'use client'

/**
 * /admin/crew/leads - the open leads as cards, the one in touch most recently on
 * top. Each card is a short summary; tapping it opens everything about the party and
 * the buttons to copy or view the invoice, open the planner, or ask the AI
 * assistant to make a change. Nothing here changes a booking or sends anything:
 * the buttons mint a link for YOU (the same ones the Parties tab makes), and the
 * assistant, as always, only proposes cards that you confirm.
 */

import { useCallback, useEffect, useState } from 'react'
import type { LeadCard } from '@/lib/leadCards'
import { PARTY_TYPE_LABELS } from '@/lib/pipelineStages'
import { STAGE_LABELS, STAGE_STYLE } from '@/lib/bookingStatus'
import { etDateTime } from '@/lib/assistant/timeFormat'
import { agoLabel } from '@/lib/agoLabel'
import { copyText } from '@/lib/copyText'
import { BTN_GHOST, BTN_PRIMARY, Banner, CrewFrame, LoginGate, useAdminApi } from '../_components/adminCrew'

const money = (cents: number | null | undefined) => `$${((Number(cents) || 0) / 100).toFixed(2)}`

/** "Sat, Dec 12" from a YYYY-MM-DD, noon-anchored so the day never slips. */
function dayLabel(ymd: string | null): string {
  if (!ymd) return 'No date yet'
  const d = new Date(`${ymd}T12:00:00`)
  return Number.isNaN(d.getTime()) ? ymd : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

interface Detail {
  package_type?: string | null
  admin_notes?: string | null
  balance_due_cents?: number | null
  party_tags?: Record<string, unknown> | null
  line_items?: Array<{ id: string; name: string; quantity: number; unit_price_cents: number; guest_multiplied: boolean }>
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 text-sm">
      <div className="w-24 shrink-0 text-hampton-navy/50">{label}</div>
      <div className="text-hampton-navy min-w-0 break-words">{children}</div>
    </div>
  )
}

function LeadCardView({
  lead,
  open,
  onToggle,
}: {
  lead: LeadCard
  open: boolean
  onToggle: () => void
}) {
  const api = useAdminApi()
  const [detail, setDetail] = useState<Detail | null>(null)
  const [detailError, setDetailError] = useState('')
  const [busy, setBusy] = useState('')
  const [toast, setToast] = useState('')
  const [copied, setCopied] = useState(false)

  // The full party, fetched the first time the card opens.
  useEffect(() => {
    if (!open || detail) return
    let cancelled = false
    api<Detail & { error?: string }>(`/api/admin/parties/${lead.id}`).then(r => {
      if (cancelled) return
      if (r.ok) setDetail(r.data)
      else setDetailError(r.data.error || 'Could not load the full party.')
    })
    return () => {
      cancelled = true
    }
  }, [open, detail, lead.id, api])

  /** Mint a client link for the manager (the Parties tab's own action) and copy or open it. */
  async function link(destination: 'invoice' | 'planner', mode: 'copy' | 'open') {
    setBusy(`${destination}-${mode}`)
    setToast('')
    // Opened BEFORE the request so a phone does not treat the new tab as a pop-up.
    const win = mode === 'open' ? window.open('', '_blank') : null
    const r = await api<{ portalUrl?: string; error?: string }>(`/api/admin/parties/${lead.id}`, {
      method: 'POST',
      body: { action: 'generate_portal_url', destination },
    })
    setBusy('')
    const url = r.data.portalUrl
    if (!r.ok || !url) {
      win?.close()
      setToast(r.data.error || 'Could not make the link.')
      return
    }
    if (mode === 'open') {
      if (win) win.location.href = url
      else window.open(url, '_blank')
      return
    }
    if (await copyText(url)) {
      // A check on the button for two seconds, the way every copy button works.
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      setToast('It signs in whoever opens it as the client.')
    } else {
      // No clipboard permission (some phones, some embedded browsers): show it, selectable.
      setToast(`Could not copy automatically. Press and hold to copy: ${url}`)
    }
  }

  const askAssistant = () => window.dispatchEvent(new CustomEvent('hh:assistant-open', { detail: { bookingRef: lead.ref } }))
  const total = lead.totalCents
  const kid = [lead.childName, lead.childAge ? `${lead.childAge}` : null].filter(Boolean).join(', ')

  return (
    <article className="bg-white rounded-2xl shadow-sm overflow-hidden" data-lead-card data-ref={lead.ref}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full text-left p-4 active:bg-[#F6F1EB]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-lg font-semibold text-hampton-navy leading-tight truncate">{lead.name}</div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${STAGE_STYLE[lead.stage]}`}>{STAGE_LABELS[lead.stage]}</span>
              {lead.waitingOnUs && <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-red-100 text-red-700">Waiting on us</span>}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-xs font-semibold text-hampton-navy" title={etDateTime(lead.lastContactAt)}>{agoLabel(lead.lastContactAt)}</div>
            <div className="text-[11px] text-hampton-navy/50">
              {lead.lastFrom === 'them' ? 'they wrote' : lead.lastFrom === 'us' ? 'we wrote' : 'first asked'}
            </div>
          </div>
        </div>
        <div className="mt-2 text-sm text-hampton-navy/80">
          {[PARTY_TYPE_LABELS[lead.partyType || 'unknown'], kid || null, `${dayLabel(lead.partyDate)}${lead.partyTime ? ` · ${lead.partyTime}` : ''}`, lead.guests ? `${lead.guests} guests` : null]
            .filter(Boolean)
            .join(' · ')}
        </div>
        <div className="mt-1 text-sm text-hampton-navy/60 line-clamp-2">
          {lead.lastTheirs ? `“${lead.lastTheirs.text}”` : 'No message from them on record.'}
        </div>
      </button>

      {open && (
        <div className="border-t border-hampton-navy/10 p-4 space-y-3 bg-[#FBF8F4]">
          <Row label="Reference">{lead.ref}</Row>
          <Row label="Phone">{lead.phone ? <a className="underline" href={`tel:${lead.phone}`}>{lead.phone}</a> : '—'}</Row>
          <Row label="Email">{lead.email ? <a className="underline" href={`mailto:${lead.email}`}>{lead.email}</a> : '—'}</Row>
          <Row label="Party">
            {PARTY_TYPE_LABELS[lead.partyType || 'unknown']} · {dayLabel(lead.partyDate)}{lead.partyTime ? ` at ${lead.partyTime}` : ''} · {lead.guests ?? '?'} guests
          </Row>
          {kid && <Row label="Child">{kid}</Row>}
          {(detail?.package_type || lead.packageType) && <Row label="Package">{detail?.package_type || lead.packageType}</Row>}
          {typeof detail?.party_tags?.location_address === 'string' && <Row label="Venue">{detail.party_tags.location_address}</Row>}
          <Row label="First asked">{etDateTime(lead.createdAt)}</Row>
          <Row label="Money">
            {total && total > 0 ? `${money(total)} quoted · ${money(lead.paidCents)} paid` : 'Not priced yet'}
          </Row>

          {detailError && <Banner tone="warn">{detailError}</Banner>}
          {!detail && !detailError && <div className="text-sm text-hampton-navy/50">Loading the rest…</div>}
          {detail?.line_items && detail.line_items.length > 0 && (
            <div>
              <div className="text-sm text-hampton-navy/50 mb-1">On the quote</div>
              <ul className="text-sm text-hampton-navy space-y-0.5">
                {detail.line_items.map(li => (
                  <li key={li.id} className="flex justify-between gap-3">
                    <span>{li.name}{li.quantity > 1 ? ` ×${li.quantity}` : ''}{li.guest_multiplied ? ' (per guest)' : ''}</span>
                    <span className="text-hampton-navy/70 shrink-0">{money(li.unit_price_cents * li.quantity)}{li.guest_multiplied ? ' ea' : ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {detail?.admin_notes && <Row label="Notes">{detail.admin_notes}</Row>}

          <div className="flex flex-wrap gap-2 pt-1">
            <button className={BTN_GHOST} disabled={!!busy} onClick={() => link('invoice', 'copy')}>
              {busy === 'invoice-copy' ? 'Making…' : copied ? '✓ Copied' : 'Copy invoice link'}
            </button>
            <button className={BTN_GHOST} disabled={!!busy} onClick={() => link('invoice', 'open')}>View invoice</button>
            <button className={BTN_GHOST} disabled={!!busy} onClick={() => link('planner', 'open')}>Open planner</button>
            <a className={`${BTN_GHOST} inline-flex items-center`} href={`/admin/crew/bookings?party=${lead.id}`}>Full booking</a>
            <button className={BTN_PRIMARY} onClick={askAssistant}>✨ Ask the AI to edit</button>
          </div>
          {toast && <div className="text-sm text-hampton-navy/70 break-all select-all">{toast}</div>}
        </div>
      )}
    </article>
  )
}

export default function CrewLeadsPage() {
  const api = useAdminApi()
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [leads, setLeads] = useState<LeadCard[] | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState('')
  const [openRef, setOpenRef] = useState<string | null>(null)

  const load = useCallback(async (): Promise<'ok' | 'unauthorized' | 'error'> => {
    const r = await api<{ leads?: LeadCard[]; truncated?: boolean; error?: string }>('/api/admin/leads')
    if (r.status === 401) { setAuthed(false); return 'unauthorized' }
    setAuthed(true)
    if (!r.ok || !r.data.leads) { setError(r.data.error || 'Could not read the leads.'); return 'error' }
    setError('')
    setLeads(r.data.leads)
    setTruncated(!!r.data.truncated)
    return 'ok'
  }, [api])

  useEffect(() => { load() }, [load])
  // After the assistant changes something, the list is re-read.
  useEffect(() => {
    const again = () => { load() }
    window.addEventListener('hh:admin-data-changed', again)
    return () => window.removeEventListener('hh:admin-data-changed', again)
  }, [load])

  if (authed === null) return <div className="min-h-screen bg-[#F6F1EB] grid place-items-center text-hampton-navy/60">Loading…</div>
  if (!authed) return <LoginGate title="Leads" onSignedIn={load} />

  return (
    <CrewFrame
      active="/admin/crew/leads"
      title="Leads"
      sub={leads ? `${leads.length} open ${leads.length === 1 ? 'lead' : 'leads'}, the one in touch most recently first.` : null}
    >
      {error && <Banner tone="error">{error}</Banner>}
      {truncated && <Banner tone="info">Showing the most recent 200 inquiries.</Banner>}
      {leads && leads.length === 0 && !error && <Banner tone="ok">No open leads right now.</Banner>}
      <div className="space-y-3 max-w-3xl">
        {(leads ?? []).map(l => (
          <LeadCardView key={l.id} lead={l} open={openRef === l.ref} onToggle={() => setOpenRef(openRef === l.ref ? null : l.ref)} />
        ))}
      </div>
    </CrewFrame>
  )
}
