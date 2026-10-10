'use client'

import { useEffect, useReducer, useRef } from 'react'
import RsvpView from '@/components/evites/RsvpView'
import {
  buildAnswerBody,
  buildExtrasBody,
  initialState,
  rsvpReducer,
  validateDetails,
  type ClubOffer,
  type FlowAction,
  type FlowState,
} from '@/lib/evites/rsvpFlow'
import type { OwnRsvp } from '@/lib/evites/rsvpView'

/**
 * The RSVP area of the public invitation (spec §7.5): the three screens, as
 * CLIENT STATE ONLY. Nothing here changes the URL, so analytics sees one page.
 *
 *   props come from the server page: the slug, the caller's OWN answer (read from
 *   their edit cookie, or null), whether they arrived on an "Update your RSVP"
 *   link, the birthday child's first name, and the CURRENT Birthday Club wording
 *   from the database (null hides the club card: unofficial wording is worse than
 *   no card).
 *
 * It never shows how many guests have answered (D15) and has no way to: the only
 * RSVP it ever holds is the caller's own, handed back by the RSVP route.
 *
 * Network: `POST /api/i/<slug>/rsvp` for a first answer, `PATCH` after that (the
 * edit cookie rides along). `rsvp_started` is reported once, on the first tap of
 * Yes / Can't make it. All state transitions live in `lib/evites/rsvpFlow.ts`.
 */

interface Props {
  slug: string
  own: OwnRsvp | null
  startInEdit?: boolean
  honoree: string | null
  club: ClubOffer | null
}

const NETWORK_ERROR = 'We couldn’t reach the server. Please check your connection and try again.'

interface Answer {
  ok: boolean
  status: number
  json: { ok?: boolean; error?: string; field?: string; rsvp?: OwnRsvp; reminderDropped?: boolean } | null
}

async function call(slug: string, method: 'POST' | 'PATCH', body: Record<string, unknown>): Promise<Answer> {
  const res = await fetch(`/api/i/${encodeURIComponent(slug)}/rsvp`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'same-origin',
  })
  let json: Answer['json'] = null
  try {
    json = (await res.json()) as Answer['json']
  } catch {
    json = null
  }
  return { ok: res.ok && json?.ok === true && !!json.rsvp, status: res.status, json }
}

function messageFor(a: Answer): string {
  if (a.status === 409 && a.json?.error === 'closed') return 'RSVPs for this party have closed.'
  if (typeof a.json?.error === 'string' && a.json.error !== '') return a.json.error
  return 'Something went wrong. Please try again in a moment.'
}

export default function RsvpIsland({ slug, own, startInEdit = false, honoree, club }: Props) {
  const [state, dispatch] = useReducer(rsvpReducer, undefined, () => initialState(own, startInEdit)) as [FlowState, (a: FlowAction) => void]
  const started = useRef(false)
  const top = useRef<HTMLDivElement | null>(null)
  const firstScreen = useRef(true)

  // Bring the new screen to the top of the viewport (a long form on a phone), but not on first paint.
  useEffect(() => {
    if (firstScreen.current) {
      firstScreen.current = false
      return
    }
    try {
      top.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    } catch {
      /* cosmetic */
    }
  }, [state.screen])

  const reportStarted = () => {
    if (started.current) return
    started.current = true
    try {
      void fetch(`/api/i/${encodeURIComponent(slug)}/event`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event: 'rsvp_started' }),
        keepalive: true,
        credentials: 'same-origin',
      }).catch(() => undefined)
    } catch {
      /* analytics only */
    }
  }

  const act = (a: FlowAction) => {
    if (a.type === 'choose') reportStarted()
    dispatch(a)
  }

  async function onSubmit() {
    // The reducer validates and flips `busy`; check the same rule here so an invalid form is never posted.
    if (state.busy) return
    if (validateDetails(state)) {
      dispatch({ type: 'submitStart' })
      return
    }
    dispatch({ type: 'submitStart' })
    try {
      const a = await call(slug, state.saved ? 'PATCH' : 'POST', buildAnswerBody(state))
      if (a.ok && a.json?.rsvp) dispatch({ type: 'submitted', rsvp: a.json.rsvp, reminderDropped: a.json.reminderDropped === true })
      else dispatch({ type: 'failed', message: messageFor(a), field: a.status === 400 ? (a.json?.field ?? null) : null })
    } catch {
      dispatch({ type: 'failed', message: NETWORK_ERROR })
    }
  }

  async function onSaveExtras() {
    if (state.busy) return
    const built = buildExtrasBody(state, club)
    if (built === null) {
      dispatch({ type: 'extrasDone', rsvp: state.saved as OwnRsvp })
      return
    }
    if ('error' in built) {
      dispatch({ type: 'failed', message: built.error.message, field: built.error.field })
      return
    }
    dispatch({ type: 'extrasStart' })
    try {
      const a = await call(slug, 'PATCH', built.body)
      if (a.ok && a.json?.rsvp) dispatch({ type: 'extrasDone', rsvp: a.json.rsvp })
      else dispatch({ type: 'failed', message: messageFor(a), field: null })
    } catch {
      dispatch({ type: 'failed', message: NETWORK_ERROR })
    }
  }

  async function onLeaveClub() {
    if (state.busy) return
    dispatch({ type: 'extrasStart' })
    try {
      const a = await call(slug, 'PATCH', { clubOptOut: true })
      if (a.ok && a.json?.rsvp) dispatch({ type: 'extrasDone', rsvp: a.json.rsvp })
      else dispatch({ type: 'failed', message: messageFor(a), field: null })
    } catch {
      dispatch({ type: 'failed', message: NETWORK_ERROR })
    }
  }

  return (
    <div ref={top} className="scroll-mt-4">
      <RsvpView
        state={state}
        dispatch={act}
        onSubmit={onSubmit}
        onSaveExtras={onSaveExtras}
        onLeaveClub={onLeaveClub}
        calendarUrl={`/i/${slug}/cal`}
        honoree={honoree}
        club={club}
      />
    </div>
  )
}
