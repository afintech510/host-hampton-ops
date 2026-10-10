/**
 * Everything the public invitation page decides that is not drawing: which
 * ribbon, which notes, which share card. Pure, so the page component stays a
 * thin shell and this is tested behaviourally (the repo's jest is node-only).
 *
 * Spec §4 (copy per state), §5 "OG metadata", §7.1, D15.
 *
 * D15: the public page shows NO counts of RSVPs, anywhere. Nothing in this model
 * is derived from `evite_rsvps`, and the page never reads that table.
 */

import type { Metadata } from 'next'
import { NOINDEX, OG_DEFAULT_IMAGE } from '@/lib/seo'
import { CANONICAL_ORIGIN } from '@/lib/publicOrigin'
import { etToUtc, PARTY_TZ } from '@/lib/partyTime'
import type { InviteFacts } from '@/lib/evites/facts'
import type { EvitePageRow, VisibleInviteState } from '@/lib/evites/resolve'

/** The share card is always 1200x630 JPEG (render.ts `OG_WIDTH` x `OG_HEIGHT`). */
export const OG_CARD = { width: 1200, height: 630, type: 'image/jpeg' } as const

export const PREVIEW_NOTE = 'RSVPs open once the party is booked'

export type RibbonTone = 'preview' | 'soon' | 'done'

export interface InviteRibbon {
  /** The headline in the ribbon. */
  text: string
  /** A second line, or null. */
  note: string | null
  tone: RibbonTone
}

export interface InvitePageModel {
  state: VisibleInviteState
  ribbon: InviteRibbon | null
  /** True only for `live`: the RSVP island is mounted. */
  showRsvp: boolean
  /** The date / place / host lines as plain text (the canvas is an image to a screen reader). */
  details: { dateLine: string; placeLine: string; hostContactLine: string | null }
  hostNote: string | null
  giftNote: string | null
  /** 'Sunday, November 8', or null. Not shown once the party has happened. */
  rsvpByText: string | null
}

/** A `YYYY-MM-DD` Eastern calendar date as 'Sunday, November 8'. Never `new Date(x + 'T..')`: the box is UTC. */
export function longDateText(isoDate: string): string | null {
  const noon = etToUtc(isoDate, 12, 0)
  if (Number.isNaN(noon.getTime())) return null
  return new Intl.DateTimeFormat('en-US', { timeZone: PARTY_TZ, weekday: 'long', month: 'long', day: 'numeric' }).format(noon)
}

/**
 * The birthday child's first name in the case the family typed it ('Mia', 'DeShawn'), for
 * sentences like "Leave a note for Mia". `honoreeDisplay` is the upper-case IMAGE string, so
 * the name is read back out of `title` ("Mia's Glow Party"); null when the booking has no name.
 */
export function honoreeFirstName(facts: Pick<InviteFacts, 'hasName' | 'title'>): string | null {
  if (!facts.hasName) return null
  const at = facts.title.indexOf("'s ")
  return at > 0 ? facts.title.slice(0, at) : null
}

export function ribbonFor(state: VisibleInviteState): InviteRibbon | null {
  switch (state) {
    case 'preview':
      return { text: 'Preview', note: PREVIEW_NOTE, tone: 'preview' }
    case 'needs_time':
      return { text: 'Time coming soon', note: null, tone: 'soon' }
    case 'closed':
      // An emoji is fine on the PAGE. It is never in the image (spec §3).
      return { text: 'This party has happened \u{1F389}', note: null, tone: 'done' }
    case 'live':
      return null
  }
}

export function invitePageModel(state: VisibleInviteState, facts: InviteFacts): InvitePageModel {
  return {
    state,
    ribbon: ribbonFor(state),
    showRsvp: state === 'live',
    details: { dateLine: facts.dateLine, placeLine: facts.placeLine, hostContactLine: facts.hostContactLine },
    hostNote: facts.hostNote,
    giftNote: facts.giftNote,
    rsvpByText: state !== 'closed' && facts.rsvpDeadline ? longDateText(facts.rsvpDeadline) : null,
  }
}

// ---------------------------------------------------------------- metadata

const IMAGE_KEY = /^[0-9a-f]{32}$/
const OG_OBJECT = /^og-v\d{1,6}-[0-9a-f]{4}\.jpg$/

/** The static fallback card, absolute against the CANONICAL origin (never a request header). */
export function defaultOgImageUrl(): string {
  return `${CANONICAL_ORIGIN}${OG_DEFAULT_IMAGE.url}`
}

/**
 * The stored share card for this invitation, or the static default when no
 * render has landed yet (or the stored names are not what the renderer writes).
 * `supabaseUrl` is `SUPABASE_URL`, passed in so a test can pin it.
 */
export function ogImageUrl(evite: Pick<EvitePageRow, 'image_key' | 'og_object'>, supabaseUrl: string | undefined): string {
  const base = (supabaseUrl ?? '').trim().replace(/\/+$/, '')
  if (!base || !evite.image_key || !evite.og_object) return defaultOgImageUrl()
  if (!IMAGE_KEY.test(evite.image_key) || !OG_OBJECT.test(evite.og_object)) return defaultOgImageUrl()
  return `${base}/storage/v1/object/public/evites/${evite.image_key}/${evite.og_object}`
}

/**
 * The page's `<head>`. Same HTML for a link-preview bot and a person (no
 * user-agent branch exists anywhere). `robots` is noindex/nofollow; the
 * `X-Robots-Tag` header and `<meta name="referrer">` are layered on by
 * `next.config.js` and the `/i` layout.
 *
 * `title` is `absolute`: the root template would append " | Host Hampton" to a
 * card that already says it. Both `openGraph` and `twitter` replace the root
 * layout's whole object (shallow merge, see lib/seo.ts), so each states its image.
 */
export function inviteMetadata(slug: string, evite: Pick<EvitePageRow, 'image_key' | 'og_object'>, facts: Pick<InviteFacts, 'title' | 'description'>, supabaseUrl: string | undefined): Metadata {
  const image = ogImageUrl(evite, supabaseUrl)
  const stored = image !== defaultOgImageUrl()
  const ogImage = stored
    ? { url: image, width: OG_CARD.width, height: OG_CARD.height, type: OG_CARD.type, alt: facts.title }
    : { url: image, width: OG_DEFAULT_IMAGE.width, height: OG_DEFAULT_IMAGE.height, type: 'image/png', alt: OG_DEFAULT_IMAGE.alt }
  return {
    title: { absolute: facts.title },
    description: facts.description,
    robots: NOINDEX,
    openGraph: {
      type: 'website',
      siteName: 'Host Hampton',
      locale: 'en_US',
      title: facts.title,
      description: facts.description,
      url: `${CANONICAL_ORIGIN}/i/${slug}`,
      images: [ogImage],
    },
    twitter: {
      card: 'summary_large_image',
      title: facts.title,
      description: facts.description,
      images: [image],
    },
  }
}

/** The one `<head>` an unavailable invitation gets, identical for unknown / archived / cancelled / off / throttled. */
export function unavailableMetadata(): Metadata {
  return {
    title: { absolute: "This invitation isn't available | Host Hampton" },
    robots: NOINDEX,
  }
}
