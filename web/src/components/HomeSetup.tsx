import { useState } from 'react'
import { ArrowRightIcon, HomeIcon, Spinner, UsersIcon } from './Icons'

interface HomeSetupProps {
  onCreateHome: (name: string) => Promise<void>
  onSwitchHomeById: (id: string) => Promise<void>
  isLoading: boolean
}

export function HomeSetup({ onCreateHome, onSwitchHomeById, isLoading }: HomeSetupProps) {
  const [homeName, setHomeName] = useState('')
  const [existingId, setExistingId] = useState('')
  const [mode, setMode] = useState<'create' | 'join'>('create')
  const [validationError, setValidationError] = useState<string | null>(null)

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = homeName.trim()
    if (!trimmed) {
      setValidationError('Please enter a home name')
      return
    }
    setValidationError(null)
    await onCreateHome(trimmed)
  }

  const handleJoinSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = existingId.trim()
    if (!trimmed || !/^\d+$/.test(trimmed)) {
      setValidationError('Please enter a valid numeric Home ID')
      return
    }
    setValidationError(null)
    await onSwitchHomeById(trimmed)
  }

  return (
    <section className="setup-container" aria-labelledby="setup-welcome-title">
      <div className="card setup-card">
        <div className="setup-brand-area">
          <div className="setup-brand-badge" aria-hidden="true">
            <HomeIcon style={{ width: 26, height: 26 }} />
          </div>
          <h1 id="setup-welcome-title" className="setup-title">
            Welcome to Splitter
          </h1>
          <p className="setup-subtitle">
            Fair, transparent expense splitting and debt tracking for flatmates.
          </p>
        </div>

        {/* Segmented Control Pill Switcher */}
        <div
          className="segmented-control"
          role="tablist"
          aria-label="Home setup mode selection"
          style={{ marginBottom: '1.25rem' }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'create'}
            aria-controls="create-home-panel"
            id="create-home-tab"
            className={`segmented-tab ${mode === 'create' ? 'active' : ''}`}
            onClick={() => {
              setMode('create')
              setValidationError(null)
            }}
          >
            <HomeIcon style={{ width: 14, height: 14 }} />
            Create New Home
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'join'}
            aria-controls="join-home-panel"
            id="join-home-tab"
            className={`segmented-tab ${mode === 'join' ? 'active' : ''}`}
            onClick={() => {
              setMode('join')
              setValidationError(null)
            }}
          >
            <UsersIcon style={{ width: 14, height: 14 }} />
            Open Existing Home ID
          </button>
        </div>

        {mode === 'create' ? (
          <form
            id="create-home-panel"
            role="tabpanel"
            aria-labelledby="create-home-tab"
            onSubmit={handleCreateSubmit}
            noValidate
          >
            <div className="form-group">
              <label htmlFor="create-home-name" className="form-label">
                <span>Home or Apartment Name</span>
              </label>
              <input
                id="create-home-name"
                type="text"
                className={`form-input ${validationError ? 'is-invalid' : ''}`}
                placeholder="e.g. Palm Grove Apt 402"
                value={homeName}
                onChange={(e) => {
                  setHomeName(e.target.value)
                  if (validationError) setValidationError(null)
                }}
                disabled={isLoading}
                aria-invalid={validationError ? 'true' : 'false'}
                aria-describedby={validationError ? 'create-home-error' : undefined}
              />
              {validationError && (
                <span id="create-home-error" className="form-feedback" role="alert">
                  {validationError}
                </span>
              )}
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', marginTop: '0.5rem' }}
              disabled={isLoading || !homeName.trim()}
              aria-busy={isLoading}
            >
              {isLoading ? (
                <>
                  <Spinner /> Creating Home...
                </>
              ) : (
                <>
                  Create Home & Get Started
                  <ArrowRightIcon style={{ width: 16, height: 16 }} />
                </>
              )}
            </button>
          </form>
        ) : (
          <form
            id="join-home-panel"
            role="tabpanel"
            aria-labelledby="join-home-tab"
            onSubmit={handleJoinSubmit}
            noValidate
          >
            <div className="form-group">
              <label htmlFor="existing-home-id" className="form-label">
                <span>Numeric Home ID</span>
              </label>
              <input
                id="existing-home-id"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                className={`form-input ${validationError ? 'is-invalid' : ''}`}
                placeholder="e.g. 1"
                value={existingId}
                onChange={(e) => {
                  setExistingId(e.target.value)
                  if (validationError) setValidationError(null)
                }}
                disabled={isLoading}
                aria-invalid={validationError ? 'true' : 'false'}
                aria-describedby={validationError ? 'join-home-error' : undefined}
              />
              {validationError && (
                <span id="join-home-error" className="form-feedback" role="alert">
                  {validationError}
                </span>
              )}
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', marginTop: '0.5rem' }}
              disabled={isLoading || !existingId.trim()}
              aria-busy={isLoading}
            >
              {isLoading ? (
                <>
                  <Spinner /> Opening Home...
                </>
              ) : (
                <>
                  Open Home Ledger
                  <ArrowRightIcon style={{ width: 16, height: 16 }} />
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </section>
  )
}
