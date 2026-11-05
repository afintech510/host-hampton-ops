/**
 * Everything about the WORDS in the chat: fencing what a visitor typed, proving a
 * detail really came from them, and screening what the model says back.
 *
 * Three jobs, three directions:
 *
 *   fenceVisitorText   IN   a stranger's text becomes quoted DATA before the model
 *                           reads it, and cannot close its own quote.
 *   statedByVisitor    IN→  a name / email / phone the model wants to put in a
 *                           write must literally appear in what the visitor
 *                           typed. The model cannot invent a lead, or "correct"
 *                           an address into somebody else's.
 *   screenReply        OUT  the model's text is checked before a visitor sees it
 *                           or it is stored: no foreign link / handle / phone
 *                           (containsForeignContact), no dollar figure no tool
 *                           returned and no invented concession
 *                           (containsFabricatedTerms with an allowlist), no
 *                           promise a date is "reserved", no payment method but
 *                           ours, no request for card details.
 */

import { containsFabricatedTerms, containsForeignContact } from '@/lib/agent/draftGuards'
import type { LlmMessage } from '@/lib/ai/provider'
import { MAX_MESSAGE_CHARS } from '@/lib/chat/config'

/* ── in ─────────────────────────────────────────────────────────────────── */

const TAG = /<\s*\/?\s*(?:visitor_message|system_notice)[^>]*>/gi
// eslint-disable-next-line no-control-regex
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g

/** Bound and clean one visitor message. Returns null for nothing worth sending. */
export function cleanVisitorText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.replace(CONTROL, ' ').replace(TAG, '[removed]').trim()
  if (!t) return null
  return t.length > MAX_MESSAGE_CHARS ? t.slice(0, MAX_MESSAGE_CHARS) : t
}

/**
 * The form a visitor's words take in the model's context. The tags are removed
 * from the text itself first (cleanVisitorText), so there is no way to write the
 * closing tag and continue "outside" the fence.
 */
export function fenceVisitorText(clean: string): string {
  return `<visitor_message>\n${clean}\n</visitor_message>`
}

export function unfenceVisitorText(s: string): string {
  const m = /^<visitor_message>\n([\s\S]*)\n<\/visitor_message>$/.exec(s)
  return m ? m[1] : s
}

/** Everything the visitor has typed in this session, unfenced, newest last. */
export function visitorTexts(messages: LlmMessage[]): string[] {
  const out: string[] = []
  for (const m of messages) {
    if (m.role !== 'user' || typeof m.content !== 'string') continue
    if (!m.content.startsWith('<visitor_message>')) continue
    out.push(unfenceVisitorText(m.content))
  }
  return out
}

/* ── in → write ─────────────────────────────────────────────────────────── */

const digitsOf = (s: string) => s.replace(/\D/g, '')

/** A phone as ten digits (a leading country code 1 is dropped), or null. */
export function tenDigits(phone: string): string | null {
  const d = digitsOf(phone)
  const t = d.length === 11 && d.startsWith('1') ? d.slice(1) : d
  return t.length === 10 ? t : null
}

export interface StatedContact { name?: string; email?: string; phone?: string }

/**
 * Did the VISITOR say each of these? Case-insensitive; the phone is compared as
 * digits so "(631) 555-0100" and "631.555.0100" agree. Returns the names of the
 * fields that did not check out — empty means every one is theirs.
 *
 * A name checks out when every word of it (2+ letters) appears in their text. The
 * model may tidy capitalisation; it may not supply a surname they never gave.
 */
export function unstatedByVisitor(visitorSaid: string[], c: StatedContact): string[] {
  const said = visitorSaid.join('\n').toLowerCase()
  const saidDigits = digitsOf(said)
  const bad: string[] = []
  if (c.email !== undefined && !said.includes(c.email.trim().toLowerCase())) bad.push('email')
  if (c.phone !== undefined) {
    const ten = tenDigits(c.phone)
    if (!ten || !saidDigits.includes(ten)) bad.push('phone')
  }
  if (c.name !== undefined) {
    const words = c.name.toLowerCase().split(/\s+/).map(w => w.replace(/[^a-zà-ɏ'-]/g, '')).filter(w => w.length >= 2)
    if (words.length === 0 || !words.every(w => said.includes(w))) bad.push('name')
  }
  return bad
}

/* ── out ────────────────────────────────────────────────────────────────── */

/** `$1,015.50` / `$595` → the normalised strings `containsFabricatedTerms` compares. */
export function amountVariants(cents: number): string[] {
  const dollars = Math.floor(cents / 100)
  const rem = cents % 100
  if (rem === 0) return [String(dollars), `${dollars}.00`]
  return [`${dollars}.${String(rem).padStart(2, '0')}`]
}

/**
 * Every dollar figure a tool returned this conversation. The model may repeat
 * these and nothing else: it does not do arithmetic on prices and it does not
 * round them, because every figure it needs is already a field in a result.
 */
export function allowedAmountsFrom(messages: LlmMessage[]): Set<string> {
  const allowed = new Set<string>()
  const re = /\$\s?(\d[\d,]*(?:\.\d{2})?)/g
  for (const m of messages) {
    if (typeof m.content === 'string') continue
    for (const b of m.content) {
      if (b.type !== 'tool_result') continue
      const text = String((b as { content?: unknown }).content ?? '')
      let hit: RegExpExecArray | null
      while ((hit = re.exec(text)) !== null) {
        const n = hit[1].replace(/,/g, '')
        allowed.add(n)
        if (n.endsWith('.00')) allowed.add(n.slice(0, -3))
        else if (!n.includes('.')) allowed.add(`${n}.00`)
      }
    }
  }
  return allowed
}

const UNSAFE_SCHEME = /\b(?:javascript|data|vbscript|file|blob):/i
const PROTOCOL_RELATIVE = /(?:^|[\s("'\[])\/\/[a-z0-9]/i
const RESERVED_CLAIM = /\b(?:reserved|reserve\s+(?:it|the\s+date|your\s+date)|locked\s+in|guaranteed\s+(?:the\s+)?date)\b/i
const OTHER_PAYMENT = /\b(?:venmo|zelle|cash\s?app|paypal|apple\s?pay|google\s?pay|wire\s+transfer|bitcoin|crypto|gift\s?card\s+code)\b/i
const CARD_DETAILS = /\b(?:card\s+number|credit\s+card\s+(?:number|details)|cvv|cvc|security\s+code|expir(?:y|ation)\s+date|routing\s+number|account\s+number)\b/i

export type ReplyScreen = { ok: true } | { ok: false; reason: string }

/**
 * Screen a model reply. Returns the REASON (logged and stored on the session, never shown to the visitor).
 *
 * Tuned to refuse: a false positive costs the visitor one "text us" line, a false
 * negative is a payment redirected or a price invented under the business's name.
 */
export function screenReply(text: string, allowedAmounts: ReadonlySet<string>): ReplyScreen {
  const foreign = containsForeignContact(text)
  if (foreign) return { ok: false, reason: `foreign_contact: ${foreign}` }

  const fabricated = containsFabricatedTerms(text, { allowedAmounts })
  if (fabricated) return { ok: false, reason: `fabricated_terms: ${fabricated}` }

  if (UNSAFE_SCHEME.test(text)) return { ok: false, reason: 'unsafe_scheme' }
  if (PROTOCOL_RELATIVE.test(text)) return { ok: false, reason: 'protocol_relative_link' }

  const reserved = RESERVED_CLAIM.exec(text)
  if (reserved) return { ok: false, reason: `reserved_claim: "${reserved[0]}"` }

  const pay = OTHER_PAYMENT.exec(text)
  if (pay) return { ok: false, reason: `other_payment_method: "${pay[0]}"` }

  const card = CARD_DETAILS.exec(text)
  if (card) return { ok: false, reason: `card_details_requested: "${card[0]}"` }

  return { ok: true }
}
