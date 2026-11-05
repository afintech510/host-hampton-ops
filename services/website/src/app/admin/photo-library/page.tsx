'use client'

/**
 * /admin/media — the photo library's tagging grid. Muse's Instagram photos land
 * here as candidates; a photo is served to customers only once it is APPROVED
 * and marked as showing no identifiable child. Look at each one before you tick
 * both.
 */

import { useCallback, useEffect, useState } from 'react'
import { BTN_GHOST, BTN_PRIMARY, Banner, INPUT, LoginGate, useAdminApi } from '../crew/_components/adminCrew'

interface Photo {
  id: string; source: string; url: string; alt: string; party_type: string | null; venue: string | null; theme_slug: string | null
  activities: string[]; decor_tags: string[]; ig_permalink: string | null; posted_at: string | null; quality: number | null
  notes: string | null; no_identifiable_faces: boolean; approved: boolean
}

type Status = 'candidates' | 'approved' | 'all'

export default function AdminMediaPage() {
  const api = useAdminApi()
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [status, setStatus] = useState<Status>('candidates')
  const [photos, setPhotos] = useState<Photo[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async (): Promise<'ok' | 'unauthorized' | 'error'> => {
    const r = await api<{ photos?: Photo[]; error?: string }>(`/api/admin/photo-library?status=${status}`)
    if (r.status === 401) { setAuthed(false); return 'unauthorized' }
    setAuthed(true)
    if (!r.ok) { setError(r.data.error || 'Could not read the library.'); return 'error' }
    setError('')
    setPhotos(r.data.photos ?? [])
    return 'ok'
  }, [api, status])
  useEffect(() => { void load() }, [load])

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(id)
    const r = await api<{ error?: string }>('/api/admin/photo-library', { method: 'PATCH', body: { id, ...body } })
    setBusy(null)
    if (!r.ok) setError(r.data.error || 'Could not save.')
    else { setError(''); await load() }
  }

  async function importCsv(file: File) {
    setNotice('Importing… (each photo is downloaded and converted, this can take a minute)')
    const csv = await file.text()
    const r = await api<{ error?: string; imported?: number; updated?: number; skipped?: { reason: string; count: number }[]; failed?: string[] }>('/api/admin/photo-library/import', { method: 'POST', body: { csv } })
    if (!r.ok) { setNotice(''); setError(r.data.error || 'Import failed.'); return }
    setError('')
    const sk = (r.data.skipped ?? []).map(s => `${s.count} ${s.reason}`).join('; ')
    setNotice(`${r.data.imported} new, ${r.data.updated} re-tagged${sk ? `. Skipped: ${sk}` : ''}${r.data.failed?.length ? `. ${r.data.failed.length} failed.` : '.'}`)
    await load()
  }

  async function seedGallery() {
    const r = await api<{ error?: string; added?: number }>('/api/admin/photo-library/import', { method: 'POST', body: { source: 'gallery' } })
    if (!r.ok) setError(r.data.error || 'Could not seed.')
    else { setNotice(`Gallery photos added: ${r.data.added}.`); await load() }
  }

  if (authed === null) return <div className="min-h-screen bg-[#F6F1EB] grid place-items-center text-hampton-navy/60">Loading…</div>
  if (!authed) return <LoginGate title="Photo library" onSignedIn={load} />

  return (
    <div className="min-h-screen bg-[#F6F1EB] px-4 sm:px-5 py-8">
      <div className="max-w-6xl mx-auto">
        <a href="/admin" className="text-hampton-navy/50 hover:text-hampton-navy text-sm">← Admin</a>
        <h1 className="font-serif text-3xl text-hampton-navy mt-2">Photo library</h1>
        <p className="text-hampton-navy/60 text-sm mt-1">Customers only ever see photos that are approved AND marked as showing no identifiable child.</p>
        {error && <div className="mt-4"><Banner tone="error">{error}</Banner></div>}
        {notice && <div className="mt-4"><Banner tone="ok">{notice}</Banner></div>}

        <div className="flex flex-wrap items-center gap-2 my-5">
          {(['candidates', 'approved', 'all'] as Status[]).map(s => (
            <button key={s} onClick={() => setStatus(s)} className={status === s ? BTN_PRIMARY : BTN_GHOST}>{s}</button>
          ))}
          <label className={`${BTN_GHOST} cursor-pointer ml-auto`}>
            Import Muse CSV
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void importCsv(f); e.target.value = '' }} />
          </label>
          <button onClick={seedGallery} className={BTN_GHOST}>Add /gallery photos</button>
        </div>

        {photos.length === 0 ? <p className="text-hampton-navy/60">Nothing here.</p> : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {photos.map(p => (
              <div key={p.id} className="bg-white rounded-2xl shadow-sm overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={p.alt} loading="lazy" className="w-full h-56 object-cover bg-[#F6F1EB]" />
                <div className="p-4 space-y-2 text-sm">
                  <p className="text-hampton-navy">{p.alt || <em>No description</em>}</p>
                  <p className="text-xs text-hampton-navy/60">
                    {[p.party_type, p.venue, p.theme_slug, ...p.activities, ...p.decor_tags].filter(Boolean).join(' · ') || 'no tags'}
                    {p.quality ? ` · quality ${p.quality}` : ''}
                  </p>
                  {p.notes && <p className="text-xs text-hampton-navy/50">{p.notes}</p>}
                  <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={p.no_identifiable_faces} disabled={busy === p.id}
                      onChange={e => patch(p.id, { no_identifiable_faces: e.target.checked })} />
                    No identifiable child in this photo
                  </label>
                  <div className="flex flex-wrap gap-2 items-center">
                    <button className={p.approved ? BTN_GHOST : BTN_PRIMARY} disabled={busy === p.id || (!p.approved && !p.no_identifiable_faces)}
                      onClick={() => patch(p.id, { approved: !p.approved })}>
                      {p.approved ? 'Withdraw' : 'Approve'}
                    </button>
                    {p.ig_permalink && <a href={p.ig_permalink} target="_blank" rel="noopener noreferrer" className="text-xs underline text-hampton-navy/60">Instagram</a>}
                    <input className={`${INPUT} flex-1 min-w-[8rem]`} defaultValue={p.theme_slug ?? ''} placeholder="theme-slug"
                      onBlur={e => { const v = e.target.value.trim().toLowerCase() || null; if (v !== p.theme_slug) void patch(p.id, { theme_slug: v }) }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
