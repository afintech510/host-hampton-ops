/**
 * `renderEvite` and `queueRender` (spec §5).
 *
 * Satori -> SVG -> sharp(librsvg) -> JPEG, with NO NETWORK at render time:
 * Satori is called directly (never through `next/og`, whose bundled loader fetches
 * Google Fonts and jsdelivr) with fonts and images read from disk and no
 * `loadAdditionalAsset`. The only network this module touches is the one
 * Supabase Storage upload, through the client it is handed.
 *
 *   renderEvite(supabase, eviteId, { force? })
 *     -> { kind: 'fresh' }                    nothing printed has changed
 *      | { kind: 'busy', reason? }            another worker holds the claim, or took over
 *      | { kind: 'rendered', version, ... }   new objects are live
 *      | { kind: 'failed', reason }           `render_error` is set (when a claim was held)
 *      | { kind: 'skipped', reason }          switched off / withdrawn: nothing to draw, nothing written
 *
 * It NEVER throws, and it never leaves a claim behind that it took.
 *
 * Steps (spec §5), with where each lives below:
 *   1 load       evite, booking, payments, line items, themes -> state -> facts -> hash.
 *                Equal hash and objects present -> `fresh` (unless `force`).
 *                A FAILED READ is `failed 'read-failed'`, never a render of the
 *                preview state: an empty payments list reads as "not booked".
 *   2 claim      `render_claim = token` where it is NULL, else where the claim is
 *                over two minutes old. Two plain filters, no interpolated `.or()`.
 *                Each is a conditional UPDATE read back with `.select('id')`.
 *   3-5 draw     computeSizes -> InviteCanvas('satori') 1085x1530 -> portrait JPEG;
 *                the portrait downscaled to 397x560 inside the 1200x630 OG card.
 *                The card must come in under 300,000 bytes or it is never stored.
 *   6 upload     `<image_key>/invite-v<n>-<sfx>.jpg` and `og-v<n>-<sfx>.jpg`, `sfx`
 *                random per attempt so a half-failed attempt can never block its
 *                retry. `upsert:false`, a year of cache.
 *   7 finalize   UPDATE ... WHERE id AND render_claim = token. ZERO ROWS means
 *                another worker took over: its result stands, ours are orphans.
 *   8 failure    release the claim and record the reason. The previous objects
 *                keep being served.
 *
 * `image_key` is 32 random hex, made on the first render and stored with it; it
 * is independent of the slug so a re-slug never moves an image a mail client has
 * already cached.
 */

import { randomBytes, randomUUID } from 'crypto'
import sharp from 'sharp'
import { getSupabase } from '@/lib/supabase'
import { InviteCanvas } from '@/components/evites/InviteCanvas'
import { OgCard } from '@/components/evites/OgCard'
import { loadTemplateAssets, ogBackgroundUri, satoriFonts } from '@/lib/evites/assets'
import { evitePagesMode, isPilotBooking } from '@/lib/evites/config'
import { inviteFacts, type InviteFactsEvite } from '@/lib/evites/facts'
import { renderInputsHash } from '@/lib/evites/hash'
import { computeSizes, ogSizes, ogTexts, OG_HEIGHT, OG_WIDTH } from '@/lib/evites/layout'
import { inviteState } from '@/lib/evites/state'
import { templateFor } from '@/lib/evites/templates'
import { readThemeInputs } from '@/lib/evites/themeInputs'
import { EVITE_BOOKING_COLUMNS, EVITE_PAYMENT_COLUMNS } from '@/lib/evites/views'
import type { EviteBookingRow, EvitePaymentRow } from '@/lib/evites/types'

type Supa = ReturnType<typeof getSupabase>

export const EVITE_BUCKET = 'evites'
export const OG_MAX_BYTES = 300_000
export const CLAIM_STALE_MS = 2 * 60 * 1000
export const INVITE_JPEG_QUALITY = 86
export const OG_JPEG_QUALITY = 82
export const MAX_WAITING_RENDERS = 20

/** The `evites` columns a render reads. No `select('*')`. */
export const EVITE_RENDER_COLUMNS = [
  'id',
  'booking_id',
  'template_slug',
  'theme_word',
  'theme_sub',
  'host_contact_name',
  'host_contact_phone',
  'show_host_contact',
  'host_note',
  'gift_note',
  'rsvp_deadline',
  'render_version',
  'render_inputs_hash',
  'image_key',
  'invite_object',
  'og_object',
  'archived_at',
] as const

interface RenderEviteRow extends InviteFactsEvite {
  id: string
  booking_id: string
  render_version: number
  render_inputs_hash: string | null
  image_key: string | null
  invite_object: string | null
  og_object: string | null
  archived_at: string | null
}

export type RenderOutcome =
  | { kind: 'fresh' }
  | { kind: 'busy'; reason: 'claimed' | 'taken-over' }
  | { kind: 'rendered'; version: number; inviteObject: string; ogObject: string; inviteBytes: number; ogBytes: number; ms: number }
  | { kind: 'failed'; reason: string }
  | { kind: 'skipped'; reason: 'state-disabled' | 'state-unavailable' }

export interface RenderOptions {
  /** Render even when the inputs hash is unchanged (admin "Re-render"). */
  force?: boolean
  /** Test seams. */
  now?: Date
  ogMaxBytes?: number
}

/** A failure with a stable, short `render_error` code. Anything else is reported as `render-failed: <message>`. */
class RenderFailure extends Error {
  constructor(public readonly code: string) {
    super(code)
  }
}

function describe(e: unknown): string {
  if (e instanceof RenderFailure) return e.code
  const msg = e instanceof Error ? e.message : String(e)
  return `render-failed: ${msg}`.slice(0, 200)
}

/** Record `render_error` where a claim is NOT held (nothing is being rendered, so nobody's claim is touched). Best effort; the outcome is `failed` either way. */
async function recordUnclaimedError(supabase: Supa, eviteId: string, reason: string): Promise<void> {
  try {
    const { error } = await supabase.from('evites').update({ render_error: reason }).eq('id', eviteId).is('render_claim', null)
    if (error) console.error(`evites/render: could not record render_error for ${eviteId}: ${error.message}`)
  } catch (e) {
    console.error(`evites/render: could not record render_error for ${eviteId}: ${describe(e)}`)
  }
}

/** Step 8: release the claim WE hold and record why. A takeover (someone else's claim) is left alone. */
async function releaseClaim(supabase: Supa, eviteId: string, token: string, reason: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('evites')
      .update({ render_claim: null, render_error: reason })
      .eq('id', eviteId)
      .eq('render_claim', token)
    if (error) console.error(`evites/render: could not release claim on ${eviteId}: ${error.message}`)
  } catch (e) {
    console.error(`evites/render: could not release claim on ${eviteId}: ${describe(e)}`)
  }
}

/** Step 2. A claim is two conditional UPDATEs, each read back; no row from either is `busy`. */
async function takeClaim(supabase: Supa, eviteId: string, token: string, now: Date): Promise<'claimed' | 'busy' | { error: string }> {
  const nowIso = now.toISOString()
  const fresh = await supabase
    .from('evites')
    .update({ render_claim: token, render_claimed_at: nowIso })
    .eq('id', eviteId)
    .is('render_claim', null)
    .select('id')
  if (fresh.error) return { error: `claim-failed: ${fresh.error.message}` }
  if (fresh.data && fresh.data.length > 0) return 'claimed'

  const staleBefore = new Date(now.getTime() - CLAIM_STALE_MS).toISOString()
  const stale = await supabase
    .from('evites')
    .update({ render_claim: token, render_claimed_at: nowIso })
    .eq('id', eviteId)
    .lt('render_claimed_at', staleBefore)
    .select('id')
  if (stale.error) return { error: `claim-failed: ${stale.error.message}` }
  return stale.data && stale.data.length > 0 ? 'claimed' : 'busy'
}

async function toJpeg(svg: string, background: string, quality: number): Promise<Buffer> {
  return sharp(Buffer.from(svg)).flatten({ background }).jpeg({ quality, mozjpeg: true }).toBuffer()
}

export async function renderEvite(supabase: Supa, eviteId: string, opts: RenderOptions = {}): Promise<RenderOutcome> {
  const started = Date.now()
  const now = opts.now ?? new Date()
  let token: string | null = null
  try {
    // ---- 1. load -------------------------------------------------------------------------------
    const ev = await supabase.from('evites').select(EVITE_RENDER_COLUMNS.join(', ')).eq('id', eviteId).maybeSingle<RenderEviteRow>()
    if (ev.error) {
      console.error(`evites/render: evite read failed: ${ev.error.message}`)
      return { kind: 'failed', reason: 'read-failed' }
    }
    const evite = ev.data
    if (!evite) return { kind: 'failed', reason: 'evite-missing' }

    const bk = await supabase.from('bookings').select(EVITE_BOOKING_COLUMNS.join(', ')).eq('id', evite.booking_id).maybeSingle<EviteBookingRow>()
    if (bk.error) {
      console.error(`evites/render: booking read failed: ${bk.error.message}`)
      await recordUnclaimedError(supabase, eviteId, 'read-failed')
      return { kind: 'failed', reason: 'read-failed' }
    }
    const booking = bk.data
    if (!booking) return { kind: 'failed', reason: 'booking-missing' }

    // A failed payments read must not become "no payments", which `inviteState` reads as preview.
    const pay = await supabase.from('booking_payments').select(EVITE_PAYMENT_COLUMNS.join(', ')).eq('booking_id', booking.id)
    if (pay.error) {
      console.error(`evites/render: booking_payments read failed: ${pay.error.message}`)
      await recordUnclaimedError(supabase, eviteId, 'read-failed')
      return { kind: 'failed', reason: 'read-failed' }
    }
    const payments = (pay.data ?? []) as unknown as EvitePaymentRow[]

    const themes = await readThemeInputs(supabase, booking.id)
    if (themes.kind === 'unavailable') {
      console.error(`evites/render: ${themes.reason}`)
      await recordUnclaimedError(supabase, eviteId, 'read-failed')
      return { kind: 'failed', reason: 'read-failed' }
    }

    const state = inviteState(booking, payments, evite, now, {
      pagesMode: evitePagesMode(),
      isPilot: isPilotBooking(booking.booking_ref),
    })
    // Nothing to draw for a switched-off or withdrawn invitation. Not a pipeline error: no render_error.
    if (state === 'disabled' || state === 'unavailable') return { kind: 'skipped', reason: `state-${state}` }

    const facts = inviteFacts(booking, evite, themes.lineItems, themes.partyThemes, state)
    const hash = renderInputsHash(facts)
    if (!opts.force && hash === evite.render_inputs_hash && evite.invite_object && evite.og_object) return { kind: 'fresh' }

    // ---- 2. claim ------------------------------------------------------------------------------
    const myToken = randomUUID()
    const claim = await takeClaim(supabase, eviteId, myToken, now)
    if (claim === 'busy') return { kind: 'busy', reason: 'claimed' }
    if (typeof claim === 'object') {
      console.error(`evites/render: ${claim.error}`)
      return { kind: 'failed', reason: 'claim-failed' }
    }
    token = myToken

    // ---- 3-5. draw -----------------------------------------------------------------------------
    const template = templateFor(facts.templateSlug)
    const sizes = computeSizes(template, facts)
    const assets = loadTemplateAssets(template)
    const fonts = satoriFonts()
    const { default: satori } = await import('satori')

    const inviteSvg = await satori(InviteCanvas({ template, facts, sizes, mode: 'satori', assets }), {
      width: template.canvas.width,
      height: template.canvas.height,
      fonts,
      embedFont: true,
    })
    const invite = await toJpeg(inviteSvg, template.backgroundColor, INVITE_JPEG_QUALITY)

    const portraitWidth = Math.round((template.ogCard.portraitHeight * template.canvas.width) / template.canvas.height)
    const portrait = await sharp(invite).resize(portraitWidth, template.ogCard.portraitHeight, { fit: 'fill' }).jpeg({ quality: 90 }).toBuffer()
    const texts = ogTexts(facts)
    const ogSvg = await satori(
      OgCard({
        template,
        texts,
        sizes: ogSizes(texts, template),
        portraitSrc: `data:image/jpeg;base64,${portrait.toString('base64')}`,
        backgroundSrc: await ogBackgroundUri(template),
      }),
      { width: OG_WIDTH, height: OG_HEIGHT, fonts, embedFont: true },
    )
    const og = await toJpeg(ogSvg, template.backgroundColor, OG_JPEG_QUALITY)
    if (og.length >= (opts.ogMaxBytes ?? OG_MAX_BYTES)) throw new RenderFailure('og-too-large')

    // ---- 6. upload -----------------------------------------------------------------------------
    const imageKey = evite.image_key ?? randomBytes(16).toString('hex')
    const version = evite.render_version + 1
    const sfx = randomBytes(2).toString('hex')
    const inviteObject = `invite-v${version}-${sfx}.jpg`
    const ogObject = `og-v${version}-${sfx}.jpg`
    for (const [name, body] of [
      [inviteObject, invite],
      [ogObject, og],
    ] as const) {
      const { error } = await supabase.storage
        .from(EVITE_BUCKET)
        .upload(`${imageKey}/${name}`, body, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false })
      if (error) throw new RenderFailure(`upload-failed: ${error.message}`.slice(0, 200))
    }

    // ---- 7. finalize ---------------------------------------------------------------------------
    const fin = await supabase
      .from('evites')
      .update({
        render_version: version,
        render_inputs_hash: hash,
        image_key: imageKey,
        invite_object: inviteObject,
        og_object: ogObject,
        rendered_at: new Date().toISOString(),
        render_claim: null,
        render_error: null,
      })
      .eq('id', eviteId)
      .eq('render_claim', token)
      .select('id')
    if (fin.error) throw new RenderFailure(`finalize-failed: ${fin.error.message}`.slice(0, 200))
    if (!fin.data || fin.data.length === 0) {
      // Another worker took over after our claim went stale. Its result stands; our objects are harmless orphans.
      token = null
      return { kind: 'busy', reason: 'taken-over' }
    }
    token = null
    return {
      kind: 'rendered',
      version,
      inviteObject,
      ogObject,
      inviteBytes: invite.length,
      ogBytes: og.length,
      ms: Date.now() - started,
    }
  } catch (e) {
    // ---- 8. failure ----------------------------------------------------------------------------
    const reason = describe(e)
    console.error(`evites/render: ${eviteId}: ${reason}`)
    if (token) await releaseClaim(supabase, eviteId, token, reason)
    return { kind: 'failed', reason }
  }
}

// ------------------------------------------------------------------------------------------------
// The process queue (spec §5): concurrency 1, at most 20 waiting. Beyond that a render is DROPPED and
// the cron's "hash differs" sweep catches up. Held on `globalThis` so every route bundle shares one.

interface QueueItem {
  eviteId: string
  run: (eviteId: string) => Promise<unknown>
}
interface RenderQueue {
  waiting: QueueItem[]
  running: boolean
}

function queue(): RenderQueue {
  const g = globalThis as { __eviteRenderQueue?: RenderQueue }
  return (g.__eviteRenderQueue ??= { waiting: [], running: false })
}

function pump(q: RenderQueue): void {
  if (q.running) return
  const item = q.waiting.shift()
  if (!item) return
  q.running = true
  void Promise.resolve()
    .then(() => item.run(item.eviteId))
    .catch((e: unknown) => console.error(`evites/render: queued render of ${item.eviteId} threw: ${describe(e)}`))
    .finally(() => {
      q.running = false
      pump(q)
    })
}

/**
 * Fire-and-forget: add a render of `eviteId` to the process queue and return at once.
 * `queued` also covers "already waiting" (one pending render per evite is enough).
 * `dropped` means 20 are already waiting; the cron will pick it up.
 */
export function queueRender(
  eviteId: string,
  opts: { run?: (eviteId: string) => Promise<unknown> } = {},
): 'queued' | 'dropped' {
  const q = queue()
  if (q.waiting.some((w) => w.eviteId === eviteId)) return 'queued'
  if (q.waiting.length >= MAX_WAITING_RENDERS) return 'dropped'
  q.waiting.push({ eviteId, run: opts.run ?? ((id) => renderEvite(getSupabase(), id)) })
  pump(q)
  return 'queued'
}

