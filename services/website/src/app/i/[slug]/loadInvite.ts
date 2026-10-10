/**
 * The one guarded load behind `/i/[slug]` (spec §7.1).
 *
 * The page AND `generateMetadata` both call `loadInvite(slug)`. It is wrapped in
 * `requestCache`, so within one request it runs ONCE: the rate limiter counts a
 * view once (not once for the head and once for the body) and the database is
 * read once. That is the choice over "metadata skips the guard", which would let
 * a flood reach the database through `generateMetadata` unthrottled.
 *
 * ORDER IS THE CONTRACT (tripwire E1, later): `guardRateHeaders` first, before
 * any database read. A throttled request gets `limited`, which the page renders
 * as the SAME not-found page as an unknown slug.
 *
 * It lives beside the page rather than in lib/ because it is the page's request
 * scope: it reads `headers()`. A read error THROWS (-> error.tsx, HTTP 500).
 */

import { headers } from 'next/headers'
import { getSupabase } from '@/lib/supabase'
import { eviteViewRule, guardRateHeaders } from '@/lib/rateLimit'
import { resolveEviteBySlug, type ResolveOutcome } from '@/lib/evites/resolve'
import { requestCache } from '@/lib/evites/requestCache'

export type LoadInviteOutcome = ResolveOutcome | { kind: 'limited' }

async function load(slug: string): Promise<LoadInviteOutcome> {
  if (guardRateHeaders(headers(), eviteViewRule)) return { kind: 'limited' }
  return resolveEviteBySlug(getSupabase(), slug)
}

export const loadInvite = requestCache(load)
