'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Edit3, Archive, ChevronDown, ChevronUp, Loader2, X, Clock, DollarSign, Tag } from 'lucide-react'

/* ─── Interfaces ─────────────────────────────────────── */

interface BookingType {
  id: string
  slug: string
  label: string
  description: string | null
  allowed_days: number[]
  slot_duration_min: number
  buffer_min: number
  open_time: string | null
  close_time: string | null
  requires_deposit: boolean
  deposit_cents: number
  min_advance_days: number
  tags: string[]
  sort_order: number
  is_active: boolean
  created_at: string
}

interface BookingTypeFormData {
  label: string
  slug: string
  description: string
  tags: string
  allowedDays: number[]
  openTime: string
  closeTime: string
  slotDurationMin: string
  bufferMin: string
  minAdvanceDays: string
  requiresDeposit: boolean
  depositDollars: string
  sortOrder: string
  isActive: boolean
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function emptyForm(): BookingTypeFormData {
  return {
    label: '', slug: '', description: '', tags: '',
    allowedDays: [0, 1, 2, 3, 4, 5, 6],
    openTime: '', closeTime: '',
    slotDurationMin: '60', bufferMin: '0', minAdvanceDays: '1',
    requiresDeposit: false, depositDollars: '',
    sortOrder: '0', isActive: true,
  }
}

function toFormData(bt: BookingType): BookingTypeFormData {
  return {
    label: bt.label,
    slug: bt.slug,
    description: bt.description || '',
    tags: bt.tags.join(', '),
    allowedDays: bt.allowed_days,
    openTime: bt.open_time || '',
    closeTime: bt.close_time || '',
    slotDurationMin: bt.slot_duration_min.toString(),
    bufferMin: bt.buffer_min.toString(),
    minAdvanceDays: bt.min_advance_days.toString(),
    requiresDeposit: bt.requires_deposit,
    depositDollars: bt.deposit_cents > 0 ? (bt.deposit_cents / 100).toString() : '',
    sortOrder: bt.sort_order.toString(),
    isActive: bt.is_active,
  }
}

function formatDuration(min: number): string {
  if (min < 60) return `${min}min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

/* ─── CalendarConfigTab ─────────────────────────────── */

export default function CalendarConfigTab({ headers, onLogout }: { headers: Record<string, string>; onLogout: () => void }) {
  const [types, setTypes] = useState<BookingType[]>([])
  const [loading, setLoading] = useState(true)
  const [showInactive, setShowInactive] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const fetchTypes = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/admin/booking-types', { headers })
    if (res.status === 401) { onLogout(); return }
    const data = await res.json()
    setTypes(data.types || [])
    setLoading(false)
  }, [headers.Authorization])

  useEffect(() => { fetchTypes() }, [fetchTypes])

  const filtered = showInactive ? types : types.filter(t => t.is_active)

  async function archiveType(id: string) {
    if (!confirm('Deactivate this booking type? It will be hidden from the calendar.')) return
    await fetch(`/api/admin/booking-types/${id}`, { method: 'DELETE', headers })
    fetchTypes()
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      {/* Actions bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => { setShowCreate(!showCreate); setEditingId(null) }}
            className="btn-primary px-4 py-2 flex items-center gap-2 text-sm">
            <Plus className="w-4 h-4" /> New Booking Type
          </button>
          <label className="flex items-center gap-2 text-sm text-hampton-mauve cursor-pointer">
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} className="accent-hampton-navy" />
            Show inactive
          </label>
        </div>
        <p className="text-sm text-hampton-mauve">{filtered.length} booking type{filtered.length !== 1 ? 's' : ''}</p>
      </div>

      {/* Create form */}
      {showCreate && !editingId && (
        <BookingTypeForm
          headers={headers}
          onSaved={() => { setShowCreate(false); fetchTypes() }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {/* Edit form */}
      {editingId && (
        <BookingTypeForm
          headers={headers}
          onSaved={() => { setEditingId(null); fetchTypes() }}
          onCancel={() => setEditingId(null)}
          existing={types.find(t => t.id === editingId)}
        />
      )}

      {loading ? (
        <div className="text-center py-12"><Loader2 className="w-6 h-6 animate-spin mx-auto text-hampton-mauve" /></div>
      ) : filtered.length === 0 ? (
        <p className="text-center text-hampton-mauve py-12">No booking types yet. Create your first one above!</p>
      ) : (
        <div className="space-y-3">
          {filtered.map(bt => (
            <div key={bt.id} className={`bg-white rounded-xl border ${bt.is_active ? 'border-hampton-pink/20' : 'border-gray-200 opacity-60'}`}>
              {/* Row */}
              <div
                className="flex items-center gap-4 p-4 cursor-pointer"
                onClick={() => setExpandedId(expandedId === bt.id ? null : bt.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="font-semibold text-hampton-navy text-sm truncate">{bt.label}</h3>
                    <span className="text-xs bg-hampton-navy/10 text-hampton-navy px-2 py-0.5 rounded-full flex items-center gap-1">
                      <Clock className="w-3 h-3" /> {formatDuration(bt.slot_duration_min)}
                    </span>
                    {bt.requires_deposit && (
                      <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <DollarSign className="w-3 h-3" /> ${(bt.deposit_cents / 100).toFixed(0)}
                      </span>
                    )}
                    {!bt.requires_deposit && (
                      <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">Free</span>
                    )}
                    {!bt.is_active && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Inactive</span>}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-hampton-mauve flex-wrap">
                    <span>{bt.allowed_days.map(d => DAYS[d]).join(', ')}</span>
                    {bt.open_time && bt.close_time && <span>{bt.open_time}–{bt.close_time}</span>}
                    {bt.tags.length > 0 && (
                      <span className="flex items-center gap-1">
                        <Tag className="w-3 h-3" />
                        {bt.tags.slice(0, 3).join(', ')}{bt.tags.length > 3 ? ` +${bt.tags.length - 3}` : ''}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={e => { e.stopPropagation(); setEditingId(bt.id); setShowCreate(false) }}
                    className="p-2 text-hampton-mauve hover:text-hampton-navy transition-colors" title="Edit">
                    <Edit3 className="w-4 h-4" />
                  </button>
                  {bt.is_active && (
                    <button onClick={e => { e.stopPropagation(); archiveType(bt.id) }}
                      className="p-2 text-hampton-mauve hover:text-red-600 transition-colors" title="Deactivate">
                      <Archive className="w-4 h-4" />
                    </button>
                  )}
                  {expandedId === bt.id ? <ChevronUp className="w-4 h-4 text-hampton-mauve" /> : <ChevronDown className="w-4 h-4 text-hampton-mauve" />}
                </div>
              </div>

              {/* Expanded detail */}
              {expandedId === bt.id && (
                <div className="border-t border-hampton-pink/10 px-4 py-4">
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="text-xs text-hampton-mauve block mb-0.5">Slug</span>
                      <span className="font-mono text-xs text-hampton-navy">{bt.slug}</span>
                    </div>
                    <div>
                      <span className="text-xs text-hampton-mauve block mb-0.5">Duration</span>
                      <span className="text-hampton-navy">{formatDuration(bt.slot_duration_min)}</span>
                    </div>
                    <div>
                      <span className="text-xs text-hampton-mauve block mb-0.5">Buffer</span>
                      <span className="text-hampton-navy">{bt.buffer_min}min</span>
                    </div>
                    <div>
                      <span className="text-xs text-hampton-mauve block mb-0.5">Min Advance</span>
                      <span className="text-hampton-navy">{bt.min_advance_days} day{bt.min_advance_days !== 1 ? 's' : ''}</span>
                    </div>
                    <div>
                      <span className="text-xs text-hampton-mauve block mb-0.5">Hours</span>
                      <span className="text-hampton-navy">{bt.open_time && bt.close_time ? `${bt.open_time}–${bt.close_time}` : 'Default'}</span>
                    </div>
                    <div>
                      <span className="text-xs text-hampton-mauve block mb-0.5">Deposit</span>
                      <span className="text-hampton-navy">{bt.requires_deposit ? `$${(bt.deposit_cents / 100).toFixed(0)}` : 'None (free)'}</span>
                    </div>
                    <div>
                      <span className="text-xs text-hampton-mauve block mb-0.5">Sort Order</span>
                      <span className="text-hampton-navy">{bt.sort_order}</span>
                    </div>
                    <div>
                      <span className="text-xs text-hampton-mauve block mb-0.5">Days</span>
                      <span className="text-hampton-navy">{bt.allowed_days.map(d => DAYS[d]).join(', ')}</span>
                    </div>
                  </div>
                  {bt.description && (
                    <div className="mt-3">
                      <span className="text-xs text-hampton-mauve block mb-0.5">Description</span>
                      <p className="text-sm text-hampton-navy">{bt.description}</p>
                    </div>
                  )}
                  {bt.tags.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {bt.tags.map(tag => (
                        <span key={tag} className="text-xs bg-hampton-navy/5 text-hampton-navy px-2 py-0.5 rounded-full">{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ─── Booking Type Form (Create / Edit) ──────────────── */

function BookingTypeForm({
  headers, onSaved, onCancel, existing,
}: {
  headers: Record<string, string>
  onSaved: () => void
  onCancel: () => void
  existing?: BookingType
}) {
  const isEdit = !!existing
  const [form, setForm] = useState<BookingTypeFormData>(() => existing ? toFormData(existing) : emptyForm())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (k: string, v: unknown) => setForm(prev => ({ ...prev, [k]: v }))

  // Auto-generate slug from label (only on create, only if slug is empty or matches previous auto-gen)
  function handleLabelChange(label: string) {
    const prevAutoSlug = form.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    set('label', label)
    if (!isEdit && (form.slug === '' || form.slug === prevAutoSlug)) {
      set('slug', label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
    }
  }

  function toggleDay(day: number) {
    const days = form.allowedDays.includes(day)
      ? form.allowedDays.filter(d => d !== day)
      : [...form.allowedDays, day].sort()
    set('allowedDays', days)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.label.trim()) { setError('Label is required'); return }
    if (form.allowedDays.length === 0) { setError('Select at least one day'); return }
    setSaving(true); setError('')

    const tags = form.tags
      .split(',')
      .map(t => t.trim().toLowerCase())
      .filter(Boolean)

    const payload = {
      label: form.label.trim(),
      slug: form.slug.trim(),
      description: form.description.trim() || null,
      tags,
      allowedDays: form.allowedDays,
      openTime: form.openTime || null,
      closeTime: form.closeTime || null,
      slotDurationMin: parseInt(form.slotDurationMin) || 60,
      bufferMin: parseInt(form.bufferMin) || 0,
      minAdvanceDays: parseInt(form.minAdvanceDays) || 1,
      requiresDeposit: form.requiresDeposit,
      depositCents: form.requiresDeposit ? Math.round(parseFloat(form.depositDollars || '0') * 100) : 0,
      sortOrder: parseInt(form.sortOrder) || 0,
      isActive: form.isActive,
    }

    const url = isEdit ? `/api/admin/booking-types/${existing!.id}` : '/api/admin/booking-types'
    const method = isEdit ? 'PUT' : 'POST'

    const res = await fetch(url, { method, headers, body: JSON.stringify(payload) })
    if (!res.ok) {
      const data = await res.json()
      setError(data.error || `Failed to ${isEdit ? 'update' : 'create'} booking type`)
      setSaving(false)
      return
    }

    onSaved()
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-hampton-pink/20 p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-serif text-lg text-hampton-navy">{isEdit ? 'Edit Booking Type' : 'New Booking Type'}</h2>
        <button type="button" onClick={onCancel} className="text-hampton-mauve hover:text-hampton-navy"><X className="w-5 h-5" /></button>
      </div>

      {/* Label + Slug */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="form-label">Label *</label>
          <input value={form.label} onChange={e => handleLabelChange(e.target.value)} className="form-input" required placeholder="e.g. Kids Birthday Party" />
        </div>
        <div>
          <label className="form-label">Slug</label>
          <input value={form.slug} onChange={e => set('slug', e.target.value)} className="form-input font-mono text-sm" placeholder="auto-generated" />
        </div>
      </div>

      {/* Description */}
      <div className="mb-4">
        <label className="form-label">Description</label>
        <textarea value={form.description} onChange={e => set('description', e.target.value)} className="form-input" rows={2} placeholder="Brief description for customers" />
      </div>

      {/* Tags */}
      <div className="mb-4">
        <label className="form-label">Tags <span className="font-normal text-hampton-mauve">(comma-separated)</span></label>
        <input value={form.tags} onChange={e => set('tags', e.target.value)} className="form-input" placeholder="e.g. kids-party, childrens, family" />
      </div>

      {/* Allowed Days */}
      <div className="mb-4">
        <label className="form-label">Available Days</label>
        <div className="flex gap-1.5">
          {DAYS.map((day, i) => (
            <button
              key={i}
              type="button"
              onClick={() => toggleDay(i)}
              className={`w-10 h-10 rounded-lg text-xs font-medium transition-colors ${
                form.allowedDays.includes(i)
                  ? 'bg-hampton-navy text-white'
                  : 'bg-hampton-ivory text-hampton-mauve hover:bg-hampton-navy/10'
              }`}
            >
              {day}
            </button>
          ))}
        </div>
      </div>

      {/* Time + Duration row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <div>
          <label className="form-label">Open Time</label>
          <input type="time" value={form.openTime} onChange={e => set('openTime', e.target.value)} className="form-input" />
          <p className="text-[10px] text-hampton-mauve mt-0.5">Blank = system default</p>
        </div>
        <div>
          <label className="form-label">Close Time</label>
          <input type="time" value={form.closeTime} onChange={e => set('closeTime', e.target.value)} className="form-input" />
          <p className="text-[10px] text-hampton-mauve mt-0.5">Blank = system default</p>
        </div>
        <div>
          <label className="form-label">Slot Duration (min)</label>
          <input type="number" min="15" step="15" value={form.slotDurationMin} onChange={e => set('slotDurationMin', e.target.value)} className="form-input" />
        </div>
        <div>
          <label className="form-label">Buffer (min)</label>
          <input type="number" min="0" step="5" value={form.bufferMin} onChange={e => set('bufferMin', e.target.value)} className="form-input" />
        </div>
      </div>

      {/* Booking window + Sort */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <div>
          <label className="form-label">Min Advance Days</label>
          <input type="number" min="0" value={form.minAdvanceDays} onChange={e => set('minAdvanceDays', e.target.value)} className="form-input" />
        </div>
        <div>
          <label className="form-label">Sort Order</label>
          <input type="number" min="0" value={form.sortOrder} onChange={e => set('sortOrder', e.target.value)} className="form-input" />
        </div>
      </div>

      {/* Deposit */}
      <div className="border-t border-hampton-pink/10 pt-4 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <input type="checkbox" checked={form.requiresDeposit} onChange={e => set('requiresDeposit', e.target.checked)} className="accent-hampton-navy" id="reqDeposit" />
          <label htmlFor="reqDeposit" className="text-sm font-medium text-hampton-navy cursor-pointer">Requires deposit</label>
        </div>
        {form.requiresDeposit && (
          <div className="w-40">
            <label className="form-label">Deposit Amount ($)</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-hampton-mauve text-sm">$</span>
              <input
                type="number" step="0.01" min="0" value={form.depositDollars}
                onChange={e => set('depositDollars', e.target.value)}
                className="form-input pl-7" placeholder="0"
              />
            </div>
          </div>
        )}
      </div>

      {/* Active toggle */}
      <div className="flex items-center gap-2 mb-5">
        <input type="checkbox" checked={form.isActive} onChange={e => set('isActive', e.target.checked)} className="accent-hampton-navy" id="isActive" />
        <label htmlFor="isActive" className="text-sm text-hampton-mauve cursor-pointer">Active (visible on calendar)</label>
      </div>

      {error && <p className="text-red-600 text-sm mb-3 bg-red-50 p-2 rounded">{error}</p>}

      <div className="flex gap-3">
        <button type="submit" disabled={saving} className="btn-primary px-6 py-2 flex items-center gap-2 text-sm">
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Booking Type'}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary px-6 py-2 text-sm">Cancel</button>
      </div>
    </form>
  )
}
