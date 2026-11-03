import { formatRupees } from '../api/client'
import type { Balance } from '../api/types'
import { WalletIcon } from './Icons'

interface BalancesBarProps {
  balances: Balance[]
}

export function BalancesBar({ balances }: BalancesBarProps) {
  if (balances.length === 0) {
    return (
      <section className="card" aria-labelledby="balances-heading">
        <div className="card-header">
          <div>
            <h2 id="balances-heading" className="card-title">
              <WalletIcon /> Balances Overview
            </h2>
            <p className="card-subtitle">Member debt and settlement status</p>
          </div>
        </div>
        <p className="empty-state-desc" style={{ fontStyle: 'italic', margin: '0.5rem 0' }}>
          No balances to display yet. Add members and split bills to see who owes what.
        </p>
      </section>
    )
  }

  return (
    <section className="card" aria-labelledby="balances-heading">
      <div className="card-header">
        <div>
          <h2 id="balances-heading" className="card-title">
            <WalletIcon /> Balances Overview
          </h2>
          <p className="card-subtitle">Outstanding unpaid share totals per member</p>
        </div>
      </div>

      <ul className="balances-grid" aria-label="Member outstanding balances">
        {balances.map((balance) => {
          const isSettled = balance.outstandingCents === 0
          return (
            <li key={balance.memberId} className="balance-card">
              <div className="balance-card-header">
                <span className="balance-name">{balance.name}</span>
                <span className={`balance-status-tag ${isSettled ? 'settled' : 'owes'}`}>
                  {isSettled ? 'Settled Up' : 'Owes'}
                </span>
              </div>

              <div className={`balance-amount tabular-nums ${isSettled ? 'is-zero' : ''}`}>
                {formatRupees(balance.outstandingCents)}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
