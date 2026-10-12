'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
// Type-only: `adminSummary` reads the database and must never reach the browser bundle.
import type { EviteSummary } from '@/lib/evites/adminSummary'

/**
 * The per-party invitation button on the admin Booked page.
 *
 *   no invitation yet  ->  "Create invitation"
 *   one exists         ->  a state chip, "Open invitation" (the public /i/<slug> page) and "Send to parent"
 *
 * Booked clients are deliberately NOT emailed their invitation automatically (Adam, 2026-10-11): "Send to parent"
 * is the on-request path, the existing `send_invite_ready` action behind a confirm. Every action here is the
 * existing `/api/admin/parties/[id]/invitation` route; the state shown is the server's (`/api/admin/evites/summary`,
 * which derives it with the same helpers as the Parties card), never re-derived in the browser.
 *
 * `BookedInvitationView` is pure (props in, markup out) so it renders with a fixture; `BookedInvitation` owns the
 * in-flight state and the requests; `useInvitationSummaries` makes ONE request per page of parties, not one per row.
 */

/** undefined = still loading; null = nothing to show; 'unavailable' = the read failed (NOT the same as "no invitation"). */
export type SummaryEntry = EviteSummary | null | 'unavailable'
export type RowMessage = { ok: boolean; text: string }
export type RowAction = 'ensure' | 'send_invite_ready'

/** Ids per summary request: a uuid is 37 characters of URL, and the edge proxy's request-line limit is 8 KB. */
const SUMMARY_BATCH = 50

const CHIP: Record<string, { label: string; cls: string }> = {
  live: { label: 'Live', cls: 'bg-green-100 text-green-800' },
  preview: { label: 'Preview', cls: 'bg-blue-100 text-blue-800' },
  needs_time: { label: 'Needs time', cls: 'bg-amber-100 text-amber-800' },
  closed: { label: 'Closed', cls: 'bg-gray-100 text-gray-600' },
  unavailable: { label: 'Withdrawn', cls: 'bg-red-100 text-red-700' },
  disabled: { label: 'Switched off', cls: 'bg-gray-100 text-gray-600' },
}

const BTN =
  'text-[11px] inline-flex items-center px-2 py-1 rounded-lg border border-hampton-blue/40 text-hampton-navy hover:bg-hampton-blue/10 disabled:opacity-50 disabled:hover:bg-transparent'

export interface BookedInvitationViewProps {
  entry: SummaryEntry | undefined
  busy: RowAction | null
  message: RowMessage | null
  onCreate: () => void
  onSend: () => void
}

export function BookedInvitationView({ entry, busy, message, onCreate, onSend }: BookedInvitationViewProps) {
  const working = busy !== null

  if (entry === undefined) {
    return <span className="text-[11px] text-gray-300" data-testid="booked-invitation-loading">Invitation&hellip;</span>
  }
  if (entry === 'unavailable') {
    return <span className="text-[11px] text-red-700" data-testid="booked-invitation-unavailable">Invitation status unavailable</span>
  }
  // No such booking, a studio rental, a cancelled or lost party: no button.
  if (entry === null || !entry.eligible) return null

  const ev = entry.evite
  let body
  if (!ev) {
    body = entry.canEnsure ? (
      <button type="button" className={BTN} disabled={working} onClick={onCreate} data-testid="booked-create-invitation">
        {busy === 'ensure' ? 'Creating...' : 'Create invitation'}
      </button>
    ) : (
      <span className="text-[11px] text-gray-400" data-testid="booked-invitation-off">Invitations are off</span>
    )
  } else {
    const chip = CHIP[ev.state] ?? CHIP.preview
    const withdrawn = ev.state === 'unavailable' || ev.state === 'disabled'
    body = (
      <>
        <span className={`text-[11px] px-2 py-0.5 rounded-full ${chip.cls}`} data-testid="booked-invitation-chip">
          {chip.label}
        </span>
        {!withdrawn ? (
          <a href={ev.publicUrl} target="_blank" rel="noopener noreferrer" className={BTN} data-testid="booked-open-invitation">
            Open invitation
          </a>
        ) : null}
        {!withdrawn && ev.inviteReadySent ? (
          <span className="text-[11px] text-green-700" data-testid="booked-invite-emailed" title="The invitation email is on the send ledger">
            Emailed to parent
          </span>
        ) : null}
        {!withdrawn && !ev.inviteReadySent ? (
          <button
            type="button"
            className={BTN}
            disabled={working || entry.noParentEmail}
            title={entry.noParentEmail ? 'No parent email on this booking' : 'Emails the parent their invitation link'}
            onClick={onSend}
            data-testid="booked-send-invitation"
          >
            {busy === 'send_invite_ready' ? 'Sending...' : 'Send to parent'}
          </button>
        ) : null}
        {!withdrawn && !ev.inviteReadySent && entry.noParentEmail ? (
          <span className="text-[11px] text-amber-700" data-testid="booked-no-parent-email">No parent email</span>
        ) : null}
        {ev.renderFresh === false && ev.state === 'live' && !ev.inviteReadySent ? (
          <span className="text-[11px] text-amber-700" data-testid="booked-render-stale" title="The image is being redrawn; sending waits for it">
            Image updating
          </span>
        ) : null}
      </>
    )
  }

  return (
    <div className="mt-1.5" data-testid="booked-invitation">
      <div className="flex flex-wrap items-center gap-1.5">{body}</div>
      {message ? (
        <p className={`text-[11px] mt-1 max-w-[16rem] ${message.ok ? 'text-green-700' : 'text-red-700'}`} role="status" data-testid="booked-invitation-message">
          {message.text}
        </p>
      ) : null}
    </div>
  )
}

/** One request per page of parties. `refresh(id)` re-reads a single row after an action. */
export function useInvitationSummaries(ids: readonly string[], headers: HeadersInit, onLogout: () => void) {
  const [entries, setEntries] = useState<Record<string, SummaryEntry>>({})
  const headersRef = useRef(headers)
  headersRef.current = headers
  const logoutRef = useRef(onLogout)
  logoutRef.current = onLogout

  const fetchBatch = useCallback(async (batch: string[]) => {
    try {
      const res = await fetch(`/api/admin/evites/summary?bookingIds=${batch.join(',')}`, { headers: headersRef.current })
      if (res.status === 401) {
        logoutRef.current()
        return
      }
      const body = await res.json().catch(() => null)
      if (!res.ok || !body || typeof body.summaries !== 'object' || body.summaries === null) throw new Error('summary read failed')
      const got = body.summaries as Record<string, EviteSummary | null>
      setEntries((cur) => {
        const next = { ...cur }
        for (const id of batch) next[id] = got[id] ?? null
        return next
      })
    } catch {
      setEntries((cur) => {
        const next = { ...cur }
        for (const id of batch) next[id] = 'unavailable'
        return next
      })
    }
  }, [])

  const key = ids.join(',')
  useEffect(() => {
    if (ids.length === 0) return
    for (let i = 0; i < ids.length; i += SUMMARY_BATCH) void fetchBatch(ids.slice(i, i + SUMMARY_BATCH))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, fetchBatch])

  const refresh = useCallback((id: string) => fetchBatch([id]), [fetchBatch])
  return { entries, refresh }
}

function failureText(body: { error?: string; reason?: string } | null, status: number): string {
  if (body?.error) return body.error
  if (body?.reason) return body.reason
  return `That did not work (${status}).`
}

export default function BookedInvitation({ bookingId, partyLabel, entry, headers, onRefresh, onLogout }: {
  bookingId: string
  /** The customer's name, for the confirm text. */
  partyLabel: string
  entry: SummaryEntry | undefined
  headers: HeadersInit
  onRefresh: (bookingId: string) => Promise<void>
  onLogout: () => void
}) {
  const [busy, setBusy] = useState<RowAction | null>(null)
  const [message, setMessage] = useState<RowMessage | null>(null)

  async function run(action: RowAction) {
    if (busy !== null) return
    if (action === 'send_invite_ready' && !window.confirm(`Email ${partyLabel} their invitation link now? It is sent once.`)) return
    setBusy(action)
    setMessage(null)
    try {
      const res = await fetch(`/api/admin/parties/${bookingId}/invitation`, {
        method: 'POST',
        headers: { ...Object.fromEntries(new Headers(headers).entries()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (res.status === 401) {
        onLogout()
        return
      }
      const body = await res.json().catch(() => null)
      if (!res.ok || body?.ok === false) {
        setMessage({ ok: false, text: failureText(body, res.status) })
      } else if (action === 'ensure') {
        setMessage({ ok: true, text: body?.outcome === 'created' ? 'Invitation created; the image is rendering.' : 'This party already had an invitation.' })
      } else {
        setMessage({ ok: true, text: typeof body?.message === 'string' ? body.message : 'Invitation email sent to the parent.' })
      }
      await onRefresh(bookingId)
    } catch {
      setMessage({ ok: false, text: 'Something went wrong. Reload and check before trying again.' })
    } finally {
      setBusy(null)
    }
  }

  return (
    // The row opens the detail panel on click; the buttons and links here must not.
    <div onClick={(e) => e.stopPropagation()}>
      <BookedInvitationView entry={entry} busy={busy} message={message} onCreate={() => void run('ensure')} onSend={() => void run('send_invite_ready')} />
    </div>
  )
}
