/**
 * Tone chips for the lead workspace composer (plan §11.3).
 *
 * Each chip is nothing more than a canned note handed to the SAME
 * `redraftForReviewer()` the SMS loop calls. That is deliberate: a chip is a
 * shortcut for typing, not a second re-draft path. If a chip could do something
 * an instruction typed by hand could not, the two surfaces would drift and only
 * one of them would stay guarded.
 *
 * ── Why these are constants and not customer text ────────────────────────
 *
 * The composer is a BRAND-NEW writer of `inquiry_drafts.reviewer_note`, and
 * that field is interpolated into the draft prompt as a TRUSTED owner
 * instruction (draftInquiry.ts `correction:`). The rule that earned itself the
 * hard way — fencing one field does not fence the prompt; a field is hostile
 * because of who can WRITE it — is why every `note` here is a literal written
 * by us. In particular `match my last message` does NOT splice a customer's
 * words into the prompt: it tells the model to match OUR last outbound draft,
 * which the model already has in context. Nothing a customer can type reaches
 * the prompt through a chip.
 *
 * Promote to an `agent_tone_presets` table when Allie wants her own; a TS
 * constant needs no migration and no cache invalidation today.
 */

export interface TonePreset {
  /** Stable id — what the client posts, so a relabel is not a behaviour change. */
  id: string
  /** The chip label. */
  label: string
  /** The instruction handed to redraftForReviewer(). Authored, never user text. */
  note: string
}

/**
 * `mom-to-mom` is the one Adam named himself, and it is the point of the
 * feature rather than a nice-to-have: Allie is a mother talking to mothers and
 * the agent's default register is a business's. If she reaches for this chip
 * every time, that is a standing voice rule and Phase 6 should learn it from
 * the `reviewer` revisions it leaves behind.
 */
export const TONE_PRESETS: TonePreset[] = [
  {
    id: 'warmer',
    label: 'warmer',
    note: 'Make it warmer and more personal — write like a person who is glad they reached out, not like a business replying to a ticket.',
  },
  {
    id: 'shorter',
    label: 'shorter',
    note: 'Make it noticeably shorter. Cut anything that is not the answer to what they asked or the single next step.',
  },
  {
    id: 'mom-to-mom',
    label: 'mom-to-mom',
    note: 'Rewrite this mom to mom: one mother talking to another about her kid’s party. Plain, warm, practical, a little informal. No marketing voice, no exclamation-mark enthusiasm, and do not call them "valued" anything.',
  },
  {
    id: 'less-salesy',
    label: 'less salesy',
    note: 'Take the sell out of it. No superlatives, no "amazing"/"perfect"/"we would love to", no pitch paragraph. Just answer them and say what happens next.',
  },
  {
    id: 'logistics',
    label: 'more specific on logistics',
    note: 'Be concrete about logistics: the date and start time, how long it runs, how many guests that covers, where it happens, and what we bring or they provide. Do not invent any detail we have not been told — if something is unknown, ask for it.',
  },
  {
    id: 'match-my-voice',
    label: 'match my last message',
    note: 'Match the voice of the most recent message we sent this customer — same sentence length, same level of formality, same sign-off. Keep the content, change the register.',
  },
]

const BY_ID = new Map(TONE_PRESETS.map(p => [p.id, p]))

/**
 * The note for a chip id, or null. Returning null (rather than falling back to
 * the id) matters: an unknown id must not become free text that reaches the
 * prompt as if we had authored it.
 */
export function tonePresetNote(id: string): string | null {
  return BY_ID.get(id)?.note ?? null
}
