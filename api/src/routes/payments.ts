import type { Context } from 'hono'
import { Hono } from 'hono'
import { parsePositiveIntegerParam } from '../validation'

type UpdatedShareRow = {
  id: number
  member_id: number
  amount_cents: number
  paid_at: string
}

type ExistingShareRow = {
  id: number
  bill_id: number
  member_id: number
  amount_cents: number
  paid_at: string | null
  idempotency_key: string | null
}

type BalanceRow = {
  memberId: number
  name: string
  outstandingCents: number
}

export const paymentsRouter = new Hono<{ Bindings: Env }>()

async function handlePay(c: Context<{ Bindings: Env }>) {
  const rawKey = c.req.header('Idempotency-Key') ?? c.req.header('idempotency-key')
  if (!rawKey || typeof rawKey !== 'string' || !rawKey.trim()) {
    return c.json({ error: 'Idempotency-Key header is required' }, 400)
  }
  const idempotencyKey = rawKey.trim()

  const billId = parsePositiveIntegerParam(c.req.param('billId'))
  const shareId = parsePositiveIntegerParam(c.req.param('shareId'))

  if (billId === null || shareId === null) {
    return c.json({ error: 'Bill or share not found' }, 404)
  }

  const now = new Date().toISOString()

  // Concurrency & Atomicity: execute the atomic conditional update directly without read-before-write
  const updatedShare = await c.env.DB.prepare(
    `UPDATE shares
     SET paid_at = ?1, idempotency_key = ?2
     WHERE id = ?3 AND bill_id = ?4 AND paid_at IS NULL
     RETURNING id, member_id, amount_cents, paid_at;`,
  )
    .bind(now, idempotencyKey, shareId, billId)
    .first<UpdatedShareRow>()

  if (updatedShare) {
    return c.json(
      {
        id: String(updatedShare.id),
        memberId: String(updatedShare.member_id),
        amountCents: updatedShare.amount_cents,
        paidAt: updatedShare.paid_at,
      },
      200,
    )
  }

  // If no row was updated, fetch the share to differentiate between 404, 409, and idempotent 200 replay
  const existingShare = await c.env.DB.prepare(
    'SELECT id, bill_id, member_id, amount_cents, paid_at, idempotency_key FROM shares WHERE id = ?',
  )
    .bind(shareId)
    .first<ExistingShareRow>()

  if (!existingShare || existingShare.bill_id !== billId) {
    return c.json({ error: 'Bill or share not found' }, 404)
  }

  if (existingShare.paid_at !== null) {
    if (existingShare.idempotency_key === idempotencyKey) {
      return c.json(
        {
          id: String(existingShare.id),
          memberId: String(existingShare.member_id),
          amountCents: existingShare.amount_cents,
          paidAt: existingShare.paid_at,
        },
        200,
      )
    }
    return c.json({ error: 'Share already paid with a different key' }, 409)
  }

  return c.json({ error: 'Failed to process payment' }, 500)
}

async function handleBalances(c: Context<{ Bindings: Env }>) {
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

  const { results } = await c.env.DB.prepare(
    `SELECT
       m.id AS memberId,
       m.name AS name,
       COALESCE(SUM(
         CASE WHEN s.paid_at IS NULL AND s.id IS NOT NULL THEN s.amount_cents ELSE 0 END
       ), 0) AS outstandingCents
     FROM members m
     LEFT JOIN shares s ON s.member_id = m.id
     WHERE m.home_id = ?
     GROUP BY m.id, m.name
     ORDER BY m.id ASC;`,
  )
    .bind(home.id)
    .all<BalanceRow>()

  const balances = (results ?? []).map((row) => ({
    memberId: String(row.memberId),
    name: row.name,
    outstandingCents: Number(row.outstandingCents),
  }))

  return c.json({ balances }, 200)
}

// Support both `/api/...` and non-`/api` paths for flexible mounting
paymentsRouter.post('/api/bills/:billId/shares/:shareId/pay', handlePay)
paymentsRouter.post('/bills/:billId/shares/:shareId/pay', handlePay)

paymentsRouter.get('/api/homes/:homeId/balances', handleBalances)
paymentsRouter.get('/homes/:homeId/balances', handleBalances)

export default paymentsRouter
