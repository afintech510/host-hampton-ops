'use client'

import { useState, useEffect } from 'react'

interface PhotoBooking {
  id: string
  booking_ref: string
  party_date: string
  child_name: string | null
  contact_name: string
  contact_email: string
  package_type: string | null
  photo_gallery_url: string | null
}

type PhotoFilter = 'missing' | 'set' | 'all'

export default function PhotosTab({ headers }: { headers: HeadersInit; onLogout: () => void }) {
  const [bookings, setBookings] = useState<PhotoBooking[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState<PhotoFilter>('missing')
  const [loading, setLoading] = useState(true)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [savingId, setSavingId] = useState('')
  const [savedFlash, setSavedFlash] = useState<Record<string, boolean>>({})

  useEffect(() => { fetchBookings() }, [filter, page])

  async function fetchBookings() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ past: 'true', page: String(page) })
      if (filter !== 'all') params.set('photos', filter)
      const res = await fetch(`/api/admin/parties?${params}`, { headers })
      const data = await res.json()
      setBookings(data.bookings || [])
      setTotal(data.total || 0)
      // Seed drafts from current values so users edit in place
      const seed: Record<string, string> = {}
      for (const b of data.bookings || []) {
        seed[b.id] = b.photo_gallery_url || ''
      }
      setDrafts(seed)
    } catch (err) {
      console.error('Fetch error:', err)
    } finally {
      setLoading(false)
    }
  }

  async function savePhoto(id: string) {
    const url = (drafts[id] || '').trim()
    setSavingId(id)
    try {
      const res = await fetch(`/api/admin/parties/${id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ photo_gallery_url: url || null }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(`Save failed: ${err.error || res.statusText}`)
        return
      }
      // Reflect locally
      setBookings(prev => prev.map(b => b.id === id ? { ...b, photo_gallery_url: url || null } : b))
      setSavedFlash(s => ({ ...s, [id]: true }))
      setTimeout(() => setSavedFlash(s => ({ ...s, [id]: false })), 1500)
    } catch (err) {
      alert(`Save error: ${err}`)
    } finally {
      setSavingId('')
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / 25))

  function formatDate(d: string): string {
    try {
      const [y, m, day] = d.split('-').map(Number)
      return new Date(y, m - 1, day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
    } catch { return d }
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h2 className="font-serif text-2xl text-hampton-navy mb-1">Photo Gallery Backfill</h2>
        <p className="text-sm text-gray-500">Paste a gallery URL (Google Photos, Dropbox, Pic-Time, etc.) for past parties. The link goes into the post-party thank-you email that sends the morning after each party. If left blank, the email still goes out — without the photo section.</p>
      </div>

      {/* Filter pills */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {(['missing', 'set', 'all'] as PhotoFilter[]).map(f => (
          <button
            key={f}
            onClick={() => { setFilter(f); setPage(1) }}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              filter === f
                ? 'bg-hampton-navy text-white border-hampton-navy'
                : 'bg-white text-hampton-navy border-gray-200 hover:border-hampton-navy/50'
            }`}
          >
            {f === 'missing' ? 'Missing photos' : f === 'set' ? 'Has photos' : 'All past parties'}
          </button>
        ))}
        <div className="ml-auto text-xs text-gray-500 self-center">
          {total} {total === 1 ? 'party' : 'parties'}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Loading…</div>
      ) : bookings.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-100">
          <p className="text-gray-500 text-sm">
            {filter === 'missing' ? 'No past parties missing photo URLs. 🎉' : 'No parties to show.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {bookings.map(b => {
            const draft = drafts[b.id] ?? (b.photo_gallery_url || '')
            const isDirty = (draft || '') !== (b.photo_gallery_url || '')
            return (
              <div key={b.id} className="bg-white border border-gray-100 rounded-xl p-4">
                <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                  <div>
                    <div className="text-xs text-gray-400 uppercase tracking-wider mb-0.5">{b.booking_ref}</div>
                    <div className="font-medium text-hampton-navy">
                      {b.child_name ? `${b.child_name}'s ` : ''}
                      {b.package_type || 'Party'}
                    </div>
                    <div className="text-sm text-gray-500">{b.contact_name} · {b.contact_email}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-gray-400">Party Date</div>
                    <div className="text-sm font-medium text-hampton-navy">{formatDate(b.party_date)}</div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="url"
                    placeholder="https://photos.google.com/share/..."
                    value={draft}
                    onChange={e => setDrafts(d => ({ ...d, [b.id]: e.target.value }))}
                    className="flex-1 min-w-[240px] px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-hampton-blue/30 focus:border-hampton-blue"
                  />
                  <button
                    onClick={() => savePhoto(b.id)}
                    disabled={!isDirty || savingId === b.id}
                    className="px-4 py-2 text-sm rounded-lg bg-hampton-navy text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
                  >
                    {savingId === b.id ? 'Saving…' : savedFlash[b.id] ? 'Saved ✓' : 'Save'}
                  </button>
                  {b.photo_gallery_url && (
                    <a
                      href={b.photo_gallery_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-2 text-xs text-hampton-navy hover:underline"
                    >
                      Open ↗
                    </a>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-6">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="px-3 py-1.5 text-sm text-gray-500">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}
