import { describe, expect, it } from 'vitest'
import { type Bill, call, createBill, createHome, type Share } from './helpers'

function getBills(homeId: string, pathPrefix = '/api') {
  return call<{ bills: Bill[] }>('GET', `${pathPrefix}/homes/${homeId}/bills`)
}

function pay(billId: string, shareId: string, key?: string) {
  return call<Share>('POST', `/api/bills/${billId}/shares/${shareId}/pay`, {
    headers: key ? { 'Idempotency-Key': key } : {},
  })
}

describe('GET /api/homes/:homeId/bills', () => {
  describe('validation and error handling', () => {
    it.each(['does-not-exist', '-1', 'abc', '1.5', '0', 'undefined', 'null', ' 1 '])(
      'returns 404 for invalid homeId format: %j',
      async (invalidId) => {
        const res = await call('GET', `/api/homes/${invalidId}/bills`)
        expect(res.status).toBe(404)
        expect(res.body).toEqual({ error: 'Home not found' })
      },
    )

    it('returns 404 when home does not exist in the database', async () => {
      const res = await call('GET', '/api/homes/999999/bills')
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'Home not found' })
    })
  })

  describe('empty bills list', () => {
    it('returns 200 with empty bills array for a home with members but no bills', async () => {
      const { homeId } = await createHome(['Alice', 'Bob'])

      const res = await getBills(homeId)
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ bills: [] })
    })

    it('returns 200 with empty bills array for a home with no members and no bills', async () => {
      const { homeId } = await createHome([])

      const res = await getBills(homeId)
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ bills: [] })
    })
  })

  describe('query and nested shares deterministic order', () => {
    it('returns 200 with all bills and nested shares in deterministic ascending order', async () => {
      const { homeId, members } = await createHome(['Asha', 'Ben', 'Chitra'])

      // Create two bills
      const bill1Res = await call<Bill>('POST', `/api/homes/${homeId}/bills`, {
        body: { title: 'First Bill', totalCents: 1000 },
      })
      const bill2Res = await call<Bill>('POST', `/api/homes/${homeId}/bills`, {
        body: { title: 'Second Bill', totalCents: 3000 },
      })

      expect(bill1Res.status).toBe(201)
      expect(bill2Res.status).toBe(201)

      const res = await getBills(homeId)
      expect(res.status).toBe(200)
      expect(res.body.bills).toHaveLength(2)

      const firstBill = res.body.bills[0]
      const secondBill = res.body.bills[1]
      if (!firstBill || !secondBill) {
        throw new Error('Expected two bills to be returned')
      }

      // Deterministic order of bills (ORDER BY id ASC)
      expect(Number(firstBill.id)).toBeLessThan(Number(secondBill.id))
      expect(firstBill.id).toBe(bill1Res.body.id)
      expect(firstBill.homeId).toBe(String(homeId))
      expect(firstBill.title).toBe('First Bill')
      expect(firstBill.totalCents).toBe(1000)

      expect(secondBill.id).toBe(bill2Res.body.id)
      expect(secondBill.homeId).toBe(String(homeId))
      expect(secondBill.title).toBe('Second Bill')
      expect(secondBill.totalCents).toBe(3000)

      // Check shares for first bill
      expect(firstBill.shares).toHaveLength(3)
      expect(firstBill.shares.map((s) => s.memberId)).toEqual(members.map((m) => m.id))
      expect(firstBill.shares.map((s) => s.amountCents)).toEqual([334, 333, 333])
      expect(firstBill.shares.every((s) => s.paidAt === null)).toBe(true)

      // Ensure all IDs are string-serialized
      for (const share of firstBill.shares) {
        expect(typeof share.id).toBe('string')
        expect(typeof share.memberId).toBe('string')
      }

      // Check shares for second bill
      expect(secondBill.shares).toHaveLength(3)
      expect(secondBill.shares.map((s) => s.memberId)).toEqual(members.map((m) => m.id))
      expect(secondBill.shares.map((s) => s.amountCents)).toEqual([1000, 1000, 1000])
      expect(secondBill.shares.every((s) => s.paidAt === null)).toBe(true)
      for (const share of secondBill.shares) {
        expect(typeof share.id).toBe('string')
        expect(typeof share.memberId).toBe('string')
      }
    })

    it('correctly reflects paidAt timestamp when a share has been paid', async () => {
      const { homeId } = await createHome(['Asha', 'Ben'])

      const billRes = await createBill(homeId, 1000)
      expect(billRes.status).toBe(201)
      const billId = billRes.body.id
      const firstShare = billRes.body.shares[0]
      const secondShare = billRes.body.shares[1]
      if (!firstShare || !secondShare) {
        throw new Error('Expected two shares to be created')
      }

      // Pay first share
      const payKey = crypto.randomUUID()
      const payRes = await pay(billId, firstShare.id, payKey)
      expect(payRes.status).toBe(200)
      expect(payRes.body.paidAt).toEqual(expect.any(String))

      const res = await getBills(homeId)
      expect(res.status).toBe(200)
      expect(res.body.bills).toHaveLength(1)

      const fetchedBill = res.body.bills[0]
      if (!fetchedBill) {
        throw new Error('Expected bill to be returned')
      }
      expect(fetchedBill.shares).toHaveLength(2)

      const fetchedFirstShare = fetchedBill.shares[0]
      const fetchedSecondShare = fetchedBill.shares[1]
      if (!fetchedFirstShare || !fetchedSecondShare) {
        throw new Error('Expected two shares in fetched bill')
      }

      expect(fetchedFirstShare.id).toBe(firstShare.id)
      expect(fetchedFirstShare.paidAt).toBe(payRes.body.paidAt)
      expect(typeof fetchedFirstShare.paidAt).toBe('string')

      expect(fetchedSecondShare.id).toBe(secondShare.id)
      expect(fetchedSecondShare.paidAt).toBeNull()
    })

    it('supports route mount flexibility with /homes/:homeId/bills', async () => {
      const { homeId } = await createHome(['Asha'])
      await createBill(homeId, 500)

      const res = await call<{ bills: Bill[] }>('GET', `/homes/${homeId}/bills`)
      expect(res.status).toBe(200)
      expect(res.body.bills).toHaveLength(1)
      expect(res.body.bills[0]?.homeId).toBe(String(homeId))
      expect(res.body.bills[0]?.totalCents).toBe(500)
    })
  })
})
