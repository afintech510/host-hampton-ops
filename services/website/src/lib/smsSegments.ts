/**
 * SMS segment arithmetic — what the 160/320 marks in the composer mean.
 *
 * A leaf module with no imports, because the composer is a client component and
 * `lib/sms.ts` drags a carrier client into the bundle (the same reason
 * `lib/pipelineStages.ts` exists).
 *
 * ── Why this is not just `length / 160` ──────────────────────────────────
 *
 * 160 is only the GSM-03.38 number. One character outside that alphabet flips
 * the WHOLE message to UCS-2 and the limit drops to 70 — and our drafts are
 * full of curly apostrophes, because that is what a model writes for "kid's".
 * So a naive counter would have told Allie a 150-character message was one
 * segment when the carrier was about to bill and split it as three. The rule
 * that a stated guarantee has to be exercised applies to a character count as
 * much as to a guardrail: the tests below check a curly apostrophe, not a
 * comment claiming it works.
 *
 * Concatenation also costs: a multi-segment message spends 6 GSM characters
 * (3 UCS-2) per segment on the UDH header, which is why the second boundary is
 * at 306, not 320. The UI still labels the familiar 160/320 marks — those are
 * what Allie has been told to aim for — but the SEGMENT COUNT here is the
 * carrier's, not the folklore.
 */

/** The GSM-03.38 basic set. Anything outside it forces UCS-2 for the message. */
const GSM_BASIC =
  '@£$¥èéùìòÇ\nØø\ríÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'

/** GSM characters that occupy TWO septets because they need an escape byte. */
const GSM_EXTENDED = '^{}\\[~]|€'

const GSM_BASIC_SET = new Set(GSM_BASIC)
const GSM_EXTENDED_SET = new Set(GSM_EXTENDED)

export type SmsEncoding = 'GSM-7' | 'UCS-2'

export interface SmsSegmentInfo {
  encoding: SmsEncoding
  /** Billable units: septets for GSM-7, UTF-16 code units for UCS-2. */
  units: number
  /** How many SMS the carrier will send. */
  segments: number
  /** Units available before this message needs one more segment. */
  unitsInCurrentLimit: number
  /** Units left before the next segment starts. Negative is not possible. */
  unitsRemaining: number
  /** The boundaries to draw, in units, for the current encoding. */
  boundaries: number[]
}

const GSM_SINGLE = 160
const GSM_CONCAT = 153
const UCS2_SINGLE = 70
const UCS2_CONCAT = 67

/**
 * Does every character fit the GSM alphabet? One that does not (an emoji, an
 * em dash, a curly quote) costs the whole message its 160.
 */
export function smsEncodingOf(text: string): SmsEncoding {
  for (const ch of text) {
    if (GSM_BASIC_SET.has(ch) || GSM_EXTENDED_SET.has(ch)) continue
    return 'UCS-2'
  }
  return 'GSM-7'
}

/**
 * Billable units. For GSM-7 the extended characters count double; for UCS-2 the
 * count is UTF-16 code units, so an emoji outside the BMP is 2 — which is the
 * carrier's arithmetic, not the human's idea of "one character".
 */
export function smsUnits(text: string, encoding: SmsEncoding = smsEncodingOf(text)): number {
  if (encoding === 'UCS-2') return text.length
  let units = 0
  for (const ch of text) units += GSM_EXTENDED_SET.has(ch) ? 2 : 1
  return units
}

/* ── Sanitising into GSM-7 (plan §21.2) ────────────────────────────────────
 *
 * The counter above has been right since §20 and nothing called it. Meanwhile
 * `leadSmsLine` joined its parts with ' · ' and `reviewerSmsBody` opened with
 * `[code · type]` — U+00B7, one character, outside the alphabet, and every
 * owner SMS in the system has been billed at 67 characters per segment instead
 * of 160 ever since. Roughly 2.3x, across sixteen call sites, invisibly.
 *
 * So this is a converter, not another counter. It is applied at the ONE choke
 * point every owner SMS passes through (`notifyOwnerSms`), for the reason the
 * mail-template work landed on: fixing the sixteen literals is a fix, fixing
 * the choke point is a guarantee. The literals are fixed too — but a model
 * writes "kid's" with a curly apostrophe and no literal fix can reach that.
 *
 * Deliberately NOT applied to customer-facing sends. Changing what a customer
 * reads is a different decision from changing what it costs to tell Adam.
 */

/** Non-GSM characters we can say something sensible about. */
const GSM_REPLACEMENTS: Record<string, string> = {
  '·': '-', '•': '-', '‣': '-', '▪': '-', '●': '-',
  '‘': "'", '’': "'", '‚': "'", '‛': "'", '′': "'",
  '“': '"', '”': '"', '„': '"', '″': '"',
  '«': '"', '»': '"',
  '–': '-', '—': '-', '‒': '-', '―': '-', '−': '-',
  '…': '...',
  '⚠': '!!', '⚠️': '!!', '‼': '!!', '❗': '!',
  '✓': 'OK', '✔': 'OK', '✅': 'OK',
  '✗': 'X', '✘': 'X', '✕': 'X', '❌': 'X',
  '→': '->', '⇒': '->', '←': '<-', '⇐': '<-',
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ',
  '​': '', '﻿': '',
  '°': 'deg', '™': '(TM)', '©': '(c)', '®': '(R)',
  '½': '1/2', '¼': '1/4', '¾': '3/4',
  '––': '-', '×': 'x', '⁄': '/',
}

function isGsm(ch: string): boolean {
  return GSM_BASIC_SET.has(ch) || GSM_EXTENDED_SET.has(ch)
}

/** Every code point of `s` is GSM. Written as a loop, not `[...s].every`, so
 *  the module keeps compiling under the repo's ES5 downlevel target. */
function allGsm(s: string): boolean {
  for (const ch of s) if (!isGsm(ch)) return false
  return true
}

/**
 * Rewrite `text` so every character is GSM-03.38, keeping the meaning where a
 * sensible substitute exists.
 *
 * Three passes per character, cheapest first:
 *   1. Already GSM — keep it. (é, ö, à, £ and € all survive; they are legal.)
 *   2. A known substitute — '·' becomes '-', '…' becomes '...'.
 *   3. A letter carrying a diacritic we cannot spend — decompose and drop the
 *      accent, so 'Zoë Kovačić' becomes 'Zoe Kovacic' rather than 'Zo Kovai'.
 *      Deleting letters out of the middle of a customer's name is the failure
 *      mode this pass exists to avoid.
 * Anything left (an emoji, a CJK character) is dropped: it cannot be rendered
 * in GSM at all, and it is not worth 2.3x the bill for the rest of the message.
 */
export function gsm7Sanitize(text: string): string {
  if (!text) return ''
  let out = ''
  for (const ch of text) {
    if (isGsm(ch)) { out += ch; continue }
    const mapped = GSM_REPLACEMENTS[ch]
    if (mapped !== undefined) { out += mapped; continue }
    const folded = ch.normalize('NFD').replace(/[̀-ͯ]/g, '')
    if (folded && allGsm(folded)) { out += folded; continue }
  }
  return out
}

export function smsSegmentInfo(text: string): SmsSegmentInfo {
  const body = text ?? ''
  const encoding = smsEncodingOf(body)
  const units = smsUnits(body, encoding)
  const single = encoding === 'GSM-7' ? GSM_SINGLE : UCS2_SINGLE
  const concat = encoding === 'GSM-7' ? GSM_CONCAT : UCS2_CONCAT

  const segments = units === 0 ? 0 : units <= single ? 1 : Math.ceil(units / concat)
  const unitsInCurrentLimit = segments <= 1 ? single : segments * concat

  // Four marks is enough: past four segments the advice is "write less", not
  // "watch the boundary".
  const boundaries = [single, concat * 2, concat * 3, concat * 4]

  return {
    encoding,
    units,
    segments,
    unitsInCurrentLimit,
    unitsRemaining: Math.max(0, unitsInCurrentLimit - units),
    boundaries,
  }
}
