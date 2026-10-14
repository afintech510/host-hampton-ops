import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import { InviteCanvas } from '@/components/evites/InviteCanvas'
import InviteImage from '@/components/evites/InviteImage'
import RsvpIsland from '@/components/evites/RsvpIsland'
import ScaledCanvas from '@/components/evites/ScaledCanvas'
import ViewBeacon from '@/components/evites/ViewBeacon'
import { computeSizes } from '@/lib/evites/layout'
import { honoreeFirstName, inviteImageUrl, invitePageModel, inviteMetadata, unavailableMetadata, type RibbonTone } from '@/lib/evites/pageModel'
import type { OwnRsvp } from '@/lib/evites/rsvpView'
import { templateForFacts } from '@/lib/evites/customArt'
import { loadInvite } from './loadInvite'
import { loadRsvpPanel } from './loadOwnRsvp'

/**
 * The public invitation (spec §7.1). Unauthenticated, unindexed, throttled.
 *
 *   - `force-dynamic`: it reads `headers()` for the rate limiter, and the state
 *     (live / closed) depends on the clock.
 *   - NO `loading.tsx` under `/i`: streaming a shell before `notFound()` would
 *     turn a 404 into a 200.
 *   - NO side effects on GET. Views are recorded by `ViewBeacon` ->
 *     `POST /api/i/[slug]/event`, so a bot or a prefetch counts as nothing.
 *   - The same HTML for a link-preview bot and a person.
 *   - Every unavailable outcome is the SAME `notFound()`: unknown, archived,
 *     cancelled, lost, switched off, and throttled.
 *   - It shows NO counts of RSVPs (D15) and never renders another guest's row: the
 *     only RSVP it reads is the CALLER'S OWN, through their edit cookie
 *     (`loadOwnRsvp`), and only for a `live` party.
 *
 * `loadInvite` is the request-cached guarded load: the rate limiter first, then
 * the database, once per request even though `generateMetadata` calls it too.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Flag = string | string[] | undefined
type Props = { params: { slug: string }; searchParams?: { edit?: Flag; stopped?: Flag } }

/** `?edit=1` / `?stopped=1`: only the exact value `1` counts. */
const flag = (v: Flag): boolean => (Array.isArray(v) ? v[0] : v) === '1'

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  try {
    const r = await loadInvite(params.slug)
    if (r.kind !== 'ok') return unavailableMetadata()
    return inviteMetadata(params.slug, r.evite, r.facts, process.env.SUPABASE_URL)
  } catch {
    // The page's own call to the same cached load throws too and renders error.tsx (500).
    return unavailableMetadata()
  }
}

const RIBBON_STYLE: Record<RibbonTone, string> = {
  preview: 'bg-amber-300/95 text-[#3b2400]',
  soon: 'bg-sky-200/95 text-[#06304a]',
  done: 'bg-white/90 text-[#1b0630]',
}

export default async function InvitePage({ params, searchParams }: Props) {
  const r = await loadInvite(params.slug)
  if (r.kind === 'redirect') permanentRedirect(`/i/${r.slug}`) // 308
  if (r.kind !== 'ok') notFound()

  const model = invitePageModel(r.state, r.facts)
  const template = templateForFacts(r.facts, process.env.SUPABASE_URL)
  const sizes = computeSizes(template, r.facts)
  // The stored picture when a render exists (a plain responsive <img>); the web canvas only before the first render.
  const image = inviteImageUrl(r.evite, process.env.SUPABASE_URL)

  // Only a live party takes RSVPs. The caller's own answer (if their cookie verifies) and the current club wording.
  let own: OwnRsvp | null = null
  let club: { version: string; wording: string } | null = null
  if (model.showRsvp) ({ own, club } = await loadRsvpPanel(r.evite.id))

  return (
    <div className="hh-inv-col">
      {model.ribbon && (
        <div role="status" className={`mb-4 rounded-xl px-4 py-2.5 text-center ${RIBBON_STYLE[model.ribbon.tone]}`}>
          <p className="text-sm font-bold uppercase tracking-wide">{model.ribbon.text}</p>
          {model.ribbon.note && <p className="mt-0.5 text-xs">{model.ribbon.note}</p>}
        </div>
      )}

      {flag(searchParams?.stopped) && (
        <div role="status" className="mb-4 rounded-xl bg-emerald-200/95 px-4 py-2.5 text-center text-[#06301a]">
          <p className="text-sm font-bold">Reminders stopped</p>
          <p className="mt-0.5 text-xs">We won&apos;t send you any more reminders about this party.</p>
        </div>
      )}

      {image ? (
        <InviteImage src={image} alt={`${r.facts.title}. ${r.facts.dateLine}`} maxWidth={540} eager className="hh-inv-img" />
      ) : (
        <ScaledCanvas frameClassName="hh-inv-frame" canvasClassName="hh-inv-canvas" initialScale={0.316}>
          <InviteCanvas template={template} facts={r.facts} sizes={sizes} mode="web" />
        </ScaledCanvas>
      )}

      {/* The picture is an image to a screen reader; the same facts, as text. */}
      <section aria-label="Party details" className="mt-5 rounded-xl bg-white/10 px-4 py-3 text-sm">
        <p className="font-semibold">{model.details.dateLine}</p>
        <p className="text-white/80">
          {model.details.placeMapsUrl ? (
            // A plain anchor to Google Maps; the picture itself cannot carry a link.
            <a href={model.details.placeMapsUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
              {model.details.placeLine}
            </a>
          ) : (
            model.details.placeLine
          )}
        </p>
        {model.details.hostContactLine && <p className="mt-1 text-white/70">{model.details.hostContactLine}</p>}
      </section>

      {(model.hostNote || model.giftNote || model.rsvpByText) && (
        <section aria-label="Notes from the host" className="mt-4 space-y-2 text-sm text-white/90">
          {model.hostNote && <p>{model.hostNote}</p>}
          {model.giftNote && (
            <p>
              <span className="font-semibold">Gifts: </span>
              {model.giftNote}
            </p>
          )}
          {model.rsvpByText && (
            <p>
              <span className="font-semibold">Please RSVP by </span>
              {model.rsvpByText}
            </p>
          )}
        </section>
      )}

      {model.showRsvp && (
        <RsvpIsland slug={params.slug} own={own} startInEdit={!!own && flag(searchParams?.edit)} honoree={honoreeFirstName(r.facts)} club={club} />
      )}

      <ViewBeacon slug={params.slug} />
    </div>
  )
}
