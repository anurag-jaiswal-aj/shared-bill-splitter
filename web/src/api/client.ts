import type { Balance, Bill, Home, Member, Share } from './types'

export class ApiClientError extends Error {
  readonly status: number
  readonly isBackendUnavailable: boolean

  constructor(message: string, status = 500) {
    super(message)
    this.name = 'ApiClientError'
    this.status = status
    this.isBackendUnavailable = status === 0 || status === 408 || status >= 500
  }
}

/**
 * Checks whether an error represents backend unavailability (network error, timeout, or 5xx server error).
 */
export function isBackendUnavailable(err: unknown): boolean {
  if (err instanceof ApiClientError) {
    return err.isBackendUnavailable
  }
  return false
}

/**
 * Determines whether active home info should be discarded.
 * Only discard active home on 404 (Not Found). Never discard on network errors, timeouts, or 500s.
 */
export function shouldDiscardHome(err: unknown): boolean {
  return err instanceof ApiClientError && err.status === 404
}

/**
 * Formats a user-friendly error message, highlighting backend unavailability.
 */
export function getFriendlyErrorMessage(
  err: unknown,
  fallback = 'An unexpected error occurred',
): string {
  if (err instanceof ApiClientError) {
    return err.message
  }
  if (err instanceof Error) {
    return err.message
  }
  return fallback
}

/**
 * Formats integer cents/paise into Indian Rupees currency string (e.g. ₹10.50, ₹0.00).
 */
export function formatRupees(cents: number): string {
  if (!Number.isFinite(cents)) {
    return '₹0.00'
  }
  const isNegative = cents < 0
  const absCents = Math.round(Math.abs(cents))
  const rupees = Math.floor(absCents / 100)
  const paise = absCents % 100
  const formattedPaise = paise.toString().padStart(2, '0')
  return `${isNegative ? '-' : ''}₹${rupees.toLocaleString('en-IN')}.${formattedPaise}`
}

/**
 * Parses a rupee string (e.g. "10.50", "10", "0.50") into positive whole cents.
 * Returns null if the value is not a valid positive amount or has more than 2 decimal digits.
 */
export function parseRupeesToCents(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  // Accepts numbers with up to 2 decimal digits, e.g. "10", "10.5", "10.50", "0.25", ".50"
  const match = trimmed.match(/^(?:(\d+)(?:\.(\d{1,2}))?|\.(\d{1,2}))$/)
  if (!match) {
    return null
  }

  let rupees = 0
  let paisePart = ''

  if (match[1] !== undefined) {
    rupees = Number.parseInt(match[1], 10)
    paisePart = match[2] ?? ''
  } else if (match[3] !== undefined) {
    rupees = 0
    paisePart = match[3]
  }

  if (!Number.isSafeInteger(rupees)) {
    return null
  }

  const paise = Number.parseInt(paisePart.padEnd(2, '0') || '0', 10)
  const totalCents = rupees * 100 + paise

  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) {
    return null
  }

  return totalCents
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
  timeoutMs?: number
}

/**
 * Base fetch wrapper with timeout, JSON parsing, and graceful error normalization.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { timeoutMs = 10000, signal: externalSignal, body, headers, ...init } = options
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let cleanupAbortListener: (() => void) | undefined
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timer)
      throw new ApiClientError('Backend is unavailable: Request was aborted', 408)
    }
    const onAbort = () => {
      clearTimeout(timer)
      controller.abort()
    }
    externalSignal.addEventListener('abort', onAbort)
    cleanupAbortListener = () => externalSignal.removeEventListener('abort', onAbort)
  }

  try {
    const response = await fetch(path, {
      ...init,
      signal: controller.signal,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
      let errorMessage = response.statusText || `Request failed with status ${response.status}`
      try {
        const errorData: unknown = await response.json()
        if (
          errorData !== null &&
          typeof errorData === 'object' &&
          'error' in errorData &&
          typeof (errorData as { error: unknown }).error === 'string'
        ) {
          errorMessage = (errorData as { error: string }).error
        }
      } catch {
        // Fallback to response.statusText when response body is not JSON
      }
      if (response.status >= 500) {
        errorMessage = `Backend is unavailable (${response.status}): ${errorMessage}`
      }
      throw new ApiClientError(errorMessage, response.status)
    }

    try {
      const data = (await response.json()) as T
      return data
    } catch {
      throw new ApiClientError('Invalid JSON response from server', response.status)
    }
  } catch (err: unknown) {
    if (err instanceof ApiClientError) {
      throw err
    }
    if (
      controller.signal.aborted ||
      externalSignal?.aborted ||
      (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError'))
    ) {
      throw new ApiClientError('Backend is unavailable: Request timed out or was aborted', 408)
    }
    const message = err instanceof Error ? err.message : 'Network error'
    throw new ApiClientError(`Backend is unavailable: ${message}`, 0)
  } finally {
    clearTimeout(timer)
    cleanupAbortListener?.()
  }
}

export const api = {
  async createHome(name: string): Promise<Home> {
    return request<Home>('/api/homes', {
      method: 'POST',
      body: { name },
    })
  },

  async addMember(homeId: string, name: string): Promise<Member> {
    return request<Member>(`/api/homes/${encodeURIComponent(homeId)}/members`, {
      method: 'POST',
      body: { name },
    })
  },

  async getBills(homeId: string, signal?: AbortSignal): Promise<Bill[]> {
    const data = await request<{ bills: Bill[] }>(
      `/api/homes/${encodeURIComponent(homeId)}/bills`,
      {
        method: 'GET',
        signal,
      },
    )
    return data.bills
  },

  async createBill(homeId: string, title: string, totalCents: number): Promise<Bill> {
    return request<Bill>(`/api/homes/${encodeURIComponent(homeId)}/bills`, {
      method: 'POST',
      body: { title, totalCents },
    })
  },

  async payShare(billId: string, shareId: string, idempotencyKey: string): Promise<Share> {
    return request<Share>(
      `/api/bills/${encodeURIComponent(billId)}/shares/${encodeURIComponent(shareId)}/pay`,
      {
        method: 'POST',
        headers: {
          'Idempotency-Key': idempotencyKey,
        },
      },
    )
  },

  async getBalances(homeId: string, signal?: AbortSignal): Promise<Balance[]> {
    const data = await request<{ balances: Balance[] }>(
      `/api/homes/${encodeURIComponent(homeId)}/balances`,
      {
        method: 'GET',
        signal,
      },
    )
    return data.balances
  },

  async checkHealth(signal?: AbortSignal, timeoutMs = 5000): Promise<boolean> {
    try {
      const data = await request<{ status: string }>('/api/health', {
        method: 'GET',
        signal,
        timeoutMs,
      })
      return data?.status === 'ok'
    } catch {
      return false
    }
  },
}

export const createHome = api.createHome
export const addMember = api.addMember
export const getBills = api.getBills
export const createBill = api.createBill
export const payShare = api.payShare
export const getBalances = api.getBalances
