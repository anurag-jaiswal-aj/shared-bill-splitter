import type { Context } from 'hono'
import { Hono } from 'hono'
import { parsePositiveIntegerParam } from '../validation'

const billsRouter = new Hono<{ Bindings: Env }>()

/**
 * Safely parses request body as a JSON object record.
 * Returns null if the body is empty, malformed JSON, or not a plain object.
 */
async function parseJsonBody(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const text = await c.req.text()
    if (!text.trim()) {
      return null
    }
    const parsed: unknown = JSON.parse(text)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

/**
 * Handles creation of a bill and deterministic allocation of shares to all home members.
 */
async function handleCreateBill(c: Context<{ Bindings: Env }>) {
  const homeId = parsePositiveIntegerParam(c.req.param('homeId'))
  if (homeId === null) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: number }>()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const body = await parseJsonBody(c)
  if (!body) {
    return c.json({ error: 'Invalid request body' }, 422)
  }

  const rawTitle = body.title
  if (typeof rawTitle !== 'string' || rawTitle.trim().length === 0) {
    return c.json({ error: 'Title is required' }, 422)
  }
  const title = rawTitle.trim()

  const rawTotalCents = body.totalCents
  if (
    typeof rawTotalCents !== 'number' ||
    !Number.isInteger(rawTotalCents) ||
    rawTotalCents <= 0 ||
    !Number.isSafeInteger(rawTotalCents)
  ) {
    return c.json({ error: 'Invalid total cents' }, 422)
  }
  const totalCents = rawTotalCents

  const membersResult = await c.env.DB.prepare(
    'SELECT id FROM members WHERE home_id = ? ORDER BY id ASC',
  )
    .bind(home.id)
    .all<{ id: number }>()

  const members = membersResult.results ?? []
  if (members.length === 0) {
    return c.json({ error: 'Home has no members' }, 422)
  }

  const memberCount = members.length
  const baseCents = Math.floor(totalCents / memberCount)
  const remainder = totalCents % memberCount

  const sharesToInsert: Array<{ memberId: number; amountCents: number }> = []
  for (let i = 0; i < memberCount; i++) {
    const member = members[i]
    if (!member) {
      continue
    }
    const amountCents = baseCents + (i < remainder ? 1 : 0)
    sharesToInsert.push({
      memberId: member.id,
      amountCents,
    })
  }

  const billStmt = c.env.DB.prepare(
    'INSERT INTO bills (home_id, title, total_cents) VALUES (?, ?, ?) RETURNING id, home_id, title, total_cents',
  ).bind(home.id, title, totalCents)

  const sharePlaceholders = sharesToInsert.map(() => '(last_insert_rowid(), ?, ?)').join(', ')
  const shareBindings: Array<number> = []
  for (const s of sharesToInsert) {
    shareBindings.push(s.memberId, s.amountCents)
  }

  const sharesStmt = c.env.DB.prepare(
    `INSERT INTO shares (bill_id, member_id, amount_cents) VALUES ${sharePlaceholders} RETURNING id, member_id, amount_cents, paid_at`,
  ).bind(...shareBindings)

  type BillRow = { id: number; home_id: number; title: string; total_cents: number }
  type ShareRowResult = {
    id: number
    member_id: number
    amount_cents: number
    paid_at: string | null
  }

  let billResult: D1Result<BillRow> | undefined
  let sharesResult: D1Result<ShareRowResult> | undefined

  try {
    const results = await c.env.DB.batch([billStmt, sharesStmt])
    billResult = results[0] as D1Result<BillRow>
    sharesResult = results[1] as D1Result<ShareRowResult>
  } catch {
    return c.json({ error: 'Failed to create bill' }, 500)
  }

  const billRow = billResult?.results?.[0] as BillRow | undefined
  if (!billRow) {
    return c.json({ error: 'Failed to create bill' }, 500)
  }

  const shareRows = (sharesResult?.results ?? []) as ShareRowResult[]
  if (shareRows.length !== sharesToInsert.length) {
    return c.json({ error: 'Failed to create bill shares' }, 500)
  }

  const shares = shareRows.map((row) => ({
    id: String(row.id),
    memberId: String(row.member_id),
    amountCents: row.amount_cents,
    paidAt: null,
  }))

  return c.json(
    {
      id: String(billRow.id),
      homeId: String(billRow.home_id),
      title: billRow.title,
      totalCents: billRow.total_cents,
      shares,
    },
    201,
  )
}

type BillRow = {
  id: number
  home_id: number
  title: string
  total_cents: number
}

type ShareRow = {
  id: number
  bill_id: number
  member_id: number
  amount_cents: number
  paid_at: string | null
}

type ShareResponse = {
  id: string
  memberId: string
  amountCents: number
  paidAt: string | null
}

type BillResponse = {
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: ShareResponse[]
}

/**
 * Handles fetching all bills and their nested shares for a specific home in deterministic order.
 */
async function handleGetBills(c: Context<{ Bindings: Env }>) {
  const homeId = parsePositiveIntegerParam(c.req.param('homeId'))
  if (homeId === null) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: number }>()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const billsResult = await c.env.DB.prepare(
    'SELECT id, home_id, title, total_cents FROM bills WHERE home_id = ? ORDER BY id ASC',
  )
    .bind(home.id)
    .all<BillRow>()

  const billRows = billsResult.results ?? []
  if (billRows.length === 0) {
    return c.json({ bills: [] }, 200)
  }

  const placeholders = billRows.map(() => '?').join(', ')
  const sharesResult = await c.env.DB.prepare(
    `SELECT id, bill_id, member_id, amount_cents, paid_at FROM shares WHERE bill_id IN (${placeholders}) ORDER BY id ASC`,
  )
    .bind(...billRows.map((b) => b.id))
    .all<ShareRow>()

  const shareRows = sharesResult.results ?? []

  const sharesByBillId = new Map<number, ShareResponse[]>()
  for (const bill of billRows) {
    sharesByBillId.set(bill.id, [])
  }

  for (const share of shareRows) {
    const list = sharesByBillId.get(share.bill_id)
    if (list) {
      list.push({
        id: String(share.id),
        memberId: String(share.member_id),
        amountCents: share.amount_cents,
        paidAt:
          share.paid_at !== null && share.paid_at !== undefined ? String(share.paid_at) : null,
      })
    }
  }

  const bills: BillResponse[] = billRows.map((bill) => ({
    id: String(bill.id),
    homeId: String(bill.home_id),
    title: bill.title,
    totalCents: bill.total_cents,
    shares: sharesByBillId.get(bill.id) ?? [],
  }))

  return c.json({ bills }, 200)
}

// Support multiple mount paths so Lead Engineer can mount at root, /api, or /api/homes
billsRouter.post('/api/homes/:homeId/bills', handleCreateBill)
billsRouter.post('/homes/:homeId/bills', handleCreateBill)
billsRouter.post('/:homeId/bills', handleCreateBill)
billsRouter.post('/', async (c, next) => {
  if (!c.req.param('homeId')) {
    return next()
  }
  return handleCreateBill(c)
})

billsRouter.get('/api/homes/:homeId/bills', handleGetBills)
billsRouter.get('/homes/:homeId/bills', handleGetBills)
billsRouter.get('/:homeId/bills', handleGetBills)
billsRouter.get('/', async (c, next) => {
  if (!c.req.param('homeId')) {
    return next()
  }
  return handleGetBills(c)
})

export { billsRouter }
export default billsRouter
