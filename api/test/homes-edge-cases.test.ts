import { env, exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { call } from './helpers'

async function rawRequest(
  method: 'GET' | 'POST',
  path: string,
  options: { rawBody?: string; headers?: Record<string, string> } = {},
) {
  const response = await exports.default.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...options.headers,
      },
      body: options.rawBody,
    }),
  )
  const text = await response.text()
  let body: Record<string, unknown> | null = null
  try {
    body = JSON.parse(text)
  } catch {
    body = null
  }
  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    text,
    body,
  }
}

describe('homes and members edge cases', () => {
  describe('whitespace-only and invalid names', () => {
    it('rejects whitespace-only names when creating a home', async () => {
      const whitespaceVariants = ['   ', '\t\n', '\r\n  \t  ']
      for (const name of whitespaceVariants) {
        const res = await call<{ error: string }>('POST', '/api/homes', {
          body: { name },
        })
        expect(res.status).toBe(400)
        expect(res.body).toEqual({ error: 'Home name is required' })
      }
    })

    it('rejects empty string name when creating a home', async () => {
      const res = await call<{ error: string }>('POST', '/api/homes', {
        body: { name: '' },
      })
      expect(res.status).toBe(400)
      expect(res.body).toEqual({ error: 'Home name is required' })
    })

    it('trims leading and trailing whitespace from home name', async () => {
      const res = await call<{ id: string; name: string }>('POST', '/api/homes', {
        body: { name: '   Cozy Cottage \n\t ' },
      })
      expect(res.status).toBe(201)
      expect(res.body.name).toBe('Cozy Cottage')
    })

    it('rejects whitespace-only names when adding a member', async () => {
      const home = await call<{ id: string }>('POST', '/api/homes', {
        body: { name: 'Cottage' },
      })
      const whitespaceVariants = ['   ', '\t\n', '\r\n \t ']
      for (const name of whitespaceVariants) {
        const res = await call<{ error: string }>('POST', `/api/homes/${home.body.id}/members`, {
          body: { name },
        })
        expect(res.status).toBe(400)
        expect(res.body).toEqual({ error: 'Member name is required' })
      }
    })

    it('rejects empty string name when adding a member', async () => {
      const home = await call<{ id: string }>('POST', '/api/homes', {
        body: { name: 'Cottage' },
      })
      const res = await call<{ error: string }>('POST', `/api/homes/${home.body.id}/members`, {
        body: { name: '' },
      })
      expect(res.status).toBe(400)
      expect(res.body).toEqual({ error: 'Member name is required' })
    })

    it('trims leading and trailing whitespace from member name', async () => {
      const home = await call<{ id: string }>('POST', '/api/homes', {
        body: { name: 'Cottage' },
      })
      const res = await call<{ id: string; homeId: string; name: string }>(
        'POST',
        `/api/homes/${home.body.id}/members`,
        { body: { name: '   Asha Smith \t ' } },
      )
      expect(res.status).toBe(201)
      expect(res.body.name).toBe('Asha Smith')
    })
  })

  describe('missing or malformed request bodies', () => {
    it('handles empty raw body on POST /api/homes', async () => {
      const res = await rawRequest('POST', '/api/homes', { rawBody: '' })
      expect(res.status).toBe(400)
      expect(res.body).toEqual({ error: 'Home name is required' })
    })

    it('handles malformed JSON on POST /api/homes', async () => {
      const res = await rawRequest('POST', '/api/homes', {
        rawBody: '{"name": "invalid json',
      })
      expect(res.status).toBe(400)
      expect(res.body).toEqual({ error: 'Home name is required' })
    })

    it('handles non-object JSON bodies (null, numbers, arrays, booleans) on POST /api/homes', async () => {
      const invalidBodies = ['null', '123', '[]', 'true', '"just a string"']
      for (const rawBody of invalidBodies) {
        const res = await rawRequest('POST', '/api/homes', { rawBody })
        expect(res.status).toBe(400)
        expect(res.body).toEqual({ error: 'Home name is required' })
      }
    })

    it('handles missing or non-string "name" property on POST /api/homes', async () => {
      const invalidPayloads = [{}, { name: null }, { name: 123 }, { name: true }, { name: {} }]
      for (const body of invalidPayloads) {
        const res = await call<{ error: string }>('POST', '/api/homes', { body })
        expect(res.status).toBe(400)
        expect(res.body).toEqual({ error: 'Home name is required' })
      }
    })

    it('handles malformed JSON and missing bodies on POST /api/homes/:id/members', async () => {
      const home = await call<{ id: string }>('POST', '/api/homes', {
        body: { name: 'Test Home' },
      })

      const emptyRes = await rawRequest('POST', `/api/homes/${home.body.id}/members`, {
        rawBody: '',
      })
      expect(emptyRes.status).toBe(400)
      expect(emptyRes.body).toEqual({ error: 'Member name is required' })

      const malformedRes = await rawRequest('POST', `/api/homes/${home.body.id}/members`, {
        rawBody: '{ broken json }',
      })
      expect(malformedRes.status).toBe(400)
      expect(malformedRes.body).toEqual({ error: 'Member name is required' })

      const invalidPayloads = [{}, { name: null }, { name: 456 }, { other: 'value' }]
      for (const body of invalidPayloads) {
        const res = await call<{ error: string }>('POST', `/api/homes/${home.body.id}/members`, {
          body,
        })
        expect(res.status).toBe(400)
        expect(res.body).toEqual({ error: 'Member name is required' })
      }
    })
  })

  describe('invalid home IDs and nonexistent homes', () => {
    it('returns 404 for various invalid home ID formats', async () => {
      const invalidIds = ['does-not-exist', '-1', 'abc', '1.5', '0', 'undefined', 'null']
      for (const homeId of invalidIds) {
        const res = await call<{ error: string }>('POST', `/api/homes/${homeId}/members`, {
          body: { name: 'Asha' },
        })
        expect(res.status).toBe(404)
        expect(res.body).toEqual({ error: 'Home not found' })
      }
    })

    it('returns 404 JSON when integer home ID does not exist in the database', async () => {
      const res = await call<{ error: string }>('POST', '/api/homes/999999/members', {
        body: { name: 'Asha' },
      })
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'Home not found' })
    })
  })

  describe('database constraints and integrity', () => {
    it('enforces foreign key cascading delete on members, bills, and shares when a home is deleted', async () => {
      const home = await call<{ id: string }>('POST', '/api/homes', {
        body: { name: 'Full Cascade Home' },
      })
      const homeId = Number(home.body.id)

      const m1 = await call<{ id: string }>('POST', `/api/homes/${homeId}/members`, {
        body: { name: 'Member 1' },
      })
      const m2 = await call<{ id: string }>('POST', `/api/homes/${homeId}/members`, {
        body: { name: 'Member 2' },
      })
      const m1Id = Number(m1.body.id)
      const m2Id = Number(m2.body.id)

      // Create bills and shares
      const b1 = await env.DB.prepare(
        'INSERT INTO bills (home_id, title, total_cents) VALUES (?, ?, ?) RETURNING id',
      )
        .bind(homeId, 'Bill 1', 1000)
        .first<{ id: number }>()
      const b2 = await env.DB.prepare(
        'INSERT INTO bills (home_id, title, total_cents) VALUES (?, ?, ?) RETURNING id',
      )
        .bind(homeId, 'Bill 2', 500)
        .first<{ id: number }>()

      expect(b1).toBeDefined()
      expect(b2).toBeDefined()
      if (!b1 || !b2) throw new Error('Bills not created')

      await env.DB.prepare('INSERT INTO shares (bill_id, member_id, amount_cents) VALUES (?, ?, ?)')
        .bind(b1.id, m1Id, 500)
        .run()
      await env.DB.prepare('INSERT INTO shares (bill_id, member_id, amount_cents) VALUES (?, ?, ?)')
        .bind(b1.id, m2Id, 500)
        .run()
      await env.DB.prepare('INSERT INTO shares (bill_id, member_id, amount_cents) VALUES (?, ?, ?)')
        .bind(b2.id, m1Id, 250)
        .run()
      await env.DB.prepare('INSERT INTO shares (bill_id, member_id, amount_cents) VALUES (?, ?, ?)')
        .bind(b2.id, m2Id, 250)
        .run()

      // Verify all exist before delete
      const membersBefore = await env.DB.prepare(
        'SELECT COUNT(*) as c FROM members WHERE home_id = ?',
      )
        .bind(homeId)
        .first<{ c: number }>()
      const billsBefore = await env.DB.prepare('SELECT COUNT(*) as c FROM bills WHERE home_id = ?')
        .bind(homeId)
        .first<{ c: number }>()
      const sharesBefore = await env.DB.prepare(
        'SELECT COUNT(*) as c FROM shares WHERE bill_id IN (?, ?)',
      )
        .bind(b1.id, b2.id)
        .first<{ c: number }>()

      expect(membersBefore?.c).toBe(2)
      expect(billsBefore?.c).toBe(2)
      expect(sharesBefore?.c).toBe(4)

      // Delete the home
      await env.DB.prepare('DELETE FROM homes WHERE id = ?').bind(homeId).run()

      // Verify cascading delete removed homes, members, bills, and shares
      const homesAfter = await env.DB.prepare('SELECT COUNT(*) as c FROM homes WHERE id = ?')
        .bind(homeId)
        .first<{ c: number }>()
      const membersAfter = await env.DB.prepare(
        'SELECT COUNT(*) as c FROM members WHERE home_id = ?',
      )
        .bind(homeId)
        .first<{ c: number }>()
      const billsAfter = await env.DB.prepare('SELECT COUNT(*) as c FROM bills WHERE home_id = ?')
        .bind(homeId)
        .first<{ c: number }>()
      const sharesAfter = await env.DB.prepare(
        'SELECT COUNT(*) as c FROM shares WHERE bill_id IN (?, ?)',
      )
        .bind(b1.id, b2.id)
        .first<{ c: number }>()

      expect(homesAfter?.c).toBe(0)
      expect(membersAfter?.c).toBe(0)
      expect(billsAfter?.c).toBe(0)
      expect(sharesAfter?.c).toBe(0)
    })

    it('cascades delete on shares when a member is deleted directly (ON DELETE CASCADE)', async () => {
      const home = await call<{ id: string }>('POST', '/api/homes', {
        body: { name: 'Member Cascade Home' },
      })
      const homeId = Number(home.body.id)

      const member = await call<{ id: string }>('POST', `/api/homes/${homeId}/members`, {
        body: { name: 'Member to Delete' },
      })
      const memberId = Number(member.body.id)

      const bill = await env.DB.prepare(
        'INSERT INTO bills (home_id, title, total_cents) VALUES (?, ?, ?) RETURNING id',
      )
        .bind(homeId, 'Member Bill', 1000)
        .first<{ id: number }>()
      expect(bill).toBeDefined()
      if (!bill) throw new Error('Bill not created')

      await env.DB.prepare('INSERT INTO shares (bill_id, member_id, amount_cents) VALUES (?, ?, ?)')
        .bind(bill.id, memberId, 1000)
        .run()

      const sharesBefore = await env.DB.prepare(
        'SELECT COUNT(*) as c FROM shares WHERE member_id = ?',
      )
        .bind(memberId)
        .first<{ c: number }>()
      expect(sharesBefore?.c).toBe(1)

      // Direct deletion of member should now cascade to their shares
      await env.DB.prepare('DELETE FROM members WHERE id = ?').bind(memberId).run()

      const membersAfter = await env.DB.prepare('SELECT COUNT(*) as c FROM members WHERE id = ?')
        .bind(memberId)
        .first<{ c: number }>()
      const sharesAfter = await env.DB.prepare(
        'SELECT COUNT(*) as c FROM shares WHERE member_id = ?',
      )
        .bind(memberId)
        .first<{ c: number }>()

      expect(membersAfter?.c).toBe(0)
      expect(sharesAfter?.c).toBe(0)
    })

    it('allows storing the same idempotency key across two different shares (non-unique index)', async () => {
      const home = await call<{ id: string }>('POST', '/api/homes', {
        body: { name: 'Idempotency Key Home' },
      })
      const homeId = Number(home.body.id)

      const m1 = await call<{ id: string }>('POST', `/api/homes/${homeId}/members`, {
        body: { name: 'M1' },
      })
      const m2 = await call<{ id: string }>('POST', `/api/homes/${homeId}/members`, {
        body: { name: 'M2' },
      })

      const bill = await env.DB.prepare(
        'INSERT INTO bills (home_id, title, total_cents) VALUES (?, ?, ?) RETURNING id',
      )
        .bind(homeId, 'Shared Bill', 2000)
        .first<{ id: number }>()
      expect(bill).toBeDefined()
      if (!bill) throw new Error('Bill not created')

      const s1 = await env.DB.prepare(
        'INSERT INTO shares (bill_id, member_id, amount_cents) VALUES (?, ?, ?) RETURNING id',
      )
        .bind(bill.id, Number(m1.body.id), 1000)
        .first<{ id: number }>()
      const s2 = await env.DB.prepare(
        'INSERT INTO shares (bill_id, member_id, amount_cents) VALUES (?, ?, ?) RETURNING id',
      )
        .bind(bill.id, Number(m2.body.id), 1000)
        .first<{ id: number }>()

      expect(s1).toBeDefined()
      expect(s2).toBeDefined()
      if (!s1 || !s2) throw new Error('Shares not created')

      const sharedKey = 'reusable-key-12345'
      const timestamp = '2026-11-02T12:00:00Z'

      // Pay share 1 with sharedKey
      await env.DB.prepare('UPDATE shares SET paid_at = ?, idempotency_key = ? WHERE id = ?')
        .bind(timestamp, sharedKey, s1.id)
        .run()

      // Pay share 2 with the SAME sharedKey - must succeed without unique constraint collision
      await env.DB.prepare('UPDATE shares SET paid_at = ?, idempotency_key = ? WHERE id = ?')
        .bind(timestamp, sharedKey, s2.id)
        .run()

      const paidS1 = await env.DB.prepare(
        'SELECT idempotency_key, paid_at FROM shares WHERE id = ?',
      )
        .bind(s1.id)
        .first<{ idempotency_key: string; paid_at: string }>()
      const paidS2 = await env.DB.prepare(
        'SELECT idempotency_key, paid_at FROM shares WHERE id = ?',
      )
        .bind(s2.id)
        .first<{ idempotency_key: string; paid_at: string }>()

      expect(paidS1?.idempotency_key).toBe(sharedKey)
      expect(paidS2?.idempotency_key).toBe(sharedKey)
    })

    it('supports atomic conditional payment updates and replay detection', async () => {
      const home = await call<{ id: string }>('POST', '/api/homes', {
        body: { name: 'Atomic Pay Home' },
      })
      const homeId = Number(home.body.id)

      const m = await call<{ id: string }>('POST', `/api/homes/${homeId}/members`, {
        body: { name: 'Solo' },
      })
      const bill = await env.DB.prepare(
        'INSERT INTO bills (home_id, title, total_cents) VALUES (?, ?, ?) RETURNING id',
      )
        .bind(homeId, 'Atomic Bill', 500)
        .first<{ id: number }>()
      expect(bill).toBeDefined()
      if (!bill) throw new Error('Bill not created')

      const share = await env.DB.prepare(
        'INSERT INTO shares (bill_id, member_id, amount_cents) VALUES (?, ?, ?) RETURNING id',
      )
        .bind(bill.id, Number(m.body.id), 500)
        .first<{ id: number }>()
      expect(share).toBeDefined()
      if (!share) throw new Error('Share not created')

      const key = 'atomic-key-abc'
      const payTime = '2026-11-02T12:30:00Z'

      // 1. Initial atomic update: paid_at IS NULL -> should update 1 row
      const firstUpdate = await env.DB.prepare(
        'UPDATE shares SET paid_at = ?, idempotency_key = ? WHERE id = ? AND paid_at IS NULL RETURNING id, paid_at, idempotency_key',
      )
        .bind(payTime, key, share.id)
        .first<{ id: number; paid_at: string; idempotency_key: string }>()

      expect(firstUpdate).toBeDefined()
      expect(firstUpdate?.paid_at).toBe(payTime)

      // 2. Second concurrent/replay attempt: paid_at IS NULL -> should update 0 rows
      const secondUpdate = await env.DB.prepare(
        'UPDATE shares SET paid_at = ?, idempotency_key = ? WHERE id = ? AND paid_at IS NULL RETURNING id, paid_at, idempotency_key',
      )
        .bind(payTime, key, share.id)
        .first<{ id: number; paid_at: string; idempotency_key: string }>()

      expect(secondUpdate).toBeNull()

      // 3. Fallback check: inspect existing row to detect idempotent replay
      const existing = await env.DB.prepare(
        'SELECT paid_at, idempotency_key FROM shares WHERE id = ?',
      )
        .bind(share.id)
        .first<{ paid_at: string; idempotency_key: string }>()

      expect(existing?.idempotency_key).toBe(key)
      expect(existing?.paid_at).toBe(payTime)
    })

    it('guarantees deterministic member ordering using auto-increment primary keys', async () => {
      const home = await call<{ id: string }>('POST', '/api/homes', {
        body: { name: 'Ordering Home' },
      })
      const homeId = Number(home.body.id)

      const names = ['Alice', 'Bob', 'Charlie', 'Dana']
      const createdIds: number[] = []

      for (const name of names) {
        const member = await call<{ id: string; name: string }>(
          'POST',
          `/api/homes/${homeId}/members`,
          { body: { name } },
        )
        createdIds.push(Number(member.body.id))
      }

      // Member IDs should be strictly increasing integers
      for (let i = 1; i < createdIds.length; i++) {
        const prev = createdIds[i - 1]
        const curr = createdIds[i]
        expect(prev).toBeDefined()
        expect(curr).toBeDefined()
        if (prev !== undefined && curr !== undefined) {
          expect(curr).toBeGreaterThan(prev)
        }
      }

      // Querying with ORDER BY id ASC preserves deterministic addition order
      const rows = await env.DB.prepare(
        'SELECT name FROM members WHERE home_id = ? ORDER BY id ASC',
      )
        .bind(homeId)
        .all<{ name: string }>()

      expect(rows.results.map((r) => r.name)).toEqual(names)
    })

    it('verifies zero-cent share compatibility in schema (amount_cents >= 0)', async () => {
      const home = await call<{ id: string }>('POST', '/api/homes', {
        body: { name: 'Share Test Home' },
      })
      const homeId = Number(home.body.id)

      const member = await call<{ id: string }>('POST', `/api/homes/${homeId}/members`, {
        body: { name: 'Asha' },
      })
      const memberId = Number(member.body.id)

      const bill = await env.DB.prepare(
        'INSERT INTO bills (home_id, title, total_cents) VALUES (?, ?, ?) RETURNING id',
      )
        .bind(homeId, 'Test Bill', 100)
        .first<{ id: number }>()
      expect(bill).toBeDefined()
      if (!bill) throw new Error('bill not found')
      const billId = bill.id

      // Inserting 0-cent share must succeed per CHECK (amount_cents >= 0)
      const zeroShare = await env.DB.prepare(
        'INSERT INTO shares (bill_id, member_id, amount_cents) VALUES (?, ?, ?) RETURNING id, amount_cents',
      )
        .bind(billId, memberId, 0)
        .first<{ id: number; amount_cents: number }>()

      expect(zeroShare?.amount_cents).toBe(0)

      // Inserting negative-cent share must fail per CHECK constraint
      await expect(
        env.DB.prepare('INSERT INTO shares (bill_id, member_id, amount_cents) VALUES (?, ?, ?)')
          .bind(billId, memberId, -1)
          .run(),
      ).rejects.toThrow()
    })
  })

  describe('error response consistency', () => {
    it('returns JSON format with error field for 404 on unhandled routes', async () => {
      const res = await rawRequest('GET', '/api/nonexistent-route')
      expect(res.status).toBe(404)
      expect(res.contentType).toContain('application/json')
      expect(res.body).toEqual({ error: 'Not found' })
    })

    it('ensures all error responses have { error: string } structure', async () => {
      const badHomeRes = await call<{ error: string }>('POST', '/api/homes', { body: {} })
      expect(typeof badHomeRes.body.error).toBe('string')

      const badMemberRes = await call<{ error: string }>('POST', '/api/homes/1/members', {
        body: {},
      })
      expect(typeof badMemberRes.body.error).toBe('string')

      const notFoundRes = await call<{ error: string }>('POST', '/api/homes/999999/members', {
        body: { name: 'Dave' },
      })
      expect(typeof notFoundRes.body.error).toBe('string')
    })
  })

  describe('standardized route parameter validation', () => {
    const invalidIds = ['1.0', '2.5', '0', '-1', 'abc', '1e5', '01']

    it('rejects malformed and decimal home IDs on POST /api/homes/:homeId/members', async () => {
      for (const id of invalidIds) {
        const res = await rawRequest('POST', `/api/homes/${id}/members`, {
          rawBody: JSON.stringify({ name: 'Test' }),
        })
        expect(res.status).toBe(404)
        expect(res.body).toEqual({ error: 'Home not found' })
      }
    })

    it('rejects malformed and decimal home IDs on POST /api/homes/:homeId/bills', async () => {
      for (const id of invalidIds) {
        const res = await rawRequest('POST', `/api/homes/${id}/bills`, {
          rawBody: JSON.stringify({ title: 'Dinner', totalCents: 1000 }),
        })
        expect(res.status).toBe(404)
        expect(res.body).toEqual({ error: 'Home not found' })
      }
    })

    it('rejects malformed and decimal home IDs on GET /api/homes/:homeId/balances', async () => {
      for (const id of invalidIds) {
        const res = await rawRequest('GET', `/api/homes/${id}/balances`)
        expect(res.status).toBe(404)
        expect(res.body).toEqual({ error: 'Home not found' })
      }
    })

    it('rejects malformed and decimal IDs on POST /api/bills/:billId/shares/:shareId/pay', async () => {
      for (const id of invalidIds) {
        const res = await rawRequest('POST', `/api/bills/${id}/shares/1/pay`, {
          headers: { 'Idempotency-Key': 'test-key' },
        })
        expect(res.status).toBe(404)
        expect(res.body).toEqual({ error: 'Bill or share not found' })
      }
    })
  })
})
