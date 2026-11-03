import { useState } from 'react'
import type { Member } from '../api/types'
import { PlusIcon, Spinner, UsersIcon } from './Icons'

interface MembersSectionProps {
  members: Member[]
  onAddMember: (name: string) => Promise<void>
  isAdding: boolean
}

export function MembersSection({ members, onAddMember, isAdding }: MembersSectionProps) {
  const [name, setName] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setValidationError('Member name cannot be empty')
      return
    }
    setValidationError(null)
    await onAddMember(trimmed)
    setName('')
  }

  return (
    <section className="card members-container" aria-labelledby="members-heading">
      <div className="card-header">
        <div>
          <h2 id="members-heading" className="card-title">
            <UsersIcon /> Roommates ({members.length})
          </h2>
          <p className="card-subtitle">Flatmates who share in bills</p>
        </div>
      </div>

      {members.length === 0 ? (
        <p className="empty-state-desc" style={{ fontStyle: 'italic', margin: '0.5rem 0' }}>
          No roommates added yet. Add flatmates below to begin splitting bills.
        </p>
      ) : (
        <ul className="members-chips" aria-label="Home members list">
          {members.map((member) => (
            <li key={member.id} className="member-chip">
              <span className="member-chip-avatar" aria-hidden="true">
                {member.name.charAt(0).toUpperCase()}
              </span>
              <span className="member-name-text">{member.name}</span>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleSubmit} className="add-member-form" noValidate>
        <div style={{ flex: 1 }}>
          <label htmlFor="new-member-name" className="sr-only">
            Add new roommate
          </label>
          <input
            id="new-member-name"
            type="text"
            className={`form-input ${validationError ? 'is-invalid' : ''}`}
            placeholder="Add new roommate name..."
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              if (validationError) setValidationError(null)
            }}
            disabled={isAdding}
            aria-invalid={validationError ? 'true' : 'false'}
            aria-describedby={validationError ? 'new-member-error' : undefined}
          />
          {validationError && (
            <span id="new-member-error" className="form-feedback" role="alert">
              {validationError}
            </span>
          )}
        </div>

        <button
          type="submit"
          className="btn btn-secondary"
          disabled={isAdding || !name.trim()}
          aria-busy={isAdding}
          aria-label="Add roommate to home"
        >
          {isAdding ? (
            <>
              <Spinner /> Adding...
            </>
          ) : (
            <>
              <PlusIcon style={{ width: 14, height: 14 }} /> Add
            </>
          )}
        </button>
      </form>
    </section>
  )
}
