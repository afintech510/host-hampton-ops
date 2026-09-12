import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { adminActorId, isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { advance, writeLedger, IllegalTransitionError, TransitionNotAuthorizedError } from '@/lib/marketing/graph'
import { generateWeek } from '@/lib/social/calendar'
import {
  screenStoredPost,
  sanitizeCaptionText,
  trimChars,
  MAX_CAPTION_CHARS,
  MAX_CTA_CHARS,
} from '@/lib/social/normalize'
import { safeSiteLink } from '@/lib/content/contentSafety'

export const dynamic = 'force-dynamic'

/**
 * The social content calendar's review surface (Phase 4).
 *
 * GET    → the calendar, with every stored row re-screened on the way out.
 * POST   → generate the coming week by hand (the same call the weekly cron makes).
 * PATCH  → edit a draft's copy, or move it through the graph.
 *
 * Two things this route will not do, both on purpose:
 *
 *  - **It will not set `status` through the edit whitelist.** `approved` and
 *    `published` are GATED graph edges and the ONLY way to reach them is
 *    `advance()` with `isAdmin`. An edit endpoint that also accepted a status
 *    would be a second, ungated publish door — exactly what the content
 *    pipeline's PATCH was written to avoid.
 *  - **It will not post anything anywhere.** `published` here means "Allie put
 *    this on Instagram herself"; there is no Meta credential in the container
 *    and no code in this repo that would use one.
 */

const COLUMNS =
  'id, scheduled_for, platform, post_type, caption, hashtags, image_idea, call_to_action, link_url, ' +
  'status, source_event_id, created_by, reviewed_by, reviewed_at, published_at, screen_notes, generation_meta, created_at, updated_at'

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const supabase = getSupabase()

  const status = req.nextUrl.searchParams.get('status')
  let query = supabase.from('social_posts').select(COLUMNS).order('scheduled_for', { ascending: true }).limit(200)
  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) {
    // Rule 12: a failed read is not an empty calendar. An empty list here would
    // read as "the cron has produced nothing", which is a different problem.
    return NextResponse.json({ error: `Could not read the calendar: ${error.message}` }, { status: 503 })
  }

  // Screened on the way OUT as well as in. A row being `draft` in Postgres is
  // not evidence it ever passed a screen — migration 043 is the only thing
  // between a hand-written INSERT and this panel, and §24 found exactly this
  // shape: a live voice profile that had never been near its own sanitiser.
  const rows = (data ?? []) as unknown as Record<string, unknown>[]
  const posts: Record<string, unknown>[] = rows.map(row => {
    const problems = screenStoredPost({
      caption: typeof row.caption === 'string' ? row.caption : null,
      call_to_action: typeof row.call_to_action === 'string' ? row.call_to_action : null,
      link_url: typeof row.link_url === 'string' ? row.link_url : null,
    })
    return { ...row, screen_failures: problems }
  })

  const flagged = posts.filter(p => (p.screen_failures as string[]).length > 0)
  if (flagged.length > 0) {
    console.warn(
      `admin:social — ${flagged.length} stored post(s) fail the output screen: ` +
        flagged.map(p => `${String(p.id)} (${(p.screen_failures as string[]).join('; ')})`).join(' | ')
    )
  }

  return NextResponse.json({ posts, flaggedCount: flagged.length })
}

export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const supabase = getSupabase()
  const actor = adminActorId(req)

  const body = await req.json().catch(() => ({}))
  const count = Number.isFinite(Number(body?.count)) ? Math.max(1, Math.min(7, Number(body.count))) : undefined

  const outcome = await generateWeek(supabase, { actor, count })
  return NextResponse.json(outcome, { status: outcome.status })
}

export async function PATCH(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const supabase = getSupabase()
  const actor = adminActorId(req)

  const body = await req.json().catch(() => ({}))
  const id = typeof body?.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  // ── status move ────────────────────────────────────────────────────────
  if (typeof body.to === 'string' && body.to) {
    const { data: current, error: readErr } = await supabase
      .from('social_posts')
      .select('id, status, caption, call_to_action, link_url')
      .eq('id', id)
      .maybeSingle()

    if (readErr) return NextResponse.json({ error: `Could not read that post: ${readErr.message}` }, { status: 503 })
    if (!current) return NextResponse.json({ error: 'No such post' }, { status: 404 })

    // Screen again at the gate. The screens ran when the row was written; this
    // is the moment the row becomes something a human is signing off on, and the
    // row may have been edited — or inserted — since.
    if (body.to === 'approved' || body.to === 'published') {
      const problems = screenStoredPost(current)
      if (problems.length > 0) {
        await writeLedger(supabase, {
          entityType: 'social_post',
          entityId: id,
          action: 'note',
          actor,
          meta: { refused_transition: body.to, problems },
        })
        return NextResponse.json(
          { error: `Refused: this post ${problems.join('; ')}. Edit it first.`, problems },
          { status: 422 }
        )
      }
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (body.to === 'approved') {
      patch.reviewed_by = actor
      patch.reviewed_at = new Date().toISOString()
    }
    if (body.to === 'published') patch.published_at = new Date().toISOString()

    try {
      const result = await advance({
        entity: 'social_post',
        id,
        to: body.to,
        // isAdmin is set from the request's own auth check above, and nowhere
        // else. No cron and no model path reaches this line.
        actor: { id: actor, isAdmin: true },
        supabase,
        patch,
      })
      return NextResponse.json({ ok: true, ...result })
    } catch (err) {
      if (err instanceof TransitionNotAuthorizedError) return NextResponse.json({ error: err.message }, { status: 403 })
      if (err instanceof IllegalTransitionError) return NextResponse.json({ error: err.message }, { status: 409 })
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ error: msg }, { status: 500 })
    }
  }

  // ── copy edit ──────────────────────────────────────────────────────────
  // A WHITELIST that excludes `status`, `reviewed_by`, `published_at` and every
  // other column the graph owns.
  const patch: Record<string, unknown> = {}
  const notes: string[] = []

  if (typeof body.caption === 'string') {
    const caption = trimChars(sanitizeCaptionText(body.caption), MAX_CAPTION_CHARS)
    if (!caption) return NextResponse.json({ error: 'Caption cannot be empty' }, { status: 400 })
    patch.caption = caption
  }
  if (body.call_to_action === null || typeof body.call_to_action === 'string') {
    const cta = body.call_to_action === null ? null : trimChars(sanitizeCaptionText(body.call_to_action), MAX_CTA_CHARS)
    patch.call_to_action = cta || null
  }
  if (body.image_idea === null || typeof body.image_idea === 'string') {
    patch.image_idea = body.image_idea === null ? null : sanitizeCaptionText(body.image_idea) || null
  }
  if (body.link_url === null || typeof body.link_url === 'string') {
    if (body.link_url === null || body.link_url === '') {
      patch.link_url = null
    } else {
      const safe = safeSiteLink(body.link_url)
      // Rule 10: refusing a link silently is how a reviewer watches a value not
      // stick and has nothing to tell her why.
      if (!safe) return NextResponse.json({ error: 'A link must be a hosthampton.com URL' }, { status: 400 })
      patch.link_url = safe
    }
  }
  if (Array.isArray(body.hashtags)) {
    patch.hashtags = body.hashtags
      .filter((h: unknown) => typeof h === 'string')
      .map((h: string) => sanitizeCaptionText(h).replace(/\s+/g, ''))
      .filter(Boolean)
      .slice(0, 12)
  }
  if (typeof body.scheduled_for === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.scheduled_for)) {
    // Noon UTC, same as the generator writes, so the slot's unique index (over
    // the UTC calendar day) agrees with what the reviewer picked.
    patch.scheduled_for = `${body.scheduled_for}T12:00:00+00:00`
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const screened = screenStoredPost({
    caption: typeof patch.caption === 'string' ? patch.caption : undefined,
    call_to_action: typeof patch.call_to_action === 'string' ? patch.call_to_action : undefined,
    link_url: typeof patch.link_url === 'string' ? patch.link_url : undefined,
  })
  if (screened.length > 0) {
    return NextResponse.json({ error: `Refused: ${screened.join('; ')}`, problems: screened }, { status: 422 })
  }

  patch.updated_at = new Date().toISOString()

  const { error } = await supabase.from('social_posts').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await writeLedger(supabase, {
    entityType: 'social_post',
    entityId: id,
    action: 'note',
    actor,
    meta: { edited_fields: Object.keys(patch).filter(k => k !== 'updated_at'), notes },
  })

  return NextResponse.json({ ok: true })
}
