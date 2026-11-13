'use client'

import { useState } from 'react'
import { EXTRA_ALT_MAX, MAX_EXTRA_IMAGES, type ExtraImageView } from '@/lib/evites/extraImages'

/**
 * The host's extra pictures on their invitation page (migration 101): thumbnails with Remove, and an
 * "Add a picture" control. Talks to `/api/portal/invitation/images`. Page-only: nothing is redrawn.
 * Never logs or displays a file name.
 */
const LOGIN = '/my-booking/login?next=/my-booking/invitation'
const API = '/api/portal/invitation/images'
const LABEL = 'block text-sm font-medium text-[#1a2744] mb-1'
const INPUT =
  'w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base text-[#1a2744] outline-none focus:ring-2 focus:ring-[#A1B5C8] focus:border-transparent'

interface Props {
  initial: ExtraImageView[]
  /** False until the invitation has rendered once (the upload needs its storage folder). */
  canAdd: boolean
  /** True once the party has happened: nothing can be added. */
  closed?: boolean
}

async function call(init: RequestInit): Promise<{ ok: boolean; data: Record<string, unknown> | null }> {
  try {
    const res = await fetch(API, { ...init, cache: 'no-store' })
    if (res.status === 401) window.location.href = LOGIN
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
    return { ok: res.ok, data }
  } catch {
    return { ok: false, data: null }
  }
}

export default function HostExtraImages({ initial, canAdd, closed = false }: Props) {
  const [images, setImages] = useState<ExtraImageView[]>(initial)
  const [alt, setAlt] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)

  const full = images.length >= MAX_EXTRA_IMAGES
  const apply = (r: { ok: boolean; data: Record<string, unknown> | null }, fallback: string, okText: string) => {
    if (r.ok && Array.isArray(r.data?.images)) {
      setImages(r.data.images as ExtraImageView[])
      setMsg({ tone: 'ok', text: okText })
      return true
    }
    setMsg({ tone: 'err', text: typeof r.data?.error === 'string' ? (r.data.error as string) : fallback })
    return false
  }

  async function add(file: File | null) {
    if (!file) return
    setBusy('add')
    setMsg(null)
    const form = new FormData()
    form.append('image', file)
    if (alt.trim()) form.append('alt', alt.trim())
    const r = await call({ method: 'POST', body: form })
    if (apply(r, 'Could not add that picture - try again.', 'Picture added. It shows on your guests’ page now.')) setAlt('')
    setBusy(null)
  }

  async function remove(object: string) {
    setBusy(object)
    setMsg(null)
    const r = await call({ method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ object }) })
    apply(r, 'Could not remove that picture - try again.', 'Picture removed.')
    setBusy(null)
  }

  return (
    <fieldset data-section="extra-images" className="mt-4 space-y-3 rounded-lg border border-gray-200 p-3">
      <legend className="px-1 text-sm font-medium text-[#1a2744]">Extra pictures (optional)</legend>
      <p className="text-xs text-gray-500">
        For things like &ldquo;Bring diapers to be entered into the raffle&rdquo;. They show on your guests&apos; page under the invitation, before the RSVP form.
        Up to {MAX_EXTRA_IMAGES}. They do not change your invitation picture.
      </p>

      {images.length > 0 && (
        <ul className="grid grid-cols-2 gap-3">
          {images.map((img) => (
            <li key={img.object} className="space-y-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt={img.alt} loading="lazy" className="h-32 w-full rounded-lg object-cover" data-extra-thumb="" />
              {img.alt && <p className="text-xs text-gray-500">{img.alt}</p>}
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void remove(img.object)}
                className="text-xs text-red-600 underline disabled:opacity-50"
              >
                {busy === img.object ? 'Removing...' : 'Remove'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {closed ? (
        <p className="text-xs text-gray-500">The party has happened, so pictures can no longer be added.</p>
      ) : !canAdd ? (
        <p className="text-xs text-gray-500">Your invitation picture is still being made. You can add pictures once it is ready.</p>
      ) : full ? (
        <p className="text-xs text-gray-500">That&apos;s the most ({MAX_EXTRA_IMAGES}). Remove one to add another.</p>
      ) : (
        <div className="space-y-2">
          <div>
            <label htmlFor="hi-extra-alt" className={LABEL}>
              What does it say? (optional)
            </label>
            <input
              id="hi-extra-alt"
              type="text"
              maxLength={EXTRA_ALT_MAX}
              value={alt}
              onChange={(e) => setAlt(e.target.value)}
              placeholder="Bring diapers to be entered into the raffle"
              className={INPUT}
            />
            <p className="mt-0.5 text-xs text-gray-400">Read aloud to guests who use a screen reader.</p>
          </div>
          <label className="flex min-h-[2.75rem] w-full cursor-pointer items-center justify-center rounded-lg border border-[#1a2744] px-4 py-2.5 text-sm font-medium text-[#1a2744] hover:bg-gray-50">
            {busy === 'add' ? 'Adding...' : 'Add a picture'}
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              disabled={busy !== null}
              data-testid="extra-image-file"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null
                e.target.value = ''
                void add(f)
              }}
            />
          </label>
        </div>
      )}

      {msg && (
        <p role={msg.tone === 'err' ? 'alert' : 'status'} className={`text-sm ${msg.tone === 'err' ? 'text-red-600' : 'text-green-700'}`}>
          {msg.text}
        </p>
      )}
    </fieldset>
  )
}
