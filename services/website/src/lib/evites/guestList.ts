/**
 * The host's guest list: parsing what they paste or upload, and a best-effort "did this guest answer".
 *
 * Pure (no imports). Used by the browser (the preview line under the paste box) AND the server, which
 * re-screens the text itself: the client's parse is a courtesy, never a credential.
 *
 *   parseGuestList(text)            -> { guests: [{ name, phone_e164 | null }], skipped: string[] }
 *   matchGuests(guests, rs)         -> per-guest answer + which RSVP, and RSVPs no guest matched
 *   matchGuestsToRsvps(guests, rs)  -> ('yes' | 'no' | null)[]   answers only
 *
 * Accepted lines (one guest each): `Name`, `Name, 631-555-1234`, `Name,6315551234`, `Name<TAB>phone`,
 * quoted CSV cells, a `name,phone` header row (ignored). A text that is ONE line with no digits is a
 * list of names split on commas / semicolons. A line like `Tom & Jen` stays ONE guest (a household).
 *
 * Phones are held as `+1XXXXXXXXXX` (the `evite_guests.phone_e164` CHECK): ten digits, or eleven starting
 * with 1, area code and exchange starting 2-9. A bad phone keeps the guest, drops the phone, and says so.
 * Skipped notes carry a guest's NAME at most - never a phone number.
 */

export const GUEST_NAME_MAX = 120
export const GUEST_LIST_MAX = 500

export interface ParsedGuest {
  name: string
  phone_e164: string | null
}

export interface ParsedGuestList {
  guests: ParsedGuest[]
  skipped: string[]
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g
const HEADER_WORDS = new Set(['name', 'names', 'guest', 'guests', 'full', 'first', 'last', 'phone', 'mobile', 'cell', 'number', 'telephone', 'tel', 'contact', 'email'])

/** `+1XXXXXXXXXX` or null. */
export function guestPhoneE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  let ten: string
  if (digits.length === 10) ten = digits
  else if (digits.length === 11 && digits[0] === '1') ten = digits.slice(1)
  else return null
  if (!/^[2-9]/.test(ten) || !/^[2-9]/.test(ten.slice(3))) return null
  return `+1${ten}`
}

/** "(631) 555-1234" for display. Anything that is not `+1XXXXXXXXXX` is returned as is. */
export function formatGuestPhone(e164: string | null | undefined): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164 ?? '')
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164 ?? ''
}

function cleanName(raw: string): string {
  return raw
    .replace(CONTROL, ' ')
    .replace(/["“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, GUEST_NAME_MAX)
    .trim()
}

/** Split one line into cells: tab if there is one, else commas / semicolons, honouring double quotes. */
function cells(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map((c) => c.trim())
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (const ch of line) {
    if (ch === '"') {
      quoted = !quoted
      continue
    }
    if (!quoted && (ch === ',' || ch === ';')) {
      out.push(cur.trim())
      cur = ''
      continue
    }
    cur += ch
  }
  out.push(cur.trim())
  return out
}

/** A letter in any common script (no `u` flag: the project targets ES5). */
const HAS_LETTER = /[A-Za-zÀ-ɏͰ-῿぀-鿿가-힯]/
const PHONE_CELL = /^\+?[\d\s().-]{7,}$/
const TRAILING_PHONE = /(?:^|\s)(\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})\s*$/

function isHeader(line: string): boolean {
  const words = line.toLowerCase().split(/[^a-z]+/).filter(Boolean)
  return words.length > 0 && words.every((w) => HEADER_WORDS.has(w))
}

/** Parse pasted text or the contents of a CSV file. Never throws. */
export function parseGuestList(text: unknown): ParsedGuestList {
  const guests: ParsedGuest[] = []
  const skipped: string[] = []
  if (typeof text !== 'string') return { guests, skipped }

  const lines = text
    .replace(/^﻿/, '')
    .split(/\r\n|\r|\n/)
    .map((l) => l.replace(CONTROL, ' ').trim())
    .filter((l) => l !== '')

  // One line with no digits is a list of names ("Ann, Bob, Cara").
  let rows: Array<{ name: string; phoneRaw: string | null }> = []
  if (lines.length === 1 && !/\d/.test(lines[0]) && !isHeader(lines[0])) {
    rows = lines[0].split(/[,;]/).map((n) => ({ name: n, phoneRaw: null }))
  } else {
    let first = true
    for (const line of lines) {
      if (first && isHeader(line)) {
        first = false
        continue
      }
      first = false
      const parts = cells(line)
      const phoneIdx = parts.findIndex((c) => PHONE_CELL.test(c) && c.replace(/\D/g, '').length >= 7)
      let phoneRaw: string | null = null
      let nameCell: string | undefined
      if (phoneIdx >= 0) {
        phoneRaw = parts[phoneIdx]
        nameCell = parts.find((c, i) => i !== phoneIdx && HAS_LETTER.test(c))
      } else {
        nameCell = parts.find((c) => HAS_LETTER.test(c))
        // "Tom Smith 631 555 1234" with nothing to split on.
        if (nameCell) {
          const m = TRAILING_PHONE.exec(nameCell)
          if (m) {
            phoneRaw = m[1]
            nameCell = nameCell.slice(0, m.index)
          }
        }
      }
      if (!nameCell || !HAS_LETTER.test(nameCell)) {
        skipped.push('A line with a phone number but no name was skipped.')
        continue
      }
      rows.push({ name: nameCell, phoneRaw })
    }
  }

  const seen = new Set<string>()
  let overflow = 0
  for (const r of rows) {
    const name = cleanName(r.name)
    if (!name || !HAS_LETTER.test(name)) continue
    let phone: string | null = null
    if (r.phoneRaw !== null) {
      phone = guestPhoneE164(r.phoneRaw)
      if (phone === null) skipped.push(`${name}: the phone number did not look right, so ${name} was added without one.`)
    }
    const key = `${name.toLowerCase()}|${phone ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    if (guests.length >= GUEST_LIST_MAX) {
      overflow++
      continue
    }
    guests.push({ name, phone_e164: phone })
  }
  if (overflow > 0) skipped.push(`${overflow} more ${overflow === 1 ? 'guest was' : 'guests were'} left out: a list holds up to ${GUEST_LIST_MAX}.`)
  return { guests, skipped }
}

// ---------------------------------------------------------------- matching an answer to a guest

export interface MatchableRsvp {
  status: 'yes' | 'no'
  parent_name: string
  /** First names (strings) or `{ first_name }` objects, as the host view and the table hold them. */
  children: Array<string | { first_name?: string }>
  /** The RSVP's own id, when the caller has it (needed for links and for "which one matched"). */
  id?: string
}

const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'mx', 'dr'])

function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Normalised words of one person's name: "Last, First" put right way round, titles dropped. */
function canonWords(name: string): string[] {
  let n = name
  const commas = n.split(',')
  if (commas.length === 2 && commas[0].trim() !== '' && commas[1].trim() !== '') n = `${commas[1]} ${commas[0]}`
  const words = norm(n).split(' ').filter(Boolean)
  while (words.length > 0 && TITLES.has(words[0])) words.shift()
  return words
}

const canon = (name: string): string => canonWords(name).join(' ')

/** "Tom & Jen" -> ["tom jen"?]: the whole, then each part; a plain name -> [name]. */
function parts(name: string): string[] {
  const whole = canon(name)
  const split = name
    .split(/\s+(?:and|&)\s+|\s*&\s*/i)
    .map(canon)
    .filter(Boolean)
  return split.length > 1 ? [whole, ...split] : [whole]
}

/** Chris / Christopher, Jen / Jennifer: one is the start of the other, and the shorter has 3+ letters. */
function sameFirst(a: string, b: string): boolean {
  if (a === b) return true
  const [s, l] = a.length <= b.length ? [a, b] : [b, a]
  return s.length >= 3 && l.startsWith(s)
}

/** Two multi-word names that are the same person: same last name AND same (or abbreviated) first name. */
function fuzzyFullName(a: string, b: string): boolean {
  const x = a.split(' ')
  const y = b.split(' ')
  if (x.length < 2 || y.length < 2) return false
  if (x[x.length - 1] === y[y.length - 1] && sameFirst(x[0], y[0])) return true
  // the same words in another order ("Lee Ann" / "Ann Lee")
  return x.length === y.length && x.length <= 3 && [...x].sort().join(' ') === [...y].sort().join(' ')
}

export interface GuestMatch {
  answer: 'yes' | 'no' | null
  /** The RSVP the answer comes from (the linked one, or the best automatic match), else null. */
  rsvpId: string | null
  linked: boolean
}

export interface GuestMatching {
  matches: GuestMatch[]
  /** Indexes into `rsvps` that no guest matched and no guest is linked to. */
  unmatchedRsvps: number[]
}

/**
 * For each guest: 'yes' if an RSVP that says yes appears to answer for them, else 'no' if one that says no
 * does, else null. MATCHED BY NAME ONLY, and only a guide: the full name equals the RSVP's name or one of
 * the names given for the party (case, accents, punctuation and titles ignored, "Last, First" accepted); a
 * full name also matches when the last names are equal and the first names are equal or one begins the
 * other (Chris / Christopher); a one-word guest name matches a given first name or the first word of the
 * RSVP's name. A first name alone never matches a guest who has a last name. A household ("Tom & Jen")
 * matches when any one of its parts does.
 *
 * A manual link wins: a guest with `rsvpId` takes that RSVP's answer, and that RSVP is never auto-matched
 * to anybody else. Two different people with the same name will be confused; the host can link by hand.
 */
export function matchGuests(guests: Array<{ name: string; rsvpId?: string | null }>, rsvps: MatchableRsvp[]): GuestMatching {
  const prepared = rsvps.map((r) => {
    const full = new Set<string>()
    const firsts = new Set<string>()
    const add = (n: string) => {
      const x = canon(n)
      if (!x) return
      full.add(x)
      firsts.add(x.split(' ')[0])
    }
    add(r.parent_name)
    for (const c of r.children) add(typeof c === 'string' ? c : c?.first_name ?? '')
    return { status: r.status, id: r.id ?? null, full, firsts }
  })

  const claimed = new Set<number>() // linked by hand
  const linkedIdx = guests.map((g) => (g.rsvpId ? prepared.findIndex((r) => r.id === g.rsvpId) : -1))
  for (const i of linkedIdx) if (i >= 0) claimed.add(i)

  const used = new Set<number>()
  const matches = guests.map((g, gi): GuestMatch => {
    if (linkedIdx[gi] >= 0) {
      const r = prepared[linkedIdx[gi]]
      used.add(linkedIdx[gi])
      return { answer: r.status, rsvpId: r.id, linked: true }
    }
    const gp = parts(g.name)
    let best: { idx: number; status: 'yes' | 'no' } | null = null
    prepared.forEach((r, idx) => {
      if (claimed.has(idx)) return
      const hit = gp.some((p) => {
        if (!p) return false
        if (r.full.has(p)) return true
        if (!p.includes(' ')) return r.firsts.has(p)
        for (const n of Array.from(r.full)) if (fuzzyFullName(p, n)) return true
        return false
      })
      if (!hit) return
      used.add(idx)
      if (!best || (r.status === 'yes' && best.status === 'no')) best = { idx, status: r.status }
    })
    if (!best) return { answer: null, rsvpId: null, linked: false }
    const b = best as { idx: number; status: 'yes' | 'no' }
    return { answer: b.status, rsvpId: prepared[b.idx].id, linked: false }
  })
  const unmatchedRsvps = prepared.map((_, i) => i).filter((i) => !used.has(i))
  return { matches, unmatchedRsvps }
}

/** The answers alone, one per guest (no links). */
export function matchGuestsToRsvps(guests: Array<{ name: string }>, rsvps: MatchableRsvp[]): Array<'yes' | 'no' | null> {
  return matchGuests(guests, rsvps).matches.map((m) => m.answer)
}
