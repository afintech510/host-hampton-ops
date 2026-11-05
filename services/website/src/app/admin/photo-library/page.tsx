'use client'

/**
 * /admin/photo-library — the photo library's tagging grid. Muse's photos land
 * here as candidates; a photo is served to customers only once it is APPROVED
 * and marked as showing no identifiable child. Look at each one before you
 * approve it. Approval is always a click or a key press here, never automatic.
 *
 * Keys (when you are not typing in a box):
 *   j / ↓  next        k / ↑  previous     x / space  select or unselect
 *   a  approve this one      w  withdraw this one      c  a child is visible (clears the face check, withdraws approval)
 *   Shift+A  approve everything selected      ?  show or hide this list
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BTN_GHOST, BTN_PRIMARY, Banner, INPUT, LoginGate, useAdminApi } from '../crew/_components/adminCrew'
import { ACTIVITY_TAGS, THEME_TAGS } from '@/lib/mediaVocab'

interface Photo {
  id: string; source: string; url: string; alt: string; party_type: string | null; venue: string | null; theme_slug: string | null
  activities: string[]; decor_tags: string[]; ig_permalink: string | null; posted_at: string | null; quality: number | null
  tag_confidence: string | null; notes: string | null; no_identifiable_faces: boolean; approved: boolean; approved_by: string | null
  media_kind: 'photo' | 'reel' | 'video_still'; review_flag: string | null
}

interface Facets {
  sources: Record<string, number>; kinds: Record<string, number>; partyTypes: Record<string, number>; themes: Record<string, number>
  activities: Record<string, number>; decor: Record<string, number>; flagged: number; unknown: string[]
}

type Status = 'candidates' | 'approved' | 'all'
type Sort = 'newest' | 'confidence' | 'quality'
interface Filters { source: string; kind: string; party_type: string; theme: string; activity: string; flagged: boolean; sort: Sort }
const NO_FILTERS: Filters = { source: '', kind: '', party_type: '', theme: '', activity: '', flagged: false, sort: 'confidence' }
const PAGE = 60
const TOKEN_KEY = 'hh_admin_token'

const KIND_LABEL: Record<Photo['media_kind'], string> = { photo: 'photo', reel: 'reel thumbnail', video_still: 'video still' }

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Record<string, number> | undefined }) {
  const entries = Object.entries(options ?? {}).sort((a, b) => b[1] - a[1])
  return (
    <select className={INPUT} value={value} onChange={e => onChange(e.target.value)} aria-label={label}>
      <option value="">{label}: all</option>
      {entries.map(([k, n]) => <option key={k} value={k}>{k} ({n})</option>)}
    </select>
  )
}

export default function AdminPhotoLibraryPage() {
  const api = useAdminApi()
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [status, setStatus] = useState<Status>('candidates')
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [total, setTotal] = useState(0)
  const [facets, setFacets] = useState<Facets | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [focusId, setFocusId] = useState<string | null>(null)
  const [help, setHelp] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const query = useMemo(() => {
    const p = new URLSearchParams({ status, sort: filters.sort })
    if (filters.source) p.set('source', filters.source)
    if (filters.kind) p.set('kind', filters.kind)
    if (filters.party_type) p.set('party_type', filters.party_type)
    if (filters.theme) p.set('theme', filters.theme)
    if (filters.activity) p.set('activity', filters.activity)
    if (filters.flagged) p.set('flagged', '1')
    return p.toString()
  }, [status, filters])

  const load = useCallback(async (more = false): Promise<'ok' | 'unauthorized' | 'error'> => {
    const offset = more ? photos.length : 0
    const r = await api<{ photos?: Photo[]; total?: number; error?: string }>(`/api/admin/photo-library?${query}&limit=${PAGE}&offset=${offset}`)
    if (r.status === 401) { setAuthed(false); return 'unauthorized' }
    setAuthed(true)
    if (!r.ok) { setError(r.data.error || 'Could not read the library.'); return 'error' }
    setError('')
    setTotal(r.data.total ?? 0)
    setPhotos(prev => (more ? [...prev, ...(r.data.photos ?? [])] : r.data.photos ?? []))
    return 'ok'
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, query, photos.length])

  const loadFacets = useCallback(async () => {
    const r = await api<{ facets?: Facets }>(`/api/admin/photo-library?facets=1&status=${status}`)
    if (r.ok && r.data.facets) setFacets(r.data.facets)
  }, [api, status])

  useEffect(() => { void load(false); void loadFacets(); setSelected(new Set()) }, [query]) // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(async () => { await load(false); await loadFacets() }, [load, loadFacets])

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(id)
    const r = await api<{ error?: string }>('/api/admin/photo-library', { method: 'PATCH', body: { id, ...body } })
    setBusy(null)
    if (!r.ok) { setError(r.data.error || 'Could not save.'); return false }
    setError('')
    await refresh()
    return true
  }

  async function bulk(approved: boolean, ids: string[]) {
    if (ids.length === 0) return
    const verb = approved ? 'Approve' : 'Withdraw'
    if (!window.confirm(`${verb} ${ids.length} photo${ids.length === 1 ? '' : 's'}?${approved ? '\n\nOnly approve photos you have looked at. Customers will be able to see them.' : ''}`)) return
    setBusy('bulk')
    const r = await api<{ error?: string; changed?: string[]; unchanged?: string[] }>('/api/admin/photo-library', { method: 'PATCH', body: { ids, approved } })
    setBusy(null)
    if (!r.ok) { setError(r.data.error || 'Could not save.'); return }
    setError('')
    const left = r.data.unchanged?.length ?? 0
    setNotice(`${approved ? 'Approved' : 'Withdrew'} ${r.data.changed?.length ?? 0}${left ? `; ${left} left unchanged (already ${approved ? 'approved' : 'withdrawn'}, or the face check is not set)` : ''}.`)
    setSelected(new Set())
    await refresh()
  }

  const toggle = useCallback((id: string) => setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n }), [])

  // Keyboard review. Ignored while typing, and with any modifier except Shift.
  const stateRef = useRef({ photos, focusId, selected })
  stateRef.current = { photos, focusId, selected }
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const { photos: ps, focusId: fid, selected: sel } = stateRef.current
      if (ps.length === 0) return
      const i = Math.max(0, ps.findIndex(p => p.id === fid))
      const cur = ps.find(p => p.id === fid)
      const move = (to: number) => { const p = ps[Math.max(0, Math.min(ps.length - 1, to))]; setFocusId(p.id); document.getElementById(`photo-${p.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }) }
      switch (e.key) {
        case 'j': case 'ArrowDown': e.preventDefault(); move(fid ? i + 1 : 0); break
        case 'k': case 'ArrowUp': e.preventDefault(); move(fid ? i - 1 : 0); break
        case 'x': case ' ': if (cur) { e.preventDefault(); toggle(cur.id) } break
        case 'a': if (cur && !cur.approved && cur.no_identifiable_faces) { e.preventDefault(); void patch(cur.id, { approved: true }) } break
        case 'w': if (cur && cur.approved) { e.preventDefault(); void patch(cur.id, { approved: false }) } break
        case 'c': if (cur) { e.preventDefault(); void patch(cur.id, { no_identifiable_faces: false }) } break
        case 'A': {
          e.preventDefault()
          const ok = ps.filter(p => sel.has(p.id) && p.no_identifiable_faces && !p.approved).map(p => p.id)
          void bulk(true, ok)
          break
        }
        case '?': setHelp(h => !h); break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toggle])

  async function importCsv(file: File) {
    setNotice('Importing… (each photo is downloaded and converted, this can take a minute)')
    const csv = await file.text()
    const r = await api<{ error?: string; imported?: number; updated?: number; skipped?: { reason: string; count: number }[]; failed?: string[]; unknownTags?: string[] }>('/api/admin/photo-library/import', { method: 'POST', body: { csv } })
    if (!r.ok) { setNotice(''); setError(r.data.error || 'Import failed.'); return }
    setError('')
    const sk = (r.data.skipped ?? []).map(s => `${s.count} ${s.reason}`).join('; ')
    const unk = r.data.unknownTags?.length ? ` Unrecognised tags: ${r.data.unknownTags.join(', ')}.` : ''
    setNotice(`${r.data.imported} new, ${r.data.updated} re-tagged${sk ? `. Skipped: ${sk}` : ''}${r.data.failed?.length ? `. ${r.data.failed.length} failed.` : '.'}${unk}`)
    await refresh()
  }

  async function seedGallery() {
    const r = await api<{ error?: string; added?: number }>('/api/admin/photo-library/import', { method: 'POST', body: { source: 'gallery' } })
    if (!r.ok) setError(r.data.error || 'Could not seed.')
    else { setNotice(`Gallery photos added: ${r.data.added}.`); await refresh() }
  }

  if (authed === null) return <div className="min-h-screen bg-[#F6F1EB] grid place-items-center text-hampton-navy/60">Loading…</div>
  if (!authed) return <LoginGate title="Photo library" onSignedIn={() => load(false)} />

  const setF = (k: keyof Filters) => (v: string | boolean) => setFilters(f => ({ ...f, [k]: v }))
  const selectable = photos.filter(p => p.no_identifiable_faces && !p.approved)
  const selectedApprovable = photos.filter(p => selected.has(p.id) && p.no_identifiable_faces && !p.approved)
  const selectedApproved = photos.filter(p => selected.has(p.id) && p.approved)

  return (
    <div className="min-h-screen bg-[#F6F1EB] px-4 sm:px-5 py-8">
      <div className="max-w-7xl mx-auto">
        <a href="/admin" className="text-hampton-navy/50 hover:text-hampton-navy text-sm">← Admin</a>
        <h1 className="font-serif text-3xl text-hampton-navy mt-2">Photo library</h1>
        <p className="text-hampton-navy/60 text-sm mt-1">Customers only ever see photos that are approved AND marked as showing no identifiable child. Press <kbd className="px-1 border rounded">?</kbd> for keyboard shortcuts.</p>
        {error && <div className="mt-4"><Banner tone="error">{error}</Banner></div>}
        {notice && <div className="mt-4"><Banner tone="ok">{notice}</Banner></div>}
        {help && (
          <div className="mt-4"><Banner tone="info">
            <b>j / ↓</b> next · <b>k / ↑</b> previous · <b>x / space</b> select · <b>a</b> approve this one · <b>w</b> withdraw this one · <b>c</b> a child is visible (clears the check) · <b>Shift+A</b> approve everything selected · <b>?</b> this list
          </Banner></div>
        )}
        {facets && facets.unknown.length > 0 && (
          <div className="mt-4"><Banner tone="warn">Tags in no vocabulary yet (kept as written; they still filter, but the assistant will not guess them): {facets.unknown.join(', ')}</Banner></div>
        )}

        <div className="flex flex-wrap items-center gap-2 my-5">
          {(['candidates', 'approved', 'all'] as Status[]).map(s => (
            <button key={s} onClick={() => setStatus(s)} className={status === s ? BTN_PRIMARY : BTN_GHOST}>{s}</button>
          ))}
          <label className={`${BTN_GHOST} cursor-pointer ml-auto`}>
            Import Muse CSV (Instagram)
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void importCsv(f); e.target.value = '' }} />
          </label>
          <button onClick={seedGallery} className={BTN_GHOST}>Add /gallery photos</button>
        </div>

        <AlbumImport onDone={refresh} setNotice={setNotice} setError={setError} />

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Select label="Source" value={filters.source} onChange={setF('source')} options={facets?.sources} />
          <Select label="Kind" value={filters.kind} onChange={setF('kind')} options={facets?.kinds} />
          <Select label="Party type" value={filters.party_type} onChange={setF('party_type')} options={facets?.partyTypes} />
          <Select label="Theme" value={filters.theme} onChange={setF('theme')} options={facets?.themes} />
          <Select label="Activity" value={filters.activity} onChange={setF('activity')} options={facets?.activities} />
          <label className="text-sm text-hampton-navy flex items-center gap-1">
            <input type="checkbox" checked={filters.flagged} onChange={e => setF('flagged')(e.target.checked)} /> Needs a second look{facets ? ` (${facets.flagged})` : ''}
          </label>
          <select className={INPUT} value={filters.sort} onChange={e => setF('sort')(e.target.value)} aria-label="Sort">
            <option value="confidence">Sort: Muse&apos;s confidence</option>
            <option value="quality">Sort: quality</option>
            <option value="newest">Sort: newest</option>
          </select>
          {(Object.values(filters).some(v => v && v !== 'confidence')) && <button className={BTN_GHOST} onClick={() => setFilters(NO_FILTERS)}>Clear filters</button>}
        </div>

        <div className="sticky top-0 z-10 bg-[#F6F1EB]/95 py-2 flex flex-wrap items-center gap-2 text-sm text-hampton-navy">
          <span>{photos.length} of {total} shown · {selected.size} selected</span>
          <button className={BTN_GHOST} onClick={() => setSelected(new Set(selectable.map(p => p.id)))} disabled={selectable.length === 0}>Select all shown with the face check ({selectable.length})</button>
          <button className={BTN_GHOST} onClick={() => setSelected(new Set())} disabled={selected.size === 0}>Clear selection</button>
          <button className={BTN_PRIMARY} disabled={busy === 'bulk' || selectedApprovable.length === 0} onClick={() => void bulk(true, selectedApprovable.map(p => p.id))}>
            Approve selected ({selectedApprovable.length})
          </button>
          <button className={BTN_GHOST} disabled={busy === 'bulk' || selectedApproved.length === 0} onClick={() => void bulk(false, selectedApproved.map(p => p.id))}>
            Withdraw selected ({selectedApproved.length})
          </button>
        </div>

        {photos.length === 0 ? <p className="text-hampton-navy/60 mt-4">Nothing here.</p> : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 mt-3">
            {photos.map(p => (
              <div key={p.id} id={`photo-${p.id}`} onClick={() => setFocusId(p.id)}
                className={`bg-white rounded-2xl shadow-sm overflow-hidden ${focusId === p.id ? 'ring-4 ring-hampton-navy/60' : ''} ${selected.has(p.id) ? 'outline outline-4 outline-sky-400' : ''}`}>
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={p.alt} loading="lazy" className="w-full h-56 object-cover bg-[#F6F1EB]" />
                  <label className="absolute top-2 left-2 bg-white/90 rounded-md px-2 py-1 text-xs flex items-center gap-1 cursor-pointer" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} /> select
                  </label>
                  <div className="absolute top-2 right-2 flex gap-1 flex-wrap justify-end">
                    <span className="bg-white/90 rounded-md px-2 py-0.5 text-[11px]">{p.source}</span>
                    {p.media_kind !== 'photo' && <span className="bg-violet-100 text-violet-800 rounded-md px-2 py-0.5 text-[11px]">{KIND_LABEL[p.media_kind]}</span>}
                    {p.review_flag && <span className="bg-red-100 text-red-700 rounded-md px-2 py-0.5 text-[11px]" title={p.review_flag}>look twice</span>}
                  </div>
                </div>
                <div className="p-4 space-y-2 text-sm">
                  <p className="text-hampton-navy">{p.alt || <em>No description</em>}</p>
                  <p className="text-xs text-hampton-navy/60">
                    {[p.party_type, p.venue, p.theme_slug, ...p.activities, ...p.decor_tags].filter(Boolean).join(' · ') || 'no tags'}
                  </p>
                  <p className="text-xs text-hampton-navy/60">
                    quality {p.quality ?? '–'} · Muse confidence {p.tag_confidence ?? '–'}{p.posted_at ? ` · ${p.posted_at}` : ''}
                    {p.approved && p.approved_by ? ` · approved by ${p.approved_by}` : ''}
                  </p>
                  {p.review_flag && <p className="text-xs text-red-700">{p.review_flag}: check the picture for a name or age before approving.</p>}
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
                    {p.ig_permalink && <a href={p.ig_permalink} target="_blank" rel="noopener noreferrer" className="text-xs underline text-hampton-navy/60">{p.media_kind === 'reel' ? 'Instagram reel' : 'Instagram'}</a>}
                  </div>
                  <div className="flex flex-col gap-2">
                    <input className={INPUT} defaultValue={p.theme_slug ?? ''} placeholder="theme-slug" list="theme-tags"
                      onBlur={e => { const v = e.target.value.trim().toLowerCase() || null; if (v !== p.theme_slug) void patch(p.id, { theme_slug: v }) }} />
                    <input className={INPUT} defaultValue={p.activities.join(', ')} placeholder="activities, comma separated" list="activity-tags"
                      onBlur={e => {
                        const v = e.target.value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
                        if (v.join(',') !== p.activities.join(',')) void patch(p.id, { activities: v })
                      }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {photos.length < total && (
          <div className="mt-6 text-center"><button className={BTN_GHOST} onClick={() => void load(true)}>Show {Math.min(PAGE, total - photos.length)} more</button></div>
        )}
        <datalist id="theme-tags">{THEME_TAGS.map(t => <option key={t} value={t} />)}</datalist>
        <datalist id="activity-tags">{Object.keys(ACTIVITY_TAGS).map(t => <option key={t} value={t} />)}</datalist>
      </div>
    </div>
  )
}

/* ── Phone-album import: a folder of pictures + Muse's CSV, uploaded one by one ───── */

interface PlanItem { item: string; sourceKey: string; exists: boolean; flag: string | null; kind: string; row: Record<string, string> }
interface Plan { rows: number; skipped: { reason: string; count: number }[]; accepted: PlanItem[] }

/** Shrink a big photo in the browser (also drops its EXIF). The server re-encodes and strips metadata regardless. */
async function shrink(file: File): Promise<Blob> {
  if (file.size <= 900 * 1024) return file
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale)
    c.getContext('2d')?.drawImage(bmp, 0, 0, c.width, c.height)
    const blob = await new Promise<Blob | null>(res => c.toBlob(res, 'image/jpeg', 0.85))
    return blob ?? file
  } catch {
    return file
  }
}

function AlbumImport({ onDone, setNotice, setError }: { onDone: () => Promise<void>; setNotice: (s: string) => void; setError: (s: string) => void }) {
  const api = useAdminApi()
  const [open, setOpen] = useState(false)
  const [csv, setCsv] = useState<string>('')
  const [files, setFiles] = useState<File[]>([])
  const [keepDupes, setKeepDupes] = useState(false)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [progress, setProgress] = useState<string>('')
  const [running, setRunning] = useState(false)
  const stop = useRef(false)

  const byName = useMemo(() => {
    const m = new Map<string, File>()
    for (const f of files) m.set(((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name).toLowerCase(), f)
    return m
  }, [files])
  const fileFor = useCallback((item: string): File | undefined => {
    const want = item.toLowerCase()
    const base = want.slice(want.lastIndexOf('/') + 1)
    for (const [k, f] of Array.from(byName)) if (k === want || k.endsWith(`/${want}`)) return f
    for (const [k, f] of Array.from(byName)) if (k.slice(k.lastIndexOf('/') + 1) === base) return f
    return undefined
  }, [byName])

  async function check() {
    setPlan(null); setError('')
    const r = await api<Plan & { error?: string }>('/api/admin/photo-library/album', { method: 'POST', body: { csv, keepDuplicates: keepDupes } })
    if (!r.ok) { setError(r.data.error || 'Could not check the CSV.'); return }
    setPlan(r.data)
  }

  async function run() {
    if (!plan) return
    const todo = plan.accepted.filter(a => !a.exists)
    stop.current = false; setRunning(true)
    let done = 0, retagged = 0; const failed: string[] = []; const missing: string[] = []
    const token = localStorage.getItem(TOKEN_KEY)
    // Re-tag rows already in the library first (no file needed), then upload the rest.
    for (const a of plan.accepted.filter(x => x.exists)) {
      const fd = new FormData(); fd.set('row', JSON.stringify(a.row)); fd.set('file', new File([], 'none.jpg'))
      const res = await fetch('/api/admin/photo-library/album', { method: 'POST', body: fd, headers: token ? { Authorization: `Bearer ${token}` } : {} }).catch(() => null)
      if (res?.ok) retagged++
    }
    for (let i = 0; i < todo.length; i++) {
      if (stop.current) break
      const a = todo[i]
      setProgress(`Uploading ${i + 1} of ${todo.length}: ${a.item}`)
      const f = fileFor(a.item)
      if (!f) { missing.push(a.item); continue }
      const fd = new FormData()
      fd.set('row', JSON.stringify(a.row))
      fd.set('file', await shrink(f), f.name)
      const res = await fetch('/api/admin/photo-library/album', { method: 'POST', body: fd, headers: token ? { Authorization: `Bearer ${token}` } : {} }).catch(() => null)
      const j = res ? await res.json().catch(() => ({})) : {}
      if (res?.ok && j.kind === 'imported') done++
      else failed.push(`${a.item}: ${j.error || j.reason || 'failed'}`)
    }
    setRunning(false); setProgress('')
    setNotice(`Album: ${done} new candidates, ${retagged} re-tagged${missing.length ? `, ${missing.length} files not found in the folder (${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''})` : ''}${failed.length ? `, ${failed.length} failed (${failed.slice(0, 3).join('; ')})` : ''}${stop.current ? ' — stopped early' : ''}.`)
    await onDone()
  }

  const matched = plan ? plan.accepted.filter(a => !a.exists && fileFor(a.item)).length : 0
  const pending = plan ? plan.accepted.filter(a => !a.exists).length : 0

  return (
    <div className="mb-5">
      <button className={BTN_GHOST} onClick={() => setOpen(o => !o)}>{open ? 'Hide' : 'Import a phone album'} (folder of photos + Muse CSV)</button>
      {open && (
        <div className="bg-white rounded-2xl shadow-sm p-4 mt-3 space-y-3 text-sm text-hampton-navy">
          <p className="text-hampton-navy/70">Pick Muse&apos;s CSV, then the folder holding the photos (the file names in the CSV, such as <code>items/001.jpg</code>, are matched inside it). Photos are cleaned of location data and stored as candidates; nothing is approved.</p>
          <div className="flex flex-wrap items-center gap-3">
            <label className={`${BTN_GHOST} cursor-pointer`}>1. CSV{csv ? ' ✓' : ''}
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={async e => { const f = e.target.files?.[0]; if (f) { setCsv(await f.text()); setPlan(null) } }} />
            </label>
            <label className={`${BTN_GHOST} cursor-pointer`}>2. Photo folder{files.length ? ` ✓ (${files.length} files)` : ''}
              <input type="file" multiple className="hidden" {...({ webkitdirectory: '' } as object)} onChange={e => { setFiles(Array.from(e.target.files ?? [])); setPlan(null) }} />
            </label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={keepDupes} onChange={e => { setKeepDupes(e.target.checked); setPlan(null) }} /> keep near-identical duplicates</label>
            <button className={BTN_PRIMARY} disabled={!csv || running} onClick={() => void check()}>3. Check</button>
          </div>
          {plan && (
            <div className="space-y-1">
              <p><b>{plan.accepted.length}</b> of {plan.rows} rows pass ({plan.accepted.filter(a => a.exists).length} already in the library, {pending} new; {plan.accepted.filter(a => a.flag).length} flagged to look twice). Photos found in the folder for the new ones: <b>{matched}</b> of {pending}.</p>
              {plan.skipped.length > 0 && <p className="text-hampton-navy/60">Skipped: {plan.skipped.map(s => `${s.count} ${s.reason}`).join('; ')}.</p>}
              <div className="flex gap-2 items-center">
                <button className={BTN_PRIMARY} disabled={running || pending === 0 || matched === 0} onClick={() => void run()}>4. Upload {matched} photos</button>
                {running && <button className={BTN_GHOST} onClick={() => { stop.current = true }}>Stop</button>}
                {progress && <span className="text-hampton-navy/60">{progress}</span>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
