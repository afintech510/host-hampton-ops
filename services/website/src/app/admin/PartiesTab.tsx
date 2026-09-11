'use client'

import { useState, useEffect } from 'react'
import { formatMoney } from '@/lib/partyPricing'
import { PIPELINE_STAGES, PARTY_TYPES, PARTY_TYPE_LABELS } from '@/lib/pipelineStages'
import { FALLBACK_STUDIO_RATES, type StudioRates } from '@/lib/pricingCatalog'

interface PartyBookingSummary {
  id: string
  booking_ref: string
  status: string
  /** Migration 035. The consistent product field — `event_type` never was. */
  party_type: string | null
  source: string | null
  party_date: string
  party_time: string
  package_type: string
  guest_count_approx: number
  child_name: string | null
  contact_name: string
  contact_email: string
  contact_phone: string | null
  total_cents: number
  balance_due_cents: number
  payment_method_preference: string
  created_at: string
}

interface PartyDetail extends PartyBookingSummary {
  checkin_status?: string | null
  checkin_started_at?: string | null
  checkin_completed_at?: string | null
  checkin_agreement_signed_at?: string | null
  checkin_agreement_pdf_url?: string | null
  admin_notes: string | null
  notes: string | null
  event_type?: string | null
  party_tags?: Record<string, unknown> | null
  approved_at: string | null
  paid_in_full_at: string | null
  child_age: number | null
  line_items: { id: string; name: string; quantity: number; unit_price_cents: number; guest_multiplied: boolean; category: string }[]
  payments: { id: string; payment_type: string; payment_method: string; amount_cents: number; card_fee_cents: number; paid_at: string; recorded_by: string; notes: string | null }[]
  modifications: { id: string; modified_by: string; change_summary: string; created_at: string }[]
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  lead: { label: 'Lead', color: 'bg-slate-100 text-slate-700' },
  quoted: { label: 'Quoted', color: 'bg-indigo-100 text-indigo-800' },
  awaiting_deposit: { label: 'Awaiting Deposit', color: 'bg-yellow-100 text-yellow-800' },
  pending_review: { label: 'Pending Review', color: 'bg-blue-100 text-blue-800' },
  deposit_paid: { label: 'Deposit Paid', color: 'bg-blue-100 text-blue-800' },
  approved: { label: 'Approved', color: 'bg-green-100 text-green-800' },
  modifications_locked: { label: 'Locked', color: 'bg-gray-100 text-gray-800' },
  paid_in_full: { label: 'Paid in Full', color: 'bg-emerald-100 text-emerald-800' },
  completed: { label: 'Completed', color: 'bg-purple-100 text-purple-800' },
  cancelled: { label: 'Cancelled', color: 'bg-red-100 text-red-800' },
}

const CHECKIN_STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: 'Not started', color: 'bg-gray-100 text-gray-700' },
  started: { label: 'Details in', color: 'bg-amber-100 text-amber-800' },
  complete: { label: 'Complete', color: 'bg-green-100 text-green-800' },
}

function checkinBadge(status: string | null | undefined) {
  return CHECKIN_STATUS[status || 'pending'] ?? CHECKIN_STATUS.pending
}

/**
 * The stages and labels come from lib/pipelineStages.ts, which the API route
 * reads too — a second copy here is how the UI and the API end up disagreeing
 * about what the pipeline is.
 */
const PIPELINE: readonly string[] = PIPELINE_STAGES
const PARTY_TYPE_FILTERS: readonly string[] = ['all', ...PARTY_TYPES]

interface PipelineCounts {
  byStatus: Record<string, number>
  byPartyType: Record<string, number>
  all: number
  allTypes: number
  truncated: boolean
  error?: string | null
}

export default function PartiesTab({ headers }: { headers: HeadersInit; onLogout: () => void }) {
  const [bookings, setBookings] = useState<PartyBookingSummary[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('all')
  const [partyTypeFilter, setPartyTypeFilter] = useState('all')
  const [counts, setCounts] = useState<PipelineCounts | null>(null)
  // Falls back to the compiled rates until the first fetch lands, so the helper
  // text is never blank and never zero.
  const [rates, setRates] = useState<StudioRates>(FALLBACK_STUDIO_RATES)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<PartyDetail | null>(null)
  const [actionLoading, setActionLoading] = useState('')
  const [copyToast, setCopyToast] = useState('')
  const [changeMessage, setChangeMessage] = useState('')
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState('cash')
  const [payNotes, setPayNotes] = useState('')
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState<Record<string, string>>({})
  const [addingItem, setAddingItem] = useState(false)
  const [newItem, setNewItem] = useState({ name: '', price: '', quantity: '1', guest_multiplied: false })
  const [discountName, setDiscountName] = useState('')
  const [discountAmount, setDiscountAmount] = useState('')
  const [showDiscount, setShowDiscount] = useState(false)
  const [agentNote, setAgentNote] = useState('')
  const [agentResult, setAgentResult] = useState<{ ok: boolean; message: string } | null>(null)

  // New Party Plan form state
  const [showNewForm, setShowNewForm] = useState(false)
  const [newForm, setNewForm] = useState({
    contactName: '', contactEmail: '', contactPhone: '', childName: '',
    partyDate: '', partyTime: '', guestCount: '10', packageType: '', notes: '',
    sendEmail: true, lockDate: true,
  })
  const [creating, setCreating] = useState(false)
  const [createResult, setCreateResult] = useState<{ ok: boolean; bookingRef?: string; builderUrl?: string; error?: string } | null>(null)

  useEffect(() => { fetchBookings() }, [statusFilter, partyTypeFilter, page])

  async function createPartyPlan() {
    if (!newForm.contactName || !newForm.contactEmail) {
      setCreateResult({ ok: false, error: 'Name and email are required' })
      return
    }
    setCreating(true)
    setCreateResult(null)
    const res = await fetch('/api/admin/parties/create', {
      method: 'POST',
      headers: { ...Object.fromEntries(new Headers(headers).entries()), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contactName: newForm.contactName,
        contactEmail: newForm.contactEmail,
        contactPhone: newForm.contactPhone || undefined,
        childName: newForm.childName || undefined,
        partyDate: newForm.partyDate || undefined,
        partyTime: newForm.partyTime || undefined,
        guestCount: parseInt(newForm.guestCount, 10) || 10,
        packageType: newForm.packageType || undefined,
        notes: newForm.notes || undefined,
        sendEmail: newForm.sendEmail,
        lockDate: newForm.lockDate,
      }),
    })
    const data = await res.json()
    setCreating(false)
    if (res.ok) {
      setCreateResult({ ok: true, bookingRef: data.bookingRef, builderUrl: data.builderUrl })
      await fetchBookings()
    } else {
      setCreateResult({ ok: false, error: data.error || 'Failed to create' })
    }
  }

  function resetNewForm() {
    setShowNewForm(false)
    setCreateResult(null)
    setNewForm({
      contactName: '', contactEmail: '', contactPhone: '', childName: '',
      partyDate: '', partyTime: '', guestCount: '10', packageType: '', notes: '',
      sendEmail: true, lockDate: true,
    })
  }

  async function fetchBookings() {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page) })
    if (statusFilter !== 'all') params.set('status', statusFilter)
    if (partyTypeFilter !== 'all') params.set('party_type', partyTypeFilter)
    const res = await fetch(`/api/admin/parties?${params}`, { headers })
    const data = await res.json()
    setBookings(data.bookings || [])
    setTotal(data.total || 0)
    setCounts(data.counts ?? null)
    if (data.studioRates) setRates(data.studioRates)
    setLoading(false)
  }

  async function fetchDetail(id: string) {
    const res = await fetch(`/api/admin/parties/${id}`, { headers })
    const data = await res.json()
    // Scoped to one plan — carrying "HH-2026-0313 drafted" onto the next plan
    // would read as if that one had been drafted too.
    if (id !== selected?.id) { setAgentNote(''); setAgentResult(null) }
    setSelected(data)
  }

  async function patchBooking(updates: Record<string, unknown>) {
    if (!selected) return
    setActionLoading('save')
    await fetch(`/api/admin/parties/${selected.id}`, {
      method: 'PATCH',
      headers: { ...Object.fromEntries(new Headers(headers).entries()), 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    await fetchDetail(selected.id)
    await fetchBookings()
    setActionLoading('')
    setEditing(false)
  }

  async function doAction(action: string, extra?: Record<string, unknown>) {
    if (!selected) return
    setActionLoading(action)
    const res = await fetch(`/api/admin/parties/${selected.id}`, {
      method: 'POST',
      headers: { ...Object.fromEntries(new Headers(headers).entries()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...extra }),
    })
    const data = await res.json()
    await fetchDetail(selected.id)
    await fetchBookings()
    setActionLoading('')
    return data
  }

  async function draftWithAgent() {
    if (!selected) return
    setActionLoading('draft_with_agent')
    setAgentResult(null)
    const res = await fetch(`/api/admin/parties/${selected.id}`, {
      method: 'POST',
      headers: { ...Object.fromEntries(new Headers(headers).entries()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'draft_with_agent', note: agentNote || undefined }),
    })
    const data = await res.json().catch(() => ({}))
    setActionLoading('')
    if (res.ok) {
      setAgentNote('')
      setAgentResult({
        ok: true,
        message: `${data.reviewCode} drafted — texted to ${data.reviewersTexted} reviewer${data.reviewersTexted === 1 ? '' : 's'}. Approve it in Inbox or by SMS.`,
      })
    } else {
      setAgentResult({ ok: false, message: data.error || 'Could not draft a reply' })
    }
    await fetchDetail(selected.id)
  }

  async function openPortal() {
    const data = await doAction('generate_portal_url')
    if (data?.portalUrl) {
      window.open(data.portalUrl, '_blank')
    }
  }

  async function copyPortalLink() {
    // Generates a fresh portal token + URL, copies to clipboard. Same backend
    // action as Open Portal — just a different post-success behavior.
    const data = await doAction('generate_portal_url')
    if (!data?.portalUrl) return
    try {
      await navigator.clipboard.writeText(data.portalUrl)
      setCopyToast('Portal link copied to clipboard')
    } catch {
      // Older browsers / non-secure context fallback — show the URL in a prompt
      window.prompt('Copy this portal link:', data.portalUrl)
    }
    setTimeout(() => setCopyToast(''), 2500)
  }

  async function sendPortalLink() {
    // Emails AND texts the portal link to the customer in one action.
    const data = await doAction('send_portal_link')
    if (!data) return
    const via: string[] = data.sentVia || []
    setCopyToast(
      via.length
        ? `Portal link sent via ${via.join(' + ')}`
        : 'Link generated but not delivered — check email/phone on file',
    )
    setTimeout(() => setCopyToast(''), 3000)
  }

  async function textPortalLink() {
    if (!selected) return
    if (!selected.contact_phone) {
      setCopyToast('No phone number on file')
      setTimeout(() => setCopyToast(''), 2500)
      return
    }
    setActionLoading('send_portal_sms')
    const res = await fetch(`/api/admin/parties/${selected.id}`, {
      method: 'POST',
      headers: { ...Object.fromEntries(new Headers(headers).entries()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'send_portal_sms' }),
    })
    const data = await res.json()
    await fetchDetail(selected.id)
    setActionLoading('')
    setCopyToast(res.ok ? `Link texted to ${data.to}` : (data.error || 'Failed to send text'))
    setTimeout(() => setCopyToast(''), 3000)
  }

  async function sendCheckinLink() {
    if (!selected) return
    if (!selected.contact_phone) {
      setCopyToast('No phone number on file')
      setTimeout(() => setCopyToast(''), 2500)
      return
    }
    setActionLoading('send_checkin_link')
    const res = await fetch(`/api/admin/parties/${selected.id}`, {
      method: 'POST',
      headers: { ...Object.fromEntries(new Headers(headers).entries()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'send_checkin_link' }),
    })
    const data = await res.json()
    await fetchDetail(selected.id)
    setActionLoading('')
    setCopyToast(res.ok ? `Check-in link texted to ${data.to}` : (data.error || 'Failed to send check-in link'))
    setTimeout(() => setCopyToast(''), 3000)
  }

  async function deleteBooking() {
    if (!selected) return
    if (!confirm(`Permanently delete ${selected.booking_ref}? This removes the booking, its line items, payments, and history. This cannot be undone.`)) return
    setActionLoading('delete_booking')
    const res = await fetch(`/api/admin/parties/${selected.id}`, {
      method: 'POST',
      headers: { ...Object.fromEntries(new Headers(headers).entries()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_booking' }),
    })
    setActionLoading('')
    if (res.ok) {
      setSelected(null)
      await fetchBookings()
    } else {
      const data = await res.json().catch(() => ({}))
      alert(data.error || 'Failed to delete booking')
    }
  }

  // List view
  if (!selected) {
    return (
      <div>
        {/* ── Pipeline ─────────────────────────────────────────────────
            Every stage is shown even at zero: the point of the view is to see
            where leads are piling up, and a stage that vanishes when empty is
            exactly the one you stop checking. Counts ignore the status filter
            so the header still reads as a whole pipeline from inside a stage. */}
        <div className="mb-5 -mx-1 overflow-x-auto">
          <div className="flex items-stretch gap-1 px-1 min-w-max">
            <PipelineChip
              label="All"
              count={counts?.all ?? total}
              active={statusFilter === 'all'}
              onClick={() => { setStatusFilter('all'); setPage(1) }}
            />
            {PIPELINE.map((stage, i) => (
              <div key={stage} className="flex items-stretch gap-1">
                <span className="self-center text-gray-300 text-xs select-none">{i === 0 ? '' : '›'}</span>
                <PipelineChip
                  label={STATUS_LABELS[stage]?.label || stage}
                  count={counts?.byStatus[stage] ?? 0}
                  active={statusFilter === stage}
                  onClick={() => { setStatusFilter(stage); setPage(1) }}
                />
              </div>
            ))}
            <span className="self-center text-gray-300 text-xs px-1 select-none">|</span>
            <PipelineChip
              label="Cancelled"
              count={counts?.byStatus.cancelled ?? 0}
              active={statusFilter === 'cancelled'}
              onClick={() => { setStatusFilter('cancelled'); setPage(1) }}
            />
          </div>
        </div>

        {/*
          The count scan stops at COUNT_SCAN_LIMIT rows and the route says so in
          `counts.truncated`, but nothing rendered it — so every chip above read
          like a total no matter how many rows were actually counted. A number
          that is silently a floor is worse than one labelled as a floor, which
          is the whole reason the route reports the flag.
        */}
        {(counts?.truncated || counts?.error) && (
          <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {counts?.error
              ? `Stage counts unavailable (${counts.error}) — the list below is still complete.`
              : 'Showing counts for the most recent rows only; the totals above are a floor, not a full count.'}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-400 uppercase tracking-wide mr-1">Type</span>
            {PARTY_TYPE_FILTERS.map(t => {
              const n = t === 'all' ? counts?.allTypes : counts?.byPartyType[t]
              return (
                <button
                  key={t}
                  onClick={() => { setPartyTypeFilter(t); setPage(1) }}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    partyTypeFilter === t ? 'bg-[#1a2744] text-white' : 'bg-gray-100 text-gray-700 hover:opacity-80'
                  }`}
                >
                  {t === 'all' ? 'All' : PARTY_TYPE_LABELS[t]}
                  {n != null && <span className="ml-1.5 opacity-60">{n}</span>}
                </button>
              )
            })}
          </div>
          <a
            // ?new=true tells the planner to clear any existing portal cookie
            // before booting so an admin always gets a blank canvas — without
            // this, a previous customer's plan loads from the cookie.
            href="/party-planner?new=true"
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 bg-[#1a2744] text-white rounded-lg text-sm font-semibold hover:bg-[#2a3754] transition-colors"
          >
            + New Party Plan
          </a>
        </div>

        {false && showNewForm && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={resetNewForm}>
            <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="px-6 py-4 border-b sticky top-0 bg-white rounded-t-2xl flex items-center justify-between">
                <h2 className="text-lg font-bold text-[#1a2744]">New Host Hampton Party Plan</h2>
                <button onClick={resetNewForm} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
              </div>

              {createResult?.ok ? (() => {
                const result = createResult as NonNullable<typeof createResult>
                return (
                <div className="p-6 space-y-4">
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <p className="font-bold text-green-800 mb-1">✓ Party Plan Created</p>
                    <p className="text-sm text-green-700">Booking ref: <span className="font-mono">{result.bookingRef}</span></p>
                    {newForm.sendEmail && <p className="text-sm text-green-700 mt-1">Quote email sent to {newForm.contactEmail}</p>}
                  </div>
                  {result.builderUrl && (
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Customer link (copy & share)</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          readOnly
                          value={result.builderUrl}
                          className="flex-1 px-3 py-2 border rounded-lg text-xs font-mono bg-gray-50"
                          onClick={e => (e.target as HTMLInputElement).select()}
                        />
                        <button
                          onClick={() => navigator.clipboard.writeText(result.builderUrl || '')}
                          className="px-3 py-2 bg-[#1a2744] text-white rounded-lg text-xs font-semibold"
                        >
                          Copy
                        </button>
                        <button
                          onClick={() => window.open(result.builderUrl, '_blank')}
                          className="px-3 py-2 border border-[#1a2744] text-[#1a2744] rounded-lg text-xs font-semibold"
                        >
                          Open
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="flex gap-3 pt-2">
                    <button onClick={resetNewForm} className="flex-1 px-4 py-2 border rounded-lg text-sm font-semibold">Done</button>
                  </div>
                </div>
                )
              })() : (
                <div className="p-6 space-y-4">
                  <p className="text-sm text-gray-500">Enter the lead&apos;s info. They&apos;ll get a branded email with a link to review the plan, add options, and pay the deposit.</p>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Customer Name *</label>
                      <input type="text" value={newForm.contactName} onChange={e => setNewForm({ ...newForm, contactName: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Jane Doe" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Email *</label>
                      <input type="email" value={newForm.contactEmail} onChange={e => setNewForm({ ...newForm, contactEmail: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="jane@example.com" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Phone</label>
                      <input type="tel" value={newForm.contactPhone} onChange={e => setNewForm({ ...newForm, contactPhone: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="(631) 555-1234" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Child / Party Name</label>
                      <input type="text" value={newForm.childName} onChange={e => setNewForm({ ...newForm, childName: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Cora's 8th Birthday" />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Date</label>
                      <input type="date" value={newForm.partyDate} onChange={e => setNewForm({ ...newForm, partyDate: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Time</label>
                      <input type="time" value={newForm.partyTime} onChange={e => setNewForm({ ...newForm, partyTime: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Guests</label>
                      <input type="number" min="1" max="50" value={newForm.guestCount} onChange={e => setNewForm({ ...newForm, guestCount: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg text-sm" />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Package / Theme (optional)</label>
                    <input type="text" value={newForm.packageType} onChange={e => setNewForm({ ...newForm, packageType: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="e.g. Princess Dream Party" />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Internal Notes (visible to customer)</label>
                    <textarea value={newForm.notes} onChange={e => setNewForm({ ...newForm, notes: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg text-sm h-20" placeholder="Any details or notes for the customer" />
                  </div>

                  <div className="space-y-2 pt-2 border-t">
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input type="checkbox" checked={newForm.lockDate} onChange={e => setNewForm({ ...newForm, lockDate: e.target.checked })}
                        className="mt-0.5" />
                      <span className="text-sm text-gray-700">
                        <strong>Lock date &amp; time</strong> — customer can&apos;t change date or time (only admin can)
                      </span>
                    </label>
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input type="checkbox" checked={newForm.sendEmail} onChange={e => setNewForm({ ...newForm, sendEmail: e.target.checked })}
                        className="mt-0.5" />
                      <span className="text-sm text-gray-700">
                        <strong>Email party plan to customer</strong> with link to review &amp; pay deposit
                      </span>
                    </label>
                  </div>

                  {createResult?.error && (
                    <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{createResult?.error}</div>
                  )}

                  <div className="flex gap-3 pt-2">
                    <button onClick={resetNewForm} className="flex-1 px-4 py-2 border rounded-lg text-sm font-semibold">Cancel</button>
                    <button
                      onClick={createPartyPlan}
                      disabled={creating || !newForm.contactName || !newForm.contactEmail}
                      className="flex-1 px-4 py-2 bg-[#1a2744] text-white rounded-lg text-sm font-semibold disabled:opacity-40"
                    >
                      {creating ? 'Creating...' : 'Create & Send Plan'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {loading ? (
          <p className="text-gray-400 text-center py-10">Loading...</p>
        ) : bookings.length === 0 ? (
          <p className="text-gray-400 text-center py-10">No bookings found</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-2 pr-4">Ref</th>
                  <th className="pb-2 pr-4">Customer</th>
                  <th className="pb-2 pr-4">Date</th>
                  <th className="pb-2 pr-4">Type</th>
                  <th className="pb-2 pr-4">Theme</th>
                  <th className="pb-2 pr-4">Guests</th>
                  <th className="pb-2 pr-4">Total</th>
                  <th className="pb-2 pr-4">Balance</th>
                  <th className="pb-2 pr-4">Status</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map(b => {
                  const st = STATUS_LABELS[b.status] || { label: b.status, color: 'bg-gray-100 text-gray-700' }
                  return (
                    <tr
                      key={b.id}
                      onClick={() => fetchDetail(b.id)}
                      className="border-b hover:bg-gray-50 cursor-pointer"
                    >
                      <td className="py-3 pr-4 font-mono text-xs">{b.booking_ref}</td>
                      <td className="py-3 pr-4">
                        {b.contact_name}
                        {b.child_name && <span className="text-gray-400 text-xs ml-1">({b.child_name})</span>}
                      </td>
                      <td className="py-3 pr-4">{b.party_date || '—'}</td>
                      <td className="py-3 pr-4">
                        <span className="text-xs text-gray-600">{PARTY_TYPE_LABELS[b.party_type || 'unknown']}</span>
                        {b.source && b.source !== 'website_form' && (
                          <span className="ml-1.5 text-[10px] text-gray-400 uppercase">{b.source}</span>
                        )}
                      </td>
                      <td className="py-3 pr-4">{b.package_type || '—'}</td>
                      <td className="py-3 pr-4 text-center">{b.guest_count_approx || '—'}</td>
                      <td className="py-3 pr-4">{formatMoney(b.total_cents || 0)}</td>
                      <td className="py-3 pr-4 font-medium">{formatMoney(b.balance_due_cents || 0)}</td>
                      <td className="py-3 pr-4">
                        <span className={`px-2 py-0.5 rounded-full text-xs ${st.color}`}>{st.label}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {total > 25 && (
          <div className="flex justify-center gap-2 mt-4">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 text-sm border rounded disabled:opacity-30">Prev</button>
            <span className="px-3 py-1 text-sm text-gray-500">{page} / {Math.ceil(total / 25)}</span>
            <button disabled={page >= Math.ceil(total / 25)} onClick={() => setPage(p => p + 1)} className="px-3 py-1 text-sm border rounded disabled:opacity-30">Next</button>
          </div>
        )}
      </div>
    )
  }

  // Detail view
  const st = STATUS_LABELS[selected.status] || { label: selected.status, color: 'bg-gray-100 text-gray-700' }

  return (
    <div>
      <button onClick={() => setSelected(null)} className="text-sm text-[#A1B5C8] hover:underline mb-4">&larr; Back to list</button>

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <p className="font-mono text-xs text-gray-400">{selected.booking_ref}</p>
          <h2 className="text-xl font-semibold text-[#1a2744]">
            {selected.child_name ? `${selected.child_name}'s Party` : selected.package_type || 'Party Booking'}
          </h2>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-medium ${st.color}`}>{st.label}</span>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Left column */}
        <div className="space-y-6">
          {/* Customer info */}
          <div className="bg-white rounded-xl border p-5">
            <h3 className="text-sm font-medium text-[#1a2744] mb-3">Customer</h3>
            <div className="text-sm space-y-1 text-gray-600">
              <p><strong>{selected.contact_name}</strong></p>
              <p>{selected.contact_email}</p>
              {selected.contact_phone && <p>{selected.contact_phone}</p>}
              <p className="text-gray-400">Method preference: {selected.payment_method_preference || '—'}</p>
            </div>
          </div>

          {/* Event details */}
          <div className="bg-white rounded-xl border p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-[#1a2744]">Event</h3>
              {!editing ? (
                <button onClick={() => { setEditing(true); setEditForm({
                  party_date: selected.party_date || '',
                  party_time: selected.party_time || '',
                  guest_count_approx: String(selected.guest_count_approx || ''),
                  package_type: selected.package_type || '',
                  child_name: selected.child_name || '',
                  child_age: String((selected as PartyDetail).child_age || ''),
                  notes: selected.notes || '',
                  admin_notes: (selected as PartyDetail).admin_notes || '',
                }) }} className="text-xs text-[#A1B5C8] hover:text-[#1a2744] font-medium">Edit</button>
              ) : (
                <div className="flex gap-2">
                  <button onClick={() => setEditing(false)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                  <button
                    onClick={() => patchBooking({
                      party_date: editForm.party_date || null,
                      party_time: editForm.party_time || null,
                      guest_count_approx: editForm.guest_count_approx ? Number(editForm.guest_count_approx) : null,
                      package_type: editForm.package_type || null,
                      child_name: editForm.child_name || null,
                      notes: editForm.notes || null,
                      admin_notes: editForm.admin_notes || null,
                    })}
                    disabled={!!actionLoading}
                    className="text-xs bg-[#1a2744] text-white px-3 py-1 rounded font-medium disabled:opacity-50"
                  >
                    {actionLoading === 'save' ? 'Saving...' : 'Save'}
                  </button>
                </div>
              )}
            </div>
            {!editing ? (
              <div className="text-sm space-y-1 text-gray-600">
                <p>Date: <strong>{selected.party_date || 'TBD'}</strong></p>
                <p>Time: <strong>{selected.party_time || 'TBD'}</strong></p>
                <p>Guests: <strong>{selected.guest_count_approx || '—'}</strong></p>
                <p>Theme: <strong>{selected.package_type || '—'}</strong></p>
                {selected.child_name && <p>Child: <strong>{selected.child_name}{(selected as PartyDetail).child_age ? `, age ${(selected as PartyDetail).child_age}` : ''}</strong></p>}
                {selected.notes && <p className="text-gray-400 mt-2">Notes: {selected.notes}</p>}
                {(selected as PartyDetail).admin_notes && <p className="text-amber-600 mt-1 text-xs">Admin: {(selected as PartyDetail).admin_notes}</p>}
              </div>
            ) : (
              <div className="space-y-2 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-gray-500">Date</label>
                    <input type="date" value={editForm.party_date} onChange={e => setEditForm(f => ({ ...f, party_date: e.target.value }))} className="w-full border rounded px-2 py-1.5 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Time</label>
                    <input type="time" value={editForm.party_time} onChange={e => setEditForm(f => ({ ...f, party_time: e.target.value }))} className="w-full border rounded px-2 py-1.5 text-sm" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-gray-500">Guests</label>
                    <input type="number" min="1" value={editForm.guest_count_approx} onChange={e => setEditForm(f => ({ ...f, guest_count_approx: e.target.value }))} className="w-full border rounded px-2 py-1.5 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Theme / Package</label>
                    <input type="text" value={editForm.package_type} onChange={e => setEditForm(f => ({ ...f, package_type: e.target.value }))} className="w-full border rounded px-2 py-1.5 text-sm" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-gray-500">Child Name</label>
                    <input type="text" value={editForm.child_name} onChange={e => setEditForm(f => ({ ...f, child_name: e.target.value }))} className="w-full border rounded px-2 py-1.5 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Child Age</label>
                    <input type="number" min="1" max="18" value={editForm.child_age} onChange={e => setEditForm(f => ({ ...f, child_age: e.target.value }))} className="w-full border rounded px-2 py-1.5 text-sm" />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Customer Notes</label>
                  <textarea value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} rows={2} className="w-full border rounded px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Admin Notes (internal)</label>
                  <textarea value={editForm.admin_notes} onChange={e => setEditForm(f => ({ ...f, admin_notes: e.target.value }))} rows={2} className="w-full border rounded px-2 py-1.5 text-sm" />
                </div>
              </div>
            )}
          </div>

          {/* Studio rental time (re-prices the rental fee) */}
          {selected.event_type === 'studio-rental' && (
            <StudioTimeEditor
              rates={rates}
              detail={selected as PartyDetail}
              busy={actionLoading === 'edit_rental'}
              onSave={(startTime, endTime) => doAction('edit_rental', { startTime, endTime })}
            />
          )}

          {/* Line items */}
          <div className="bg-white rounded-xl border p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-[#1a2744]">Line Items</h3>
              <div className="flex gap-2">
                <button onClick={() => setShowDiscount(d => !d)} className="text-xs text-amber-600 hover:text-amber-700 font-medium">+ Discount</button>
                <button onClick={() => setAddingItem(a => !a)} className="text-xs text-[#A1B5C8] hover:text-[#1a2744] font-medium">+ Add Item</button>
              </div>
            </div>
            {(selected.line_items || []).map(li => {
              const amt = li.guest_multiplied ? li.unit_price_cents * li.quantity * (selected.guest_count_approx || 1) : li.unit_price_cents * li.quantity
              const isDiscount = li.unit_price_cents < 0 || li.category === 'discount'
              return (
                <div key={li.id} className="flex items-center justify-between py-1.5 text-sm border-b border-gray-100 last:border-0 group">
                  <span className={isDiscount ? 'text-amber-600' : 'text-gray-600'}>
                    {li.name}{li.quantity > 1 ? ` ×${li.quantity}` : ''}{li.guest_multiplied ? ' (per guest)' : ''}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className={isDiscount ? 'text-amber-600' : 'text-[#1a2744]'}>{formatMoney(amt)}</span>
                    <button
                      onClick={() => { if (confirm(`Remove "${li.name}"?`)) doAction('remove_line_item', { line_item_id: li.id }) }}
                      className="text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                      title="Remove"
                    >✕</button>
                  </div>
                </div>
              )
            })}

            {/* Add item form */}
            {addingItem && (
              <div className="mt-3 pt-3 border-t border-dashed border-gray-200 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input type="text" value={newItem.name} onChange={e => setNewItem(n => ({ ...n, name: e.target.value }))} placeholder="Item name" className="border rounded px-2 py-1.5 text-sm" />
                  <input type="number" value={newItem.price} onChange={e => setNewItem(n => ({ ...n, price: e.target.value }))} placeholder="Price ($)" className="border rounded px-2 py-1.5 text-sm" step="0.01" />
                </div>
                <div className="flex items-center gap-3">
                  <input type="number" min="1" value={newItem.quantity} onChange={e => setNewItem(n => ({ ...n, quantity: e.target.value }))} className="w-16 border rounded px-2 py-1.5 text-sm" />
                  <label className="flex items-center gap-1 text-xs text-gray-500">
                    <input type="checkbox" checked={newItem.guest_multiplied} onChange={e => setNewItem(n => ({ ...n, guest_multiplied: e.target.checked }))} />
                    Per guest
                  </label>
                  <div className="flex-1" />
                  <button
                    onClick={() => {
                      const cents = Math.round(Number(newItem.price) * 100)
                      if (!newItem.name || !cents) return
                      doAction('add_line_item', {
                        name: newItem.name,
                        quantity: Number(newItem.quantity) || 1,
                        unit_price_cents: cents,
                        guest_multiplied: newItem.guest_multiplied,
                      })
                      setNewItem({ name: '', price: '', quantity: '1', guest_multiplied: false })
                      setAddingItem(false)
                    }}
                    disabled={!newItem.name || !newItem.price || !!actionLoading}
                    className="bg-[#1a2744] text-white px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50"
                  >Add</button>
                </div>
              </div>
            )}

            {/* Discount form */}
            {showDiscount && (
              <div className="mt-3 pt-3 border-t border-dashed border-amber-200 space-y-2">
                <div className="flex gap-2">
                  <input type="text" value={discountName} onChange={e => setDiscountName(e.target.value)} placeholder="Discount reason" className="flex-1 border rounded px-2 py-1.5 text-sm" />
                  <input type="number" value={discountAmount} onChange={e => setDiscountAmount(e.target.value)} placeholder="Amount ($)" className="w-24 border rounded px-2 py-1.5 text-sm" step="0.01" />
                  <button
                    onClick={() => {
                      const cents = Math.round(Number(discountAmount) * 100)
                      if (!discountName || !cents) return
                      doAction('add_line_item', {
                        name: discountName,
                        category: 'discount',
                        quantity: 1,
                        unit_price_cents: -Math.abs(cents),
                        guest_multiplied: false,
                      })
                      setDiscountName('')
                      setDiscountAmount('')
                      setShowDiscount(false)
                    }}
                    disabled={!discountName || !discountAmount || !!actionLoading}
                    className="bg-amber-500 text-white px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50"
                  >Apply</button>
                </div>
              </div>
            )}

            <div className="flex justify-between pt-2 mt-2 border-t-2 border-[#1a2744] text-[#1a2744] font-semibold text-sm">
              <span>Total</span><span>{formatMoney(selected.total_cents || 0)}</span>
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Actions */}
          <div className="bg-white rounded-xl border p-5">
            <h3 className="text-sm font-medium text-[#1a2744] mb-3">Actions</h3>
            <div className="space-y-2">
              {/* ── Draft reply with agent ─────────────────────────────
                  The path for a lead the agent never heard about: a phone call,
                  or a plan typed into the New Party form. It enqueues an inbound
                  event and drafts for it, so the reply still goes to the
                  reviewers for approval — this button cannot reach a customer.
                  Disabled while in flight, which is the client-side half of the
                  double-click guard; the server has three more. */}
              <div className="p-3 bg-[#1a2744]/5 rounded-lg space-y-2">
                <textarea
                  value={agentNote}
                  onChange={e => setAgentNote(e.target.value)}
                  placeholder="What did they ask for? (optional — e.g. notes from a phone call)"
                  rows={2}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
                <button
                  onClick={draftWithAgent}
                  disabled={!!actionLoading}
                  title={
                    selected.contact_email || selected.contact_phone
                      ? 'Drafts a reply and texts it to the reviewers for approval'
                      : 'Add an email or phone to this plan first'
                  }
                  className="w-full bg-[#1a2744] text-white py-2 rounded-lg text-sm font-medium hover:bg-[#2a3754] disabled:opacity-50"
                >
                  {actionLoading === 'draft_with_agent' ? 'Drafting…' : '✍️ Draft reply with agent'}
                </button>
                {agentResult && (
                  <p className={`text-xs ${agentResult.ok ? 'text-green-700' : 'text-amber-700'}`}>
                    {agentResult.message}
                  </p>
                )}
                <p className="text-[11px] text-[#1a2744]/50">
                  Goes to the reviewers for approval. Nothing reaches the customer from here.
                </p>
              </div>

              {(selected.status === 'pending_review' || selected.status === 'deposit_paid') && (
                <button
                  onClick={() => doAction('approve')}
                  disabled={!!actionLoading}
                  className="w-full bg-green-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                >
                  {actionLoading === 'approve' ? 'Approving...' : 'Approve Booking'}
                </button>
              )}

              <div>
                <textarea
                  value={changeMessage}
                  onChange={e => setChangeMessage(e.target.value)}
                  placeholder="Message to customer..."
                  rows={2}
                  className="w-full border rounded-lg px-3 py-2 text-sm mb-1"
                />
                <button
                  onClick={() => { doAction('request_changes', { message: changeMessage }); setChangeMessage('') }}
                  disabled={!changeMessage || !!actionLoading}
                  className="w-full bg-amber-500 text-white py-2 rounded-lg text-sm font-medium hover:bg-amber-600 disabled:opacity-50"
                >
                  Send Message to Customer
                </button>
              </div>

              <button
                onClick={sendPortalLink}
                disabled={!!actionLoading}
                className="w-full bg-[#A1B5C8] text-white py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                {actionLoading === 'send_portal_link' ? 'Sending...' : 'Send Portal Link (Email + Text)'}
              </button>

              <button
                onClick={textPortalLink}
                disabled={!!actionLoading || !selected.contact_phone}
                title={selected.contact_phone ? `Text link to ${selected.contact_phone}` : 'No phone number on file'}
                className="w-full bg-green-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
              >
                {actionLoading === 'send_portal_sms' ? 'Texting...' : '📱 Text Link to Client'}
              </button>

              <button
                onClick={openPortal}
                disabled={!!actionLoading}
                className="w-full border-2 border-[#1a2744] text-[#1a2744] py-2 rounded-lg text-sm font-medium hover:bg-[#1a2744]/5 disabled:opacity-50"
              >
                {actionLoading === 'generate_portal_url' ? 'Opening...' : 'Open Portal (New Tab)'}
              </button>

              <button
                onClick={copyPortalLink}
                disabled={!!actionLoading}
                className="w-full border-2 border-[#1a2744]/40 text-[#1a2744] py-2 rounded-lg text-sm font-medium hover:bg-[#1a2744]/5 disabled:opacity-50"
              >
                {copyToast || 'Copy Portal Link'}
              </button>

              {/* ── Pre-arrival check-in ─────────────────────── */}
              <div className="p-3 bg-gray-50 rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-[#1a2744]">Check-In</span>
                  <span className={`text-xs px-2 py-1 rounded-full ${checkinBadge(selected.checkin_status).color}`}>
                    {checkinBadge(selected.checkin_status).label}
                  </span>
                </div>

                <ul className="text-xs text-[#1a2744]/70 space-y-0.5">
                  <li>{selected.checkin_started_at ? '✓' : '○'} Details &amp; marketing opt-in</li>
                  <li>{selected.checkin_agreement_signed_at ? '✓' : '○'} Agreement &amp; waiver signed</li>
                </ul>

                {selected.checkin_agreement_pdf_url ? (
                  <a
                    href={selected.checkin_agreement_pdf_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-xs text-blue-700 underline"
                  >
                    View signed agreement (PDF)
                  </a>
                ) : null}

                <button
                  onClick={sendCheckinLink}
                  disabled={!!actionLoading || !selected.contact_phone}
                  title={selected.contact_phone ? `Text check-in link to ${selected.contact_phone}` : 'No phone number on file'}
                  className="w-full bg-[#1a2744] text-white py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
                >
                  {actionLoading === 'send_checkin_link'
                    ? 'Texting...'
                    : selected.checkin_status === 'complete'
                      ? '📱 Resend Check-In Link'
                      : '📱 Send Check-In Link'}
                </button>

                <p className="text-[11px] text-[#1a2744]/50">
                  Also texts automatically 36 hours before and at 6am on the day. Both stop once
                  check-in is complete.
                </p>
              </div>

              {/* Unlock toggle — lets client edit even within the lock window */}
              <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!(selected as PartyDetail).party_tags?.modifications_unlocked}
                  onChange={async () => {
                    const tags = ((selected as PartyDetail).party_tags || {}) as Record<string, unknown>
                    const newVal = !tags.modifications_unlocked
                    await patchBooking({ party_tags: { ...tags, modifications_unlocked: newVal } })
                  }}
                  className="accent-[#1a2744]"
                  disabled={!!actionLoading}
                />
                <div>
                  <span className="text-sm font-medium text-[#1a2744]">Unlock for Client</span>
                  <p className="text-xs text-gray-500">Allow client to edit even within the lock window</p>
                </div>
              </label>

              {selected.status !== 'cancelled' && selected.status !== 'completed' && (
                <button
                  onClick={() => { if (confirm('Cancel this booking?')) doAction('cancel') }}
                  disabled={!!actionLoading}
                  className="w-full bg-red-100 text-red-700 py-2 rounded-lg text-sm font-medium hover:bg-red-200 disabled:opacity-50"
                >
                  Cancel Booking
                </button>
              )}

              <button
                onClick={deleteBooking}
                disabled={!!actionLoading}
                className="w-full border border-red-300 text-red-600 py-2 rounded-lg text-sm font-medium hover:bg-red-50 disabled:opacity-50"
              >
                {actionLoading === 'delete_booking' ? 'Deleting...' : 'Delete Booking (permanent)'}
              </button>
            </div>
          </div>

          {/* Balance + Record Payment */}
          <div className="bg-white rounded-xl border p-5">
            <div className="text-center mb-4">
              <p className="text-gray-400 text-xs">Balance Due</p>
              <p className="text-2xl font-bold text-[#1a2744]">{formatMoney(selected.balance_due_cents || 0)}</p>
            </div>

            {(selected.balance_due_cents || 0) > 0 && (
              <div className="space-y-2 border-t pt-4">
                <h4 className="text-xs font-medium text-gray-500">Record Payment</h4>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={payAmount}
                    onChange={e => setPayAmount(e.target.value)}
                    placeholder="Amount ($)"
                    className="flex-1 border rounded px-2 py-1.5 text-sm"
                  />
                  <select value={payMethod} onChange={e => setPayMethod(e.target.value)} className="border rounded px-2 py-1.5 text-sm">
                    <option value="cash">Cash</option>
                    <option value="venmo">Venmo</option>
                    <option value="zelle">Zelle</option>
                    <option value="card">Card</option>
                  </select>
                </div>
                <input
                  type="text"
                  value={payNotes}
                  onChange={e => setPayNotes(e.target.value)}
                  placeholder="Notes (optional)"
                  className="w-full border rounded px-2 py-1.5 text-sm"
                />
                <button
                  onClick={() => {
                    const cents = Math.round(Number(payAmount) * 100)
                    if (cents <= 0) return
                    doAction('record_payment', { amount_cents: cents, payment_method: payMethod, notes: payNotes })
                    setPayAmount('')
                    setPayNotes('')
                  }}
                  disabled={!payAmount || !!actionLoading}
                  className="w-full bg-[#1a2744] text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  Record Payment
                </button>
              </div>
            )}
          </div>

          {/* Payment History */}
          {(selected.payments || []).length > 0 && (
            <div className="bg-white rounded-xl border p-5">
              <h3 className="text-sm font-medium text-[#1a2744] mb-3">Payments</h3>
              {selected.payments.map(p => (
                <div key={p.id} className="flex justify-between py-1.5 text-sm border-b border-gray-100 last:border-0">
                  <div>
                    <span className="capitalize text-gray-700">{p.payment_type}</span>
                    <span className="text-gray-400 text-xs ml-2">{p.payment_method}</span>
                    <span className="text-gray-300 text-xs ml-2">{new Date(p.paid_at).toLocaleDateString()}</span>
                    {p.recorded_by === 'admin' && <span className="text-xs text-amber-500 ml-1">(admin)</span>}
                  </div>
                  <span className={`font-medium ${p.payment_type === 'refund' ? 'text-red-600' : 'text-green-700'}`}>
                    {formatMoney(p.amount_cents)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Modification Log */}
          {(selected.modifications || []).length > 0 && (
            <div className="bg-white rounded-xl border p-5">
              <h3 className="text-sm font-medium text-[#1a2744] mb-3">Activity Log</h3>
              {selected.modifications.map(m => (
                <div key={m.id} className="py-1.5 text-xs border-b border-gray-100 last:border-0">
                  <span className="text-gray-400">{new Date(m.created_at).toLocaleString()}</span>
                  <span className="text-gray-500 ml-2 capitalize">[{m.modified_by}]</span>
                  <span className="text-gray-700 ml-1">{m.change_summary}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ─── Pipeline stage chip ──────────────────────────────────────── */
function PipelineChip({ label, count, active, onClick }: {
  label: string; count: number; active: boolean; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors border ${
        active
          ? 'bg-[#1a2744] text-white border-[#1a2744]'
          : count > 0
            ? 'bg-white text-[#1a2744] border-gray-200 hover:border-[#A1B5C8]'
            // A zero stage stays visible but recedes, so the eye lands on where
            // work is actually sitting.
            : 'bg-white text-gray-400 border-gray-100 hover:border-gray-200'
      }`}
    >
      {label}
      <span className={`ml-1.5 font-bold ${active ? '' : count > 0 ? 'text-[#A1B5C8]' : 'text-gray-300'}`}>{count}</span>
    </button>
  )
}

/* ─── Studio rental time editor (re-prices the rental fee) ─────── */
function StudioTimeEditor({ detail, busy, onSave, rates }: {
  detail: PartyDetail
  busy: boolean
  onSave: (startTime: string, endTime: string) => void
  rates: StudioRates
}) {
  const tags0 = (detail.party_tags || {}) as Record<string, string>
  const [start, setStart] = useState(tags0.rental_start_time || detail.party_time || '14:00')
  const [end, setEnd] = useState(tags0.rental_end_time || '17:00')
  useEffect(() => {
    const t = (detail.party_tags || {}) as Record<string, string>
    setStart(t.rental_start_time || detail.party_time || '14:00')
    setEnd(t.rental_end_time || '17:00')
  }, [detail.id]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="bg-white rounded-xl border p-5">
      <h3 className="text-sm font-medium text-[#1a2744] mb-3">Studio Rental Time</h3>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-gray-500">Start
          <input type="time" value={start} onChange={e => setStart(e.target.value)} className="block border rounded px-2 py-1.5 text-sm mt-0.5" />
        </label>
        <label className="text-xs text-gray-500">End
          <input type="time" value={end} onChange={e => setEnd(e.target.value)} className="block border rounded px-2 py-1.5 text-sm mt-0.5" />
        </label>
        <button onClick={() => onSave(start, end)} disabled={busy}
          className="text-xs bg-[#1a2744] text-white px-3 py-2 rounded font-medium disabled:opacity-50">
          {busy ? 'Updating…' : 'Update time & re-price'}
        </button>
      </div>
      {/* Reads the live rate card rather than restating it, so this cannot
          end up describing prices the re-pricing no longer uses. */}
      <p className="text-[11px] text-gray-400 mt-2">
        Re-prices the rental fee (Weekend {formatMoney(rates.weekendBaseCents)}/{rates.minHours}hr +{formatMoney(rates.weekendAddlHourCents)}/hr,
        Weekday {formatMoney(rates.weekdayBaseCents)}/{rates.minHours}hr +{formatMoney(rates.weekdayAddlHourCents)}/hr;
        capped at full-day {formatMoney(rates.weekendFullDayCents)} / {formatMoney(rates.weekdayFullDayCents)}) and recomputes the balance.
      </p>
    </div>
  )
}
