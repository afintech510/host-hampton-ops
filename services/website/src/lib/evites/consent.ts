/**
 * The CURRENT Birthday Club consent wording (spec §1 `evite_consent_texts`, §7.5).
 *
 * The WORDING a guest sees next to the checkbox comes from the database row, never
 * from a constant: the consent record stores the `version`, and a version string
 * only means something if the text it names is what was on screen. `club-v1` is
 * the first row; a later wording change is a NEW row, and "current" is the newest.
 *
 * Three outcomes, because a failed read is not "there is no wording":
 *   { kind: 'ok', version, wording }
 *   { kind: 'absent' }        no usable row
 *   { kind: 'unavailable' }   the read failed
 * The page hides the club card on anything but `ok` (unofficial wording is worse
 * than no card), and the PATCH route answers 503 on `unavailable`.
 */

import type { getSupabase } from '@/lib/supabase'

type Supa = ReturnType<typeof getSupabase>

/** The version key of the first wording. Code may name it; the WORDING must come from the row. */
export const CLUB_CONSENT_VERSION = 'club-v1'

export type ClubConsentRead = { kind: 'ok'; version: string; wording: string } | { kind: 'absent' } | { kind: 'unavailable' }

export async function readCurrentClubConsent(supabase: Supa): Promise<ClubConsentRead> {
  try {
    const { data, error } = await supabase
      .from('evite_consent_texts')
      .select('version, wording')
      .order('created_at', { ascending: false })
      .limit(1)
    if (error) {
      console.error(`evites/consent: read failed: ${error.message}`)
      return { kind: 'unavailable' }
    }
    const row = ((data ?? []) as unknown as Array<{ version?: unknown; wording?: unknown }>)[0]
    if (!row) return { kind: 'absent' }
    if (typeof row.version !== 'string' || typeof row.wording !== 'string' || row.version === '' || row.wording.trim() === '') return { kind: 'absent' }
    return { kind: 'ok', version: row.version, wording: row.wording }
  } catch (e) {
    console.error(`evites/consent: read failed: ${e instanceof Error ? e.message : String(e)}`)
    return { kind: 'unavailable' }
  }
}
