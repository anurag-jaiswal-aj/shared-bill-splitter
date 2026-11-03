import { createRootRoute, Outlet } from '@tanstack/react-router'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { ReceiptIcon } from '../components/Icons'

export const Route = createRootRoute({
  component: RootComponent,
})

function RootComponent() {
  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      <header className="app-header">
        <div className="app-header-content">
          <div className="app-logo">
            <ReceiptIcon style={{ width: 22, height: 22, color: 'var(--color-primary)' }} />
            <span>Splitter</span>
          </div>
        </div>
      </header>

      <main className="app-main" id="main-content" tabIndex={-1}>
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  )
}
