import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { adminActorId, isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { advance, writeLedger, IllegalTransitionError, TransitionNotAuthorizedError } from '@/lib/marketing/graph'
import { releasesAllSigned } from '@/lib/marketing/consent'
import { checkSlug } from '@/lib/content/slugSafety'
import { revalidateContent } from '@/lib/content/published'
import { MAX_DESCRIPTION_CHARS } from '@/lib/seo'
import { trimToBudget, trimTitleToBudget } from '@/lib/content/draftNormalize'
import { htmlToPlainText } from '@/lib/content/contentSafety'
import type { Locale } from '@/lib/content/slug'

export const dynamic = 'force-dynamic'

// `isAdmin` is unchanged — this route is already behind isAdminAuthorized. The
// id now NAMES the person when a session cookie says who they are (plan §11.1),
// and falls back to the historical anonymous 'admin' on the shared password.
const adminActor = (req: NextRequest) => ({ id: adminActorId(req), isAdmin: true })

const asLocale = (v: unknown): Locale => (v === 'es' ? 'es' : 'en')

/**
 * Advance a website_content row through the publishing graph. The ONLY status
 * writer for content — everything goes through advance(), which validates the
 * transition, enforces the admin gate, and writes a ledger row.
 *
 * Body: { id, to, reason? }
 *   to ∈ pending_review | approved | published | draft | archived
 *
 * `approved` and `published` stay GATED in lib/marketing/graph.ts: nothing an
 * agent writes can publish itself, exactly as `inquiry_draft` works.
 */
export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const supabase = getSupabase()
  const body = (await req.json()) as { id?: string; to?: string; reason?: string }
  const { id, to, reason } = body

  if (!id || !to) {
    return NextResponse.json({ error: 'id and to are required' }, { status: 400 })
  }

  const { data: row, error: readErr } = await supabase
    .from('website_content')
    .select('slug, locale, references_child_media, consent_release_ids')
    .eq('id', id)
    .maybeSingle()

  // Rule 12 — three outcomes. A failed read must not be answered as "no such
  // row", because the caller would then create a second one or conclude the
  // publish is impossible.
  if (readErr) {
    return NextResponse.json({ error: 'Could not read this content row — try again.' }, { status: 503 })
  }
  if (!row) {
    return NextResponse.json({ error: 'No content row with that id.' }, { status: 404 })
  }

  const slug = row.slug as string
  const locale = asLocale(row.locale)

  if (to === 'approved' || to === 'published') {
    // Friendly consent pre-check (layer 2) before the DB trigger (layer 1) fires,
    // so the admin gets a clear message rather than a raw SQL error.
    if (row.references_child_media) {
      const ok = await releasesAllSigned(supabase, row.consent_release_ids as string[] | null)
      if (!ok) {
        return NextResponse.json(
          { error: 'Consent gate: this content references child media and needs a signed release attached before it can be approved or published.' },
          { status: 409 }
        )
      }
    }
  }

  // Publishing CREATES A URL, and a slug shadowed by a hand-built page creates
  // a URL that renders somebody else's content — the row goes `published`, the
  // sitemap gains a duplicate entry, and the page never appears. Refuse, and
  // say which page is in the way rather than failing silently (rule 10).
  if (to === 'published') {
    const check = checkSlug(slug, locale)
    if (!check.ok) {
      return NextResponse.json(
        { error: `Cannot publish at ${check.path}: ${check.message}`, code: check.code, path: check.path },
        { status: 409 }
      )
    }
  }

  const patch: Record<string, unknown> = {
    // Was the literal 'admin'. The ledger already names the person; the row's
    // own review stamp should too — five sessions have removed a hardcoded
    // actor and this was the last one on the content path.
    reviewed_by: adminActorId(req),
    reviewed_at: new Date().toISOString(),
  }
  if (to === 'published') patch.published_at = new Date().toISOString()

  try {
    const result = await advance({
      entity: 'website_content',
      id,
      to,
      actor: adminActor(req),
      patch,
      meta: reason ? { reason } : undefined,
      supabase,
    })
    // Every status change alters what the public renderer should serve —
    // publishing, archiving and un-publishing alike. Flush before answering, so
    // the admin's own reload after clicking Publish shows the new page.
    revalidateContent()
    return NextResponse.json({ ok: true, ...result, path: `/${locale === 'es' ? 'es/' : ''}${slug}` })
  } catch (err) {
    if (err instanceof IllegalTransitionError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    if (err instanceof TransitionNotAuthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 403 })
    }
    const msg = err instanceof Error ? err.message : 'advance failed'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}

/**
 * Edit the fields a reviewer actually needs to fix before approving: the title,
 * the meta description and the slug.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS. Before it, the pipeline could be watched but not corrected.
 * The one published row carries a 165-character meta description — over
 * Google's limit — and the only way to change it was a SQL client. A reviewer
 * who can approve and publish but cannot fix a title is not a reviewer.
 *
 * It is a WHITELIST, and `status` is not on it. Status moves through advance()
 * and nowhere else, so this route cannot become a second, ungated publish door.
 * `body_html`, `structured` and `featured_image` are not on it either: those
 * are the fields the renderer treats as content, and hand-editing JSON through
 * a text box is how a reviewer accidentally empties a page.
 *
 * Body: { id, title?, meta_description?, slug?, locale? }
 */
export async function PATCH(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const supabase = getSupabase()
  const body = (await req.json()) as {
    id?: string
    title?: string
    meta_description?: string
    slug?: string
    locale?: string
  }
  if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const { data: row, error: readErr } = await supabase
    .from('website_content')
    .select('slug, locale, status, title, meta_description')
    .eq('id', body.id)
    .maybeSingle()

  if (readErr) {
    return NextResponse.json({ error: 'Could not read this content row — try again.' }, { status: 503 })
  }
  if (!row) return NextResponse.json({ error: 'No content row with that id.' }, { status: 404 })

  const patch: Record<string, unknown> = {}
  const notes: string[] = []

  // Plain text, then the same budget the writer enforces — imported from
  // lib/seo.ts, not restated (rule 11). An admin pasting a 200-character
  // description gets the same treatment the agent does.
  if (typeof body.title === 'string') {
    const clean = htmlToPlainText(body.title).replace(/\s+/g, ' ').trim()
    if (!clean) return NextResponse.json({ error: 'Title cannot be empty.' }, { status: 400 })
    const fitted = trimTitleToBudget(clean)
    if (fitted !== clean) notes.push(`title trimmed from ${clean.length} to ${fitted.length} characters`)
    patch.title = fitted
  }
  if (typeof body.meta_description === 'string') {
    const clean = htmlToPlainText(body.meta_description).replace(/\s+/g, ' ').trim()
    const fitted = trimToBudget(clean, MAX_DESCRIPTION_CHARS)
    if (fitted !== clean) notes.push(`description trimmed from ${clean.length} to ${fitted.length} characters`)
    patch.meta_description = fitted || null
  }

  const nextLocale = body.locale === undefined ? asLocale(row.locale) : asLocale(body.locale)
  const nextSlug = body.slug === undefined ? (row.slug as string) : body.slug.trim()

  if (nextSlug !== row.slug || nextLocale !== asLocale(row.locale)) {
    const check = checkSlug(nextSlug, nextLocale)
    if (!check.ok) {
      return NextResponse.json({ error: check.message, code: check.code, path: check.path }, { status: 422 })
    }
    patch.slug = nextSlug
    patch.locale = nextLocale
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: true, changed: [], notes: [] })
  }

  const { error: updErr } = await supabase.from('website_content').update(patch).eq('id', body.id)
  if (updErr) {
    // A (slug, locale) collision with another row is the expected failure here.
    if ((updErr as { code?: string }).code === '23505') {
      return NextResponse.json(
        { error: `Another content row already uses "${nextSlug}" (${nextLocale}).` },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: 'Could not save the change — try again.' }, { status: 503 })
  }

  await writeLedger(supabase, {
    entityType: 'website_content',
    entityId: body.id,
    action: 'note',
    actor: adminActorId(req),
    meta: {
      edited_fields: Object.keys(patch),
      ...(patch.slug ? { slug_from: row.slug, slug_to: patch.slug, locale_to: patch.locale } : {}),
      ...(notes.length ? { normalizer_notes: notes } : {}),
    },
  })

  // A slug change moves the page; flush regardless of which field changed,
  // because both the row cache and the index (which keys on slug) are stale.
  revalidateContent()

  return NextResponse.json({ ok: true, changed: Object.keys(patch), notes })
}
