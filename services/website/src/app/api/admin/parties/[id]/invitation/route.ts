import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { adminActorId, isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { logBookingChange } from '@/lib/bookingAudit'
import { CANONICAL_ORIGIN } from '@/lib/publicOrigin'
import { isPlausibleEmailAddress } from '@/lib/contactLookup'
import { evitePagesMode, eviteSendsMode, isPilotBooking } from '@/lib/evites/config'
import { isEviteEligible } from '@/lib/evites/eligibility'
import { ensureEviteForBooking, MAX_SLUG_ATTEMPTS } from '@/lib/evites/ensure'
import { childNameOf } from '@/lib/evites/facts'
import { renderInputsHash } from '@/lib/evites/hash'
import { renderViaQueue, queueRender } from '@/lib/evites/render'
import { makeSlug } from '@/lib/evites/slug'
import { slugIsAnAlias } from '@/lib/evites/slugTaken'
import { fireClubOptOut } from '@/lib/evites/clubHook'
import { themeShortOf } from '@/lib/evites/themes'
import { TEMPLATE_SLUGS } from '@/lib/evites/templates'
import { loadFactsContext } from '@/lib/evites/adminLoad'
import { notifyPartyCancelled } from '@/lib/evites/adminHooks'
import {
  ADMIN_CONTACT_PRESENCE_COLUMNS,
  ADMIN_EVITE_COLUMNS,
  ADMIN_REVEAL_COLUMNS,
  ADMIN_ROW_LIMIT,
  ADMIN_VOID_COLUMNS,
  ADMIN_SEND_COLUMNS,
  ADMIN_SEND_LIMIT,
  adminRsvpViews,
  inviteImageUrl,
  isTemplateSlug,
  isUuidLike,
  screenThemeText,
  storedOgUrl,
  summarizeRsvps,
  summarizeSends,
  type AdminRsvpRow,
  type ContactPresenceRow,
} from '@/lib/evites/adminView'
import { EVITE_BOOKING_COLUMNS, ADMIN_RSVP_COLUMNS } from '@/lib/evites/views'
import type { EviteBookingRow, EviteRow, EviteSendRow } from '@/lib/evites/types'

/**
 * Admin "Invitation & RSVPs" (spec §7.3, HANDOFF §5).
 *
 *   GET   /api/admin/parties/[id]/invitation              the card's data
 *   GET   ...?reveal=<rsvpId>                             ONE RSVP's raw contact, audited
 *   POST  ...  { action: ensure | rerender | archive | unarchive | set_theme | reslug | notify_cancelled | void_rsvp }
 *
 * `void_rsvp` { rsvpId } deletes ONE RSVP of THIS booking's invitation (the remedy for a junk answer that a
 * link holder filled the list with). It is a hard DELETE of our own `evite_rsvps` row (its ledger rows go with it,
 * ON DELETE CASCADE), audited by id; a club member is taken off the Brevo list first-class, not left subscribed.
 *
 * `[id]` is the BOOKING id, the same id `/api/admin/parties/[id]` takes.
 *
 * Every handler opens with `isAdminAuthorized`. Every write names the human through
 * `adminActorId(req)` and is recorded with `logBookingChange` (its `modified_by`
 * CHECK, migration 047, permits `admin:<email>` and `ADMIN`; the audit text names an
 * RSVP by id and NEVER carries an address). Every write reads its `{error}`, and
 * every conditional update is read back with `.select(...)` so "zero rows" is an
 * answer, not a success.
 *
 * Nothing here selects `*`: each read names an allow-list from `lib/evites/adminView.ts`
 * or `views.ts`. The raw reminder / club addresses are never in the GET payload:
 * they are read in a separate narrow select ONLY to compute two booleans.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Supa = ReturnType<typeof getSupabase>
type Ctx = { params: { id: string } | Promise<{ id: string }> }

const NO_STORE = { 'Cache-Control': 'no-store' }

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

type AdminEvite = Pick<EviteRow, (typeof ADMIN_EVITE_COLUMNS)[number]>

type EviteLookup = { kind: 'found'; evite: AdminEvite } | { kind: 'absent' } | { kind: 'unavailable'; reason: string }

async function lookupEvite(supabase: Supa, bookingId: string): Promise<EviteLookup> {
  const { data, error } = await supabase
    .from('evites')
    .select(ADMIN_EVITE_COLUMNS.join(', '))
    .eq('booking_id', bookingId)
    .maybeSingle<AdminEvite>()
  if (error) return { kind: 'unavailable', reason: `evite read failed: ${error.message}` }
  return data ? { kind: 'found', evite: data } : { kind: 'absent' }
}

async function readParams(ctx: Ctx): Promise<string | null> {
  const { id } = await ctx.params
  return isUuidLike(id) ? id : null
}

// ------------------------------------------------------------------------------------------------ GET

export async function GET(req: NextRequest, ctx: Ctx) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const bookingId = await readParams(ctx)
  if (!bookingId) return json({ error: 'Not found' }, 404)
  const supabase = getSupabase()

  const reveal = req.nextUrl.searchParams.get('reveal')
  if (reveal !== null) return revealContact(req, supabase, bookingId, reveal)

  const now = new Date()
  const found = await lookupEvite(supabase, bookingId)
  if (found.kind === 'unavailable') return json({ error: found.reason }, 503)

  const pagesMode = evitePagesMode()
  const sendsMode = eviteSendsMode()

  // No invitation yet: say whether one could be made. The booking read is the eligibility input.
  if (found.kind === 'absent') {
    const bk = await supabase
      .from('bookings')
      .select(EVITE_BOOKING_COLUMNS.join(', '))
      .eq('id', bookingId)
      .maybeSingle<EviteBookingRow>()
    if (bk.error) return json({ error: `booking read failed: ${bk.error.message}` }, 503)
    if (!bk.data) return json({ error: 'Not found' }, 404)
    const eligible = isEviteEligible(bk.data)
    return json({
      evite: null,
      eligible,
      pagesMode,
      sendsMode,
      canEnsure: eligible && pagesMode !== 'off' && (pagesMode === 'on' || isPilotBooking(bk.data.booking_ref)),
    })
  }

  const evite = found.evite
  const ctxRead = await loadFactsContext(supabase, evite, now)
  if (ctxRead.kind === 'noBooking') return json({ error: 'Not found' }, 404)
  if (ctxRead.kind === 'unavailable') return json({ error: ctxRead.reason }, 503)
  const { booking, state, facts } = ctxRead

  // The three remaining reads are independent. Each can fail on its own and says so.
  const [rsvpRead, presenceRead, sendRead] = await Promise.all([
    supabase
      .from('evite_rsvps')
      .select(ADMIN_RSVP_COLUMNS.join(', '))
      .eq('evite_id', evite.id)
      .order('created_at', { ascending: true })
      .limit(ADMIN_ROW_LIMIT + 1),
    supabase
      .from('evite_rsvps')
      .select(ADMIN_CONTACT_PRESENCE_COLUMNS.join(', '))
      .eq('evite_id', evite.id)
      .limit(ADMIN_ROW_LIMIT + 1),
    supabase
      .from('evite_sends')
      .select(ADMIN_SEND_COLUMNS.join(', '))
      .eq('evite_id', evite.id)
      .order('claimed_at', { ascending: false })
      .limit(ADMIN_SEND_LIMIT + 1),
  ])

  let rsvps:
    | { available: true; truncated: boolean; rows: ReturnType<typeof adminRsvpViews> }
    | { available: false; error: string }
  let summary: ReturnType<typeof summarizeRsvps> | null = null
  if (rsvpRead.error || presenceRead.error) {
    const msg = (rsvpRead.error ?? presenceRead.error)?.message ?? 'unknown'
    console.error(`evites/admin: rsvp read failed for ${evite.id}: ${msg}`)
    rsvps = { available: false, error: 'RSVPs unavailable' }
  } else {
    const all = (rsvpRead.data ?? []) as unknown as AdminRsvpRow[]
    const presence = (presenceRead.data ?? []) as unknown as ContactPresenceRow[]
    const truncated = all.length > ADMIN_ROW_LIMIT
    const rows = adminRsvpViews(all.slice(0, ADMIN_ROW_LIMIT), presence, ADMIN_RSVP_COLUMNS)
    rsvps = { available: true, truncated, rows }
    summary = summarizeRsvps(rows, facts.guestCap)
  }

  let ledger:
    | { available: true; truncated: boolean; groups: ReturnType<typeof summarizeSends> }
    | { available: false; error: string }
  if (sendRead.error) {
    console.error(`evites/admin: send ledger read failed for ${evite.id}: ${sendRead.error.message}`)
    ledger = { available: false, error: 'Ledger unavailable' }
  } else {
    const all = (sendRead.data ?? []) as unknown as EviteSendRow[]
    ledger = {
      available: true,
      truncated: all.length > ADMIN_SEND_LIMIT,
      groups: summarizeSends(all.slice(0, ADMIN_SEND_LIMIT), now),
    }
  }

  const supabaseUrl = process.env.SUPABASE_URL
  const rendered = !!evite.invite_object && !!evite.og_object
  // A switched-off or withdrawn invitation is not drawn at all, so "fresh" has no meaning for it.
  const renderFresh = state === 'disabled' || state === 'unavailable' ? null : rendered && renderInputsHash(facts) === evite.render_inputs_hash

  return json({
    eligible: isEviteEligible(booking),
    pagesMode,
    sendsMode,
    booking: {
      id: booking.id,
      bookingRef: booking.booking_ref,
      status: booking.status,
      partyDate: booking.party_date,
      contactName: booking.contact_name,
    },
    evite: {
      id: evite.id,
      slug: evite.slug,
      previousSlugs: evite.previous_slugs,
      templateSlug: evite.template_slug,
      themeWord: evite.theme_word,
      themeSub: evite.theme_sub,
      renderVersion: evite.render_version,
      renderedAt: evite.rendered_at,
      renderError: evite.render_error,
      calVersion: evite.cal_version,
      wentLiveAt: evite.went_live_at,
      cancelledNoticeAt: evite.cancelled_notice_at,
      archivedAt: evite.archived_at,
      createdAt: evite.created_at,
      canReslug: !evite.went_live_at,
    },
    state,
    facts: {
      title: facts.title,
      hasName: facts.hasName,
      themeWord: facts.themeWord,
      themeSub: facts.themeSub,
      templateSlug: facts.templateSlug,
      dateLine: facts.dateLine,
      placeLine: facts.placeLine,
      hostContactLine: facts.hostContactLine,
      hostNote: facts.hostNote,
      giftNote: facts.giftNote,
      rsvpDeadline: facts.rsvpDeadline,
      guestCap: facts.guestCap,
    },
    links: {
      publicUrl: `${CANONICAL_ORIGIN}/i/${evite.slug}`,
      hostPageUrl: `${CANONICAL_ORIGIN}/my-booking/invitation`,
      // The host page needs the customer's own sign-in; an admin cannot open it. Information only.
      hostPageNote: "Opens with the customer's own sign-in, so it is shown for information.",
    },
    images: { invite: inviteImageUrl(evite, supabaseUrl), og: storedOgUrl(evite, supabaseUrl) },
    templateOptions: TEMPLATE_SLUGS,
    renderFresh,
    warnings: {
      needsTime: state === 'needs_time',
      noParentEmail: !isPlausibleEmailAddress(booking.contact_email),
    },
    rsvps,
    summary,
    ledger,
  })
}

/**
 * `?reveal=<rsvpId>`: the raw contact for ONE RSVP. The RSVP must belong to THIS
 * booking's evite (a lookup by RSVP id alone would let any booking's URL reveal any
 * guest's address). The audit row is written FIRST and the reveal is refused if it
 * cannot be: a contact shown without a record is the one outcome this exists to stop.
 */
async function revealContact(req: NextRequest, supabase: Supa, bookingId: string, rsvpId: string) {
  if (!isUuidLike(rsvpId)) return json({ error: 'Not found' }, 404)

  const found = await lookupEvite(supabase, bookingId)
  if (found.kind === 'unavailable') return json({ error: found.reason }, 503)
  if (found.kind === 'absent') return json({ error: 'Not found' }, 404)

  const { data, error } = await supabase
    .from('evite_rsvps')
    .select(ADMIN_REVEAL_COLUMNS.join(', '))
    .eq('id', rsvpId)
    .eq('evite_id', found.evite.id)
    .maybeSingle<{ id: string; evite_id: string; reminder_email: string | null; reminder_phone_e164: string | null; club_email: string | null }>()
  if (error) return json({ error: `rsvp read failed: ${error.message}` }, 503)
  if (!data) return json({ error: 'Not found' }, 404)

  const logged = await logBookingChange(supabase, {
    bookingId,
    actor: adminActorId(req),
    summary: `Invitation: revealed the reminder contact for RSVP ${rsvpId}`,
  })
  if (!logged) return json({ error: 'Could not record the reveal in the audit log, so nothing was shown.' }, 500)

  return json({
    rsvpId,
    reminderEmail: data.reminder_email,
    reminderPhone: data.reminder_phone_e164,
    clubEmail: data.club_email,
  })
}

// ------------------------------------------------------------------------------------------------ POST

const ACTIONS = ['ensure', 'rerender', 'archive', 'unarchive', 'set_theme', 'reslug', 'notify_cancelled', 'void_rsvp'] as const
type Action = (typeof ACTIONS)[number]

function isSlugCollision(err: { code?: string | null; message?: string | null; details?: string | null } | null): boolean {
  if (!err || err.code !== '23505') return false
  const text = `${err.message ?? ''} ${err.details ?? ''}`
  return text.includes('evites_slug_key') || /Key \(slug\)=/.test(text)
}

export async function POST(req: NextRequest, ctx: Ctx) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const bookingId = await readParams(ctx)
  if (!bookingId) return json({ error: 'Not found' }, 404)

  let body: Record<string, unknown>
  try {
    const parsed: unknown = await req.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return json({ error: 'Body must be a JSON object' }, 400)
    body = parsed as Record<string, unknown>
  } catch {
    return json({ error: 'Body must be JSON' }, 400)
  }
  const action = body.action
  if (typeof action !== 'string' || !(ACTIONS as readonly string[]).includes(action)) {
    return json({ error: `action must be one of ${ACTIONS.join(', ')}` }, 400)
  }

  const supabase = getSupabase()
  const actor = adminActorId(req)
  const audit = (summary: string, oldData?: Record<string, unknown>, newData?: Record<string, unknown>) =>
    logBookingChange(supabase, { bookingId, actor, summary, oldData: oldData ?? null, newData: newData ?? null })

  if ((action as Action) === 'ensure') {
    const outcome = await ensureEviteForBooking(supabase, bookingId)
    if (outcome.kind === 'created') {
      queueRender(outcome.eviteId)
      const audited = await audit('Invitation: created', undefined, { slug: outcome.slug })
      return json({ ok: true, action, outcome: outcome.kind, slug: outcome.slug, audited })
    }
    if (outcome.kind === 'exists') return json({ ok: true, action, outcome: outcome.kind, slug: outcome.slug })
    const status = outcome.kind === 'ineligible' ? 422 : outcome.kind === 'disabled' ? 409 : 503
    return json({ ok: false, action, outcome: outcome.kind, reason: outcome.reason }, status)
  }

  // Every other action works on the invitation that already exists.
  const found = await lookupEvite(supabase, bookingId)
  if (found.kind === 'unavailable') return json({ error: found.reason }, 503)
  if (found.kind === 'absent') return json({ error: 'This booking has no invitation yet' }, 404)
  const evite = found.evite

  switch (action as Exclude<Action, 'ensure'>) {
    case 'rerender': {
      // Awaited on purpose: the admin pressed the button to see the result (about two seconds).
      const outcome = await renderViaQueue(supabase, evite.id, { force: true })
      const audited = await audit(`Invitation: re-render requested (${outcome.kind})`)
      if (outcome.kind === 'failed') return json({ ok: false, action, outcome, audited }, 502)
      return json({ ok: outcome.kind === 'rendered', action, outcome, audited })
    }

    case 'archive': {
      if (evite.archived_at) return json({ error: 'Already archived' }, 409)
      const at = new Date().toISOString()
      const { data, error } = await supabase
        .from('evites')
        .update({ archived_at: at })
        .eq('id', evite.id)
        .is('archived_at', null)
        .select('id')
      if (error) return json({ error: `archive failed: ${error.message}` }, 500)
      if (!data || data.length === 0) return json({ error: 'Already archived' }, 409)
      const audited = await audit('Invitation: archived', { archived_at: null }, { archived_at: at })
      return json({ ok: true, action, archivedAt: at, audited })
    }

    case 'unarchive': {
      if (!evite.archived_at) return json({ error: 'Not archived' }, 409)
      const { data, error } = await supabase
        .from('evites')
        .update({ archived_at: null })
        .eq('id', evite.id)
        .eq('archived_at', evite.archived_at)
        .select('id')
      if (error) return json({ error: `unarchive failed: ${error.message}` }, 500)
      if (!data || data.length === 0) return json({ error: 'Changed by someone else; reload and try again' }, 409)
      queueRender(evite.id)
      const audited = await audit('Invitation: unarchived', { archived_at: evite.archived_at }, { archived_at: null })
      return json({ ok: true, action, audited })
    }

    case 'set_theme': {
      const patch: Record<string, string | null> = {}
      if ('template_slug' in body) {
        if (!isTemplateSlug(body.template_slug)) return json({ error: 'Unknown template' }, 400)
        patch.template_slug = body.template_slug
      }
      if ('theme_word' in body) {
        const w = screenThemeText(body.theme_word, 'monoton', 'theme_word')
        if (!w.ok) return json({ error: w.error }, 400)
        patch.theme_word = w.value
      }
      if ('theme_sub' in body) {
        const s = screenThemeText(body.theme_sub, 'bungee', 'theme_sub')
        if (!s.ok) return json({ error: s.error }, 400)
        patch.theme_sub = s.value
      }
      if (Object.keys(patch).length === 0) return json({ error: 'Nothing to change' }, 400)

      const before: Record<string, unknown> = {}
      for (const k of Object.keys(patch)) before[k] = (evite as unknown as Record<string, unknown>)[k] ?? null
      const { data, error } = await supabase.from('evites').update(patch).eq('id', evite.id).select('id')
      if (error) return json({ error: `set_theme failed: ${error.message}` }, 500)
      if (!data || data.length === 0) return json({ error: 'Invitation not found' }, 404)
      queueRender(evite.id)
      const audited = await audit('Invitation: theme changed', before, patch)

      // facts.ts honours `template_slug` only alongside a theme word / sub; say so rather than imply it took effect.
      const after = { ...evite, ...patch }
      const templateIgnored = 'template_slug' in patch && !after.theme_word && !after.theme_sub
      return json({
        ok: true,
        action,
        audited,
        ...(templateIgnored ? { warning: 'The template only applies together with a theme word or sub. Set one to use it.' } : {}),
      })
    }

    case 'reslug': {
      if (evite.went_live_at) {
        return json({ error: 'This invitation has gone live, so its link can no longer change.', code: 'went-live' }, 409)
      }
      const read = await loadFactsContext(supabase, evite, new Date())
      if (read.kind === 'noBooking') return json({ error: 'Booking not found' }, 404)
      if (read.kind === 'unavailable') return json({ error: read.reason }, 503)

      // The name from the booking and the theme from the facts (which carry any admin override), as `ensure` mints them.
      const name = childNameOf(read.booking)
      const themeShort = themeShortOf(read.facts.themeWord)
      const previous = Array.from(new Set([...(evite.previous_slugs ?? []), evite.slug]))

      for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
        const slug = makeSlug(name, themeShort)
        if (slug === evite.slug) continue
        // Another invitation's re-minted alias is taken too (UNIQUE(slug) does not see previous_slugs).
        const alias = await slugIsAnAlias(supabase, slug)
        if (alias === 'taken') continue
        if (alias === 'unknown') return json({ error: 'Could not check whether the new link is free; try again' }, 503)
        const { data, error } = await supabase
          .from('evites')
          .update({ slug, previous_slugs: previous })
          .eq('id', evite.id)
          .eq('slug', evite.slug)
          .is('went_live_at', null)
          .select('slug')
        if (error) {
          if (isSlugCollision(error)) continue // another invitation has it: mint again
          return json({ error: `reslug failed: ${error.message}` }, 500)
        }
        const row = ((data ?? []) as unknown as Array<{ slug: string }>)[0]
        if (!row) return json({ error: 'The invitation changed (went live or re-slugged); reload and try again', code: 'changed' }, 409)
        if (row.slug !== slug) return json({ error: 'reslug read-back did not match' }, 500)
        const audited = await audit('Invitation: link re-minted', { slug: evite.slug }, { slug })
        return json({ ok: true, action, slug, previousSlug: evite.slug, audited })
      }
      return json({ error: `slug collided ${MAX_SLUG_ATTEMPTS} times; try again` }, 503)
    }

    case 'notify_cancelled': {
      const bk = await supabase.from('bookings').select('id, status').eq('id', bookingId).maybeSingle<{ id: string; status: string | null }>()
      if (bk.error) return json({ error: `booking read failed: ${bk.error.message}` }, 503)
      if (!bk.data) return json({ error: 'Booking not found' }, 404)
      if (bk.data.status !== 'cancelled' && bk.data.status !== 'lost') {
        return json({ error: 'The party is not cancelled, so there is nothing to announce.' }, 409)
      }
      const result = await notifyPartyCancelled(supabase, evite.id)
      const audited = await audit(`Invitation: cancellation notice requested (${result.queued ? 'queued' : result.reason ?? 'not sent'})`)
      return json({ action, ...result, audited }, result.ok ? 200 : 502)
    }

    case 'void_rsvp': {
      const rsvpId = body.rsvpId
      if (typeof rsvpId !== 'string' || !isUuidLike(rsvpId)) return json({ error: 'rsvpId must be an RSVP id' }, 400)

      // Scoped to THIS booking's invitation: the id alone would let any booking's URL remove any guest's answer.
      const read = await supabase
        .from('evite_rsvps')
        .select(ADMIN_VOID_COLUMNS.join(', '))
        .eq('id', rsvpId)
        .eq('evite_id', evite.id)
        .maybeSingle<{
          id: string
          evite_id: string
          status: string
          revision: number
          child_count: number
          club_email: string | null
          club_opt_in_at: string | null
          club_opted_out_at: string | null
        }>()
      if (read.error) return json({ error: `rsvp read failed: ${read.error.message}` }, 503)
      if (!read.data) return json({ error: 'That RSVP is not on this invitation' }, 404)
      const was = read.data

      const { data, error } = await supabase.from('evite_rsvps').delete().eq('id', rsvpId).eq('evite_id', evite.id).select('id')
      if (error) return json({ error: `remove failed: ${error.message}` }, 500)
      if (!data || data.length === 0) return json({ error: 'That RSVP was already removed' }, 404)

      // A club member is taken off the list with the answer that held their consent record; best effort, never blocks the removal.
      if (was.club_email && was.club_opt_in_at && !was.club_opted_out_at) fireClubOptOut(supabase, { email: was.club_email, rsvpId })

      const audited = await audit(`Invitation: removed RSVP ${rsvpId}`, { rsvpId, status: was.status, revision: was.revision, children: was.child_count })
      return json({ ok: true, action, rsvpId, audited })
    }
  }
}
