/**
 * The host's guest list: parsing what they paste or upload, and a best-effort "did this guest answer".
 *
 * Pure (no imports). Used by the browser (the preview line under the paste box) AND the server, which
 * re-screens the text itself: the client's parse is a courtesy, never a credential.
 *
 *   parseGuestList(text)            -> { guests: [{ name, phone_e164 | null }], skipped: string[] }
 *   matchGuestsToRsvps(guests, rs)  -> ('yes' | 'no' | null)[]   one answer per guest, MATCHED BY NAME
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
}

function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** "Tom & Jen" -> ["tom", "jen"]; a plain name -> [name]. */
function parts(name: string): string[] {
  const whole = norm(name)
  const split = name
    .split(/\s+(?:and|&)\s+|\s*&\s*/i)
    .map(norm)
    .filter(Boolean)
  return split.length > 1 ? [whole, ...split] : [whole]
}

/**
 * For each guest: 'yes' if an RSVP that says yes appears to answer for them, else 'no' if one that says no
 * does, else null. MATCHED BY NAME ONLY, and only a guide: the full name equals the RSVP's name or one of
 * the names given for the party; a one-word guest name also matches a given first name or the first word
 * of the RSVP's name. A household ("Tom & Jen") matches when any one of its parts does. Two different
 * people with the same name will be confused; the host can always add or remove an RSVP by hand.
 */
export function matchGuestsToRsvps(guests: Array<{ name: string }>, rsvps: MatchableRsvp[]): Array<'yes' | 'no' | null> {
  const prepared = rsvps.map((r) => {
    const full = new Set<string>()
    const firsts = new Set<string>()
    const add = (n: string) => {
      const x = norm(n)
      if (!x) return
      full.add(x)
      firsts.add(x.split(' ')[0])
    }
    add(r.parent_name)
    for (const c of r.children) add(typeof c === 'string' ? c : c?.first_name ?? '')
    return { status: r.status, full, firsts }
  })
  return guests.map((g) => {
    let answer: 'yes' | 'no' | null = null
    for (const r of prepared) {
      const hit = parts(g.name).some((p) => {
        if (!p) return false
        if (r.full.has(p)) return true
        return !p.includes(' ') && r.firsts.has(p)
      })
      if (!hit) continue
      if (r.status === 'yes') return 'yes'
      answer = 'no'
    }
    return answer
  })
}
