import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import {
  ApiClientError,
  api,
  getFriendlyErrorMessage,
  isBackendUnavailable,
  shouldDiscardHome,
} from '../api/client'
import type { Balance, Bill, Home, Member } from '../api/types'
import { BackendUnavailable } from '../components/BackendUnavailable'
import { BalancesBar } from '../components/BalancesBar'
import { BillsList } from '../components/BillsList'
import { CreateBillForm } from '../components/CreateBillForm'
import { HomeSetup } from '../components/HomeSetup'
import {
  AlertCircleIcon,
  ArrowLeftRightIcon,
  CheckIcon,
  CopyIcon,
  HomeIcon,
  RefreshCwIcon,
} from '../components/Icons'
import { MembersSection } from '../components/MembersSection'

export const Route = createFileRoute('/')({
  component: HomePage,
})

const STORAGE_KEY = 'bill_splitter_active_home'

function getInitialHome(): Home | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return null
    }
    const parsed: unknown = JSON.parse(raw)
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'id' in parsed &&
      typeof (parsed as { id: unknown }).id === 'string' &&
      'name' in parsed &&
      typeof (parsed as { name: unknown }).name === 'string'
    ) {
      return parsed as Home
    }
  } catch {
    // Ignore invalid JSON in localStorage
  }
  return null
}

function HomePage() {
  const [currentHome, setCurrentHome] = useState<Home | null>(getInitialHome)
  const [bills, setBills] = useState<Bill[]>([])
  const [balances, setBalances] = useState<Balance[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Backend availability state
  const [isBackendDown, setIsBackendDown] = useState(false)
  const [isRetryingBackend, setIsRetryingBackend] = useState(false)
  const [lastAttemptTime, setLastAttemptTime] = useState<string | null>(null)

  // Sub-action loading states
  const [isCreatingHome, setIsCreatingHome] = useState(false)
  const [isAddingMember, setIsAddingMember] = useState(false)
  const [isCreatingBill, setIsCreatingBill] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Payment state tracking
  const [idempotencyKeys, setIdempotencyKeys] = useState<Map<string, string>>(() => new Map())
  const [payingShareIds, setPayingShareIds] = useState<Set<string>>(() => new Set())
  const [shareErrors, setShareErrors] = useState<Map<string, string>>(() => new Map())
  const [copiedId, setCopiedId] = useState(false)

  const handleCopyHomeId = () => {
    if (!currentHome) return
    navigator.clipboard
      .writeText(currentHome.id)
      .then(() => {
        setCopiedId(true)
        setTimeout(() => setCopiedId(false), 2000)
      })
      .catch(() => {})
  }

  // Save or clear active home in localStorage
  const setActiveHome = useCallback((home: Home | null) => {
    setCurrentHome(home)
    if (home) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(home))
      } catch {
        // Ignore localStorage quota or access errors
      }
    } else {
      try {
        localStorage.removeItem(STORAGE_KEY)
      } catch {
        // Ignore localStorage errors
      }
    }
  }, [])

  // Load home data on startup or when active home changes
  useEffect(() => {
    if (!currentHome) {
      setBills([])
      setBalances([])
      setMembers([])
      setIsLoading(false)
      return
    }

    const controller = new AbortController()
    let isMounted = true
    setIsLoading(true)
    setError(null)

    async function loadHomeData() {
      if (!currentHome) {
        return
      }
      try {
        const [fetchedBalances, fetchedBills] = await Promise.all([
          api.getBalances(currentHome.id, controller.signal),
          api.getBills(currentHome.id, controller.signal),
        ])

        if (!isMounted) {
          return
        }

        setBalances(fetchedBalances)
        setBills(fetchedBills)

        // Derive members from balances to guarantee sync
        setMembers((prevMembers) => {
          const map = new Map<string, Member>()
          for (const m of prevMembers) {
            if (m.homeId === currentHome.id) {
              map.set(m.id, m)
            }
          }
          for (const b of fetchedBalances) {
            map.set(b.memberId, { id: b.memberId, homeId: currentHome.id, name: b.name })
          }
          return Array.from(map.values())
        })
      } catch (err: unknown) {
        if (!isMounted) {
          return
        }
        if (err instanceof Error && err.name === 'AbortError') {
          return
        }

        if (isBackendUnavailable(err)) {
          setIsBackendDown(true)
          setLastAttemptTime(new Date().toLocaleTimeString())
          setError(getFriendlyErrorMessage(err, 'Backend server is currently unavailable'))
          return
        }

        if (shouldDiscardHome(err)) {
          // Home invalid or deleted: gracefully clear localStorage and return to setup
          setActiveHome(null)
          setBills([])
          setBalances([])
          setMembers([])
          setError(
            'The active home was not found on the server. Please create a new home or open another.',
          )
          return
        }

        setError(getFriendlyErrorMessage(err, 'Failed to load home data'))
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    loadHomeData()

    return () => {
      isMounted = false
      controller.abort()
    }
  }, [currentHome, setActiveHome])

  // Check backend availability on initial mount if no home is selected
  useEffect(() => {
    if (currentHome) {
      return
    }

    let isMounted = true
    const controller = new AbortController()

    async function checkHealthOnStartup() {
      try {
        const ok = await api.checkHealth(controller.signal, 3000)
        if (!isMounted) return
        if (!ok) {
          setIsBackendDown(true)
          setLastAttemptTime(new Date().toLocaleTimeString())
          setError('Backend server is currently unreachable. Make sure the API server is running.')
        } else {
          setIsBackendDown(false)
        }
      } catch {
        if (!isMounted) return
        setIsBackendDown(true)
        setLastAttemptTime(new Date().toLocaleTimeString())
        setError('Backend server is currently unreachable. Make sure the API server is running.')
      }
    }

    checkHealthOnStartup()

    return () => {
      isMounted = false
      controller.abort()
    }
  }, [currentHome])

  // Handle retrying connection to the backend server
  const handleRetryBackend = async () => {
    setIsRetryingBackend(true)
    setError(null)
    const timestamp = new Date().toLocaleTimeString()

    try {
      const isAlive = await api.checkHealth(undefined, 4000)
      if (!isAlive) {
        setIsBackendDown(true)
        setLastAttemptTime(timestamp)
        setError('Connection attempt failed: backend server is still not responding.')
        return
      }

      setIsBackendDown(false)

      if (currentHome) {
        setIsLoading(true)
        try {
          const [fetchedBalances, fetchedBills] = await Promise.all([
            api.getBalances(currentHome.id),
            api.getBills(currentHome.id),
          ])
          setBalances(fetchedBalances)
          setBills(fetchedBills)
          setMembers((prev) => {
            const map = new Map<string, Member>()
            for (const m of prev) {
              if (m.homeId === currentHome.id) map.set(m.id, m)
            }
            for (const b of fetchedBalances) {
              map.set(b.memberId, { id: b.memberId, homeId: currentHome.id, name: b.name })
            }
            return Array.from(map.values())
          })
        } catch (loadErr: unknown) {
          if (isBackendUnavailable(loadErr)) {
            setIsBackendDown(true)
            setLastAttemptTime(new Date().toLocaleTimeString())
            setError(getFriendlyErrorMessage(loadErr, 'Backend server is currently unavailable'))
          } else if (shouldDiscardHome(loadErr)) {
            setActiveHome(null)
            setError('The active home was not found on the server.')
          } else {
            setError(getFriendlyErrorMessage(loadErr, 'Failed to load home data'))
          }
        } finally {
          setIsLoading(false)
        }
      }
    } catch (err: unknown) {
      setIsBackendDown(true)
      setLastAttemptTime(timestamp)
      setError(getFriendlyErrorMessage(err, 'Backend server is still unreachable'))
    } finally {
      setIsRetryingBackend(false)
    }
  }

  // Handle manual refresh
  const handleRefresh = async () => {
    if (!currentHome || isRefreshing) {
      return
    }
    setIsRefreshing(true)
    setError(null)
    try {
      const [fetchedBalances, fetchedBills] = await Promise.all([
        api.getBalances(currentHome.id),
        api.getBills(currentHome.id),
      ])
      setBalances(fetchedBalances)
      setBills(fetchedBills)
      setMembers((prev) => {
        const map = new Map<string, Member>()
        for (const m of prev) {
          if (m.homeId === currentHome.id) map.set(m.id, m)
        }
        for (const b of fetchedBalances) {
          map.set(b.memberId, { id: b.memberId, homeId: currentHome.id, name: b.name })
        }
        return Array.from(map.values())
      })
    } catch (err: unknown) {
      if (isBackendUnavailable(err)) {
        setIsBackendDown(true)
        setLastAttemptTime(new Date().toLocaleTimeString())
        setError(getFriendlyErrorMessage(err, 'Backend server is unreachable'))
        return
      }
      if (shouldDiscardHome(err)) {
        setActiveHome(null)
        setError('Home was not found on the server.')
        return
      }
      setError(getFriendlyErrorMessage(err, 'Failed to refresh data'))
    } finally {
      setIsRefreshing(false)
    }
  }

  // Handle creating a new home
  const handleCreateHome = async (name: string) => {
    setIsCreatingHome(true)
    setError(null)
    try {
      const newHome = await api.createHome(name)
      setActiveHome(newHome)
    } catch (err: unknown) {
      if (isBackendUnavailable(err)) {
        setIsBackendDown(true)
        setLastAttemptTime(new Date().toLocaleTimeString())
      }
      setError(getFriendlyErrorMessage(err, 'Failed to create home'))
    } finally {
      setIsCreatingHome(false)
    }
  }

  // Handle opening an existing home by ID
  const handleSwitchHomeById = async (id: string) => {
    setIsCreatingHome(true)
    setError(null)
    try {
      // Validate by fetching balances
      const initialBalances = await api.getBalances(id)
      const home: Home = { id, name: `Home #${id}` }
      setBalances(initialBalances)
      setActiveHome(home)
    } catch (err: unknown) {
      if (isBackendUnavailable(err)) {
        setIsBackendDown(true)
        setLastAttemptTime(new Date().toLocaleTimeString())
        setError(getFriendlyErrorMessage(err, 'Failed to connect to server'))
      } else if (err instanceof ApiClientError && err.status === 404) {
        setError(`Home #${id} does not exist`)
      } else {
        setError(getFriendlyErrorMessage(err, `Failed to open home #${id}`))
      }
    } finally {
      setIsCreatingHome(false)
    }
  }

  // Handle adding a member
  const handleAddMember = async (name: string) => {
    if (!currentHome) {
      return
    }
    setIsAddingMember(true)
    setError(null)
    try {
      const newMember = await api.addMember(currentHome.id, name)
      setMembers((prev) => [...prev, newMember])
      const freshBalances = await api.getBalances(currentHome.id)
      setBalances(freshBalances)
    } catch (err: unknown) {
      if (isBackendUnavailable(err)) {
        setIsBackendDown(true)
        setLastAttemptTime(new Date().toLocaleTimeString())
      }
      setError(getFriendlyErrorMessage(err, 'Failed to add member'))
    } finally {
      setIsAddingMember(false)
    }
  }

  // Handle creating a bill
  const handleCreateBill = async (title: string, totalCents: number) => {
    if (!currentHome) {
      return
    }
    setIsCreatingBill(true)
    setError(null)
    try {
      await api.createBill(currentHome.id, title, totalCents)
      const [freshBills, freshBalances] = await Promise.all([
        api.getBills(currentHome.id),
        api.getBalances(currentHome.id),
      ])
      setBills(freshBills)
      setBalances(freshBalances)
    } catch (err: unknown) {
      if (isBackendUnavailable(err)) {
        setIsBackendDown(true)
        setLastAttemptTime(new Date().toLocaleTimeString())
      }
      setError(getFriendlyErrorMessage(err, 'Failed to create bill'))
    } finally {
      setIsCreatingBill(false)
    }
  }

  // Handle paying a share with idempotency key tracking
  const handlePayShare = async (billId: string, shareId: string) => {
    if (!currentHome) {
      return
    }

    // Reuse existing idempotency key if this share is being retried, or generate new UUID
    const key = idempotencyKeys.get(shareId) ?? crypto.randomUUID()
    if (!idempotencyKeys.has(shareId)) {
      setIdempotencyKeys((prev) => {
        const next = new Map(prev)
        next.set(shareId, key)
        return next
      })
    }

    // Clear previous error for this share
    setShareErrors((prev) => {
      const next = new Map(prev)
      next.delete(shareId)
      return next
    })

    // Disable button with spinner
    setPayingShareIds((prev) => {
      const next = new Set(prev)
      next.add(shareId)
      return next
    })

    try {
      const updatedShare = await api.payShare(billId, shareId, key)

      // Only update on success (never optimistically)
      setBills((prevBills) =>
        prevBills.map((bill) => {
          if (bill.id !== billId) {
            return bill
          }
          return {
            ...bill,
            shares: bill.shares.map((share) =>
              share.id === shareId ? { ...share, paidAt: updatedShare.paidAt } : share,
            ),
          }
        }),
      )

      // Update balances
      const freshBalances = await api.getBalances(currentHome.id)
      setBalances(freshBalances)
    } catch (err: unknown) {
      // On failure: share remains unpaid, display error message under share, re-enable button
      const message = getFriendlyErrorMessage(err, 'Failed to process payment')
      setShareErrors((prev) => {
        const next = new Map(prev)
        next.set(shareId, message)
        return next
      })
    } finally {
      setPayingShareIds((prev) => {
        const next = new Set(prev)
        next.delete(shareId)
        return next
      })
    }
  }

  // If backend is down, show the Backend Unavailable view
  if (isBackendDown) {
    return (
      <BackendUnavailable
        onRetry={handleRetryBackend}
        isRetrying={isRetryingBackend}
        activeHome={currentHome}
        lastAttemptTime={lastAttemptTime}
        errorMessage={error}
      />
    )
  }

  // If no active home, show the Home Setup view
  if (!currentHome) {
    return (
      <div>
        {error && (
          <div className="banner banner-error" style={{ marginBottom: '1.5rem' }} role="alert">
            <div className="banner-content">
              <AlertCircleIcon style={{ width: 18, height: 18, flexShrink: 0 }} />
              <span>{error}</span>
            </div>
            <button
              type="button"
              className="banner-close"
              onClick={() => setError(null)}
              aria-label="Dismiss error"
            >
              ✕
            </button>
          </div>
        )}
        <HomeSetup
          onCreateHome={handleCreateHome}
          onSwitchHomeById={handleSwitchHomeById}
          isLoading={isCreatingHome}
        />
      </div>
    )
  }

  return (
    <>
      {/* Global Error Banner */}
      {error && (
        <div className="banner banner-error" role="alert">
          <div className="banner-content">
            <AlertCircleIcon style={{ width: 18, height: 18, flexShrink: 0 }} />
            <span>{error}</span>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
              aria-label="Retry loading data"
            >
              <RefreshCwIcon
                style={{
                  width: 14,
                  height: 14,
                  animation: isRefreshing ? 'spin 1s linear infinite' : 'none',
                }}
              />
              {isRefreshing ? 'Retrying...' : 'Retry'}
            </button>
            <button
              type="button"
              className="banner-close"
              onClick={() => setError(null)}
              aria-label="Dismiss error"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Active Home Header Card */}
      <section className="home-header-card" aria-label="Active Home Information">
        <div className="home-meta">
          <div className="home-avatar" aria-hidden="true">
            <HomeIcon style={{ width: 22, height: 22 }} />
          </div>
          <div className="home-details">
            <h1 className="home-name">{currentHome.name}</h1>
            <div className="home-id-tag">
              <span>Home ID:</span>
              <span className="home-id-code">#{currentHome.id}</span>
              <button
                type="button"
                className={`copy-id-btn ${copiedId ? 'copied' : ''}`}
                onClick={handleCopyHomeId}
                aria-label={copiedId ? 'Home ID copied to clipboard' : 'Copy Home ID to clipboard'}
                title="Copy Home ID"
              >
                {copiedId ? (
                  <>
                    <CheckIcon style={{ width: 12, height: 12 }} /> Copied
                  </>
                ) : (
                  <>
                    <CopyIcon style={{ width: 12, height: 12 }} /> Copy
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="home-header-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleRefresh}
            disabled={isRefreshing || isLoading}
            aria-label="Refresh home data"
          >
            <RefreshCwIcon
              style={{
                width: 14,
                height: 14,
                animation: isRefreshing ? 'spin 1s linear infinite' : 'none',
              }}
            />
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setActiveHome(null)}
            aria-label="Switch to another home or create new"
          >
            <ArrowLeftRightIcon style={{ width: 14, height: 14 }} /> Switch Home
          </button>
        </div>
      </section>

      {/* Loading Skeleton */}
      {isLoading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="card skeleton skeleton-card" />
          <div className="card skeleton skeleton-card" />
        </div>
      ) : (
        <div className="dashboard-grid">
          {/* Primary Column (Left on Desktop): Action & Transaction Feed */}
          <div className="dashboard-primary-col">
            <CreateBillForm
              members={members}
              onCreateBill={handleCreateBill}
              isSubmitting={isCreatingBill}
            />
            <BillsList
              bills={bills}
              members={members}
              balances={balances}
              onPayShare={handlePayShare}
              payingShareIds={payingShareIds}
              shareErrors={shareErrors}
            />
          </div>

          {/* Secondary Column (Right on Desktop): People & Balances Context */}
          <div className="dashboard-secondary-col">
            <MembersSection
              members={members}
              onAddMember={handleAddMember}
              isAdding={isAddingMember}
            />
            <BalancesBar balances={balances} />
          </div>
        </div>
      )}
    </>
  )
}
