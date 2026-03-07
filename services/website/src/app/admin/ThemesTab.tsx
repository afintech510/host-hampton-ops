'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Edit3, Archive, ChevronDown, ChevronUp, Loader2, X, Star, Upload, GripVertical } from 'lucide-react'

/* ─── Interfaces ─────────────────────────────────────── */

interface ThemeImage {
  url: string
  name: string
  is_primary: boolean
}

interface PartyTheme {
  id: string
  name: string
  slug: string
  price_cents: number
  tag: string | null
  description: string
  extended_description: string
  images: string[]
  sort_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

interface ThemeFormData {
  name: string
  slug: string
  priceDollars: string
  tag: string
  description: string
  extendedDescription: string
  images: ThemeImage[]
  sortOrder: string
  isActive: boolean
}

function emptyForm(): ThemeFormData {
  return {
    name: '', slug: '', priceDollars: '', tag: '',
    description: '', extendedDescription: '',
    images: [], sortOrder: '0', isActive: true,
  }
}

function toFormData(t: PartyTheme): ThemeFormData {
  const imgs: ThemeImage[] = (t.images || []).map((url: string, i: number) => ({
    url,
    name: url.split('/').pop() || `image-${i}`,
    is_primary: i === 0,
  }))
  return {
    name: t.name,
    slug: t.slug,
    priceDollars: t.price_cents > 0 ? (t.price_cents / 100).toString() : '',
    tag: t.tag || '',
    description: t.description || '',
    extendedDescription: t.extended_description || '',
    images: imgs,
    sortOrder: t.sort_order.toString(),
    isActive: t.is_active,
  }
}

/* ─── ThemesTab ──────────────────────────────────────── */

export default function ThemesTab({ headers, onLogout }: { headers: Record<string, string>; onLogout: () => void }) {
  const [themes, setThemes] = useState<PartyTheme[]>([])
  const [loading, setLoading] = useState(true)
  const [showInactive, setShowInactive] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const fetchThemes = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/admin/themes', { headers })
    if (res.status === 401) { onLogout(); return }
    const data = await res.json()
    setThemes(data.themes || [])
    setLoading(false)
  }, [headers.Authorization])

  useEffect(() => { fetchThemes() }, [fetchThemes])

  const filtered = showInactive ? themes : themes.filter(t => t.is_active)

  async function archiveTheme(id: string) {
    if (!confirm('Deactivate this theme? It will be hidden from the website.')) return
    await fetch(`/api/admin/themes/${id}`, { method: 'DELETE', headers })
    fetchThemes()
  }

  async function reactivateTheme(id: string) {
    await fetch(`/api/admin/themes/${id}`, {
      method: 'PUT', headers,
      body: JSON.stringify({ isActive: true }),
    })
    fetchThemes()
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      {/* Actions bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => { setShowCreate(!showCreate); setEditingId(null) }}
            className="btn-primary px-4 py-2 flex items-center gap-2 text-sm">
            <Plus className="w-4 h-4" /> New Theme
          </button>
          <label className="flex items-center gap-2 text-sm text-hampton-mauve cursor-pointer">
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} className="accent-hampton-navy" />
            Show inactive
          </label>
        </div>
        <p className="text-sm text-hampton-mauve">{filtered.length} theme{filtered.length !== 1 ? 's' : ''}</p>
      </div>

      {/* Create form */}
      {showCreate && !editingId && (
        <ThemeForm
          headers={headers}
          onSaved={() => { setShowCreate(false); fetchThemes() }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {/* Edit form */}
      {editingId && (
        <ThemeForm
          headers={headers}
          onSaved={() => { setEditingId(null); fetchThemes() }}
          onCancel={() => setEditingId(null)}
          existing={themes.find(t => t.id === editingId)}
        />
      )}

      {loading ? (
        <div className="text-center py-12"><Loader2 className="w-6 h-6 animate-spin mx-auto text-hampton-mauve" /></div>
      ) : filtered.length === 0 ? (
        <p className="text-center text-hampton-mauve py-12">No themes yet. Create your first one above!</p>
      ) : (
        <div className="space-y-3">
          {filtered.map(theme => (
            <div key={theme.id} className={`bg-white rounded-xl border ${theme.is_active ? 'border-hampton-pink/20' : 'border-gray-200 opacity-60'}`}>
              {/* Row */}
              <div
                className="flex items-center gap-3 sm:gap-4 p-3 sm:p-4 cursor-pointer"
                onClick={() => setExpandedId(expandedId === theme.id ? null : theme.id)}
              >
                {/* Thumbnail */}
                {theme.images?.[0] && (
                  <img src={theme.images[0]} alt="" className="w-12 h-12 sm:w-14 sm:h-14 rounded-lg object-cover shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 sm:gap-2 mb-1 flex-wrap">
                    <h3 className="font-semibold text-hampton-navy text-sm truncate">{theme.name}</h3>
                    {theme.tag && (
                      <span className="text-[10px] sm:text-xs bg-hampton-pink/20 text-hampton-navy px-1.5 sm:px-2 py-0.5 rounded-full">{theme.tag}</span>
                    )}
                    {!theme.is_active && <span className="text-[10px] sm:text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">Inactive</span>}
                  </div>
                  <div className="flex items-center gap-2 sm:gap-4 text-xs text-hampton-mauve">
                    <span className="font-medium">${(theme.price_cents / 100).toFixed(0)}</span>
                    <span className="hidden sm:inline truncate">{theme.description}</span>
                    <span className="sm:hidden truncate">{theme.slug}</span>
                  </div>
                </div>
                <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
                  <button onClick={e => { e.stopPropagation(); setEditingId(theme.id); setShowCreate(false) }}
                    className="p-1.5 sm:p-2 text-hampton-mauve hover:text-hampton-navy transition-colors" title="Edit">
                    <Edit3 className="w-4 h-4" />
                  </button>
                  {theme.is_active ? (
                    <button onClick={e => { e.stopPropagation(); archiveTheme(theme.id) }}
                      className="p-1.5 sm:p-2 text-hampton-mauve hover:text-red-600 transition-colors" title="Deactivate">
                      <Archive className="w-4 h-4" />
                    </button>
                  ) : (
                    <button onClick={e => { e.stopPropagation(); reactivateTheme(theme.id) }}
                      className="p-1.5 sm:p-2 text-green-600 hover:text-green-800 transition-colors text-xs font-medium" title="Reactivate">
                      Activate
                    </button>
                  )}
                  {expandedId === theme.id ? <ChevronUp className="w-4 h-4 text-hampton-mauve" /> : <ChevronDown className="w-4 h-4 text-hampton-mauve" />}
                </div>
              </div>

              {/* Expanded detail */}
              {expandedId === theme.id && (
                <div className="border-t border-hampton-pink/10 px-3 sm:px-4 py-4">
                  {/* Images */}
                  {theme.images?.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-4">
                      {theme.images.map((url: string, i: number) => (
                        <img key={i} src={url} alt={`${theme.name} ${i + 1}`} className="w-20 h-20 sm:w-24 sm:h-24 rounded-lg object-cover" />
                      ))}
                    </div>
                  )}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm mb-3">
                    <div>
                      <span className="text-xs text-hampton-mauve block mb-0.5">Slug</span>
                      <span className="font-mono text-xs text-hampton-navy">{theme.slug}</span>
                    </div>
                    <div>
                      <span className="text-xs text-hampton-mauve block mb-0.5">Price</span>
                      <span className="text-hampton-navy">${(theme.price_cents / 100).toFixed(0)}</span>
                    </div>
                    <div>
                      <span className="text-xs text-hampton-mauve block mb-0.5">Tag</span>
                      <span className="text-hampton-navy">{theme.tag || 'None'}</span>
                    </div>
                    <div>
                      <span className="text-xs text-hampton-mauve block mb-0.5">Sort Order</span>
                      <span className="text-hampton-navy">{theme.sort_order}</span>
                    </div>
                    <div>
                      <span className="text-xs text-hampton-mauve block mb-0.5">Images</span>
                      <span className="text-hampton-navy">{theme.images?.length || 0}</span>
                    </div>
                  </div>
                  {theme.description && (
                    <div className="mb-2">
                      <span className="text-xs text-hampton-mauve block mb-0.5">Short Description</span>
                      <p className="text-sm text-hampton-navy">{theme.description}</p>
                    </div>
                  )}
                  {theme.extended_description && (
                    <div>
                      <span className="text-xs text-hampton-mauve block mb-0.5">Extended Description</span>
                      <p className="text-sm text-hampton-navy">{theme.extended_description}</p>
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

/* ─── Theme Form (Create / Edit) ─────────────────────── */

function ThemeForm({
  headers, onSaved, onCancel, existing,
}: {
  headers: Record<string, string>
  onSaved: () => void
  onCancel: () => void
  existing?: PartyTheme
}) {
  const isEdit = !!existing
  const [form, setForm] = useState<ThemeFormData>(() => existing ? toFormData(existing) : emptyForm())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (k: string, v: unknown) => setForm(prev => ({ ...prev, [k]: v }))

  function handleNameChange(name: string) {
    const prevAutoSlug = form.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    set('name', name)
    if (!isEdit && (form.slug === '' || form.slug === prevAutoSlug)) {
      set('slug', name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Name is required'); return }
    setSaving(true); setError('')

    const imageUrls = form.images
      .sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0))
      .map(img => img.url)

    const payload = {
      name: form.name.trim(),
      slug: form.slug.trim(),
      priceCents: Math.round(parseFloat(form.priceDollars || '0') * 100),
      tag: form.tag.trim() || null,
      description: form.description.trim(),
      extendedDescription: form.extendedDescription.trim(),
      images: imageUrls,
      sortOrder: parseInt(form.sortOrder) || 0,
      isActive: form.isActive,
    }

    const url = isEdit ? `/api/admin/themes/${existing!.id}` : '/api/admin/themes'
    const method = isEdit ? 'PUT' : 'POST'

    const res = await fetch(url, { method, headers, body: JSON.stringify(payload) })
    if (!res.ok) {
      const data = await res.json()
      setError(data.error || `Failed to ${isEdit ? 'update' : 'create'} theme`)
      setSaving(false)
      return
    }

    onSaved()
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-hampton-pink/20 p-4 sm:p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-serif text-lg text-hampton-navy">{isEdit ? 'Edit Theme' : 'New Theme'}</h2>
        <button type="button" onClick={onCancel} className="text-hampton-mauve hover:text-hampton-navy"><X className="w-5 h-5" /></button>
      </div>

      {/* Name + Slug */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="form-label">Name *</label>
          <input value={form.name} onChange={e => handleNameChange(e.target.value)} className="form-input" required placeholder="e.g. Glow Party" />
        </div>
        <div>
          <label className="form-label">Slug</label>
          <input value={form.slug} onChange={e => set('slug', e.target.value)} className="form-input font-mono text-sm" placeholder="auto-generated" />
        </div>
      </div>

      {/* Price + Tag + Sort */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4">
        <div>
          <label className="form-label">Price ($)</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-hampton-mauve text-sm">$</span>
            <input type="number" step="1" min="0" value={form.priceDollars}
              onChange={e => set('priceDollars', e.target.value)}
              className="form-input pl-7" placeholder="850" />
          </div>
        </div>
        <div>
          <label className="form-label">Tag / Badge</label>
          <input value={form.tag} onChange={e => set('tag', e.target.value)} className="form-input" placeholder="e.g. Most Popular" />
        </div>
        <div>
          <label className="form-label">Sort Order</label>
          <input type="number" min="0" value={form.sortOrder} onChange={e => set('sortOrder', e.target.value)} className="form-input" />
        </div>
      </div>

      {/* Short Description */}
      <div className="mb-4">
        <label className="form-label">Short Description</label>
        <textarea value={form.description} onChange={e => set('description', e.target.value)} className="form-input" rows={2} placeholder="One-liner for the tile card" />
      </div>

      {/* Extended Description */}
      <div className="mb-4">
        <label className="form-label">Extended Description</label>
        <textarea value={form.extendedDescription} onChange={e => set('extendedDescription', e.target.value)} className="form-input" rows={4} placeholder="Full marketing copy shown when expanded" />
      </div>

      {/* Images */}
      <div className="mb-4">
        <label className="form-label">Images</label>
        <ImageUploader
          images={form.images}
          onChange={imgs => set('images', imgs)}
          token={headers.Authorization.replace('Bearer ', '')}
        />
      </div>

      {/* Active toggle */}
      <div className="flex items-center gap-2 mb-5">
        <input type="checkbox" checked={form.isActive} onChange={e => set('isActive', e.target.checked)} className="accent-hampton-navy" id="themeActive" />
        <label htmlFor="themeActive" className="text-sm text-hampton-mauve cursor-pointer">Active (visible on website)</label>
      </div>

      {error && <p className="text-red-600 text-sm mb-3 bg-red-50 p-2 rounded">{error}</p>}

      <div className="flex gap-3">
        <button type="submit" disabled={saving} className="btn-primary px-6 py-2 flex items-center gap-2 text-sm">
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Theme'}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary px-6 py-2 text-sm">Cancel</button>
      </div>
    </form>
  )
}

/* ─── Image Uploader (reuses /api/admin/events/upload) ── */

function ImageUploader({
  images, onChange, token,
}: {
  images: ThemeImage[]; onChange: (imgs: ThemeImage[]) => void; token: string
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
      } catch {
        errors.push(`Network error uploading ${file.name}`)
      }
    }

    if (errors.length > 0) setUploadError(errors.join('. '))
    onChange(newImages)
    setUploading(false)
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
        <div className="flex flex-wrap gap-2 sm:gap-3 mb-3">
          {images.map((img, i) => (
            <div key={i} className={`relative group rounded-lg overflow-hidden border-2 ${img.is_primary ? 'border-hampton-navy' : 'border-transparent'}`}>
              <img src={img.url} alt={img.name} className="w-20 h-20 sm:w-24 sm:h-24 object-cover" />
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
        <input value={urlInput} onChange={e => setUrlInput(e.target.value)} className="form-input flex-1 text-sm" placeholder="Or paste image URL..."
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addUrl() } }} />
        <button type="button" onClick={addUrl} className="text-xs text-hampton-navy hover:underline whitespace-nowrap">Add URL</button>
      </div>
    </div>
  )
}
