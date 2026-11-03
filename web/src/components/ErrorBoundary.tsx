import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertCircleIcon, RefreshCwIcon } from './Icons'

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an unhandled error:', error, errorInfo)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div
          style={{
            minHeight: '50vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2rem 1rem',
          }}
          role="alert"
        >
          <div
            className="card"
            style={{
              maxWidth: 480,
              width: '100%',
              textAlign: 'center',
              padding: '2.5rem 2rem',
              boxShadow: 'var(--shadow-md)',
            }}
          >
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
                margin: '0 auto 1rem',
              }}
              aria-hidden="true"
            >
              <AlertCircleIcon style={{ width: 26, height: 26 }} />
            </div>
            <h2
              style={{
                fontSize: '1.25rem',
                fontWeight: 700,
                marginBottom: '0.5rem',
                color: 'var(--color-text-primary)',
              }}
            >
              Application Error
            </h2>
            <p
              style={{
                fontSize: '0.85rem',
                color: 'var(--color-text-muted)',
                marginBottom: '1.5rem',
                lineHeight: 1.5,
              }}
            >
              {this.state.error?.message || 'An unexpected rendering error occurred.'}
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
              <button
                type="button"
                onClick={this.handleReset}
                className="btn btn-primary"
                aria-label="Try again"
              >
                Try Again
              </button>
              <button
                type="button"
                onClick={this.handleReload}
                className="btn btn-secondary"
                aria-label="Reload application"
              >
                <RefreshCwIcon style={{ width: 14, height: 14 }} /> Reload Page
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
