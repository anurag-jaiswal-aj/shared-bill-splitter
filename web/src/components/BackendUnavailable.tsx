import type { Home } from '../api/types'
import { AlertCircleIcon, HomeIcon, RefreshCwIcon, Spinner } from './Icons'

interface BackendUnavailableProps {
  onRetry: () => Promise<void>
  isRetrying: boolean
  activeHome: Home | null
  lastAttemptTime?: string | null
  errorMessage?: string | null
}

export function BackendUnavailable({
  onRetry,
  isRetrying,
  activeHome,
  lastAttemptTime,
  errorMessage,
}: BackendUnavailableProps) {
  return (
    <div className="backend-unavailable-container" role="alert" aria-live="assertive">
      <div className="card backend-unavailable-card">
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            background: '#fef2f2',
            color: '#dc2626',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '1rem',
          }}
          aria-hidden="true"
        >
          <AlertCircleIcon style={{ width: 26, height: 26 }} />
        </div>

        <div>
          <div className="backend-status-pill">
            <span className="status-dot offline" />
            <span>Backend Disconnected</span>
          </div>
        </div>

        <h1
          style={{
            fontSize: '1.25rem',
            fontWeight: 700,
            marginBottom: '0.5rem',
            color: 'var(--color-text-primary)',
          }}
        >
          Cannot Connect to Backend Server
        </h1>

        <p
          style={{
            fontSize: '0.85rem',
            color: 'var(--color-text-muted)',
            lineHeight: 1.5,
            marginBottom: '1.25rem',
          }}
        >
          The API server is currently unreachable. Ensure the backend process is running (e.g. via{' '}
          <code>pnpm dev</code>) and click retry below.
        </p>

        {errorMessage && (
          <div
            style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#991b1b',
              padding: '0.6rem 0.85rem',
              borderRadius: 'var(--radius-md)',
              fontSize: '0.8rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              marginBottom: '1rem',
              textAlign: 'left',
            }}
          >
            <AlertCircleIcon style={{ width: 16, height: 16, flexShrink: 0 }} />
            <span>{errorMessage}</span>
          </div>
        )}

        {activeHome && (
          <div
            className="backend-unavailable-home-badge"
            style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', textAlign: 'left' }}
          >
            <HomeIcon
              style={{ width: 18, height: 18, color: 'var(--color-primary)', flexShrink: 0 }}
            />
            <div>
              <strong style={{ display: 'block', color: 'var(--color-text-primary)' }}>
                Active Home: {activeHome.name}
              </strong>
              <small style={{ color: 'var(--color-text-muted)' }}>
                ID #{activeHome.id} · Preserved locally
              </small>
            </div>
          </div>
        )}

        <div style={{ marginTop: '1.25rem' }}>
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: '100%' }}
            onClick={onRetry}
            disabled={isRetrying}
            aria-label="Retry connecting to server"
          >
            {isRetrying ? (
              <>
                <Spinner style={{ width: 14, height: 14 }} /> Attempting Reconnection...
              </>
            ) : (
              <>
                <RefreshCwIcon style={{ width: 14, height: 14 }} /> Retry Connection
              </>
            )}
          </button>
        </div>

        {lastAttemptTime && (
          <p
            style={{ fontSize: '0.72rem', color: 'var(--color-text-subtle)', marginTop: '0.85rem' }}
          >
            Last connection attempt: {lastAttemptTime}
          </p>
        )}
      </div>
    </div>
  )
}
