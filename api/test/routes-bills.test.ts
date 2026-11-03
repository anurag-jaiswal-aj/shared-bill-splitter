import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import billsRouter from '../src/routes/bills'
import { type Bill, createHome } from './helpers'

async function callBillsRoute<T = Record<string, unknown>>(
  path: string,
  options: {
    rawBody?: string
    body?: unknown
    headers?: Record<string, string>
  } = {},
) {
  let bodyStr: string | undefined
  if (options.rawBody !== undefined) {
    bodyStr = options.rawBody
  } else if (options.body !== undefined) {
    bodyStr = JSON.stringify(options.body)
  }

  const response = await billsRouter.fetch(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...options.headers,
      },
      body: bodyStr,
    }),
    env,
  )

  const text = await response.text()
  let body: unknown = null
  try {
    body = JSON.parse(text)
  } catch {
    body = null
  }

  return {
    status: response.status,
    text,
    body: body as T,
  }
}

describe('billsRouter - Bill creation and share allocation', () => {
  it('splits an even amount equally', async () => {
    const { homeId } = await createHome(['Asha', 'Ben', 'Chitra'])

    const res = await callBillsRoute<Bill>(`/api/homes/${homeId}/bills`, {
      body: { title: 'Dinner', totalCents: 3000 },
    })

    expect(res.status).toBe(201)
    expect(res.body.id).toBeDefined()
    expect(typeof res.body.id).toBe('string')
    expect(res.body.homeId).toBe(String(homeId))
    expect(res.body.title).toBe('Dinner')
    expect(res.body.totalCents).toBe(3000)
    expect(res.body.shares).toHaveLength(3)
    expect(res.body.shares.map((s) => s.amountCents)).toEqual([1000, 1000, 1000])
  })

  it('gives the extra cents to the first members, in deterministic order', async () => {
    const { homeId, members } = await createHome(['Asha', 'Ben', 'Chitra'])

    const res = await callBillsRoute<Bill>(`/api/homes/${homeId}/bills`, {
      body: { title: 'Groceries', totalCents: 1000 },
    })

    expect(res.status).toBe(201)
    expect(res.body.shares.map((s) => s.memberId)).toEqual(members.map((m) => m.id))
    expect(res.body.shares.map((s) => s.amountCents)).toEqual([334, 333, 333])
    expect(res.body.shares.every((s) => s.paidAt === null)).toBe(true)
    for (const share of res.body.shares) {
      expect(typeof share.id).toBe('string')
      expect(typeof share.memberId).toBe('string')
    }
  })

  it('guarantees the sum of all shares strictly equals total cents', async () => {
    const { homeId } = await createHome(['Asha', 'Ben', 'Chitra', 'Dev', 'Esha', 'Farid', 'Gita'])

    const res = await callBillsRoute<Bill>(`/api/homes/${homeId}/bills`, {
      body: { title: 'Bulk shopping', totalCents: 100001 },
    })

    expect(res.status).toBe(201)
    const sum = res.body.shares.reduce((total, s) => total + s.amountCents, 0)
    expect(sum).toBe(100001)
  })

  it('gives the whole amount to a home with one member', async () => {
    const { homeId } = await createHome(['Solo Member'])

    const res = await callBillsRoute<Bill>(`/api/homes/${homeId}/bills`, {
      body: { title: 'Internet', totalCents: 4999 },
    })

    expect(res.status).toBe(201)
    expect(res.body.shares.map((s) => s.amountCents)).toEqual([4999])
  })

  it('trims whitespace from bill title', async () => {
    const { homeId } = await createHome(['Asha'])

    const res = await callBillsRoute<Bill>(`/api/homes/${homeId}/bills`, {
      body: { title: '  Electric Bill \n\t ', totalCents: 1200 },
    })

    expect(res.status).toBe(201)
    expect(res.body.title).toBe('Electric Bill')
  })

  it('rejects a home with no members with 422', async () => {
    const { homeId } = await createHome([])

    const res = await callBillsRoute(`/api/homes/${homeId}/bills`, {
      body: { title: 'Water', totalCents: 1000 },
    })

    expect(res.status).toBe(422)
    expect(res.body).toEqual({ error: 'Home has no members' })
  })

  it('rejects invalid or missing totalCents with 422', async () => {
    const { homeId } = await createHome(['Asha', 'Ben'])

    const invalidAmounts = [
      0,
      -100,
      -1,
      10.5,
      '1000',
      null,
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 10,
    ]

    for (const totalCents of invalidAmounts) {
      const res = await callBillsRoute(`/api/homes/${homeId}/bills`, {
        body: { title: 'Rent', totalCents },
      })
      expect(res.status).toBe(422)
      expect(res.body).toEqual({ error: 'Invalid total cents' })
    }
  })

  it('rejects invalid or missing title with 422', async () => {
    const { homeId } = await createHome(['Asha'])

    const invalidTitles = ['', '   ', '\t\n', null, 123, true, {}, []]

    for (const title of invalidTitles) {
      const res = await callBillsRoute(`/api/homes/${homeId}/bills`, {
        body: { title, totalCents: 5000 },
      })
      expect(res.status).toBe(422)
      expect(res.body).toEqual({ error: 'Title is required' })
    }

    const missingTitleRes = await callBillsRoute(`/api/homes/${homeId}/bills`, {
      body: { totalCents: 5000 },
    })
    expect(missingTitleRes.status).toBe(422)
    expect(missingTitleRes.body).toEqual({ error: 'Title is required' })
  })

  it('rejects malformed or non-object bodies with 422', async () => {
    const { homeId } = await createHome(['Asha'])

    const emptyRes = await callBillsRoute(`/api/homes/${homeId}/bills`, { rawBody: '' })
    expect(emptyRes.status).toBe(422)
    expect(emptyRes.body).toEqual({ error: 'Invalid request body' })

    const malformedRes = await callBillsRoute(`/api/homes/${homeId}/bills`, {
      rawBody: '{"broken": json',
    })
    expect(malformedRes.status).toBe(422)
    expect(malformedRes.body).toEqual({ error: 'Invalid request body' })

    const nonObjectBodies = ['null', '123', 'true', '"a string"', '[]', '[1, 2, 3]']
    for (const rawBody of nonObjectBodies) {
      const res = await callBillsRoute(`/api/homes/${homeId}/bills`, { rawBody })
      expect(res.status).toBe(422)
      expect(res.body).toEqual({ error: 'Invalid request body' })
    }
  })

  it('returns 404 when home does not exist or invalid homeId format', async () => {
    const invalidIds = ['does-not-exist', '-1', 'abc', '1.5', '0', 'undefined', 'null', ' 1 ']
    for (const homeId of invalidIds) {
      const res = await callBillsRoute(`/api/homes/${homeId}/bills`, {
        body: { title: 'Dinner', totalCents: 1000 },
      })
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'Home not found' })
    }

    const nonexistentRes = await callBillsRoute('/api/homes/999999/bills', {
      body: { title: 'Dinner', totalCents: 1000 },
    })
    expect(nonexistentRes.status).toBe(404)
    expect(nonexistentRes.body).toEqual({ error: 'Home not found' })
  })

  it('verifies records are correctly inserted into DB', async () => {
    const { homeId, members } = await createHome(['Asha', 'Ben'])

    const res = await callBillsRoute<Bill>(`/api/homes/${homeId}/bills`, {
      body: { title: 'Water', totalCents: 500 },
    })

    expect(res.status).toBe(201)
    const billId = Number(res.body.id)

    const billInDb = await env.DB.prepare(
      'SELECT id, home_id, title, total_cents FROM bills WHERE id = ?',
    )
      .bind(billId)
      .first<{ id: number; home_id: number; title: string; total_cents: number }>()

    expect(billInDb).not.toBeNull()
    expect(billInDb?.title).toBe('Water')
    expect(billInDb?.total_cents).toBe(500)
    expect(billInDb?.home_id).toBe(Number(homeId))

    const sharesInDb = await env.DB.prepare(
      'SELECT id, bill_id, member_id, amount_cents, paid_at FROM shares WHERE bill_id = ? ORDER BY id ASC',
    )
      .bind(billId)
      .all<{
        id: number
        bill_id: number
        member_id: number
        amount_cents: number
        paid_at: string | null
      }>()

    expect(sharesInDb.results).toHaveLength(2)
    expect(sharesInDb.results[0]?.member_id).toBe(Number(members[0]?.id))
    expect(sharesInDb.results[0]?.amount_cents).toBe(250)
    expect(sharesInDb.results[0]?.paid_at).toBeNull()
    expect(sharesInDb.results[1]?.member_id).toBe(Number(members[1]?.id))
    expect(sharesInDb.results[1]?.amount_cents).toBe(250)
    expect(sharesInDb.results[1]?.paid_at).toBeNull()
  })

  it('supports alternative mount paths', async () => {
    const { homeId } = await createHome(['Asha'])

    // /homes/:homeId/bills
    const res1 = await callBillsRoute<Bill>(`/homes/${homeId}/bills`, {
      body: { title: 'Gas', totalCents: 1500 },
    })
    expect(res1.status).toBe(201)

    // /:homeId/bills
    const res2 = await callBillsRoute<Bill>(`/${homeId}/bills`, {
      body: { title: 'Trash', totalCents: 800 },
    })
    expect(res2.status).toBe(201)
  })

  describe('Bill creation atomicity and transactional integrity', () => {
    it('TEST A — Multiple shares: creates 1 bill with 3 shares, verifying exact amounts, ordering, sum, and DB foreign keys', async () => {
      const { homeId, members } = await createHome(['Asha', 'Ben', 'Chitra'])

      const res = await callBillsRoute<Bill>(`/api/homes/${homeId}/bills`, {
        body: { title: 'Dinner', totalCents: 1000 },
      })

      expect(res.status).toBe(201)
      const billId = Number(res.body.id)

      // 1. Verify exactly one bill exists in DB
      const billsInDb = await env.DB.prepare(
        'SELECT id, home_id, title, total_cents FROM bills WHERE home_id = ?',
      )
        .bind(Number(homeId))
        .all<{ id: number; home_id: number; title: string; total_cents: number }>()

      expect(billsInDb.results).toHaveLength(1)
      expect(billsInDb.results[0]?.id).toBe(billId)
      expect(billsInDb.results[0]?.title).toBe('Dinner')
      expect(billsInDb.results[0]?.total_cents).toBe(1000)

      // 2. Verify exactly three shares exist in DB
      const sharesInDb = await env.DB.prepare(
        'SELECT id, bill_id, member_id, amount_cents, paid_at FROM shares WHERE bill_id = ? ORDER BY id ASC',
      )
        .bind(billId)
        .all<{
          id: number
          bill_id: number
          member_id: number
          amount_cents: number
          paid_at: string | null
        }>()

      expect(sharesInDb.results).toHaveLength(3)

      // 3. Verify every share references the newly created bill ID
      for (const s of sharesInDb.results) {
        expect(s.bill_id).toBe(billId)
      }

      // 4. Verify each member has exactly one share
      const memberIdsInShares = sharesInDb.results.map((s) => s.member_id)
      const expectedMemberIds = members.map((m) => Number(m.id))
      expect(memberIdsInShares).toEqual(expectedMemberIds)
      expect(new Set(memberIdsInShares).size).toBe(3)

      // 5. Verify amounts are 334, 333, 333 in member insertion order
      const amounts = sharesInDb.results.map((s) => s.amount_cents)
      expect(amounts).toEqual([334, 333, 333])

      // 6. Verify their sum is exactly 1000
      const sum = amounts.reduce((acc, val) => acc + val, 0)
      expect(sum).toBe(1000)
    })

    it('TEST B — Repeated bill creation: second bill shares reference only the second bill ID', async () => {
      const { homeId } = await createHome(['Asha', 'Ben'])

      // First bill
      const res1 = await callBillsRoute<Bill>(`/api/homes/${homeId}/bills`, {
        body: { title: 'First Bill', totalCents: 1000 },
      })
      expect(res1.status).toBe(201)
      const bill1Id = Number(res1.body.id)

      // Second bill
      const res2 = await callBillsRoute<Bill>(`/api/homes/${homeId}/bills`, {
        body: { title: 'Second Bill', totalCents: 2000 },
      })
      expect(res2.status).toBe(201)
      const bill2Id = Number(res2.body.id)

      expect(bill2Id).toBeGreaterThan(bill1Id)

      // Verify bill 1 shares in DB
      const bill1Shares = await env.DB.prepare(
        'SELECT id, bill_id, member_id, amount_cents FROM shares WHERE bill_id = ? ORDER BY id ASC',
      )
        .bind(bill1Id)
        .all<{ id: number; bill_id: number; member_id: number; amount_cents: number }>()

      expect(bill1Shares.results).toHaveLength(2)
      for (const s of bill1Shares.results) {
        expect(s.bill_id).toBe(bill1Id)
        expect(s.amount_cents).toBe(500)
      }

      // Verify bill 2 shares in DB
      const bill2Shares = await env.DB.prepare(
        'SELECT id, bill_id, member_id, amount_cents FROM shares WHERE bill_id = ? ORDER BY id ASC',
      )
        .bind(bill2Id)
        .all<{ id: number; bill_id: number; member_id: number; amount_cents: number }>()

      expect(bill2Shares.results).toHaveLength(2)
      for (const s of bill2Shares.results) {
        expect(s.bill_id).toBe(bill2Id)
        expect(s.amount_cents).toBe(1000)
      }

      // Ensure no share from bill 2 was accidentally associated with bill 1
      const bill1ShareIds = bill1Shares.results.map((s) => s.id)
      const bill2ShareIds = bill2Shares.results.map((s) => s.id)
      for (const id of bill2ShareIds) {
        expect(bill1ShareIds).not.toContain(id)
      }
    })

    it('TEST C — Rollback: demonstrates atomic rollback when share insertion fails via deterministic constraint violation', async () => {
      const { homeId } = await createHome(['Asha', 'Ben'])

      // Create a pre-existing bill to verify it remains untouched
      const preRes = await callBillsRoute<Bill>(`/api/homes/${homeId}/bills`, {
        body: { title: 'Pre-existing Rent', totalCents: 3000 },
      })
      expect(preRes.status).toBe(201)
      const preExistingBillId = Number(preRes.body.id)

      // Add a deterministic database constraint trigger that aborts share insertion for amount_cents = 777777
      await env.DB.prepare(
        `CREATE TRIGGER test_fail_share_insert
         BEFORE INSERT ON shares
         WHEN NEW.amount_cents = 777777
         BEGIN
           SELECT RAISE(ABORT, 'Deterministic database constraint violation on share insert');
         END;`,
      ).run()

      try {
        // Call the actual bill creation endpoint with totalCents = 1555554 (each of 2 members gets 777777 cents)
        const failRes = await callBillsRoute(`/api/homes/${homeId}/bills`, {
          body: { title: 'Failing Bill', totalCents: 1555554 },
        })

        // Request must fail with expected JSON error response (500)
        expect(failRes.status).toBe(500)
        expect(failRes.body).toHaveProperty('error')

        // Verify that the failing bill was rolled back: 0 rows exist with title 'Failing Bill'
        const failingBills = await env.DB.prepare(
          'SELECT id, home_id, title FROM bills WHERE title = ?',
        )
          .bind('Failing Bill')
          .all<{ id: number; home_id: number; title: string }>()

        expect(failingBills.results).toHaveLength(0)

        // Verify that no shares were created for amount_cents = 777777
        const failingShares = await env.DB.prepare(
          'SELECT id, bill_id, amount_cents FROM shares WHERE amount_cents = 777777',
        ).all<{ id: number; bill_id: number; amount_cents: number }>()

        expect(failingShares.results).toHaveLength(0)

        // Verify pre-existing bill and shares remain completely untouched
        const preBillInDb = await env.DB.prepare(
          'SELECT id, title, total_cents FROM bills WHERE id = ?',
        )
          .bind(preExistingBillId)
          .first<{ id: number; title: string; total_cents: number }>()

        expect(preBillInDb).not.toBeNull()
        expect(preBillInDb?.title).toBe('Pre-existing Rent')
        expect(preBillInDb?.total_cents).toBe(3000)

        const preSharesInDb = await env.DB.prepare(
          'SELECT id, bill_id, amount_cents FROM shares WHERE bill_id = ?',
        )
          .bind(preExistingBillId)
          .all<{ id: number; bill_id: number; amount_cents: number }>()

        expect(preSharesInDb.results).toHaveLength(2)
      } finally {
        // Clean up the trigger
        await env.DB.prepare('DROP TRIGGER IF EXISTS test_fail_share_insert;').run()
      }
    })

    it('TEST D — Zero/one member edge cases: handles no-member and one-member homes correctly', async () => {
      // 1. Zero-member home
      const { homeId: emptyHomeId } = await createHome([])

      const zeroRes = await callBillsRoute(`/api/homes/${emptyHomeId}/bills`, {
        body: { title: 'No member bill', totalCents: 1000 },
      })

      expect(zeroRes.status).toBe(422)
      expect(zeroRes.body).toEqual({ error: 'Home has no members' })

      // Verify no bill was created in DB
      const billsInEmptyHome = await env.DB.prepare('SELECT id FROM bills WHERE home_id = ?')
        .bind(Number(emptyHomeId))
        .all<{ id: number }>()

      expect(billsInEmptyHome.results).toHaveLength(0)

      // 2. One-member home
      const { homeId: soloHomeId, members: soloMembers } = await createHome(['Solo Resident'])

      const soloRes = await callBillsRoute<Bill>(`/api/homes/${soloHomeId}/bills`, {
        body: { title: 'Internet', totalCents: 4999 },
      })

      expect(soloRes.status).toBe(201)
      expect(soloRes.body.totalCents).toBe(4999)
      expect(soloRes.body.shares).toHaveLength(1)
      expect(soloRes.body.shares[0]?.amountCents).toBe(4999)
      expect(soloRes.body.shares[0]?.memberId).toBe(soloMembers[0]?.id)

      // Verify in DB directly
      const soloBillInDb = await env.DB.prepare(
        'SELECT id, total_cents FROM bills WHERE home_id = ?',
      )
        .bind(Number(soloHomeId))
        .all<{ id: number; total_cents: number }>()

      expect(soloBillInDb.results).toHaveLength(1)
      expect(soloBillInDb.results[0]?.total_cents).toBe(4999)

      const soloSharesInDb = await env.DB.prepare(
        'SELECT id, bill_id, member_id, amount_cents FROM shares WHERE bill_id = ?',
      )
        .bind(soloBillInDb.results[0]?.id)
        .all<{ id: number; bill_id: number; member_id: number; amount_cents: number }>()

      expect(soloSharesInDb.results).toHaveLength(1)
      expect(soloSharesInDb.results[0]?.amount_cents).toBe(4999)
      expect(soloSharesInDb.results[0]?.member_id).toBe(Number(soloMembers[0]?.id))
    })
  })
})
