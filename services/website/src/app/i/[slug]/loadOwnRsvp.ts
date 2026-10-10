/**
 * The caller's OWN RSVP for the invitation page (spec §7.5): read from their edit
 * cookie, verified for THIS invitation, and reduced to `PUBLIC_RSVP_SELF_COLUMNS`.
 *
 *   no cookie                       -> null, and NO database read (a stranger costs nothing)
 *   cookie that does not verify     -> null (forged, expired, revoked, another party's: all the same)
 *   verified, row there             -> the guest's own answer
 *
 * THROWS when a read fails (-> `error.tsx`, HTTP 500, like every other read on the
 * page). Rendering the blank form to someone who HAS answered, because a read
 * hiccuped, would invite a second answer; "try again in a moment" does not.
 *
 * It never reads another guest's row: both reads are filtered on the token's own
 * id AND this evite's id. It is called only AFTER `loadInvite`, so the rate limiter
 * and the invitation lookup have already run.
 */

import { cookies } from 'next/headers'
import { getSupabase } from '@/lib/supabase'
import { readCurrentClubConsent } from '@/lib/evites/consent'
import { cookieName, verifyEditToken } from '@/lib/evites/rsvpToken'
import { OWN_RSVP_SELECT, ownRsvpView, type OwnRsvp } from '@/lib/evites/rsvpView'

export async function loadOwnRsvp(eviteId: string): Promise<OwnRsvp | null> {
  const token = cookies().get(cookieName(eviteId))?.value
  if (!token) return null

  const supabase = getSupabase()
  const verified = await verifyEditToken(supabase, token, eviteId)
  if (!verified.ok) {
    if (verified.reason === 'unavailable') throw new Error('evites/page: could not verify the RSVP cookie')
    return null
  }

  const read = await supabase.from('evite_rsvps').select(OWN_RSVP_SELECT).eq('id', verified.rsvpId).eq('evite_id', eviteId).maybeSingle()
  if (read.error) throw new Error(`evites/page: own rsvp read failed: ${read.error.message}`)
  if (!read.data) return null
  return ownRsvpView(read.data as unknown as Record<string, unknown>)
}

/**
 * Everything the RSVP island needs beyond the invitation itself: the caller's own
 * answer and the CURRENT club wording. A club read that fails (or finds nothing)
 * hides the card rather than showing wording that is not on record.
 */
export async function loadRsvpPanel(eviteId: string): Promise<{ own: OwnRsvp | null; club: { version: string; wording: string } | null }> {
  const own = await loadOwnRsvp(eviteId)
  const consent = await readCurrentClubConsent(getSupabase())
  return { own, club: consent.kind === 'ok' ? { version: consent.version, wording: consent.wording } : null }
}
