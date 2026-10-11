'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import type { HostPayload } from '@/lib/evites/hostView'
import {
  formFromCustomize,
  isIosUserAgent,
  patchFromForm,
  pollIntervalMs,
  shareGate,
  shareMessage,
  smsHref,
  type HostFormState,
} from '@/lib/evites/hostUi'
import { HostInvitationView } from './HostInvitationView'

/**
 * The host page's interactive half (spec §7.2). Everything it DECIDES lives in
 * `lib/evites/hostUi.ts` and everything it DRAWS in `HostInvitationView`; this file owns only
 * the browser: polling, the customise form's state, Web Share, the clipboard, `fetch`.
 *
 * - Polls `GET /api/portal/invitation` every 30 s while the tab is visible (every 5 s while a
 *   redraw the host just asked for is in flight), pauses when hidden and polls once the moment
 *   the tab comes back. The form's text is its own state: a poll replaces the RSVPs, the state
 *   and the share gate, never what the host is typing.
 * - After a save it asks the server component to re-render (`router.refresh()`), so the canvas
 *   - which is drawn on the server from the same facts the picture is - shows the new details.
 * - A 401 anywhere sends the host back through sign-in and returns them here (`?next=`); a 404
 *   means the invitation went away (cancelled, switched off) and says so.
 */

const LOGIN = '/my-booking/login?next=/my-booking/invitation'

interface Props {
  initial: HostPayload
  /** The server-drawn canvas inside its frame. */
  preview: ReactNode
}

function trackShare(): void {
  void fetch('/api/portal/invitation/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: 'share_clicked' }),
    keepalive: true,
  }).catch(() => undefined)
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the selection fallback
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

export default function HostInvitation({ initial, preview }: Props) {
  const router = useRouter()
  const [data, setData] = useState<HostPayload>(initial)
  const [gone, setGone] = useState(false)
  const [form, setForm] = useState<HostFormState>(() => formFromCustomize(initial.customize))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [formError, setFormError] = useState<{ field: string | null; message: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [designSaving, setDesignSaving] = useState<string | null>(null)
  const [designError, setDesignError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/portal/invitation', { cache: 'no-store' })
      if (res.status === 401) {
        window.location.href = LOGIN
        return
      }
      if (res.status === 404) {
        setGone(true)
        return
      }
      if (!res.ok) return // keep what is on screen; the next tick tries again
      setData((await res.json()) as HostPayload)
    } catch {
      // offline or a blip: keep what is on screen
    }
  }, [])

  // ---- polling: only while the tab is visible
  const interval = pollIntervalMs(data.state, data.renderFresh)
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null
    const stop = () => {
      if (timer) clearInterval(timer)
      timer = null
    }
    const start = () => {
      stop()
      timer = setInterval(() => void refresh(), interval)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refresh()
        start()
      } else {
        stop()
      }
    }
    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [interval, refresh])

  // The preview is the STORED picture (drawn on the server). When a redraw lands - `renderFresh` going
  // false -> true on a poll - ask for the page again so the new picture replaces the old one.
  const fresh = data.renderFresh
  const [wasFresh, setWasFresh] = useState(fresh)
  useEffect(() => {
    if (fresh && !wasFresh) router.refresh()
    setWasFresh(fresh)
  }, [fresh, wasFresh, router])

  const dirty = Object.keys(patchFromForm(form, data.customize)).length > 0

  async function save() {
    const patch = patchFromForm(form, data.customize)
    if (Object.keys(patch).length === 0) return
    setSaving(true)
    setSaved(false)
    setFormError(null)
    try {
      const res = await fetch('/api/portal/invitation', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (res.status === 401) {
        window.location.href = LOGIN
        return
      }
      const body = (await res.json().catch(() => null)) as (HostPayload & { error?: string; field?: string }) | null
      if (!res.ok || !body) {
        setFormError({ field: body?.field ?? null, message: body?.error ?? 'Could not save your changes - try again.' })
        return
      }
      setData(body)
      setForm(formFromCustomize(body.customize))
      setSaved(true)
      router.refresh() // the canvas is drawn on the server
    } catch {
      setFormError({ field: null, message: 'Could not save your changes - check your connection and try again.' })
    } finally {
      setSaving(false)
    }
  }

  /** The gallery: one PATCH per tap, separate from the Customize form so an unsaved note is never sent with it. */
  async function pickDesign(slug: string | null) {
    setDesignSaving(slug ?? 'theme')
    setDesignError(null)
    try {
      const res = await fetch('/api/portal/invitation', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_choice: slug }),
      })
      if (res.status === 401) {
        window.location.href = LOGIN
        return
      }
      const body = (await res.json().catch(() => null)) as (HostPayload & { error?: string }) | null
      if (!res.ok || !body) {
        setDesignError(body?.error ?? 'Could not change the design - try again.')
        return
      }
      setData(body)
      router.refresh() // the canvas is drawn on the server
    } catch {
      setDesignError('Could not change the design - check your connection and try again.')
    } finally {
      setDesignSaving(null)
    }
  }

  async function share(kind: 'invite' | 'reshare') {
    if (!shareGate(data.state, data.renderFresh).enabled) return
    trackShare()
    const text = kind === 'invite' ? data.facts.shareText : data.facts.reshareText
    const nav = navigator as Navigator & { share?: (d: { title?: string; text?: string; url?: string }) => Promise<void> }
    if (typeof nav.share === 'function') {
      try {
        await nav.share({ title: data.facts.title, text, url: data.url })
        return
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return // the host closed the sheet
        // any other failure: fall back to a plain text message
      }
    }
    window.location.href = smsHref(isIosUserAgent(navigator.userAgent), shareMessage(text, data.url))
  }

  async function copy() {
    if (!shareGate(data.state, data.renderFresh).enabled) return
    trackShare()
    if (await copyText(data.url)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    }
  }

  if (gone) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="font-display text-2xl text-[#1a2744]">Your invitation isn&apos;t available</h1>
        <p className="mt-3 text-sm text-gray-600">If that looks wrong, get in touch and we&apos;ll sort it out.</p>
        <p className="mt-6">
          <a href="/my-booking" className="text-[#1a2744] underline">
            Back to my booking
          </a>
        </p>
      </div>
    )
  }

  return (
    <HostInvitationView
      data={data}
      preview={preview}
      form={form}
      dirty={dirty}
      saving={saving}
      formError={formError}
      saved={saved}
      copied={copied}
      designSaving={designSaving}
      designError={designError}
      on={{
        form: (patch) => {
          setSaved(false)
          setFormError(null)
          setForm((f) => ({ ...f, ...patch }))
        },
        save: () => void save(),
        design: (slug) => void pickDesign(slug),
        share: (kind) => void share(kind),
        copy: () => void copy(),
        download: trackShare,
      }}
    />
  )
}
