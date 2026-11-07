/**
 * Short links for crew texts (Adam, 2026-11-07): a party link is about 80 characters and a
 * calendar link is longer, and every segment of a text is billed. Each of our own links in a
 * body becomes a `/s/<22 characters>` link (48) at SEND time, so the text that was stored, the
 * email and the in-app copy all keep the full address.
 *
 * Built on `lib/shortLink.ts` (our own domain, never a public shortener: carriers filter
 * those). Minting is non-fatal by that module's contract: a link that could not be shortened
 * goes out whole, because a text with no working link is worse than a text one segment longer.
 * Only OUR links are touched, and a `/s/` link already is one.
 */

import type { getSupabase } from '@/lib/supabase'
import { createShortLink } from '@/lib/shortLink'
import { reviewLinkSecret } from '@/lib/agent/config'
import { TENANT } from '@/tenant'

type Supa = ReturnType<typeof getSupabase>

/** How long a crew short link works. Long: a "new party" text is acted on days later. */
export const CREW_SHORT_LINK_TTL_MS = 45 * 24 * 60 * 60 * 1000

/** Our own host, with or without `www.`, read from the tenant rather than written here. */
const OWN_HOST = new URL(TENANT.business.siteUrl).hostname.replace(/^www\./, '').replace(/\./g, '\\.')
/** Our own https links, up to the next space. Trailing punctuation is the sentence's, not the link's. */
const OWN_LINK = new RegExp(`https://(?:www\\.)?${OWN_HOST}/[^\\s]*`, 'g')
const ALREADY_SHORT = new RegExp(`^https://(?:www\\.)?${OWN_HOST}/s/`)
const TRAILING = /[.,;:!?)\]]+$/

export async function shortenCrewLinks(sb: Supa, text: string, now: Date = new Date()): Promise<string> {
  const found = Array.from(new Set(text.match(OWN_LINK) ?? []))
  if (found.length === 0) return text
  const secret = reviewLinkSecret()
  let out = text
  for (const raw of found) {
    const tail = (raw.match(TRAILING) ?? [''])[0]
    const url = tail ? raw.slice(0, -tail.length) : raw
    if (ALREADY_SHORT.test(url)) continue
    const short = await createShortLink(sb as never, { target: url, secret, kind: 'crew', ttlMs: CREW_SHORT_LINK_TTL_MS, now })
    if (!short) continue
    out = out.split(raw).join(`${short.url}${tail}`)
  }
  return out
}
