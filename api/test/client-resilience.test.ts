import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ApiClientError,
  api,
  getFriendlyErrorMessage,
  isBackendUnavailable,
  request,
  shouldDiscardHome,
} from '../../web/src/api/client'

describe('Frontend API Client Resilience & Error Normalization', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  describe('ApiClientError and classification helpers', () => {
    it('initializes ApiClientError with custom status and availability flag', () => {
      const networkErr = new ApiClientError('Offline', 0)
      expect(networkErr.status).toBe(0)
      expect(networkErr.name).toBe('ApiClientError')
      expect(networkErr.isBackendUnavailable).toBe(true)

      const serverErr = new ApiClientError('Crash', 500)
      expect(serverErr.status).toBe(500)
      expect(serverErr.isBackendUnavailable).toBe(true)

      const timeoutErr = new ApiClientError('Timeout', 408)
      expect(timeoutErr.status).toBe(408)
      expect(timeoutErr.isBackendUnavailable).toBe(true)

      const clientErr = new ApiClientError('Bad Request', 400)
      expect(clientErr.status).toBe(400)
      expect(clientErr.isBackendUnavailable).toBe(false)
    })

    it('classifies backend unavailability correctly with isBackendUnavailable', () => {
      expect(isBackendUnavailable(new ApiClientError('Down', 0))).toBe(true)
      expect(isBackendUnavailable(new ApiClientError('Error', 500))).toBe(true)
      expect(isBackendUnavailable(new ApiClientError('Bad Gateway', 502))).toBe(true)
      expect(isBackendUnavailable(new ApiClientError('Service Unavailable', 503))).toBe(true)
      expect(isBackendUnavailable(new ApiClientError('Gateway Timeout', 504))).toBe(true)
      expect(isBackendUnavailable(new ApiClientError('Timeout', 408))).toBe(true)

      // Client errors are NOT backend unavailability
      expect(isBackendUnavailable(new ApiClientError('Bad request', 400))).toBe(false)
      expect(isBackendUnavailable(new ApiClientError('Not found', 404))).toBe(false)
      expect(isBackendUnavailable(new ApiClientError('Conflict', 409))).toBe(false)
      expect(isBackendUnavailable(new Error('Unknown generic error'))).toBe(false)
      expect(isBackendUnavailable(null)).toBe(false)
      expect(isBackendUnavailable('string error')).toBe(false)
    })

    it('determines when active home should be discarded with shouldDiscardHome', () => {
      // ONLY 404 indicates home was deleted or does not exist
      expect(shouldDiscardHome(new ApiClientError('Not Found', 404))).toBe(true)

      // Network errors, timeouts, and server crashes MUST NOT discard active home
      expect(shouldDiscardHome(new ApiClientError('Network down', 0))).toBe(false)
      expect(shouldDiscardHome(new ApiClientError('Server crash', 500))).toBe(false)
      expect(shouldDiscardHome(new ApiClientError('Timeout', 408))).toBe(false)
      expect(shouldDiscardHome(new ApiClientError('Bad Request', 400))).toBe(false)
      expect(shouldDiscardHome(new Error('Generic failure'))).toBe(false)
    })

    it('formats friendly error messages with getFriendlyErrorMessage', () => {
      const apiErr = new ApiClientError('Backend is unavailable: Failed to fetch', 0)
      expect(getFriendlyErrorMessage(apiErr)).toBe('Backend is unavailable: Failed to fetch')

      const standardErr = new Error('Disk read failure')
      expect(getFriendlyErrorMessage(standardErr)).toBe('Disk read failure')

      expect(getFriendlyErrorMessage(null, 'Custom fallback')).toBe('Custom fallback')
    })
  })

  describe('Network failure (Status 0)', () => {
    it('normalizes TypeError fetch failure into ApiClientError with status 0 and unavailability explanation', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))

      await expect(request('/api/homes/test/balances')).rejects.toThrow(ApiClientError)

      try {
        await request('/api/homes/test/balances')
      } catch (err) {
        expect(err).toBeInstanceOf(ApiClientError)
        const apiErr = err as ApiClientError
        expect(apiErr.status).toBe(0)
        expect(apiErr.isBackendUnavailable).toBe(true)
        expect(apiErr.message).toContain('Backend is unavailable')
        expect(apiErr.message).toContain('Failed to fetch')
      }
    })

    it('propagates status 0 across high-level API methods when API server is down', async () => {
      globalThis.fetch = vi
        .fn()
        .mockRejectedValue(new TypeError('connect ECONNREFUSED 127.0.0.1:8787'))

      await expect(api.getBalances('h1')).rejects.toMatchObject({
        status: 0,
        isBackendUnavailable: true,
      })

      await expect(api.getBills('h1')).rejects.toMatchObject({
        status: 0,
        isBackendUnavailable: true,
      })

      await expect(api.createHome('My Home')).rejects.toMatchObject({
        status: 0,
        isBackendUnavailable: true,
      })

      await expect(api.addMember('h1', 'Alice')).rejects.toMatchObject({
        status: 0,
        isBackendUnavailable: true,
      })

      await expect(api.createBill('h1', 'Wifi', 2000)).rejects.toMatchObject({
        status: 0,
        isBackendUnavailable: true,
      })

      await expect(api.payShare('b1', 's1', 'key-123')).rejects.toMatchObject({
        status: 0,
        isBackendUnavailable: true,
      })
    })
  })

  describe('HTTP 500 Responses', () => {
    it('handles non-JSON (HTML/plain-text) 500 response without crashing on JSON parsing', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response('<!DOCTYPE html><html><body>500 Internal Server Error</body></html>', {
          status: 500,
          statusText: 'Internal Server Error',
          headers: { 'Content-Type': 'text/html' },
        }),
      )

      try {
        await request('/api/homes/test/bills')
        expect.unreachable('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ApiClientError)
        const apiErr = err as ApiClientError
        expect(apiErr.status).toBe(500)
        expect(apiErr.isBackendUnavailable).toBe(true)
        expect(apiErr.message).toContain('Backend is unavailable')
        expect(apiErr.message).toContain('500')
      }
    })

    it('handles JSON 500 response by extracting error payload while marking backend unavailable', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Database connection pool exhausted' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      try {
        await request('/api/homes/test/bills')
        expect.unreachable('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ApiClientError)
        const apiErr = err as ApiClientError
        expect(apiErr.status).toBe(500)
        expect(apiErr.isBackendUnavailable).toBe(true)
        expect(apiErr.message).toContain('Database connection pool exhausted')
      }
    })

    it('handles 500 response with empty body and empty statusText gracefully', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response('', {
          status: 500,
          statusText: '',
        }),
      )

      try {
        await request('/api/homes/test/bills')
        expect.unreachable('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ApiClientError)
        const apiErr = err as ApiClientError
        expect(apiErr.status).toBe(500)
        expect(apiErr.isBackendUnavailable).toBe(true)
      }
    })
  })

  describe('Malformed Responses', () => {
    it('handles HTTP 200 with invalid JSON body without uncaught SyntaxError', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response('{invalid_json_body...', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      try {
        await request('/api/homes/test/bills')
        expect.unreachable('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ApiClientError)
        const apiErr = err as ApiClientError
        expect(apiErr.status).toBe(200)
        expect(apiErr.message).toContain('Invalid JSON response from server')
      }
    })
  })

  describe('Slow Requests & Timeouts', () => {
    it('times out when request exceeds timeoutMs and returns status 408', async () => {
      globalThis.fetch = vi.fn().mockImplementation((_url, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          const signal = init?.signal
          if (signal) {
            signal.addEventListener('abort', () => {
              const abortErr = new Error('The operation was aborted')
              abortErr.name = 'AbortError'
              reject(abortErr)
            })
          }
        })
      })

      try {
        await request('/api/slow-endpoint', { timeoutMs: 25 })
        expect.unreachable('Should have timed out')
      } catch (err) {
        expect(err).toBeInstanceOf(ApiClientError)
        const apiErr = err as ApiClientError
        expect(apiErr.status).toBe(408)
        expect(apiErr.isBackendUnavailable).toBe(true)
        expect(apiErr.message).toContain('Backend is unavailable')
        expect(apiErr.message).toContain('timed out')
      }
    })

    it('rejects immediately when external signal is already aborted', async () => {
      const controller = new AbortController()
      controller.abort()

      const fetchSpy = vi.fn()
      globalThis.fetch = fetchSpy

      try {
        await request('/api/immediate-abort', { signal: controller.signal })
        expect.unreachable('Should have aborted immediately')
      } catch (err) {
        expect(err).toBeInstanceOf(ApiClientError)
        const apiErr = err as ApiClientError
        expect(apiErr.status).toBe(408)
      }
    })
  })

  describe('Backend Recovery & Retry Workflow', () => {
    it('recovers successfully after API server is restarted following network downtime', async () => {
      let serverUp = false

      globalThis.fetch = vi.fn().mockImplementation(async () => {
        if (!serverUp) {
          throw new TypeError('Failed to fetch (API server down)')
        }
        return new Response(
          JSON.stringify({
            balances: [{ memberId: 'm1', name: 'Bob', outstandingCents: 500 }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      })

      // 1. Initial attempt fails while API is down
      await expect(api.getBalances('home-1')).rejects.toMatchObject({
        status: 0,
        isBackendUnavailable: true,
      })

      // 2. API is restarted
      serverUp = true

      // 3. Retry succeeds and fetches fresh data
      const balances = await api.getBalances('home-1')
      expect(balances).toHaveLength(1)
      expect(balances[0]?.memberId).toBe('m1')
      expect(balances[0]?.outstandingCents).toBe(500)
    })

    it('recovers successfully after a 500 server reboot following a crash', async () => {
      let isRecovered = false

      globalThis.fetch = vi.fn().mockImplementation(async () => {
        if (!isRecovered) {
          return new Response(JSON.stringify({ error: 'Database restarting' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        return new Response(
          JSON.stringify({
            bills: [
              {
                id: 'b1',
                homeId: 'h1',
                title: 'Groceries',
                totalCents: 1200,
                shares: [],
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      })

      // Initial attempt fails with 500
      await expect(api.getBills('h1')).rejects.toMatchObject({
        status: 500,
        isBackendUnavailable: true,
      })

      // Server recovers
      isRecovered = true

      // Retry succeeds
      const bills = await api.getBills('h1')
      expect(bills).toHaveLength(1)
      expect(bills[0]?.title).toBe('Groceries')
      expect(bills[0]?.totalCents).toBe(1200)
    })

    it('preserves idempotency key across retries for payment requests', async () => {
      let attempt = 0
      const capturedHeaders: HeadersInit[] = []

      globalThis.fetch = vi.fn().mockImplementation(async (_url, init?: RequestInit) => {
        attempt++
        if (init?.headers) {
          capturedHeaders.push(init.headers)
        }
        if (attempt === 1) {
          throw new TypeError('Network error during payShare')
        }
        return new Response(
          JSON.stringify({
            id: 'share-1',
            memberId: 'm1',
            amountCents: 500,
            paidAt: '2026-11-02T12:00:00Z',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      })

      const idempotencyKey = 'fixed-uuid-1234'

      // First attempt fails
      await expect(api.payShare('b1', 's1', idempotencyKey)).rejects.toMatchObject({
        status: 0,
      })

      // Retry attempt with same idempotency key
      const result = await api.payShare('b1', 's1', idempotencyKey)
      expect(result.id).toBe('share-1')
      expect(result.paidAt).toBe('2026-11-02T12:00:00Z')

      // Verify both calls used identical Idempotency-Key header
      expect(capturedHeaders).toHaveLength(2)
      for (const headers of capturedHeaders) {
        expect(headers).toMatchObject({
          'Idempotency-Key': 'fixed-uuid-1234',
        })
      }
    })
  })
})
