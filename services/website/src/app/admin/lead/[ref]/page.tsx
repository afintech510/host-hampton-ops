'use client'

import { useCallback, useEffect, useState } from 'react'
import type { TimelineItem } from '@/lib/agent/threadTimeline'
import LeadThread, { type LeadDraft } from '@/app/admin/LeadThread'
import PlanPanel, { PipelineHeader, type PlanBooking, type PlanLineItem } from '@/app/admin/PlanPanel'

/**
 * `/admin/lead/[ref]` — the Lead Thread Workspace (plan §11).
 *
 * One page per lead: the whole progression in one stream, the draft editable in
 * place, and the plan on the right. It replaces hunting across the Inbox,
 * Parties and Contacts tabs for the same lead.
 *
 * ── Auth ─────────────────────────────────────────────────────────────────
 *
 * Both doors from migration 038, and neither of them re-implemented here: the
 * page asks `/api/admin/auth/session` whether the HttpOnly `hh_admin` cookie
 * names someone, and falls back to the shared password in localStorage that
 * `/admin` already stores. It deliberately does NOT render a login form — one
 * password prompt in the app is enough, and a second one is a second thing to
 * get wrong.
 *
 * `[ref]` is whatever identifier Allie is holding: a booking ref, a review code
 * from an SMS, or a draft UUID. The API resolves all three.
 */

interface LeadPayload {
  ref: string
  booking: PlanBooking | null
  drafts: LeadDraft[]
  activeDraftId: string | null
  lineItems: PlanLineItem[]
  timeline: TimelineItem[]
  errors: string[]
}

export default function LeadWorkspacePage({ params }: { params: { ref: string } }) {
  const ref = decodeURIComponent(params.ref || '')
  const [token, setToken] = useState<string | null>(null)
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [who, setWho] = useState<string | null>(null)
  const [data, setData] = useState<LeadPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [staleDraftIds, setStaleDraftIds] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/auth/session')
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        if (d?.authenticated) {
          setAuthed(true)
          setWho(d.displayName ?? d.email ?? null)
          return
        }
        const saved = localStorage.getItem('hh_admin_token')
        setToken(saved)
        setAuthed(!!saved)
      })
      .catch(() => {
        // A failed session probe must not block the shared-password door.
        if (cancelled) return
        const saved = localStorage.getItem('hh_admin_token')
        setToken(saved)
        setAuthed(!!saved)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }

  const load = useCallback(async () => {
    if (!authed) return
    try {
      const res = await fetch(`/api/admin/lead/${encodeURIComponent(ref)}`, { headers })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(payload?.error || `Could not load ${ref}`)
        return
      }
      setError(null)
      setData(payload as LeadPayload)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this lead')
    }
    // `headers` is derived from `token`, which is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, ref, token])

  useEffect(() => {
    void load()
  }, [load])

  if (authed === null) {
    return <main className="min-h-screen bg-[#f5f6f8] p-8 text-sm text-gray-500">Checking your sign-in…</main>
  }

  if (!authed) {
    return (
      <main className="min-h-screen bg-[#f5f6f8] p-8">
        <p className="text-sm text-gray-600">
          You are not signed in.{' '}
          <a className="text-hampton-navy underline" href="/admin">
            Sign in to Host Hampton
          </a>{' '}
          and come back to this link.
        </p>
      </main>
    )
  }

  const recipient = {
    name: data?.booking?.contact_name ?? null,
    email: data?.booking?.contact_email ?? null,
    phone: data?.booking?.contact_phone ?? null,
  }

  return (
    <main className="min-h-screen bg-[#f5f6f8] py-6 px-4">
      <div className="max-w-6xl mx-auto space-y-4">
        <header className="bg-white rounded-2xl border border-gray-200 p-4 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <a href="/admin" className="text-[11px] text-gray-400 underline">
                ← Admin
              </a>
              <h1 className="text-lg font-semibold text-hampton-navy">
                {data?.booking?.contact_name || ref}
              </h1>
              <p className="text-[11px] text-gray-400 font-mono">{data?.booking?.booking_ref || ref}</p>
            </div>
            <div className="text-right text-[11px] text-gray-400">
              {who ? (
                <>
                  signed in as <span className="font-semibold text-gray-600">{who}</span>
                </>
              ) : (
                // Worth saying plainly: on the shared password every approval in
                // the ledger reads 'ADMIN' and cannot name who sent it.
                <>shared login — approvals will be recorded as “ADMIN”</>
              )}
              <div>
                <button onClick={() => void load()} className="underline">
                  Refresh
                </button>
              </div>
            </div>
          </div>
          <PipelineHeader status={data?.booking?.status ?? null} />
        </header>

        {error && (
          <p className="bg-red-50 border border-red-200 text-red-700 rounded-2xl px-4 py-3 text-sm">{error}</p>
        )}
        {(data?.errors ?? []).length > 0 && (
          <p className="bg-amber-50 border border-amber-200 text-amber-800 rounded-2xl px-4 py-3 text-sm">
            Part of this lead could not be read: {(data?.errors ?? []).join(' · ')}
          </p>
        )}

        {data && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
            <div className="lg:col-span-2">
              <LeadThread
                timeline={data.timeline}
                drafts={data.drafts}
                activeDraftId={data.activeDraftId}
                recipient={recipient}
                headers={headers}
                onChanged={() => void load()}
                staleDraftIds={staleDraftIds}
              />
            </div>
            <PlanPanel
              booking={data.booking}
              lineItems={data.lineItems}
              headers={headers}
              refPath={`/api/admin/lead/${encodeURIComponent(ref)}`}
              onSaved={ids => {
                setStaleDraftIds(ids)
                void load()
              }}
            />
          </div>
        )}
      </div>
    </main>
  )
}
