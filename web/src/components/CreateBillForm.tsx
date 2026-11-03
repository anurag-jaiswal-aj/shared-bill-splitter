import { useId, useMemo, useState } from 'react'
import { formatRupees, parseRupeesToCents } from '../api/client'
import type { Member } from '../api/types'
import { AlertCircleIcon, ReceiptIcon, Spinner } from './Icons'

interface CreateBillFormProps {
  members: Member[]
  onCreateBill: (title: string, totalCents: number) => Promise<void>
  isSubmitting: boolean
}

export function CreateBillForm({ members, onCreateBill, isSubmitting }: CreateBillFormProps) {
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [touched, setTouched] = useState(false)

  const titleId = useId()
  const amountId = useId()
  const titleErrorId = `${titleId}-error`
  const amountErrorId = `${amountId}-error`

  const memberCount = members.length
  const parsedCents = useMemo(() => parseRupeesToCents(amount), [amount])

  // Live preview calculation strictly mirroring deterministic backend allocation
  const livePreviewShares = useMemo(() => {
    if (parsedCents === null || parsedCents <= 0 || memberCount === 0) {
      return []
    }
    const baseCents = Math.floor(parsedCents / memberCount)
    const remainder = parsedCents % memberCount

    return members.map((member, i) => ({
      memberId: member.id,
      name: member.name,
      amountCents: baseCents + (i < remainder ? 1 : 0),
    }))
  }, [parsedCents, memberCount, members])

  const isValidAmount = parsedCents !== null && parsedCents > 0
  const isValidTitle = title.trim().length > 0
  const canSubmit = isValidTitle && isValidAmount && memberCount > 0 && !isSubmitting

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (!canSubmit || parsedCents === null) {
      return
    }

    await onCreateBill(title.trim(), parsedCents)
    setTitle('')
    setAmount('')
    setTouched(false)
  }

  const isTitleInvalid = touched && !isValidTitle
  const isAmountInvalid = touched && !isValidAmount

  return (
    <section className="card" aria-labelledby="create-bill-heading">
      <div className="card-header">
        <div>
          <h2 id="create-bill-heading" className="card-title">
            <ReceiptIcon /> Create a Shared Bill
          </h2>
          <p className="card-subtitle">Split expenses equally among all home members</p>
        </div>
      </div>

      {memberCount === 0 && (
        <div
          className="banner banner-info"
          style={{ marginBottom: '1.25rem' }}
          role="status"
          aria-live="polite"
        >
          <div className="banner-content">
            <AlertCircleIcon style={{ width: 16, height: 16, flexShrink: 0 }} />
            <span>Add roommates to this home first to enable equal expense splitting.</span>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor={titleId} className="form-label">
              <span>Bill Description</span>
            </label>
            <input
              id={titleId}
              type="text"
              className={`form-input ${isTitleInvalid ? 'is-invalid' : ''}`}
              placeholder="e.g. WiFi Bill, Groceries, Dinner"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isSubmitting || memberCount === 0}
              aria-invalid={isTitleInvalid ? 'true' : 'false'}
              aria-describedby={isTitleInvalid ? titleErrorId : undefined}
            />
            {isTitleInvalid && (
              <span id={titleErrorId} className="form-feedback" role="alert">
                Bill description is required
              </span>
            )}
          </div>

          <div className="form-group">
            <label htmlFor={amountId} className="form-label">
              <span>Total Amount</span>
            </label>
            <div className="input-group">
              <span className="input-addon" aria-hidden="true">
                ₹
              </span>
              <input
                id={amountId}
                type="text"
                inputMode="decimal"
                className={`form-input ${isAmountInvalid ? 'is-invalid' : ''}`}
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={isSubmitting || memberCount === 0}
                aria-invalid={isAmountInvalid ? 'true' : 'false'}
                aria-describedby={isAmountInvalid ? amountErrorId : undefined}
              />
            </div>
            {isAmountInvalid && (
              <span id={amountErrorId} className="form-feedback" role="alert">
                Enter a valid positive amount (e.g. 1500 or 150.50)
              </span>
            )}
          </div>
        </div>

        {livePreviewShares.length > 0 && parsedCents !== null && (
          <div className="share-preview-box" aria-live="polite">
            <div className="share-preview-title">
              <span>
                Equal Split Preview · {formatRupees(parsedCents)} among {memberCount} roommates:
              </span>
            </div>
            <div className="share-preview-list">
              {livePreviewShares.map((item) => (
                <div key={item.memberId} className="share-preview-chip">
                  <span>{item.name}:</span>
                  <span className="share-preview-amount tabular-nums">
                    {formatRupees(item.amountCents)}
                  </span>
                </div>
              ))}
            </div>
            {parsedCents % memberCount !== 0 && (
              <p className="remainder-note">
                ℹ️ Remainder paise distributed to first {parsedCents % memberCount} member(s) in
                order of addition.
              </p>
            )}
          </div>
        )}

        <button
          type="submit"
          className="btn btn-primary"
          style={{ width: '100%', marginTop: '0.25rem' }}
          disabled={!canSubmit}
          aria-busy={isSubmitting}
        >
          {isSubmitting ? (
            <>
              <Spinner /> Creating Bill...
            </>
          ) : (
            'Split & Record Expense'
          )}
        </button>
      </form>
    </section>
  )
}
