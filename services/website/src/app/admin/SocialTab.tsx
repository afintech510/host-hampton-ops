'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  RefreshCw,
  CheckCircle2,
  Archive,
  Sparkles,
  AlertTriangle,
  Pencil,
  Instagram,
  Calendar as CalendarIcon,
  Send,
} from 'lucide-react'

/**
 * The social content calendar (Phase 4).
 *
 * Every row here is model-written copy. Two things the panel exists to make
 * impossible to miss:
 *
 *  - a draft that FAILS the output screen is badged and its Approve button is
 *    disabled, with the reason named — a screen that stops something must say
 *    that it stopped it (hard-won rule 10);
 *  - nothing posts itself. "Published" is Allie recording that she put the post
 *    up, not the app doing it. There is no Meta credential in the container and
 *    no code here that would use one.
 */

interface SocialPost {
  id: string
  scheduled_for: string
  platform: string
  post_type: string
  caption: string
  hashtags: string[] | null
  image_idea: string | null
  call_to_action: string | null
  link_url: string | null
  status: string
  created_by: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  published_at: string | null
  screen_notes: string[] | null
  screen_failures: string[]
  created_at: string
}

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700',
  approved: 'bg-emerald-100 text-emerald-800',
  scheduled: 'bg-amber-100 text-amber-800',
  published: 'bg-sky-100 text-sky-800',
  archived: 'bg-slate-100 text-slate-400',
}

/**
 * `scheduled_for` is a timestamptz and every slot is written at noon UTC, so the
 * day is read back in UTC. Rendering it in the browser's zone would move a
 * Saturday post to Friday for anyone west of London.
 */
function prettyDate(d: string): string {
  const parsed = new Date(d)
  if (Number.isNaN(parsed.getTime())) return d
  return parsed.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

export default function SocialTab({
  headers,
  onLogout,
}: {
  headers: Record<string, string>
  onLogout: () => void
}) {
  const [posts, setPosts] = useState<SocialPost[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [draftCaption, setDraftCaption] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/social', { headers })
      if (res.status === 401) return onLogout()
      const body = await res.json()
      if (!res.ok) {
        // Rule 12 at the UI: "could not read" must not render as an empty
        // calendar, which reads exactly like "the cron has produced nothing".
        setError(body?.error || 'Could not load the calendar')
        setPosts([])
        return
      }
      setPosts(body.posts || [])
    } catch {
      setError('Could not load the calendar')
      setPosts([])
    } finally {
      setLoading(false)
    }
  }, [headers, onLogout])

  useEffect(() => {
    load()
  }, [load])

  async function generate() {
    setBusy('generate')
    setMessage(null)
    try {
      const res = await fetch('/api/admin/social', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const body = await res.json()
      if (!res.ok || body.ok === false) {
        setMessage(body?.error || 'Generation failed')
      } else {
        const bits = [`${body.inserted ?? 0} drafted`]
        if (body.alreadyDrafted) bits.push(`${body.alreadyDrafted} already had a draft`)
        if (body.refused?.length) bits.push(`${body.refused.length} refused by the screens`)
        if (typeof body.costUsd === 'number') bits.push(`$${body.costUsd.toFixed(4)}`)
        setMessage(bits.join(' · '))
        if (body.refused?.length) {
          setMessage(
            `${bits.join(' · ')} — ${body.refused.map((r: { date: string; reason: string }) => `${r.date}: ${r.reason}`).join('; ')}`
          )
        }
      }
      await load()
    } finally {
      setBusy(null)
    }
  }

  async function move(id: string, to: string) {
    setBusy(id)
    setMessage(null)
    try {
      const res = await fetch('/api/admin/social', {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, to }),
      })
      const body = await res.json()
      if (!res.ok) setMessage(body?.error || `Could not move that post to ${to}`)
      await load()
    } finally {
      setBusy(null)
    }
  }

  async function saveCaption(id: string) {
    setBusy(id)
    setMessage(null)
    try {
      const res = await fetch('/api/admin/social', {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, caption: draftCaption }),
      })
      const body = await res.json()
      if (!res.ok) setMessage(body?.error || 'Could not save')
      else setEditing(null)
      await load()
    } finally {
      setBusy(null)
    }
  }

  const live = posts.filter(p => p.status !== 'archived')

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-serif text-2xl text-slate-800">Social calendar</h2>
          <p className="text-sm text-slate-500">
            Drafts written by the SOC agent. Nothing posts itself — approving marks it ready for
            you to put up.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
          <button
            onClick={generate}
            disabled={busy === 'generate'}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4" />
            {busy === 'generate' ? 'Writing…' : 'Draft the coming week'}
          </button>
        </div>
      </div>

      {message && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {message}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && <p className="text-sm text-slate-500">Loading…</p>}

      {!loading && !error && live.length === 0 && (
        <p className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
          No drafts yet. Use “Draft the coming week”, or schedule
          <code className="mx-1 rounded bg-slate-100 px-1">/api/cron/social-calendar</code>
          weekly.
        </p>
      )}

      <div className="space-y-4">
        {live.map(post => {
          const blocked = post.screen_failures.length > 0
          return (
            <article
              key={post.id}
              className={`rounded-xl border bg-white p-4 shadow-sm ${blocked ? 'border-red-300' : 'border-slate-200'}`}
            >
              <header className="flex flex-wrap items-center gap-2 text-sm">
                <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
                  <CalendarIcon className="h-4 w-4" />
                  {prettyDate(post.scheduled_for)}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                  <Instagram className="h-3 w-3" /> {post.platform}
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                  {post.post_type.replace(/_/g, ' ')}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[post.status] ?? 'bg-slate-100'}`}>
                  {post.status.replace(/_/g, ' ')}
                </span>
                {post.reviewed_by && (
                  <span className="text-xs text-slate-400">approved by {post.reviewed_by}</span>
                )}
              </header>

              {blocked && (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    <strong>Held by the screens.</strong> {post.screen_failures.join('; ')}. Edit the
                    caption before this can be approved.
                  </span>
                </div>
              )}

              {editing === post.id ? (
                <div className="mt-3">
                  <textarea
                    value={draftCaption}
                    onChange={e => setDraftCaption(e.target.value)}
                    rows={8}
                    className="w-full rounded-lg border border-slate-300 p-3 text-sm"
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => saveCaption(post.id)}
                      disabled={busy === post.id}
                      className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditing(null)}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
                  {post.caption}
                </p>
              )}

              {post.hashtags && post.hashtags.length > 0 && (
                <p className="mt-2 text-sm text-sky-700">{post.hashtags.join(' ')}</p>
              )}
              {post.call_to_action && (
                <p className="mt-2 text-sm text-slate-600">
                  <strong>CTA:</strong> {post.call_to_action}
                </p>
              )}
              {post.link_url && (
                <p className="mt-1 text-xs text-slate-500 break-all">{post.link_url}</p>
              )}
              {post.image_idea && (
                <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <strong>Photo:</strong> {post.image_idea}
                </p>
              )}
              {post.screen_notes && post.screen_notes.length > 0 && (
                <p className="mt-2 text-xs text-amber-700">
                  The writer trimmed this: {post.screen_notes.join('; ')}
                </p>
              )}

              <footer className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={() => {
                    setEditing(post.id)
                    setDraftCaption(post.caption)
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                >
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </button>

                {post.status === 'draft' && (
                  <button
                    onClick={() => move(post.id, 'approved')}
                    disabled={busy === post.id || blocked}
                    title={blocked ? 'The output screen is holding this post' : undefined}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-40"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                  </button>
                )}

                {(post.status === 'approved' || post.status === 'scheduled') && (
                  <button
                    onClick={() => {
                      if (
                        window.confirm(
                          'Mark this as posted? This records that YOU put it on Instagram — the app does not post anything.'
                        )
                      )
                        move(post.id, 'published')
                    }}
                    disabled={busy === post.id}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-sm text-white hover:bg-sky-700 disabled:opacity-50"
                  >
                    <Send className="h-3.5 w-3.5" /> I posted this
                  </button>
                )}

                <button
                  onClick={() => move(post.id, 'archived')}
                  disabled={busy === post.id}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                >
                  <Archive className="h-3.5 w-3.5" /> Archive
                </button>
              </footer>
            </article>
          )
        })}
      </div>
    </div>
  )
}
