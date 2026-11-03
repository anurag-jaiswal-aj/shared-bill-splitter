import type { Context } from 'hono'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { billsRouter } from './routes/bills'
import { paymentsRouter } from './routes/payments'
import { parsePositiveIntegerParam } from './validation'

const app = new Hono<{ Bindings: Env }>()

// Global 404 handler: return JSON error for unhandled routes
app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404)
})

// Global error handler: return JSON error for unhandled exceptions
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message || 'Internal server error' }, err.status)
  }
  console.error('Unhandled internal server error:', err)
  return c.json({ error: 'Internal server error' }, 500)
})

/**
 * Safely parses request body as a JSON object record.
 * Returns null if the body is empty, malformed JSON, or not an object.
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

// Health check endpoint
app.get('/api/health', (c) => c.json({ status: 'ok' }))

// Mount domain routes
app.route('', billsRouter)
app.route('', paymentsRouter)

// Create a new home
app.post('/api/homes', async (c) => {
  const body = await parseJsonBody(c)
  if (!body) {
    return c.json({ error: 'Home name is required' }, 400)
  }

  const rawName = body.name
  if (typeof rawName !== 'string') {
    return c.json({ error: 'Home name is required' }, 400)
  }

  const name = rawName.trim()
  if (!name) {
    return c.json({ error: 'Home name is required' }, 400)
  }

  const row = await c.env.DB.prepare('INSERT INTO homes (name) VALUES (?) RETURNING id, name')
    .bind(name)
    .first<{ id: number; name: string }>()

  if (!row) {
    return c.json({ error: 'Failed to create home' }, 500)
  }

  return c.json(
    {
      id: String(row.id),
      name: row.name,
    },
    201,
  )
})

// Add a member to a home
app.post('/api/homes/:homeId/members', async (c) => {
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
    return c.json({ error: 'Member name is required' }, 400)
  }

  const rawName = body.name
  if (typeof rawName !== 'string') {
    return c.json({ error: 'Member name is required' }, 400)
  }

  const name = rawName.trim()
  if (!name) {
    return c.json({ error: 'Member name is required' }, 400)
  }

  const row = await c.env.DB.prepare(
    'INSERT INTO members (home_id, name) VALUES (?, ?) RETURNING id, home_id, name',
  )
    .bind(home.id, name)
    .first<{ id: number; home_id: number; name: string }>()

  if (!row) {
    return c.json({ error: 'Failed to create member' }, 500)
  }

  return c.json(
    {
      id: String(row.id),
      homeId: String(row.home_id),
      name: row.name,
    },
    201,
  )
})

export default app
