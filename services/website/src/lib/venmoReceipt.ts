/**
 * Reading a Venmo receipt, so a side payment is not a payment nobody saw.
 *
 * ── The incident this exists for ────────────────────────────────────────────
 *
 * Every `event_tickets` row and every ticket's `financial_transactions` row is
 * written by `/api/webhook` (Stripe) or the cart checkout. Nothing else writes
 * one. So a customer who pays by Venmo — which at Host Hampton is most of the
 * repeat ones — exists NOWHERE: not on the roster Allie reads at the door, not
 * in the books, and not in `available_tickets`, so the event looks emptier than
 * it is and can be oversold underneath her.
 *
 * On 2026-09-13 the 9/25 squishy night read "2 orders, 3 people" in the admin
 * while five more children had already been paid for. Ten days of Venmo mail
 * held ~$2,186 that no table had ever heard of.
 *
 * ── Why the mailbox is the ledger ───────────────────────────────────────────
 *
 * Venmo has no API for an individual account's incoming payments. The
 * notification email is the only machine-readable trace there is, and the agent
 * already reads that exact mailbox every three minutes (`/api/cron/gmail-sync`)
 * — where `venmo.com` is on `AUTO_IGNORE_DOMAINS`, so these messages are
 * recorded and then deliberately dropped before triage. This module is what
 * looks at them on the way past.
 *
 * ── Why it only ever PROPOSES ───────────────────────────────────────────────
 *
 * Kyra Possin paid $45 for the 9/25 squishy night and cancelled TWO MINUTES
 * LATER in the payment's comment thread; the refund went out four minutes after
 * that and she re-sent the same $45 for a different event. A parser reading only
 * "Kyra Possin paid you $45.00 · Make Your Own Squishy" would have seated a
 * person who was not coming and counted her money twice.
 *
 * So nothing here writes a ticket. It writes a PROPOSAL a human accepts —
 * see `recordVenmoReceipt` and `/api/admin/venmo-payments`.
 *
 * This file is deliberately pure: no Supabase, no Gmail, no clock. Everything
 * it decides can be tested against a real receipt body, and there are real ones
 * in `__tests__/lib/venmoReceipt.test.ts`.
 */

/* ── What a receipt is ──────────────────────────────────────────────── */

export interface VenmoReceipt {
  /** Venmo's display name for the payer — NOT necessarily our contact's name. */
  payerName: string
  amountCents: number
  /** The payment note, decoded. Empty string when they left it blank. */
  note: string
  /** Venmo's own transaction id, when the body carries one. */
  transactionId: string | null
}

/**
 * Subjects that are money arriving, and the ones that only look like it.
 *
 * Venmo writes an incoming payment two ways depending on whether the balance is
 * auto-transferred:
 *
 *   "Meg McKeel paid you $45.00"
 *   "Kyra Possin paid $45.00 to your Venmo account. Leave it in Venmo or …"
 *
 * Everything else in this mailbox is noise that shares the vocabulary:
 * `You paid Adam Larkin $500.00` (outbound — and one of those was the REFUND
 * that cancelled a ticket), `Receipt from SATURDAY CANDY CO - $12.44` (the debit
 * card), `TARGET T-2847 refunded you $8.31`, and `… commented on a payment
 * between you and …`. Each of those would have become a phantom ticket.
 */
const INBOUND_PATTERNS: readonly RegExp[] = [
  /^(.+?)\s+paid you\s+\$([\d,]+(?:\.\d{2})?)/i,
  /^(.+?)\s+paid\s+\$([\d,]+(?:\.\d{2})?)\s+to your venmo account/i,
]

/** Subject prefixes/shapes that are never an inbound customer payment. */
const NEVER_INBOUND: readonly RegExp[] = [
  /^you paid\b/i,
  /^receipt from\b/i,
  /\brefunded you\b/i,
  /\bcommented on\b/i,
  /\bpayment request\b/i,
  /\byou requested\b/i,
]

export function isVenmoSender(fromEmail: string | null | undefined): boolean {
  const addr = (fromEmail || '').trim().toLowerCase()
  const domain = addr.split('@')[1] || ''
  return domain === 'venmo.com' || domain.endsWith('.venmo.com')
}

function centsFromAmount(raw: string): number | null {
  const n = Number(raw.replace(/,/g, ''))
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n * 100)
}

/**
 * The note, as a person wrote it.
 *
 * Venmo form-encodes the note inside the notification body — `Make+Your+Own
 * +Squishy`, `Blair+—+Mobile+Party+10/3+Deposit` — but only sometimes: the same
 * field arrives with real spaces in other receipts ("Lynch Kiddos Squishy Night
 * 💕💕"). Both are decoded here, and a `%` that is not a valid escape is left
 * alone rather than thrown, because a customer typing "50% deposit" into a
 * Venmo note must not cost us the whole receipt.
 */
export function decodeVenmoNote(raw: string): string {
  const spaced = raw.replace(/\+/g, ' ')
  let decoded = spaced
  try {
    decoded = decodeURIComponent(spaced)
  } catch {
    decoded = spaced
  }
  return decoded.replace(/\s+/g, ' ').trim()
}

/**
 * The note out of a notification body — the LAST rendering of it, not the first.
 *
 * A Venmo email says the same sentence three times: a preheader, a heading, and
 * then the expanded row that actually carries the note:
 *
 *   Randi Lynch paid you $80.00 Randi Lynch paid you $80.00 | | … |
 *   Randi Lynch paid you $ 80. 00 Lynch Kiddos Squishy Night 💕💕 See transaction
 *
 * A lazy `paid you \$…(.*?)See transaction` matches from the FIRST of those and
 * swallows the two repeats and the table scaffolding as the "note" — a tripwire
 * satisfied by the wrong occurrence, which is a family of bug this codebase has
 * been bitten by repeatedly. So: cut at `See transaction` first, then take what
 * follows the LAST amount before it.
 */
function noteFromBody(body: string | null): string {
  const text = (body || '').replace(/\s+/g, ' ')
  if (!text) return ''
  const head = text.split(/See transaction/i)[0]
  const marks = Array.from(head.matchAll(/paid you\s+\$\s*[\d,]+\s*\.\s*\d{2}/gi))
  if (!marks.length) return ''
  const last = marks[marks.length - 1]
  const raw = head.slice((last.index ?? 0) + last[0].length)
  // Table scaffolding, and a bound: a note is one line a person typed, and an
  // unbounded slice of a marketing-heavy body is not evidence of anything.
  return decodeVenmoNote(raw.replace(/[|#]+/g, ' ')).slice(0, 300).trim()
}

/**
 * Parse one Venmo notification into a receipt, or `null` if it is not one.
 *
 * The subject carries the payer and the amount; the body carries the note and
 * the transaction id. The body is matched on the SECOND, expanded rendering
 * (`… paid you $ 45 . 00 <note> See transaction`) because that is the only
 * place the note appears.
 */
export function parseVenmoReceipt(subject: string | null, body: string | null): VenmoReceipt | null {
  const subj = (subject || '').replace(/\s+/g, ' ').trim()
  if (!subj) return null
  if (NEVER_INBOUND.some(re => re.test(subj))) return null

  let payerName = ''
  let amountCents: number | null = null
  for (const re of INBOUND_PATTERNS) {
    const m = subj.match(re)
    if (!m) continue
    payerName = m[1].trim()
    amountCents = centsFromAmount(m[2])
    break
  }
  if (!payerName || amountCents === null) return null

  const note = noteFromBody(body)

  const txMatch = (body || '').replace(/\s+/g, ' ').match(/Transaction ID\s+([A-Z0-9]+)/i)

  return {
    payerName,
    amountCents,
    // A blank note is common and is not a parse failure — it is simply a
    // payment we cannot attribute, which is exactly what the proposal is for.
    note,
    transactionId: txMatch ? txMatch[1] : null,
  }
}

/* ── Matching a receipt to an event ─────────────────────────────────── */

export interface MatchableEvent {
  id: string
  title: string
  event_date: string
  price_cents: number | null
  sibling_price_cents?: number | null
  variants?: unknown
}

export interface SeatLine {
  variantLabel: string | null
  unitPriceCents: number
  quantity: number
}

export type MatchConfidence = 'title' | 'amount' | 'none'

export interface EventMatch {
  eventId: string | null
  title: string | null
  confidence: MatchConfidence
  /** How the amount decomposes into seats, when exactly one decomposition fits. */
  seats: SeatLine[] | null
  /** One line, for the proposal row and the owner email. */
  reason: string
}

/**
 * Words too common to identify an event.
 *
 * "party", "night" and "drop" appear in half the titles and in a third of the
 * notes; matching on them would attach a mobile-party deposit to a studio
 * event. The distinctive words are what people actually type: squishy, bingo,
 * bejewel.
 */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'your', 'own', 'make', 'host', 'hampton',
  'party', 'night', 'drop', 'off', 'event', 'ticket', 'tickets', 'kids',
  'kiddos', 'class', 'workshop', 'deposit', 'balance',
])

/** Letters and digits only, lowercased — emoji, punctuation and `+` all go. */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function distinctiveWords(title: string): string[] {
  return normalizeForMatch(title)
    .split(' ')
    .filter(w => w.length > 3 && !STOPWORDS.has(w))
}

/**
 * Every way this amount could be seats at this event, as `SeatLine[]`.
 *
 * Two shapes are real: N seats at the headline price, and one first-child seat
 * plus N siblings. $80 at the squishy night is $45 + $35 and $45 is one seat;
 * $90 is two seats. Anything that fits neither (a tip, a partial, a deposit for
 * something else) returns nothing, and the proposal says the amount is
 * unexplained rather than inventing a seat count.
 */
function seatOptions(ev: MatchableEvent, amountCents: number): SeatLine[][] {
  const base = ev.price_cents ?? 0
  const out: SeatLine[][] = []
  if (base > 0 && amountCents % base === 0) {
    const qty = amountCents / base
    if (qty >= 1 && qty <= 20) out.push([{ variantLabel: firstLabel(ev), unitPriceCents: base, quantity: qty }])
  }
  const sibling = siblingPrice(ev)
  if (base > 0 && sibling && sibling > 0 && amountCents > base) {
    const rest = amountCents - base
    if (rest % sibling === 0) {
      const sibs = rest / sibling
      if (sibs >= 1 && sibs <= 20) {
        out.push([
          { variantLabel: firstLabel(ev), unitPriceCents: base, quantity: 1 },
          { variantLabel: siblingLabel(ev), unitPriceCents: sibling, quantity: sibs },
        ])
      }
    }
  }
  return out
}

interface VariantRow { label?: unknown; priceCents?: unknown }

function variantRows(ev: MatchableEvent): VariantRow[] {
  return Array.isArray(ev.variants) ? (ev.variants as VariantRow[]) : []
}

/**
 * The labels an event actually uses, not the ones we would have chosen.
 *
 * The squishy night's second variant is spelled `SIbling` in the database. A
 * ticket row written with a tidied-up `Sibling` would not group with the ones
 * already there, so the event's own spelling wins.
 */
function firstLabel(ev: MatchableEvent): string | null {
  const rows = variantRows(ev)
  const first = rows.find(r => Number(r.priceCents) === Number(ev.price_cents))
  return first && typeof first.label === 'string' ? first.label : null
}

function siblingPrice(ev: MatchableEvent): number | null {
  if (ev.sibling_price_cents) return ev.sibling_price_cents
  const rows = variantRows(ev)
  const cheaper = rows
    .map(r => Number(r.priceCents))
    .filter(n => Number.isFinite(n) && n > 0 && n < Number(ev.price_cents ?? 0))
    .sort((a, b) => b - a)
  return cheaper.length ? cheaper[0] : null
}

function siblingLabel(ev: MatchableEvent): string | null {
  const price = siblingPrice(ev)
  const row = variantRows(ev).find(r => Number(r.priceCents) === price)
  return row && typeof row.label === 'string' ? row.label : null
}

/**
 * Which event, if any, this receipt is for.
 *
 * The note is the evidence, the amount is the tiebreak, and "I do not know" is
 * a supported answer — Ruvimbo Nyakurimwa's $80 said only "Host Hampton event
 * ticket Sophia and Ethan Lettieri", which names no event at all.
 */
export function matchEvent(receipt: VenmoReceipt, events: MatchableEvent[]): EventMatch {
  const note = normalizeForMatch(receipt.note)
  const none = (reason: string): EventMatch => ({ eventId: null, title: null, confidence: 'none', seats: null, reason })
  if (!events.length) return none('no upcoming events to match against')

  const scored = events
    .map(ev => {
      const words = distinctiveWords(ev.title)
      const hits = note ? words.filter(w => note.includes(w)).length : 0
      const full = note && normalizeForMatch(ev.title) && note.includes(normalizeForMatch(ev.title))
      return { ev, score: full ? words.length + 1 : hits }
    })
    .sort((a, b) => b.score - a.score)

  const best = scored[0]
  const tied = scored.filter(s => s.score === best.score && s.score > 0).length > 1

  if (best.score > 0 && !tied) {
    const options = seatOptions(best.ev, receipt.amountCents)
    return {
      eventId: best.ev.id,
      title: best.ev.title,
      confidence: 'title',
      seats: options.length === 1 ? options[0] : null,
      reason:
        options.length === 1
          ? `note names "${best.ev.title}"`
          : options.length === 0
            ? `note names "${best.ev.title}" but $${(receipt.amountCents / 100).toFixed(2)} is not a whole number of seats`
            : `note names "${best.ev.title}" but the amount fits more than one seat split`,
    }
  }

  // No title to go on. An amount is only evidence when exactly ONE upcoming
  // event can explain it — and even then it is the weaker verdict, because two
  // $45 events a month apart are indistinguishable from the money alone.
  //
  // And it is only evidence for a SMALL number of seats. $250 divides cleanly
  // into ten $25 bingo seats, which is how "Blair — Mobile Party 10/3 Deposit"
  // becomes a bingo party of ten that nobody booked. Nobody buys ten seats in
  // one Venmo without saying what for; a guess that large is not a guess.
  const AMOUNT_ONLY_SEAT_CEILING = 4
  const byAmount = events
    .map(ev => ({ ev, options: seatOptions(ev, receipt.amountCents) }))
    .filter(
      x =>
        x.options.length === 1 &&
        x.options[0].reduce((n, line) => n + line.quantity, 0) <= AMOUNT_ONLY_SEAT_CEILING,
    )
  if (byAmount.length === 1) {
    const { ev, options } = byAmount[0]
    return {
      eventId: ev.id,
      title: ev.title,
      confidence: 'amount',
      seats: options[0],
      reason: tied
        ? `the note matches more than one event; only "${ev.title}" explains the amount`
        : `the note names no event; only "${ev.title}" explains $${(receipt.amountCents / 100).toFixed(2)}`,
    }
  }

  return none(
    tied
      ? 'the note matches more than one upcoming event'
      : byAmount.length > 1
        ? 'the note names no event and several events explain the amount'
        : 'the note names no event and no event explains the amount',
  )
}
