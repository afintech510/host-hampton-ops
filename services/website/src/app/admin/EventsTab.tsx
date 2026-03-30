'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Users, Mail, Archive, Edit3, Printer, Download, ChevronDown, ChevronUp, Loader2, X, Send, Upload, Star, Image as ImageIcon, Bold, Italic, Underline, Link2, Type, List } from 'lucide-react'

/* ─── Interfaces ─────────────────────────────────────── */

interface Event {
  id: string; slug: string; title: string; category: string; price_cents: number
  event_date: string | null; event_time: string | null; event_end_time: string | null
  max_tickets: number; available_tickets: number; is_active: boolean; is_featured: boolean
  has_variants: boolean; variants: Variant[]; has_sessions: boolean
  description: string | null; short_description: string | null
  image_url: string | null; images: EventImage[]; location: string; confirmed_tickets: number
  sibling_price_cents: number | null
  allow_multi_session: boolean; bundle_pricing: BundleTier[]
}

interface EventImage {
  url: string
  name: string
  is_primary: boolean
}

interface Ticket {
  id: string; ticket_ref: string; customer_name: string; customer_email: string
  customer_phone: string | null; quantity: number; variant_label: string | null
  total_cents: number; status: string; created_at: string
  stripe_payment_intent_id: string | null
  session_id: string | null
  group_ref: string | null
}

interface Variant { label: string; priceCents: number }

interface EventSession {
  id?: string
  session_date: string
  session_time: string
  session_end_time?: string
  label?: string
  price_cents?: number | null
  max_tickets: number
  available_tickets?: number
  is_active: boolean
}

interface BundleTier {
  minSessions: number
  pricePerSessionCents: number
}

interface EventFormData {
  title: string; description: string; shortDescription: string; category: string
  priceDollars: string; eventDate: string; eventTime: string; eventEndTime: string
  maxTickets: string; images: EventImage[]; isFeatured: boolean; location: string
  hasVariants: boolean; variants: Variant[]
  hasSessions: boolean; sessions: EventSession[]
  allowMultiSession: boolean; bundlePricing: BundleTier[]
}

/* ─── Helpers ────────────────────────────────────────── */

function formatPrice(cents: number) { return cents === 0 ? 'Free' : `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}` }
function formatDate(d: string) { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }

const DEFAULT_LOCATION = 'Host Hampton, 295 Montauk Hwy Suite 7, Speonk NY'

/* ─── Events Tab ─────────────────────────────────────── */

export default function EventsTab({ headers, onLogout }: { headers: Record<string, string>; onLogout: () => void }) {
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null)
  const [editingEvent, setEditingEvent] = useState<(Event & { sessions?: EventSession[] }) | null>(null)
  const [loadingEdit, setLoadingEdit] = useState<string | null>(null)

  const fetchEvents = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/admin/events', { headers })
    if (res.status === 401) { onLogout(); return }
    const data = await res.json()
    setEvents(data.events || [])
    setLoading(false)
  }, [headers.Authorization])

  useEffect(() => { fetchEvents() }, [fetchEvents])

  const filteredEvents = showArchived ? events : events.filter(e => e.is_active)

  async function archiveEvent(id: string) {
    if (!confirm('Archive this event? It will be hidden from the public site.')) return
    await fetch(`/api/admin/events/${id}`, { method: 'DELETE', headers })
    fetchEvents()
  }

  async function startEdit(eventId: string) {
    setLoadingEdit(eventId)
    const res = await fetch(`/api/admin/events/${eventId}`, { headers })
    if (res.ok) {
      const data = await res.json()
      setEditingEvent({ ...data.event, sessions: data.sessions || [] })
      setShowCreate(false)
    }
    setLoadingEdit(null)
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      {/* Actions bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => { setShowCreate(!showCreate); setEditingEvent(null) }}
            className="btn-primary px-4 py-2 flex items-center gap-2 text-sm">
            <Plus className="w-4 h-4" /> New Event
          </button>
          <label className="flex items-center gap-2 text-sm text-hampton-mauve cursor-pointer">
            <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} className="accent-hampton-navy" />
            Show archived
          </label>
        </div>
        <p className="text-sm text-hampton-mauve">{filteredEvents.length} event{filteredEvents.length !== 1 ? 's' : ''}</p>
      </div>

      {/* Create form */}
      {showCreate && !editingEvent && (
        <EventForm headers={headers} onSaved={() => { setShowCreate(false); fetchEvents() }} onCancel={() => setShowCreate(false)} />
      )}

      {/* Edit form */}
      {editingEvent && (
        <EventForm
          headers={headers}
          onSaved={() => { setEditingEvent(null); fetchEvents() }}
          onCancel={() => setEditingEvent(null)}
          existingEvent={editingEvent}
          existingSessions={editingEvent.sessions}
        />
      )}

      {error && <p className="text-red-600 bg-red-50 p-3 rounded-lg mb-4 text-sm">{error}</p>}

      {loading ? (
        <div className="text-center py-12"><Loader2 className="w-6 h-6 animate-spin mx-auto text-hampton-mauve" /></div>
      ) : filteredEvents.length === 0 ? (
        <p className="text-center text-hampton-mauve py-12">No events yet. Create your first one above!</p>
      ) : (
        <div className="space-y-3">
          {filteredEvents.map(event => (
            <div key={event.id} className={`bg-white rounded-xl border ${event.is_active ? 'border-hampton-pink/20' : 'border-gray-200 opacity-60'}`}>
              {/* Event row */}
              <div className="flex items-center gap-3 sm:gap-4 p-3 sm:p-4 cursor-pointer" onClick={() => setExpandedEvent(expandedEvent === event.id ? null : event.id)}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 sm:gap-2 mb-1 flex-wrap">
                    <h3 className="font-semibold text-hampton-navy text-sm truncate">{event.title}</h3>
                    <span className="text-[10px] sm:text-xs bg-hampton-navy/10 text-hampton-navy px-1.5 sm:px-2 py-0.5 rounded-full capitalize">{event.category}</span>
                    {event.is_featured && <span className="text-[10px] sm:text-xs bg-amber-100 text-amber-700 px-1.5 sm:px-2 py-0.5 rounded-full">Featured</span>}
                    {event.has_variants && <span className="text-[10px] sm:text-xs bg-blue-50 text-blue-600 px-1.5 sm:px-2 py-0.5 rounded-full hidden sm:inline">Options</span>}
                    {event.has_sessions && <span className="text-[10px] sm:text-xs bg-purple-50 text-purple-600 px-1.5 sm:px-2 py-0.5 rounded-full hidden sm:inline">{event.allow_multi_session ? 'Series' : 'Multi-date'}</span>}
                    {!event.is_active && <span className="text-[10px] sm:text-xs bg-gray-100 text-gray-500 px-1.5 sm:px-2 py-0.5 rounded-full">Archived</span>}
                  </div>
                  <div className="flex items-center gap-2 sm:gap-4 text-xs text-hampton-mauve">
                    <span>{event.event_date ? formatDate(event.event_date) : event.has_sessions ? 'Multiple dates' : 'Date TBD'}</span>
                    <span>{formatPrice(event.price_cents)}</span>
                    <span>{event.max_tickets - event.available_tickets}/{event.max_tickets} sold</span>
                  </div>
                </div>
                <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
                  <button onClick={e => { e.stopPropagation(); startEdit(event.id) }}
                    className="p-1.5 sm:p-2 text-hampton-mauve hover:text-hampton-navy transition-colors" title="Edit">
                    {loadingEdit === event.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Edit3 className="w-4 h-4" />}
                  </button>
                  <button onClick={e => { e.stopPropagation(); archiveEvent(event.id) }}
                    className="p-1.5 sm:p-2 text-hampton-mauve hover:text-red-600 transition-colors" title="Archive">
                    <Archive className="w-4 h-4" />
                  </button>
                  {expandedEvent === event.id ? <ChevronUp className="w-4 h-4 text-hampton-mauve" /> : <ChevronDown className="w-4 h-4 text-hampton-mauve" />}
                </div>
              </div>

              {/* Expanded panel */}
              {expandedEvent === event.id && (
                <EventDetailPanel event={event} headers={headers} onRefresh={fetchEvents} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ─── Event Form (Create / Edit) ─────────────────────── */

function EventForm({
  headers, onSaved, onCancel, existingEvent, existingSessions,
}: {
  headers: Record<string, string>
  onSaved: () => void
  onCancel: () => void
  existingEvent?: Event & { sessions?: EventSession[] }
  existingSessions?: EventSession[]
}) {
  const isEdit = !!existingEvent

  const [form, setForm] = useState<EventFormData>(() => {
    if (existingEvent) {
      return {
        title: existingEvent.title,
        description: existingEvent.description || '',
        shortDescription: existingEvent.short_description || '',
        category: existingEvent.category,
        priceDollars: existingEvent.price_cents > 0 ? (existingEvent.price_cents / 100).toString() : '',
        eventDate: existingEvent.event_date || '',
        eventTime: existingEvent.event_time || '',
        eventEndTime: existingEvent.event_end_time || '',
        maxTickets: existingEvent.max_tickets.toString(),
        images: existingEvent.images || [],
        isFeatured: existingEvent.is_featured,
        location: existingEvent.location || DEFAULT_LOCATION,
        hasVariants: existingEvent.has_variants,
        variants: existingEvent.variants || [],
        hasSessions: existingEvent.has_sessions,
        sessions: existingSessions || [],
        allowMultiSession: existingEvent.allow_multi_session || false,
        bundlePricing: existingEvent.bundle_pricing || [],
      }
    }
    return {
      title: '', description: '', shortDescription: '', category: 'workshop',
      priceDollars: '', eventDate: '', eventTime: '', eventEndTime: '',
      maxTickets: '30', images: [], isFeatured: false, location: DEFAULT_LOCATION,
      hasVariants: false, variants: [],
      hasSessions: false, sessions: [],
      allowMultiSession: false, bundlePricing: [],
    }
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (k: string, v: unknown) => setForm(prev => ({ ...prev, [k]: v }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title) { setError('Title is required'); return }
    setSaving(true); setError('')

    const payload: Record<string, unknown> = {
      title: form.title,
      description: form.description || null,
      shortDescription: form.shortDescription || null,
      category: form.category,
      priceCents: Math.round(parseFloat(form.priceDollars || '0') * 100),
      eventDate: form.eventDate || null,
      eventTime: form.eventTime || null,
      eventEndTime: form.eventEndTime || null,
      maxTickets: parseInt(form.maxTickets) || 30,
      imageUrl: form.images.find(i => i.is_primary)?.url || form.images[0]?.url || null,
      images: form.images,
      isFeatured: form.isFeatured,
      location: form.location || DEFAULT_LOCATION,
      hasVariants: form.hasVariants,
      variants: form.hasVariants ? form.variants : [],
      hasSessions: form.hasSessions,
      sessions: form.hasSessions ? form.sessions.map(s => ({
        ...s,
        session_date: s.session_date,
        session_time: s.session_time,
        session_end_time: s.session_end_time || null,
        label: s.label || null,
        max_tickets: s.max_tickets || 30,
      })) : [],
      allowMultiSession: form.allowMultiSession,
      bundlePricing: form.allowMultiSession ? form.bundlePricing : [],
    }

    const url = isEdit ? `/api/admin/events/${existingEvent!.id}` : '/api/admin/events'
    const method = isEdit ? 'PUT' : 'POST'

    const res = await fetch(url, { method, headers, body: JSON.stringify(payload) })
    if (!res.ok) {
      const data = await res.json()
      setError(data.error || `Failed to ${isEdit ? 'update' : 'create'} event`)
      setSaving(false)
      return
    }

    onSaved()
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-hampton-pink/20 p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-serif text-lg text-hampton-navy">{isEdit ? 'Edit Event' : 'New Event'}</h2>
        <button type="button" onClick={onCancel} className="text-hampton-mauve hover:text-hampton-navy"><X className="w-5 h-5" /></button>
      </div>

      {/* Basic fields */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="form-label">Title *</label>
          <input value={form.title} onChange={e => set('title', e.target.value)} className="form-input" required />
        </div>
        <div>
          <label className="form-label">Category</label>
          <select value={form.category} onChange={e => set('category', e.target.value)} className="form-input">
            <option value="workshop">Workshop</option>
            <option value="class">Class</option>
            <option value="camp">Camp / Series</option>
            <option value="reading">Reading</option>
            <option value="market">Market</option>
            <option value="drop-off">Drop-off</option>
            <option value="recurring">Recurring</option>
            <option value="night-out">Night Out</option>
          </select>
        </div>
        <div>
          <label className="form-label">Base Price ($)</label>
          <input type="number" step="0.01" min="0" value={form.priceDollars} onChange={e => set('priceDollars', e.target.value)} className="form-input" placeholder="0 = Free" />
        </div>
        <div>
          <label className="form-label">Max Tickets {form.hasSessions && <span className="text-xs text-hampton-mauve font-normal">(per event total)</span>}</label>
          <input type="number" min="1" value={form.maxTickets} onChange={e => set('maxTickets', e.target.value)} className="form-input" />
        </div>
        <div>
          <label className="form-label">
            Event Date
            {form.hasSessions && <span className="text-xs text-hampton-mauve font-normal ml-1">(dates set per session)</span>}
          </label>
          <input type="date" value={form.eventDate} onChange={e => set('eventDate', e.target.value)}
            className={`form-input ${form.hasSessions ? 'opacity-50' : ''}`} disabled={form.hasSessions} />
        </div>
        <div>
          <label className="form-label">Event Time</label>
          <input type="text" value={form.eventTime} onChange={e => set('eventTime', e.target.value)} className="form-input" placeholder="e.g. 6:00 PM" />
        </div>
        <div>
          <label className="form-label">End Time</label>
          <input type="text" value={form.eventEndTime} onChange={e => set('eventEndTime', e.target.value)} className="form-input" placeholder="e.g. 8:00 PM" />
        </div>
        <div>
          <label className="form-label">Location</label>
          <input value={form.location} onChange={e => set('location', e.target.value)} className="form-input" />
        </div>
      </div>

      <div className="mb-4">
        <label className="form-label">Short Description</label>
        <input value={form.shortDescription} onChange={e => set('shortDescription', e.target.value)} className="form-input" placeholder="One-liner for cards" />
      </div>
      <div className="mb-4">
        <label className="form-label">Full Description</label>
        <textarea value={form.description} onChange={e => set('description', e.target.value)} className="form-input" rows={3} />
      </div>
      <div className="mb-4">
        <label className="form-label">Images</label>
        <ImageUploader
          images={form.images}
          onChange={imgs => set('images', imgs)}
          token={headers.Authorization.replace('Bearer ', '')}
        />
      </div>

      <div className="flex items-center gap-2 mb-5">
        <input type="checkbox" checked={form.isFeatured} onChange={e => set('isFeatured', e.target.checked)} className="accent-hampton-navy" id="featured" />
        <label htmlFor="featured" className="text-sm text-hampton-mauve cursor-pointer">Featured event</label>
      </div>

      {/* ── Variants toggle ── */}
      <div className="border-t border-hampton-pink/10 pt-4 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <input type="checkbox" checked={form.hasVariants} onChange={e => set('hasVariants', e.target.checked)} className="accent-hampton-navy" id="hasVariants" />
          <label htmlFor="hasVariants" className="text-sm font-medium text-hampton-navy cursor-pointer">This event has pricing options (variants)</label>
        </div>
        {form.hasVariants && (
          <VariantsEditor variants={form.variants} onChange={v => set('variants', v)} />
        )}
      </div>

      {/* ── Sessions toggle ── */}
      <div className="border-t border-hampton-pink/10 pt-4 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <input type="checkbox" checked={form.hasSessions} onChange={e => set('hasSessions', e.target.checked)} className="accent-hampton-navy" id="hasSessions" />
          <label htmlFor="hasSessions" className="text-sm font-medium text-hampton-navy cursor-pointer">This event has multiple dates/sessions</label>
        </div>
        {form.hasSessions && (
          <>
            <SessionsEditor sessions={form.sessions} onChange={s => set('sessions', s)} allowMultiSession={form.allowMultiSession} />

            {/* Multi-session (series) toggle */}
            <div className="flex items-center gap-2 mb-3 mt-3">
              <input type="checkbox" checked={form.allowMultiSession} onChange={e => set('allowMultiSession', e.target.checked)} className="accent-hampton-navy" id="allowMulti" />
              <label htmlFor="allowMulti" className="text-sm text-hampton-mauve cursor-pointer">Allow customers to pick multiple sessions (series pricing)</label>
            </div>
            {form.allowMultiSession && (
              <BundlePricingEditor tiers={form.bundlePricing} onChange={t => set('bundlePricing', t)} />
            )}
          </>
        )}
      </div>

      {error && <p className="text-red-600 text-sm mb-3 bg-red-50 p-2 rounded">{error}</p>}

      <div className="flex gap-3">
        <button type="submit" disabled={saving} className="btn-primary px-6 py-2 flex items-center gap-2 text-sm">
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Event'}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary px-6 py-2 text-sm">Cancel</button>
      </div>
    </form>
  )
}

/* ─── Variants Editor ────────────────────────────────── */

function VariantsEditor({ variants, onChange }: { variants: Variant[]; onChange: (v: Variant[]) => void }) {
  function addVariant() { onChange([...variants, { label: '', priceCents: 0 }]) }
  function removeVariant(i: number) { onChange(variants.filter((_, idx) => idx !== i)) }
  function updateVariant(i: number, field: 'label' | 'priceCents', value: string) {
    const updated = [...variants]
    if (field === 'priceCents') {
      updated[i] = { ...updated[i], priceCents: Math.round(parseFloat(value || '0') * 100) }
    } else {
      updated[i] = { ...updated[i], label: value }
    }
    onChange(updated)
  }

  return (
    <div className="bg-hampton-ivory/50 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-hampton-navy">Options / Variants</span>
        <button type="button" onClick={addVariant} className="text-xs text-hampton-navy hover:underline flex items-center gap-1">
          <Plus className="w-3 h-3" /> Add Option
        </button>
      </div>
      {variants.map((v, i) => (
        <div key={i} className="flex items-center gap-2 mb-2">
          <input value={v.label} onChange={e => updateVariant(i, 'label', e.target.value)}
            className="form-input flex-1 text-sm" placeholder="e.g. Baseball Hat" />
          <div className="relative w-24">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-hampton-mauve text-sm">$</span>
            <input type="number" step="0.01" min="0"
              value={v.priceCents > 0 ? (v.priceCents / 100).toString() : ''}
              onChange={e => updateVariant(i, 'priceCents', e.target.value)}
              className="form-input pl-6 text-sm" placeholder="0" />
          </div>
          <button type="button" onClick={() => removeVariant(i)} className="text-red-400 hover:text-red-600 p-1"><X className="w-4 h-4" /></button>
        </div>
      ))}
      {variants.length === 0 && <p className="text-xs text-hampton-mauve">No options yet. Add one above.</p>}
    </div>
  )
}

/* ─── Sessions Editor ────────────────────────────────── */

function SessionsEditor({
  sessions, onChange, allowMultiSession,
}: {
  sessions: EventSession[]; onChange: (s: EventSession[]) => void; allowMultiSession: boolean
}) {
  function addSession() {
    onChange([...sessions, { session_date: '', session_time: '', label: '', max_tickets: 30, is_active: true }])
  }
  function removeSession(i: number) { onChange(sessions.filter((_, idx) => idx !== i)) }
  function updateSession(i: number, field: string, value: unknown) {
    const updated = [...sessions]
    updated[i] = { ...updated[i], [field]: value }
    onChange(updated)
  }

  return (
    <div className="bg-hampton-ivory/50 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-hampton-navy">Sessions / Dates</span>
        <button type="button" onClick={addSession} className="text-xs text-hampton-navy hover:underline flex items-center gap-1">
          <Plus className="w-3 h-3" /> Add Session
        </button>
      </div>
      {sessions.map((s, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 mb-2">
          <input type="date" value={s.session_date} onChange={e => updateSession(i, 'session_date', e.target.value)}
            className="form-input text-sm w-36" required />
          <input type="text" value={s.session_time} onChange={e => updateSession(i, 'session_time', e.target.value)}
            className="form-input text-sm w-24" placeholder="Time" />
          {allowMultiSession && (
            <input type="text" value={s.label || ''} onChange={e => updateSession(i, 'label', e.target.value)}
              className="form-input text-sm w-32" placeholder="Subject/Theme" />
          )}
          <input type="number" min="1" value={s.max_tickets}
            onChange={e => updateSession(i, 'max_tickets', parseInt(e.target.value) || 30)}
            className="form-input text-sm w-16" title="Max tickets" placeholder="Cap" />
          <button type="button" onClick={() => removeSession(i)} className="text-red-400 hover:text-red-600 p-1"><X className="w-4 h-4" /></button>
        </div>
      ))}
      {sessions.length === 0 && <p className="text-xs text-hampton-mauve">No sessions yet. Add one above.</p>}
    </div>
  )
}

/* ─── Bundle Pricing Editor ──────────────────────────── */

function BundlePricingEditor({ tiers, onChange }: { tiers: BundleTier[]; onChange: (t: BundleTier[]) => void }) {
  function addTier() { onChange([...tiers, { minSessions: 1, pricePerSessionCents: 0 }]) }
  function removeTier(i: number) { onChange(tiers.filter((_, idx) => idx !== i)) }
  function updateTier(i: number, field: keyof BundleTier, value: string) {
    const updated = [...tiers]
    if (field === 'pricePerSessionCents') {
      updated[i] = { ...updated[i], pricePerSessionCents: Math.round(parseFloat(value || '0') * 100) }
    } else {
      updated[i] = { ...updated[i], minSessions: parseInt(value) || 1 }
    }
    onChange(updated)
  }

  return (
    <div className="bg-hampton-ivory/50 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-hampton-navy">Bundle Pricing Tiers</span>
        <button type="button" onClick={addTier} className="text-xs text-hampton-navy hover:underline flex items-center gap-1">
          <Plus className="w-3 h-3" /> Add Tier
        </button>
      </div>
      <p className="text-xs text-hampton-mauve mb-3">Customer gets the best rate for the number of sessions they pick.</p>
      {tiers.map((t, i) => (
        <div key={i} className="flex items-center gap-2 mb-2">
          <span className="text-xs text-hampton-mauve whitespace-nowrap">Min</span>
          <input type="number" min="1" value={t.minSessions}
            onChange={e => updateTier(i, 'minSessions', e.target.value)}
            className="form-input w-14 text-sm" />
          <span className="text-xs text-hampton-mauve whitespace-nowrap">sessions @</span>
          <div className="relative w-24">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-hampton-mauve text-sm">$</span>
            <input type="number" step="0.01" min="0"
              value={t.pricePerSessionCents > 0 ? (t.pricePerSessionCents / 100).toString() : ''}
              onChange={e => updateTier(i, 'pricePerSessionCents', e.target.value)}
              className="form-input pl-6 text-sm" placeholder="0" />
          </div>
          <span className="text-xs text-hampton-mauve">/ea</span>
          <button type="button" onClick={() => removeTier(i)} className="text-red-400 hover:text-red-600 p-1"><X className="w-4 h-4" /></button>
        </div>
      ))}
      {tiers.length === 0 && <p className="text-xs text-hampton-mauve">No tiers yet. Add one above.</p>}
    </div>
  )
}

/* ─── Image Uploader ────────────────────────────────── */

function ImageUploader({
  images, onChange, token,
}: {
  images: EventImage[]; onChange: (imgs: EventImage[]) => void; token: string
}) {
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [urlInput, setUrlInput] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)
    setUploadError('')

    const newImages = [...images]
    const errors: string[] = []
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const formData = new FormData()
      formData.append('file', file)

      try {
        const res = await fetch('/api/admin/events/upload', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        })
        if (res.ok) {
          const data = await res.json()
          newImages.push({
            url: data.url,
            name: data.name || file.name,
            is_primary: newImages.length === 0,
          })
        } else {
          const data = await res.json().catch(() => ({ error: `Upload failed (${res.status})` }))
          errors.push(data.error || `Upload failed for ${file.name}`)
        }
      } catch (err) {
        errors.push(`Network error uploading ${file.name}`)
        console.error('Upload failed:', err)
      }
    }

    if (errors.length > 0) setUploadError(errors.join('. '))
    onChange(newImages)
    setUploading(false)
    // Reset file input so the same file can be re-selected on mobile
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function addUrl() {
    if (!urlInput.trim()) return
    const newImages = [...images, { url: urlInput.trim(), name: 'external', is_primary: images.length === 0 }]
    onChange(newImages)
    setUrlInput('')
  }

  function setPrimary(index: number) {
    onChange(images.map((img, i) => ({ ...img, is_primary: i === index })))
  }

  function removeImage(index: number) {
    const updated = images.filter((_, i) => i !== index)
    if (updated.length > 0 && !updated.some(img => img.is_primary)) {
      updated[0].is_primary = true
    }
    onChange(updated)
  }

  return (
    <div>
      {/* Thumbnails */}
      {images.length > 0 && (
        <div className="flex flex-wrap gap-3 mb-3">
          {images.map((img, i) => (
            <div key={i} className={`relative group rounded-lg overflow-hidden border-2 ${img.is_primary ? 'border-hampton-navy' : 'border-transparent'}`}>
              <img src={img.url} alt={img.name} className="w-24 h-24 object-cover" />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100">
                <button type="button" onClick={() => setPrimary(i)} title="Set as primary"
                  className={`p-1 rounded-full ${img.is_primary ? 'bg-amber-400 text-white' : 'bg-white/80 text-hampton-navy hover:bg-amber-400 hover:text-white'}`}>
                  <Star className="w-3.5 h-3.5" />
                </button>
                <button type="button" onClick={() => removeImage(i)} title="Remove"
                  className="p-1 rounded-full bg-white/80 text-red-600 hover:bg-red-500 hover:text-white">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              {img.is_primary && (
                <span className="absolute top-1 left-1 bg-amber-400 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">PRIMARY</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Upload area */}
      <label className={`flex items-center justify-center gap-2 border-2 border-dashed border-hampton-pink/30 rounded-lg p-4 cursor-pointer hover:border-hampton-navy/30 transition-colors ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
        {uploading ? (
          <><Loader2 className="w-4 h-4 animate-spin text-hampton-navy" /><span className="text-sm text-hampton-mauve">Uploading...</span></>
        ) : (
          <><Upload className="w-4 h-4 text-hampton-navy" /><span className="text-sm text-hampton-mauve">Tap to upload photos</span></>
        )}
        <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={e => handleFiles(e.target.files)} disabled={uploading} />
      </label>

      {uploadError && (
        <p className="text-red-600 text-xs mt-1">{uploadError}</p>
      )}

      {/* URL fallback */}
      <div className="flex gap-2 mt-2">
        <input value={urlInput} onChange={e => setUrlInput(e.target.value)} className="form-input flex-1 text-sm" placeholder="Or paste image URL..." onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addUrl() } }} />
        <button type="button" onClick={addUrl} className="text-xs text-hampton-navy hover:underline whitespace-nowrap">Add URL</button>
      </div>
    </div>
  )
}

/* ─── Event Detail Panel (Attendees + Email) ─────────── */

function EventDetailPanel({ event, headers, onRefresh }: { event: Event; headers: Record<string, string>; onRefresh: () => void }) {
  const [tab, setTab] = useState<'attendees' | 'email'>('attendees')
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [sessions, setSessions] = useState<EventSession[]>([])
  const [loadingTickets, setLoadingTickets] = useState(true)
  const [refunding, setRefunding] = useState<string | null>(null)
  const [refundReason, setRefundReason] = useState('')

  useEffect(() => { fetchTickets() }, [event.id])

  async function fetchTickets() {
    setLoadingTickets(true)
    const [ticketRes, eventRes] = await Promise.all([
      fetch(`/api/admin/events/${event.id}/tickets`, { headers }),
      event.has_sessions ? fetch(`/api/admin/events/${event.id}`, { headers }) : null,
    ])
    const ticketData = await ticketRes.json()
    setTickets(ticketData.tickets || [])
    if (eventRes) {
      const eventData = await eventRes.json()
      setSessions(eventData.sessions || [])
    }
    setLoadingTickets(false)
  }

  // Build session lookup map: session_id → session info
  const sessionMap = new Map<string, EventSession>()
  sessions.forEach(s => { if (s.id) sessionMap.set(s.id, s) })
  const hasSessions = event.has_sessions && sessions.length > 0

  async function processRefund(ticketId: string) {
    if (!confirm('Process full refund for this ticket?')) return
    setRefunding(ticketId)
    const res = await fetch(`/api/admin/events/${event.id}/tickets/${ticketId}/refund`, {
      method: 'POST', headers,
      body: JSON.stringify({ reason: refundReason }),
    })
    if (res.ok) { fetchTickets(); onRefresh() }
    setRefunding(null)
    setRefundReason('')
  }

  function getSessionLabel(t: Ticket) {
    if (!t.session_id) return ''
    const s = sessionMap.get(t.session_id)
    if (!s) return ''
    return s.session_date ? formatDate(s.session_date) + (s.label ? ` (${s.label})` : '') : (s.label || '')
  }

  function printAttendees() {
    const confirmed = tickets.filter(t => t.status === 'confirmed')
    const sessionCol = hasSessions
    const html = `<html><head><title>Attendees - ${event.title}</title>
      <style>body{font-family:sans-serif;padding:20px}table{width:100%;border-collapse:collapse}th,td{padding:8px 12px;border:1px solid #ddd;text-align:left;font-size:13px}th{background:#f5f5f5;font-weight:bold}.title{font-size:18px;margin-bottom:4px}.meta{color:#888;font-size:13px;margin-bottom:16px}</style></head>
      <body><div class="title">${event.title}</div><div class="meta">${confirmed.length} confirmed attendees · ${confirmed.reduce((s, t) => s + t.quantity, 0)} total tickets</div>
      <table><thead><tr><th>#</th><th>Name</th><th>Email</th><th>Phone</th>${sessionCol ? '<th>Date</th>' : ''}<th>Qty</th><th>Option</th></tr></thead><tbody>
      ${confirmed.map((t, i) => `<tr><td>${i + 1}</td><td>${t.customer_name}</td><td>${t.customer_email}</td><td>${t.customer_phone || '—'}</td>${sessionCol ? `<td>${getSessionLabel(t) || '—'}</td>` : ''}<td>${t.quantity}</td><td>${t.variant_label || '—'}</td></tr>`).join('')}
      </tbody></table></body></html>`
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close(); w.print() }
  }

  function downloadCSV() {
    const confirmed = tickets.filter(t => t.status === 'confirmed')
    const csv = (hasSessions ? 'Name,Email,Phone,Date,Qty,Option,Paid,Ref\n' : 'Name,Email,Phone,Qty,Option,Paid,Ref\n') +
      confirmed.map(t => {
        const datePart = hasSessions ? `"${getSessionLabel(t)}",` : ''
        return `"${t.customer_name}","${t.customer_email}","${t.customer_phone || ''}",${datePart}${t.quantity},"${t.variant_label || ''}","${formatPrice(t.total_cents)}","${t.ticket_ref}"`
      }).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `${event.slug}-attendees.csv`; a.click()
  }

  const confirmed = tickets.filter(t => t.status === 'confirmed')
  const refunded = tickets.filter(t => t.status === 'refunded')

  // Group confirmed tickets by session for multi-date events
  const groupedBySession: { label: string; date: string; tickets: Ticket[] }[] = []
  if (hasSessions) {
    const grouped = new Map<string, Ticket[]>()
    const noSession: Ticket[] = []
    confirmed.forEach(t => {
      if (t.session_id) {
        const arr = grouped.get(t.session_id) || []
        arr.push(t)
        grouped.set(t.session_id, arr)
      } else {
        noSession.push(t)
      }
    })
    // Sort sessions by date
    const sortedSessions = [...sessions].sort((a, b) => (a.session_date || '').localeCompare(b.session_date || ''))
    sortedSessions.forEach(s => {
      if (s.id && grouped.has(s.id)) {
        groupedBySession.push({
          label: s.label || formatDate(s.session_date),
          date: s.session_date,
          tickets: grouped.get(s.id)!,
        })
      }
    })
    if (noSession.length > 0) {
      groupedBySession.push({ label: 'No session assigned', date: '', tickets: noSession })
    }
  }

  return (
    <div className="border-t border-hampton-pink/10 px-4 pb-4">
      {/* Tabs */}
      <div className="flex items-center gap-1 py-3 border-b border-hampton-pink/10 mb-4">
        <button onClick={() => setTab('attendees')}
          className={`px-3 py-1.5 rounded text-sm font-medium transition-colors flex items-center gap-1.5 ${tab === 'attendees' ? 'bg-hampton-navy text-white' : 'text-hampton-mauve hover:bg-hampton-navy/5'}`}>
          <Users className="w-3.5 h-3.5" /> Attendees ({confirmed.length})
        </button>
        <button onClick={() => setTab('email')}
          className={`px-3 py-1.5 rounded text-sm font-medium transition-colors flex items-center gap-1.5 ${tab === 'email' ? 'bg-hampton-navy text-white' : 'text-hampton-mauve hover:bg-hampton-navy/5'}`}>
          <Mail className="w-3.5 h-3.5" /> Send Email
        </button>
      </div>

      {tab === 'attendees' && (
        <>
          <div className="flex gap-2 mb-4">
            <button onClick={printAttendees} className="text-xs text-hampton-mauve hover:text-hampton-navy flex items-center gap-1 transition-colors">
              <Printer className="w-3.5 h-3.5" /> Print List
            </button>
            <button onClick={downloadCSV} className="text-xs text-hampton-mauve hover:text-hampton-navy flex items-center gap-1 transition-colors">
              <Download className="w-3.5 h-3.5" /> Download CSV
            </button>
          </div>

          {loadingTickets ? (
            <Loader2 className="w-5 h-5 animate-spin mx-auto my-6 text-hampton-mauve" />
          ) : confirmed.length === 0 ? (
            <p className="text-sm text-hampton-mauve py-4 text-center">No tickets sold yet.</p>
          ) : hasSessions ? (
            /* ── Grouped by session date ── */
            <div className="space-y-4">
              {groupedBySession.map((group, gi) => (
                <div key={gi} className="border border-hampton-pink/10 rounded-xl overflow-hidden">
                  <div className="bg-gradient-to-r from-purple-50 to-blue-50 px-4 py-2.5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-hampton-navy">
                        {group.date ? formatDate(group.date) : group.label}
                      </span>
                      {group.date && group.label !== formatDate(group.date) && (
                        <span className="text-xs text-purple-600 bg-purple-100 px-2 py-0.5 rounded-full">{group.label}</span>
                      )}
                    </div>
                    <span className="text-xs text-hampton-mauve">
                      {group.tickets.length} attendee{group.tickets.length !== 1 ? 's' : ''} &middot; {group.tickets.reduce((s, t) => s + t.quantity, 0)} ticket{group.tickets.reduce((s, t) => s + t.quantity, 0) !== 1 ? 's' : ''}
                    </span>
                  </div>
                  {/* Desktop table */}
                  <div className="overflow-x-auto hidden sm:block">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-hampton-mauve border-b border-hampton-pink/10">
                          <th className="py-2 px-4 pr-3">Ref</th>
                          <th className="py-2 pr-3">Name</th>
                          <th className="py-2 pr-3">Email</th>
                          <th className="py-2 pr-3">Phone</th>
                          <th className="py-2 pr-3">Qty</th>
                          <th className="py-2 pr-3">Paid</th>
                          <th className="py-2">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.tickets.map(t => (
                          <tr key={t.id} className="border-b border-hampton-pink/5">
                            <td className="py-2 px-4 pr-3 text-xs font-mono text-hampton-navy">{t.ticket_ref}</td>
                            <td className="py-2 pr-3">{t.customer_name}</td>
                            <td className="py-2 pr-3 text-hampton-mauve">{t.customer_email}</td>
                            <td className="py-2 pr-3 text-hampton-mauve">{t.customer_phone || '—'}</td>
                            <td className="py-2 pr-3">{t.quantity}</td>
                            <td className="py-2 pr-3">{formatPrice(t.total_cents)}</td>
                            <td className="py-2">
                              {t.stripe_payment_intent_id ? (
                                <button onClick={() => processRefund(t.id)} disabled={refunding === t.id}
                                  className="text-xs text-red-600 hover:text-red-800 font-medium disabled:opacity-50">
                                  {refunding === t.id ? 'Refunding...' : 'Refund'}
                                </button>
                              ) : (
                                <span className="text-xs text-green-600">Free</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {/* Mobile cards */}
                  <div className="sm:hidden space-y-2 p-3">
                    {group.tickets.map(t => (
                      <div key={t.id} className="bg-white border border-hampton-pink/10 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-sm text-hampton-navy">{t.customer_name}</span>
                          <span className="text-sm font-semibold">{formatPrice(t.total_cents)}</span>
                        </div>
                        <div className="text-xs text-hampton-mauve space-y-0.5">
                          <p>{t.customer_email}</p>
                          {t.customer_phone && <p>{t.customer_phone}</p>}
                          <div className="flex items-center justify-between pt-1">
                            <span className="font-mono text-gray-400">{t.ticket_ref} · Qty {t.quantity}</span>
                            {t.stripe_payment_intent_id ? (
                              <button onClick={() => processRefund(t.id)} disabled={refunding === t.id}
                                className="text-xs text-red-600 hover:text-red-800 font-medium disabled:opacity-50">
                                {refunding === t.id ? 'Refunding...' : 'Refund'}
                              </button>
                            ) : (
                              <span className="text-xs text-green-600">Free</span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <>
            {/* Desktop table (flat — no sessions) */}
            <div className="overflow-x-auto hidden sm:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-hampton-mauve border-b border-hampton-pink/10">
                    <th className="pb-2 pr-3">Ref</th>
                    <th className="pb-2 pr-3">Name</th>
                    <th className="pb-2 pr-3">Email</th>
                    <th className="pb-2 pr-3">Phone</th>
                    <th className="pb-2 pr-3">Qty</th>
                    <th className="pb-2 pr-3">Paid</th>
                    <th className="pb-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {confirmed.map(t => (
                    <tr key={t.id} className="border-b border-hampton-pink/5">
                      <td className="py-2 pr-3 text-xs font-mono text-hampton-navy">{t.ticket_ref}</td>
                      <td className="py-2 pr-3">{t.customer_name}</td>
                      <td className="py-2 pr-3 text-hampton-mauve">{t.customer_email}</td>
                      <td className="py-2 pr-3 text-hampton-mauve">{t.customer_phone || '—'}</td>
                      <td className="py-2 pr-3">{t.quantity}</td>
                      <td className="py-2 pr-3">{formatPrice(t.total_cents)}</td>
                      <td className="py-2">
                        {t.stripe_payment_intent_id ? (
                          <button onClick={() => processRefund(t.id)} disabled={refunding === t.id}
                            className="text-xs text-red-600 hover:text-red-800 font-medium disabled:opacity-50">
                            {refunding === t.id ? 'Refunding...' : 'Refund'}
                          </button>
                        ) : (
                          <span className="text-xs text-green-600">Free</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Mobile cards */}
            <div className="sm:hidden space-y-2">
              {confirmed.map(t => (
                <div key={t.id} className="bg-white border border-hampton-pink/10 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-sm text-hampton-navy">{t.customer_name}</span>
                    <span className="text-sm font-semibold">{formatPrice(t.total_cents)}</span>
                  </div>
                  <div className="text-xs text-hampton-mauve space-y-0.5">
                    <p>{t.customer_email}</p>
                    {t.customer_phone && <p>{t.customer_phone}</p>}
                    <div className="flex items-center justify-between pt-1">
                      <span className="font-mono text-gray-400">{t.ticket_ref} · Qty {t.quantity}</span>
                      {t.stripe_payment_intent_id ? (
                        <button onClick={() => processRefund(t.id)} disabled={refunding === t.id}
                          className="text-xs text-red-600 hover:text-red-800 font-medium disabled:opacity-50">
                          {refunding === t.id ? 'Refunding...' : 'Refund'}
                        </button>
                      ) : (
                        <span className="text-xs text-green-600">Free</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            </>
          )}

          {refunded.length > 0 && (
            <details className="mt-4">
              <summary className="text-xs text-hampton-mauve cursor-pointer">{refunded.length} refunded ticket{refunded.length !== 1 ? 's' : ''}</summary>
              <div className="mt-2 space-y-1">
                {refunded.map(t => (
                  <p key={t.id} className="text-xs text-gray-400">{t.ticket_ref} — {t.customer_name} — {formatPrice(t.total_cents)}</p>
                ))}
              </div>
            </details>
          )}
        </>
      )}

      {tab === 'email' && (
        <EmailComposer
          event={event}
          confirmed={confirmed}
          headers={headers}
        />
      )}
    </div>
  )
}

/* ─── Email Composer (Rich Text) ─────────────────────── */

function EmailComposer({
  event, confirmed, headers,
}: {
  event: Event; confirmed: Ticket[]; headers: Record<string, string>
}) {
  const editorRef = useRef<HTMLDivElement>(null)
  const [subject, setSubject] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState('')
  const [showImageInput, setShowImageInput] = useState(false)
  const [imageUrl, setImageUrl] = useState('')
  const [uploading, setUploading] = useState(false)
  const token = headers.Authorization.replace('Bearer ', '')

  function exec(cmd: string, value?: string) {
    document.execCommand(cmd, false, value)
    editorRef.current?.focus()
  }

  function loadTemplate() {
    const dateStr = event.event_date
      ? new Date(event.event_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      : 'Date TBD'
    const timeStr = event.event_time || 'Time TBD'

    if (editorRef.current) {
      editorRef.current.innerHTML = `
        <p>Hi there,</p>
        <p>This is a friendly reminder about <strong>${event.title}</strong> at Host Hampton!</p>
        <p><strong>Date:</strong> ${dateStr}<br/>
        <strong>Time:</strong> ${timeStr}<br/>
        <strong>Location:</strong> Host Hampton, 295 Montauk Hwy Suite 7, Speonk NY 11972</p>
        <p>We're looking forward to seeing you! If you have any questions or need to make changes to your reservation, please don't hesitate to reach out.</p>
        <p>Warm regards,<br/>
        <strong>The Host Hampton Team</strong><br/>
        <span style="color:#666;font-size:13px;">(631) 998-9325 · hosthampton295@gmail.com<br/>
        www.hosthampton.com</span></p>
      `.trim()
    }
    if (!subject) setSubject(`Reminder: ${event.title}`)
  }

  function insertLink() {
    const url = prompt('Enter URL:')
    if (url) exec('createLink', url)
  }

  function insertImage(src: string) {
    if (editorRef.current) {
      editorRef.current.focus()
      exec('insertHTML', `<img src="${src}" alt="Event image" style="max-width:100%;border-radius:8px;margin:8px 0;" />`)
    }
    setShowImageInput(false)
    setImageUrl('')
  }

  async function handleImageUpload(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)
    const formData = new FormData()
    formData.append('file', files[0])
    try {
      const res = await fetch('/api/admin/events/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })
      if (res.ok) {
        const data = await res.json()
        insertImage(data.url)
      }
    } catch (err) {
      console.error('Image upload failed:', err)
    }
    setUploading(false)
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    const htmlBody = editorRef.current?.innerHTML || ''
    if (!subject || !htmlBody.trim() || htmlBody.trim() === '<br>') return
    setSending(true); setResult('')

    const res = await fetch(`/api/admin/events/${event.id}/email`, {
      method: 'POST', headers,
      body: JSON.stringify({ subject, htmlBody }),
    })
    const data = await res.json()
    if (res.ok) {
      setResult(`Sent to ${data.sent} attendee${data.sent !== 1 ? 's' : ''}${data.failed ? ` (${data.failed} failed)` : ''}`)
      setSubject('')
      if (editorRef.current) editorRef.current.innerHTML = ''
    } else {
      setResult(data.error || 'Failed to send')
    }
    setSending(false)
  }

  return (
    <form onSubmit={handleSend}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-hampton-mauve">
          Send to {confirmed.length} confirmed attendee{confirmed.length !== 1 ? 's' : ''}.
        </p>
        <button type="button" onClick={loadTemplate}
          className="text-xs text-hampton-navy hover:underline flex items-center gap-1">
          <Mail className="w-3 h-3" /> Load Reminder Template
        </button>
      </div>

      <div className="mb-3">
        <label className="form-label">Subject</label>
        <input value={subject} onChange={e => setSubject(e.target.value)} className="form-input" placeholder="Event reminder..." required />
      </div>

      <div className="mb-4">
        <label className="form-label">Message</label>
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-0.5 border border-b-0 border-hampton-pink/20 rounded-t-lg bg-hampton-ivory/50 px-2 py-1.5">
          <button type="button" onClick={() => exec('bold')} className="p-1.5 rounded hover:bg-hampton-navy/10 transition-colors" title="Bold">
            <Bold className="w-3.5 h-3.5 text-hampton-navy" />
          </button>
          <button type="button" onClick={() => exec('italic')} className="p-1.5 rounded hover:bg-hampton-navy/10 transition-colors" title="Italic">
            <Italic className="w-3.5 h-3.5 text-hampton-navy" />
          </button>
          <button type="button" onClick={() => exec('underline')} className="p-1.5 rounded hover:bg-hampton-navy/10 transition-colors" title="Underline">
            <Underline className="w-3.5 h-3.5 text-hampton-navy" />
          </button>
          <div className="w-px h-4 bg-hampton-pink/30 mx-1" />
          <button type="button" onClick={() => exec('formatBlock', 'h3')} className="p-1.5 rounded hover:bg-hampton-navy/10 transition-colors" title="Heading">
            <Type className="w-3.5 h-3.5 text-hampton-navy" />
          </button>
          <button type="button" onClick={() => exec('insertUnorderedList')} className="p-1.5 rounded hover:bg-hampton-navy/10 transition-colors" title="Bullet List">
            <List className="w-3.5 h-3.5 text-hampton-navy" />
          </button>
          <button type="button" onClick={insertLink} className="p-1.5 rounded hover:bg-hampton-navy/10 transition-colors" title="Insert Link">
            <Link2 className="w-3.5 h-3.5 text-hampton-navy" />
          </button>
          <div className="w-px h-4 bg-hampton-pink/30 mx-1" />
          <button type="button" onClick={() => setShowImageInput(!showImageInput)} className="p-1.5 rounded hover:bg-hampton-navy/10 transition-colors" title="Insert Image">
            <ImageIcon className="w-3.5 h-3.5 text-hampton-navy" />
          </button>
        </div>

        {/* Image insert row */}
        {showImageInput && (
          <div className="flex items-center gap-2 border border-b-0 border-hampton-pink/20 bg-hampton-ivory/30 px-3 py-2">
            <label className={`text-xs text-hampton-navy cursor-pointer hover:underline flex items-center gap-1 ${uploading ? 'opacity-50' : ''}`}>
              <Upload className="w-3 h-3" />
              {uploading ? 'Uploading...' : 'Upload'}
              <input type="file" accept="image/*" className="hidden" onChange={e => handleImageUpload(e.target.files)} disabled={uploading} />
            </label>
            <span className="text-xs text-hampton-mauve">or</span>
            <input value={imageUrl} onChange={e => setImageUrl(e.target.value)} className="form-input flex-1 text-xs py-1" placeholder="Paste image URL..."
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (imageUrl.trim()) insertImage(imageUrl.trim()) } }} />
            <button type="button" onClick={() => { if (imageUrl.trim()) insertImage(imageUrl.trim()) }} className="text-xs text-hampton-navy hover:underline">Insert</button>
          </div>
        )}

        {/* Editable area */}
        <div
          ref={editorRef}
          contentEditable
          className="form-input rounded-t-none min-h-[160px] prose prose-sm max-w-none focus:outline-none"
          style={{ whiteSpace: 'pre-wrap' }}
          data-placeholder="Start typing your message..."
          suppressContentEditableWarning
        />
      </div>

      {result && <p className={`text-sm mb-3 p-2 rounded ${result.includes('Failed') ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-700'}`}>{result}</p>}
      <button type="submit" disabled={sending || confirmed.length === 0} className="btn-primary px-5 py-2 text-sm flex items-center gap-2 disabled:opacity-50">
        {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        {sending ? 'Sending...' : `Send to ${confirmed.length} attendee${confirmed.length !== 1 ? 's' : ''}`}
      </button>
    </form>
  )
}
