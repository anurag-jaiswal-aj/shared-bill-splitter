import { env, exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { type Balance, call, createBill, createHome, type Share } from './helpers'

async function rawCall<Body = unknown>(
  method: 'GET' | 'POST',
  path: string,
  options: { rawBody?: string; headers?: Record<string, string> } = {},
) {
  const response = await exports.default.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...options.headers },
      body: options.rawBody,
    }),
  )
  const text = await response.text()
  try {
    return { status: response.status, body: JSON.parse(text) as Body }
  } catch {
    return { status: response.status, body: null as unknown as Body }
  }
}

describe('concurrency and payments edge cases', () => {
  describe('True Concurrency Test', () => {
    it('handles concurrent payment attempts: exactly one succeeds (200) and the other fails with conflict (409)', async () => {
      const { homeId } = await createHome(['Alice', 'Bob'])
      const billRes = await createBill(homeId, 1000)
      expect(billRes.status).toBe(201)

      const targetShare = billRes.body.shares[0]
      if (!targetShare) throw new Error('Share not found')

      const key1 = crypto.randomUUID()
      const key2 = crypto.randomUUID()

      // Concurrently dispatch two payments with different idempotency keys
      const [res1, res2] = await Promise.all([
        call<Share>('POST', `/api/bills/${billRes.body.id}/shares/${targetShare.id}/pay`, {
          headers: { 'Idempotency-Key': key1 },
        }),
        call<Share>('POST', `/api/bills/${billRes.body.id}/shares/${targetShare.id}/pay`, {
          headers: { 'Idempotency-Key': key2 },
        }),
      ])

      // Verify that exactly ONE request received 200 and the other received 409
      const statuses = [res1.status, res2.status].sort((a, b) => a - b)
      expect(statuses).toEqual([200, 409])

      const winningRes = res1.status === 200 ? res1 : res2
      const losingRes = res1.status === 409 ? res1 : res2
      const winningKey = res1.status === 200 ? key1 : key2
      const losingKey = res1.status === 409 ? key1 : key2

      // Verify the winning response
      expect(winningRes.body.id).toBe(targetShare.id)
      expect(typeof winningRes.body.paidAt).toBe('string')
      expect(winningRes.body.paidAt).toBeTruthy()
      expect(winningRes.body.amountCents).toBe(targetShare.amountCents)

      // Verify the losing response
      expect(losingRes.body).toEqual({ error: 'Share already paid with a different key' })

      // Verify balances reflect that the share was paid only once
      const balancesRes = await call<{ balances: Balance[] }>(
        'GET',
        `/api/homes/${homeId}/balances`,
      )
      expect(balancesRes.status).toBe(200)
      expect(balancesRes.body.balances.map((b) => b.outstandingCents)).toEqual([0, 500])

      // Subsequent replay with the winning key returns HTTP 200 with the exact same timestamp
      const replayWinningRes = await call<Share>(
        'POST',
        `/api/bills/${billRes.body.id}/shares/${targetShare.id}/pay`,
        { headers: { 'Idempotency-Key': winningKey } },
      )
      expect(replayWinningRes.status).toBe(200)
      expect(replayWinningRes.body.id).toBe(targetShare.id)
      expect(replayWinningRes.body.paidAt).toBe(winningRes.body.paidAt)

      // Subsequent replay with the losing key returns HTTP 409
      const replayLosingRes = await call<{ error: string }>(
        'POST',
        `/api/bills/${billRes.body.id}/shares/${targetShare.id}/pay`,
        { headers: { 'Idempotency-Key': losingKey } },
      )
      expect(replayLosingRes.status).toBe(409)
      expect(replayLosingRes.body).toEqual({ error: 'Share already paid with a different key' })

      // Balances remain completely unchanged after both replays
      const finalBalances = await call<{ balances: Balance[] }>(
        'GET',
        `/api/homes/${homeId}/balances`,
      )
      expect(finalBalances.body.balances.map((b) => b.outstandingCents)).toEqual([0, 500])
    })

    it('handles high concurrency: 5 concurrent payment attempts with 5 different keys on the same share', async () => {
      const { homeId } = await createHome(['Carol', 'Dave'])
      const billRes = await createBill(homeId, 2400)
      const targetShare = billRes.body.shares[0]
      if (!targetShare) throw new Error('Share not found')

      const keys = Array.from({ length: 5 }, () => crypto.randomUUID())

      const results = await Promise.all(
        keys.map((key) =>
          call<Share>('POST', `/api/bills/${billRes.body.id}/shares/${targetShare.id}/pay`, {
            headers: { 'Idempotency-Key': key },
          }),
        ),
      )

      const successCount = results.filter((r) => r.status === 200).length
      const conflictCount = results.filter((r) => r.status === 409).length

      expect(successCount).toBe(1)
      expect(conflictCount).toBe(4)

      // Check balance: 2400 / 2 = 1200 each. Carol paid once -> [0, 1200]
      const balances = await call<{ balances: Balance[] }>('GET', `/api/homes/${homeId}/balances`)
      expect(balances.body.balances.map((b) => b.outstandingCents)).toEqual([0, 1200])

      // Replaying any conflict key still gives 409
      const winningIndex = results.findIndex((r) => r.status === 200)
      const winningKey = keys[winningIndex]
      if (!winningKey) throw new Error('Winning key not found')
      const losingKeys = keys.filter((_, idx) => idx !== winningIndex)

      for (const losingKey of losingKeys) {
        const replay = await call<{ error: string }>(
          'POST',
          `/api/bills/${billRes.body.id}/shares/${targetShare.id}/pay`,
          { headers: { 'Idempotency-Key': losingKey } },
        )
        expect(replay.status).toBe(409)
      }

      // Replaying winning key gives 200 with identical paidAt
      const winnerReplay = await call<Share>(
        'POST',
        `/api/bills/${billRes.body.id}/shares/${targetShare.id}/pay`,
        { headers: { 'Idempotency-Key': winningKey } },
      )
      expect(winnerReplay.status).toBe(200)
      expect(winnerReplay.body.paidAt).toBe(results[winningIndex]?.body.paidAt)
    })

    it('handles concurrent identical-key replays: all concurrent requests return 200 with matching timestamps', async () => {
      const { homeId } = await createHome(['Elena', 'Felix'])
      const billRes = await createBill(homeId, 1800)
      const targetShare = billRes.body.shares[0]
      if (!targetShare) throw new Error('Share not found')

      const sharedKey = crypto.randomUUID()

      const [res1, res2, res3] = await Promise.all([
        call<Share>('POST', `/api/bills/${billRes.body.id}/shares/${targetShare.id}/pay`, {
          headers: { 'Idempotency-Key': sharedKey },
        }),
        call<Share>('POST', `/api/bills/${billRes.body.id}/shares/${targetShare.id}/pay`, {
          headers: { 'Idempotency-Key': sharedKey },
        }),
        call<Share>('POST', `/api/bills/${billRes.body.id}/shares/${targetShare.id}/pay`, {
          headers: { 'Idempotency-Key': sharedKey },
        }),
      ])

      expect(res1.status).toBe(200)
      expect(res2.status).toBe(200)
      expect(res3.status).toBe(200)

      expect(res1.body.paidAt).toBeTruthy()
      expect(res2.body.paidAt).toBe(res1.body.paidAt)
      expect(res3.body.paidAt).toBe(res1.body.paidAt)

      const balances = await call<{ balances: Balance[] }>('GET', `/api/homes/${homeId}/balances`)
      expect(balances.body.balances.map((b) => b.outstandingCents)).toEqual([0, 900])
    })
  })

  describe('Mismatched Bill & Share', () => {
    it('returns 404 when paying share2 under bill1', async () => {
      const { homeId } = await createHome(['Member1', 'Member2'])
      const bill1 = await createBill(homeId, 1000)
      const bill2 = await createBill(homeId, 2000)

      const share1 = bill1.body.shares[0]
      const share2 = bill2.body.shares[0]
      if (!share1 || !share2) throw new Error('Shares not created')

      // Mismatched: bill1 + share2
      const mismatch1 = await call<{ error: string }>(
        'POST',
        `/api/bills/${bill1.body.id}/shares/${share2.id}/pay`,
        { headers: { 'Idempotency-Key': crypto.randomUUID() } },
      )
      expect(mismatch1.status).toBe(404)
      expect(mismatch1.body).toEqual({ error: 'Bill or share not found' })

      // Mismatched: bill2 + share1
      const mismatch2 = await call<{ error: string }>(
        'POST',
        `/api/bills/${bill2.body.id}/shares/${share1.id}/pay`,
        { headers: { 'Idempotency-Key': crypto.randomUUID() } },
      )
      expect(mismatch2.status).toBe(404)
      expect(mismatch2.body).toEqual({ error: 'Bill or share not found' })

      // Neither share was marked as paid
      const balances = await call<{ balances: Balance[] }>('GET', `/api/homes/${homeId}/balances`)
      // bill1 (500 each) + bill2 (1000 each) = 1500 each
      expect(balances.body.balances.map((b) => b.outstandingCents)).toEqual([1500, 1500])
    })

    it('returns 404 for non-existent bill or share IDs', async () => {
      const { homeId } = await createHome(['Solo'])
      const bill = await createBill(homeId, 500)
      const validShare = bill.body.shares[0]
      if (!validShare) throw new Error('Share not found')

      const nonExistentBill = await call<{ error: string }>(
        'POST',
        `/api/bills/9999999/shares/${validShare.id}/pay`,
        { headers: { 'Idempotency-Key': crypto.randomUUID() } },
      )
      expect(nonExistentBill.status).toBe(404)
      expect(nonExistentBill.body).toEqual({ error: 'Bill or share not found' })

      const nonExistentShare = await call<{ error: string }>(
        'POST',
        `/api/bills/${bill.body.id}/shares/9999999/pay`,
        { headers: { 'Idempotency-Key': crypto.randomUUID() } },
      )
      expect(nonExistentShare.status).toBe(404)
      expect(nonExistentShare.body).toEqual({ error: 'Bill or share not found' })

      const invalidStringIds = await call<{ error: string }>(
        'POST',
        '/api/bills/notanumber/shares/alsonotanumber/pay',
        { headers: { 'Idempotency-Key': crypto.randomUUID() } },
      )
      expect(invalidStringIds.status).toBe(404)
      expect(invalidStringIds.body).toEqual({ error: 'Bill or share not found' })
    })
  })

  describe('Same key reused across two different shares', () => {
    it('allows the same Idempotency-Key for different shares and marks both paid', async () => {
      const { homeId } = await createHome(['UserA', 'UserB'])
      const bill = await createBill(homeId, 1000)

      const share1 = bill.body.shares[0]
      const share2 = bill.body.shares[1]
      if (!share1 || !share2) throw new Error('Shares not created')

      const sharedKey = `reused-key-${crypto.randomUUID()}`

      const payShare1 = await call<Share>(
        'POST',
        `/api/bills/${bill.body.id}/shares/${share1.id}/pay`,
        {
          headers: { 'Idempotency-Key': sharedKey },
        },
      )
      expect(payShare1.status).toBe(200)
      expect(payShare1.body.id).toBe(share1.id)
      expect(payShare1.body.paidAt).toBeTruthy()

      const payShare2 = await call<Share>(
        'POST',
        `/api/bills/${bill.body.id}/shares/${share2.id}/pay`,
        {
          headers: { 'Idempotency-Key': sharedKey },
        },
      )
      expect(payShare2.status).toBe(200)
      expect(payShare2.body.id).toBe(share2.id)
      expect(payShare2.body.paidAt).toBeTruthy()

      // Balances should show both shares paid: 0 outstanding cents for both
      const balances = await call<{ balances: Balance[] }>('GET', `/api/homes/${homeId}/balances`)
      expect(balances.body.balances.map((b) => b.outstandingCents)).toEqual([0, 0])

      // Replaying each share with the shared key returns 200 with their original paidAt
      const replayShare1 = await call<Share>(
        'POST',
        `/api/bills/${bill.body.id}/shares/${share1.id}/pay`,
        { headers: { 'Idempotency-Key': sharedKey } },
      )
      expect(replayShare1.status).toBe(200)
      expect(replayShare1.body.paidAt).toBe(payShare1.body.paidAt)

      const replayShare2 = await call<Share>(
        'POST',
        `/api/bills/${bill.body.id}/shares/${share2.id}/pay`,
        { headers: { 'Idempotency-Key': sharedKey } },
      )
      expect(replayShare2.status).toBe(200)
      expect(replayShare2.body.paidAt).toBe(payShare2.body.paidAt)
    })
  })

  describe('Zero-cent share uneven splits', () => {
    it('creates a bill of 2 cents with 5 members: [1, 1, 0, 0, 0] with sum = 2 and accurate balances', async () => {
      const { homeId, members } = await createHome(['M1', 'M2', 'M3', 'M4', 'M5'])

      const billRes = await createBill(homeId, 2)
      expect(billRes.status).toBe(201)
      expect(billRes.body.totalCents).toBe(2)
      expect(billRes.body.shares).toHaveLength(5)

      const shareAmounts = billRes.body.shares.map((s) => s.amountCents)
      expect(shareAmounts).toEqual([1, 1, 0, 0, 0])

      const totalSharesSum = shareAmounts.reduce((acc, curr) => acc + curr, 0)
      expect(totalSharesSum).toBe(2)

      // Verify member IDs map deterministically in order
      expect(billRes.body.shares.map((s) => s.memberId)).toEqual(members.map((m) => m.id))

      // Balances show 1 cent for first 2 members and 0 for remaining 3
      const balances = await call<{ balances: Balance[] }>('GET', `/api/homes/${homeId}/balances`)
      expect(balances.status).toBe(200)
      expect(balances.body.balances).toEqual([
        { memberId: members[0]?.id, name: 'M1', outstandingCents: 1 },
        { memberId: members[1]?.id, name: 'M2', outstandingCents: 1 },
        { memberId: members[2]?.id, name: 'M3', outstandingCents: 0 },
        { memberId: members[3]?.id, name: 'M4', outstandingCents: 0 },
        { memberId: members[4]?.id, name: 'M5', outstandingCents: 0 },
      ])

      // Paying a 0-cent share succeeds and marks it as paid
      const zeroShare = billRes.body.shares[2]
      if (!zeroShare) throw new Error('Share 2 missing')
      const payZero = await call<Share>(
        'POST',
        `/api/bills/${billRes.body.id}/shares/${zeroShare.id}/pay`,
        { headers: { 'Idempotency-Key': crypto.randomUUID() } },
      )
      expect(payZero.status).toBe(200)
      expect(payZero.body.paidAt).toBeTruthy()
      expect(payZero.body.amountCents).toBe(0)

      // Balances remain [1, 1, 0, 0, 0]
      const balancesAfterZeroPay = await call<{ balances: Balance[] }>(
        'GET',
        `/api/homes/${homeId}/balances`,
      )
      expect(balancesAfterZeroPay.body.balances.map((b) => b.outstandingCents)).toEqual([
        1, 1, 0, 0, 0,
      ])

      // Paying the first 1-cent share reduces outstanding cents to 0 for M1
      const firstShare = billRes.body.shares[0]
      if (!firstShare) throw new Error('Share 0 missing')
      const payFirst = await call<Share>(
        'POST',
        `/api/bills/${billRes.body.id}/shares/${firstShare.id}/pay`,
        { headers: { 'Idempotency-Key': crypto.randomUUID() } },
      )
      expect(payFirst.status).toBe(200)
      const balancesAfterFirstPay = await call<{ balances: Balance[] }>(
        'GET',
        `/api/homes/${homeId}/balances`,
      )
      expect(balancesAfterFirstPay.body.balances.map((b) => b.outstandingCents)).toEqual([
        0, 1, 0, 0, 0,
      ])
    })

    it('creates a bill of 1 cent with 3 members: [1, 0, 0]', async () => {
      const { homeId } = await createHome(['X', 'Y', 'Z'])
      const billRes = await createBill(homeId, 1)

      expect(billRes.status).toBe(201)
      expect(billRes.body.shares.map((s) => s.amountCents)).toEqual([1, 0, 0])
      expect(billRes.body.shares.reduce((acc, s) => acc + s.amountCents, 0)).toBe(1)

      const balances = await call<{ balances: Balance[] }>('GET', `/api/homes/${homeId}/balances`)
      expect(balances.body.balances.map((b) => b.outstandingCents)).toEqual([1, 0, 0])
    })
  })

  describe('Empty home balances', () => {
    it('returns balances with 0 outstanding cents for each member in member insertion order when home has 0 bills', async () => {
      const { homeId, members } = await createHome(['Zara', 'Arthur', 'Beatrix', 'Liam'])

      const balancesRes = await call<{ balances: Balance[] }>(
        'GET',
        `/api/homes/${homeId}/balances`,
      )
      expect(balancesRes.status).toBe(200)
      expect(balancesRes.body.balances).toEqual([
        { memberId: members[0]?.id, name: 'Zara', outstandingCents: 0 },
        { memberId: members[1]?.id, name: 'Arthur', outstandingCents: 0 },
        { memberId: members[2]?.id, name: 'Beatrix', outstandingCents: 0 },
        { memberId: members[3]?.id, name: 'Liam', outstandingCents: 0 },
      ])
    })

    it('returns empty array when home has 0 members and 0 bills', async () => {
      const { homeId } = await createHome([])

      const balancesRes = await call<{ balances: Balance[] }>(
        'GET',
        `/api/homes/${homeId}/balances`,
      )
      expect(balancesRes.status).toBe(200)
      expect(balancesRes.body.balances).toEqual([])
    })

    it('returns 404 when requesting balances for non-existent home', async () => {
      const balancesRes = await call<{ error: string }>('GET', '/api/homes/999999/balances')
      expect(balancesRes.status).toBe(404)
      expect(balancesRes.body).toEqual({ error: 'Home not found' })

      const invalidIdRes = await call<{ error: string }>('GET', '/api/homes/invalid/balances')
      expect(invalidIdRes.status).toBe(404)
      expect(invalidIdRes.body).toEqual({ error: 'Home not found' })
    })
  })

  describe('Floating point / invalid amounts', () => {
    it.each([
      { value: 10.5, desc: '10.5 (floating point number)' },
      { value: 0, desc: '0 (zero cents)' },
      { value: -500, desc: '-500 (negative cents)' },
      { value: '500', desc: '"500" (string representation)' },
      { value: null, desc: 'null' },
    ])('rejects totalCents: $desc with HTTP 422', async ({ value }) => {
      const { homeId } = await createHome(['Alpha', 'Beta'])

      const res = await call<{ error: string }>('POST', `/api/homes/${homeId}/bills`, {
        body: { title: 'Test Bill', totalCents: value },
      })
      expect(res.status).toBe(422)
      expect(res.body).toEqual({ error: 'Invalid total cents' })
    })

    it('rejects totalCents: NaN with HTTP 422', async () => {
      const { homeId } = await createHome(['Alpha', 'Beta'])

      // When passed as JS object, JSON.stringify converts NaN to null
      const res1 = await call<{ error: string }>('POST', `/api/homes/${homeId}/bills`, {
        body: { title: 'NaN bill', totalCents: Number.NaN },
      })
      expect(res1.status).toBe(422)

      // When passed as raw JSON literal with NaN
      const res2 = await rawCall<{ error: string }>('POST', `/api/homes/${homeId}/bills`, {
        rawBody: '{"title":"NaN bill","totalCents":NaN}',
      })
      expect(res2.status).toBe(422)
    })

    it('rejects totalCents: Infinity with HTTP 422', async () => {
      const { homeId } = await createHome(['Alpha', 'Beta'])

      // When passed as JS object, JSON.stringify converts Infinity to null
      const res1 = await call<{ error: string }>('POST', `/api/homes/${homeId}/bills`, {
        body: { title: 'Infinity bill', totalCents: Number.POSITIVE_INFINITY },
      })
      expect(res1.status).toBe(422)

      // When passed as raw JSON literal with Infinity
      const res2 = await rawCall<{ error: string }>('POST', `/api/homes/${homeId}/bills`, {
        rawBody: '{"title":"Infinity bill","totalCents":Infinity}',
      })
      expect(res2.status).toBe(422)

      const res3 = await rawCall<{ error: string }>('POST', `/api/homes/${homeId}/bills`, {
        rawBody: '{"title":"-Infinity bill","totalCents":-Infinity}',
      })
      expect(res3.status).toBe(422)
    })

    it('rejects non-integer, safe integer violation, boolean, array, and object for totalCents', async () => {
      const { homeId } = await createHome(['Alpha', 'Beta'])

      const invalidValues = [
        Number.MAX_SAFE_INTEGER + 10,
        true,
        false,
        [],
        [100],
        {},
        { cents: 100 },
      ]

      for (const val of invalidValues) {
        const res = await call<{ error: string }>('POST', `/api/homes/${homeId}/bills`, {
          body: { title: 'Invalid test', totalCents: val },
        })
        expect(res.status).toBe(422)
      }
    })
  })

  describe('Idempotency Key validation edge cases', () => {
    it('rejects requests with missing, empty, or whitespace-only Idempotency-Key header', async () => {
      const { homeId } = await createHome(['Member1'])
      const bill = await createBill(homeId, 1000)
      const share = bill.body.shares[0]
      if (!share) throw new Error('Share missing')

      // Missing header
      const missing = await call<{ error: string }>(
        'POST',
        `/api/bills/${bill.body.id}/shares/${share.id}/pay`,
      )
      expect(missing.status).toBe(400)
      expect(missing.body).toEqual({ error: 'Idempotency-Key header is required' })

      // Empty string
      const empty = await call<{ error: string }>(
        'POST',
        `/api/bills/${bill.body.id}/shares/${share.id}/pay`,
        { headers: { 'Idempotency-Key': '' } },
      )
      expect(empty.status).toBe(400)
      expect(empty.body).toEqual({ error: 'Idempotency-Key header is required' })

      // Whitespace only
      const whitespace = await call<{ error: string }>(
        'POST',
        `/api/bills/${bill.body.id}/shares/${share.id}/pay`,
        { headers: { 'Idempotency-Key': '    \t   ' } },
      )
      expect(whitespace.status).toBe(400)
      expect(whitespace.body).toEqual({ error: 'Idempotency-Key header is required' })
    })

    it('trims whitespace around valid Idempotency-Key header', async () => {
      const { homeId } = await createHome(['Member1'])
      const bill = await createBill(homeId, 1000)
      const share = bill.body.shares[0]
      if (!share) throw new Error('Share missing')

      const rawKey = crypto.randomUUID()
      const paddedKey = `   ${rawKey}   `

      const res = await call<Share>('POST', `/api/bills/${bill.body.id}/shares/${share.id}/pay`, {
        headers: { 'Idempotency-Key': paddedKey },
      })
      expect(res.status).toBe(200)

      // Replaying with rawKey or paddedKey matches the same idempotency key
      const replay = await call<Share>(
        'POST',
        `/api/bills/${bill.body.id}/shares/${share.id}/pay`,
        { headers: { 'Idempotency-Key': rawKey } },
      )
      expect(replay.status).toBe(200)
      expect(replay.body.paidAt).toBe(res.body.paidAt)
    })
  })

  describe('QA Idempotency & Concurrency Verification', () => {
    it('verifies points 1-6: test-key-1 replay, different key conflict, balance integrity, missing key 400, and race exclusion', async () => {
      // 5. Verify a missing Idempotency-Key returns HTTP 400
      const { homeId } = await createHome(['Alice', 'Bob'])
      const billRes = await createBill(homeId, 1000)
      expect(billRes.status).toBe(201)
      const billId = billRes.body.id
      const share1 = billRes.body.shares[0]
      const share2 = billRes.body.shares[1]
      if (!share1 || !share2) throw new Error('Shares missing')

      // Missing Idempotency-Key returns HTTP 400
      const missingKeyRes = await call<{ error: string }>(
        'POST',
        `/api/bills/${billId}/shares/${share1.id}/pay`,
      )
      expect(missingKeyRes.status).toBe(400)
      expect(missingKeyRes.body).toEqual({ error: 'Idempotency-Key header is required' })

      // Initial DB assertion: share1 is unpaid
      const initialShareInDb = await env.DB.prepare(
        'SELECT id, bill_id, member_id, amount_cents, paid_at, idempotency_key FROM shares WHERE id = ?',
      )
        .bind(Number(share1.id))
        .first<{
          id: number
          bill_id: number
          member_id: number
          amount_cents: number
          paid_at: string | null
          idempotency_key: string | null
        }>()
      expect(initialShareInDb?.paid_at).toBeNull()
      expect(initialShareInDb?.idempotency_key).toBeNull()

      // Initial balances: both owe 500
      const initialBalances = await call<{ balances: Balance[] }>(
        'GET',
        `/api/homes/${homeId}/balances`,
      )
      expect(initialBalances.status).toBe(200)
      expect(initialBalances.body.balances.map((b) => b.outstandingCents)).toEqual([500, 500])

      // 1. Pay a share with Idempotency-Key: test-key-1.
      // Expect HTTP 200 and a paidAt timestamp.
      const payRes1 = await call<Share>('POST', `/api/bills/${billId}/shares/${share1.id}/pay`, {
        headers: { 'Idempotency-Key': 'test-key-1' },
      })
      expect(payRes1.status).toBe(200)
      expect(payRes1.body.id).toBe(share1.id)
      expect(payRes1.body.memberId).toBe(share1.memberId)
      expect(payRes1.body.amountCents).toBe(500)
      expect(typeof payRes1.body.paidAt).toBe('string')
      expect(payRes1.body.paidAt).toBeTruthy()
      const originalPaidAt = payRes1.body.paidAt

      // Database assertion after point 1:
      const dbShareAfterPay1 = await env.DB.prepare(
        'SELECT id, paid_at, idempotency_key FROM shares WHERE id = ?',
      )
        .bind(Number(share1.id))
        .first<{ id: number; paid_at: string; idempotency_key: string }>()
      expect(dbShareAfterPay1?.paid_at).toBe(originalPaidAt)
      expect(dbShareAfterPay1?.idempotency_key).toBe('test-key-1')

      // Balance after payment: Alice owes 0, Bob owes 500
      const balancesAfterPay1 = await call<{ balances: Balance[] }>(
        'GET',
        `/api/homes/${homeId}/balances`,
      )
      expect(balancesAfterPay1.body.balances.map((b) => b.outstandingCents)).toEqual([0, 500])

      // 2. Repeat the exact request for the same share with the same key.
      // Expect HTTP 200 and the same original payment result.
      // Verify no duplicate payment or balance change.
      const replayRes = await call<Share>('POST', `/api/bills/${billId}/shares/${share1.id}/pay`, {
        headers: { 'Idempotency-Key': 'test-key-1' },
      })
      expect(replayRes.status).toBe(200)
      expect(replayRes.body.id).toBe(share1.id)
      expect(replayRes.body.paidAt).toBe(originalPaidAt)
      expect(replayRes.body.amountCents).toBe(500)

      // Database assertion after point 2: row unchanged
      const dbShareAfterReplay = await env.DB.prepare(
        'SELECT id, paid_at, idempotency_key FROM shares WHERE id = ?',
      )
        .bind(Number(share1.id))
        .first<{ id: number; paid_at: string; idempotency_key: string }>()
      expect(dbShareAfterReplay?.paid_at).toBe(originalPaidAt)
      expect(dbShareAfterReplay?.idempotency_key).toBe('test-key-1')

      // 3. Send a request for the already-paid share with a different key.
      // Expect HTTP 409.
      const diffKeyRes = await call<{ error: string }>(
        'POST',
        `/api/bills/${billId}/shares/${share1.id}/pay`,
        { headers: { 'Idempotency-Key': 'different-key-999' } },
      )
      expect(diffKeyRes.status).toBe(409)
      expect(diffKeyRes.body).toEqual({ error: 'Share already paid with a different key' })

      // Database assertion after point 3: key was NOT overwritten
      const dbShareAfterConflict = await env.DB.prepare(
        'SELECT id, paid_at, idempotency_key FROM shares WHERE id = ?',
      )
        .bind(Number(share1.id))
        .first<{ id: number; paid_at: string; idempotency_key: string }>()
      expect(dbShareAfterConflict?.paid_at).toBe(originalPaidAt)
      expect(dbShareAfterConflict?.idempotency_key).toBe('test-key-1')

      // 4. Verify the outstanding balance remains unchanged after both retries.
      const balancesAfterRetries = await call<{ balances: Balance[] }>(
        'GET',
        `/api/homes/${homeId}/balances`,
      )
      expect(balancesAfterRetries.status).toBe(200)
      expect(balancesAfterRetries.body.balances.map((b) => b.outstandingCents)).toEqual([0, 500])

      // 6. Verify concurrent requests for the same unpaid share cannot result in two successful payments.
      // We test this on share2 (currently unpaid)
      const concurrentKeyA = 'concurrent-key-A'
      const concurrentKeyB = 'concurrent-key-B'

      const [concurrentResA, concurrentResB] = await Promise.all([
        call<Share>('POST', `/api/bills/${billId}/shares/${share2.id}/pay`, {
          headers: { 'Idempotency-Key': concurrentKeyA },
        }),
        call<Share>('POST', `/api/bills/${billId}/shares/${share2.id}/pay`, {
          headers: { 'Idempotency-Key': concurrentKeyB },
        }),
      ])

      const statuses = [concurrentResA.status, concurrentResB.status].sort((a, b) => a - b)
      expect(statuses).toEqual([200, 409])

      const winner = concurrentResA.status === 200 ? concurrentResA : concurrentResB
      const loser = concurrentResA.status === 409 ? concurrentResA : concurrentResB
      const winningKey = concurrentResA.status === 200 ? concurrentKeyA : concurrentKeyB

      expect(winner.body.id).toBe(share2.id)
      expect(winner.body.paidAt).toBeTruthy()
      expect(loser.body).toEqual({ error: 'Share already paid with a different key' })

      // Direct DB assertion for share2: exactly 1 payment record with the winning key
      const dbShare2 = await env.DB.prepare(
        'SELECT id, paid_at, idempotency_key FROM shares WHERE id = ?',
      )
        .bind(Number(share2.id))
        .first<{ id: number; paid_at: string; idempotency_key: string }>()
      expect(dbShare2?.paid_at).toBe(winner.body.paidAt)
      expect(dbShare2?.idempotency_key).toBe(winningKey)

      // Final balance: both shares paid -> [0, 0]
      const finalBalances = await call<{ balances: Balance[] }>(
        'GET',
        `/api/homes/${homeId}/balances`,
      )
      expect(finalBalances.body.balances.map((b) => b.outstandingCents)).toEqual([0, 0])
    })
  })
})
