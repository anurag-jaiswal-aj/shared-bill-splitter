import { useMemo } from 'react'
import { formatRupees } from '../api/client'
import type { Balance, Bill, Member } from '../api/types'
import { AlertCircleIcon, CheckCircleIcon, ReceiptIcon, Spinner } from './Icons'

interface BillsListProps {
  bills: Bill[]
  members: Member[]
  balances: Balance[]
  onPayShare: (billId: string, shareId: string) => Promise<void>
  payingShareIds: Set<string>
  shareErrors: Map<string, string>
}

function formatDateTime(isoString: string): string {
  try {
    const d = new Date(isoString)
    if (Number.isNaN(d.getTime())) {
      return isoString
    }
    return d.toLocaleString('en-IN', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return isoString
  }
}

export function BillsList({
  bills,
  members,
  balances,
  onPayShare,
  payingShareIds,
  shareErrors,
}: BillsListProps) {
  // Build lookup map for member names
  const memberNameMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const member of members) {
      map.set(member.id, member.name)
    }
    for (const balance of balances) {
      map.set(balance.memberId, balance.name)
    }
    return map
  }, [members, balances])

  if (bills.length === 0) {
    return (
      <section className="empty-state" aria-labelledby="empty-bills-title">
        <div className="empty-state-icon" aria-hidden="true">
          <ReceiptIcon style={{ width: 22, height: 22 }} />
        </div>
        <h2 id="empty-bills-title" className="empty-state-title">
          No shared bills recorded yet
        </h2>
        <p className="empty-state-desc">
          Create your first bill using the form to split expenses and track repayments.
        </p>
      </section>
    )
  }

  return (
    <section aria-labelledby="bills-feed-heading">
      <div className="card-header" style={{ marginBottom: '1rem' }}>
        <div>
          <h2 id="bills-feed-heading" className="card-title">
            <ReceiptIcon /> Bills & Shared Expenses ({bills.length})
          </h2>
          <p className="card-subtitle">
            Expense history, allocated shares, and individual payments
          </p>
        </div>
      </div>

      <div className="bills-container">
        {bills.map((bill) => {
          const totalShares = bill.shares.length
          const paidShares = bill.shares.filter((s) => s.paidAt !== null).length
          const isFullySettled = totalShares > 0 && paidShares === totalShares

          return (
            <div key={bill.id} className="bill-card">
              <div className="bill-header">
                <div className="bill-title-area">
                  <h3 className="bill-title">{bill.title}</h3>
                  <span className="bill-date">
                    {bill.createdAt ? formatDateTime(bill.createdAt) : `Bill #${bill.id}`}
                  </span>
                </div>

                <div className="bill-meta-right">
                  {isFullySettled ? (
                    <span className="badge badge-paid">
                      <CheckCircleIcon style={{ width: 12, height: 12 }} /> Fully Settled
                    </span>
                  ) : (
                    <span className="badge badge-unpaid">
                      {paidShares} of {totalShares} Paid
                    </span>
                  )}
                  <div className="bill-total tabular-nums">{formatRupees(bill.totalCents)}</div>
                </div>
              </div>

              <div className="table-responsive">
                <table className="shares-table" aria-label={`Shares breakdown for ${bill.title}`}>
                  <thead>
                    <tr>
                      <th scope="col">Roommate</th>
                      <th scope="col">Share Amount</th>
                      <th scope="col">Status</th>
                      <th scope="col" className="share-action-cell">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {bill.shares.map((share) => {
                      const memberName =
                        memberNameMap.get(share.memberId) ?? `Member #${share.memberId}`
                      const isPaid = share.paidAt !== null
                      const isPaying = payingShareIds.has(share.id)
                      const errorMessage = shareErrors.get(share.id)

                      return (
                        <tr key={share.id}>
                          <th scope="row" style={{ fontWeight: 600 }}>
                            {memberName}
                          </th>
                          <td className="tabular-nums" style={{ fontWeight: 500 }}>
                            {formatRupees(share.amountCents)}
                          </td>
                          <td>
                            {isPaid ? (
                              <span
                                className="badge badge-paid"
                                title={`Paid on ${formatDateTime(share.paidAt ?? '')}`}
                              >
                                <CheckCircleIcon style={{ width: 12, height: 12 }} />
                                Paid {share.paidAt ? `· ${formatDateTime(share.paidAt)}` : ''}
                              </span>
                            ) : (
                              <span className="badge badge-unpaid">Pending</span>
                            )}
                          </td>
                          <td className="share-action-cell">
                            {!isPaid && (
                              <div>
                                <button
                                  type="button"
                                  className="btn btn-pay"
                                  onClick={() => onPayShare(bill.id, share.id)}
                                  disabled={isPaying}
                                  aria-busy={isPaying}
                                  aria-label={`Pay ${formatRupees(share.amountCents)} share for ${memberName} on ${bill.title}`}
                                >
                                  {isPaying ? (
                                    <>
                                      <Spinner style={{ width: 12, height: 12 }} /> Paying...
                                    </>
                                  ) : (
                                    'Pay Share'
                                  )}
                                </button>
                                {errorMessage && (
                                  <span
                                    className="share-error-inline"
                                    role="alert"
                                    aria-live="polite"
                                  >
                                    <AlertCircleIcon
                                      style={{
                                        width: 12,
                                        height: 12,
                                        display: 'inline',
                                        verticalAlign: 'text-bottom',
                                      }}
                                    />{' '}
                                    {errorMessage}
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
