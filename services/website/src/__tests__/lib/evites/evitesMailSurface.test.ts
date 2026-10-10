import fs from 'fs'
import path from 'path'
import { readSrc } from '../../helpers/sourceScan'
import { EVITE_SEND_TYPES } from '@/lib/evites/types'

/**
 * Source rules for the evite mail path (P09a): the ledger, the one Resend call, the claim-before-send order,
 * the templates. Each rule is scoped to the site that matters, counts what it examined, tolerates CRLF, and is
 * written so that neutering the guard (not just deleting a string) turns it red.
 */

const MAIL_FILES = ['lib/evites/mail.ts', 'lib/evites/sends.ts', 'lib/evites/suppression.ts', 'lib/evites/sendContext.ts', 'lib/evites/sendOne.ts', 'lib/evites/inlineSends.ts', 'lib/email-templates/evites.ts']
const src = (rel: string) => readSrc(...rel.split('/'))
const squash = (s: string) => s.replace(/\s+/g, ' ')

/** From the `{` after a function's parameter list (paren-matched, so a `= {}` default cannot fool it) to its matching `}`. */
function bodyOf(code: string, header: RegExp): string {
  const m = header.exec(code)
  expect(m).not.toBeNull()
  let i = (m as RegExpExecArray).index + (m as RegExpExecArray)[0].length
  let depth = 1
  while (i < code.length && depth > 0) {
    const c = code[i++]
    if (c === '(') depth++
    else if (c === ')') depth--
  }
  const open = code.indexOf('{', i)
  let d = 0
  for (let j = open; j < code.length; j++) {
    if (code[j] === '{') d++
    else if (code[j] === '}' && --d === 0) return code.slice(open, j + 1)
  }
  throw new Error('unbalanced')
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === '__tests__') continue
      walk(p, out)
    } else if (/\.tsx?$/.test(e.name)) out.push(p)
  }
  return out
}
const SRC_ROOT = path.join(process.cwd(), 'src')
const relOf = (abs: string) => path.relative(SRC_ROOT, abs).split(path.sep).join('/')

describe('the surface is read', () => {
  it('every file exists and is non-trivial', () => {
    let examined = 0
    for (const rel of MAIL_FILES) {
      expect(src(rel).length).toBeGreaterThan(500)
      examined++
    }
    expect(examined).toBe(MAIL_FILES.length)
  })
})

describe('E-ledger: finishSend is the ONLY writer of a terminal status', () => {
  it('no file but sends.ts writes sent / failed / skipped onto an evite_sends row', () => {
    let examined = 0
    const offenders: string[] = []
    for (const abs of walk(SRC_ROOT)) {
      const rel = relOf(abs)
      const code = readSrc(...rel.split('/'))
      if (!/['"`]evite_sends['"`]/.test(code)) continue
      examined++
      if (rel === 'lib/evites/sends.ts') continue
      for (const m of Array.from(code.matchAll(/\bstatus\s*:\s*['"](sent|failed|skipped)['"]/g))) offenders.push(`${rel}: status: '${m[1]}'`)
    }
    expect(examined).toBeGreaterThanOrEqual(2)
    expect(offenders).toEqual([])
  })

  it('inside sends.ts the three terminal statuses appear only in finishSend, and claim / reclaim write only `sending`', () => {
    const code = src('lib/evites/sends.ts')
    const finish = bodyOf(code, /export async function finishSend\(/)
    expect(finish.length).toBeGreaterThan(300)
    const start = code.indexOf(finish)
    let terminal = 0
    for (const m of Array.from(code.matchAll(/\bstatus\s*:\s*['"](sent|failed|skipped)['"]/g))) {
      terminal++
      const at = m.index as number
      expect(at).toBeGreaterThanOrEqual(start)
      expect(at).toBeLessThan(start + finish.length)
    }
    expect(terminal).toBe(3)
    // every other status written is `sending`
    const outside = code.slice(0, start) + code.slice(start + finish.length)
    const others = Array.from(outside.matchAll(/\bstatus\s*:\s*['"](\w+)['"]/g)).map((m) => m[1])
    expect(others.length).toBeGreaterThanOrEqual(3)
    expect(others.every((s) => s === 'sending')).toBe(true)
  })

  it('finishSend is conditional on the row still being `sending`, reads its error, and reads the row back', () => {
    const finish = squash(bodyOf(src('lib/evites/sends.ts'), /export async function finishSend\(/))
    expect(finish).toMatch(/\.eq\('id', id\)\.eq\('status', 'sending'\)\.select\('id'\)/)
    expect(finish).toMatch(/if \(error\) \{[^}]*continue/)
    expect(finish).toMatch(/rows\.length === 0\) return \{ ok: false, reason: 'not-sending'/)
  })

  it('claimSend answers `duplicate` only for the unique index, and every other error is unavailable', () => {
    const claim = squash(bodyOf(src('lib/evites/sends.ts'), /export async function claimSend\(/))
    expect(claim).toMatch(/e\.code === '23505' && String\(e\.message \?\? ''\)\.includes\(UNIQUE_SEND_INDEX\)\) return \{ kind: 'duplicate' \}/)
    expect(claim).toMatch(/return \{ kind: 'unavailable', error: e\.message/)
  })
})

describe('E6: claim precedes send, and there is exactly one send site', () => {
  it('sendEviteEmail is called from sendOne.ts and nowhere else (mail.ts defines it)', () => {
    const callers: string[] = []
    let examined = 0
    for (const abs of walk(SRC_ROOT)) {
      const rel = relOf(abs)
      examined++
      const code = readSrc(...rel.split('/'))
      if (rel === 'lib/evites/mail.ts') continue
      if (/\bsendEviteEmail\s*\(/.test(code)) callers.push(rel)
    }
    expect(examined).toBeGreaterThan(300)
    expect(callers).toEqual(['lib/evites/sendOne.ts'])
  })

  it('in performSend: the context is re-read, THEN built, THEN sent, THEN finished; the flag is checked first', () => {
    const body = bodyOf(src('lib/evites/sendOne.ts'), /export async function performSend\(/)
    const at = (needle: string) => {
      const i = body.indexOf(needle)
      expect(i).toBeGreaterThan(-1)
      return i
    }
    const flag = at("eviteSendsMode() === 'off'")
    const load = at('loadSendContext(')
    const pilot = at("eviteSendsMode() === 'pilot'")
    const prep = at('await prepare(')
    const send = at('await sendEviteEmail(')
    const sent = at("finish({ kind: 'sent'")
    expect(flag).toBeLessThan(load)
    expect(load).toBeLessThan(pilot)
    expect(pilot).toBeLessThan(prep)
    expect(prep).toBeLessThan(send)
    expect(send).toBeLessThan(sent)
    // the unconfigured and failed outcomes are finished BEFORE the success path is reached
    expect(body.indexOf("out.kind === 'unconfigured'")).toBeLessThan(sent)
    expect(body.indexOf("out.kind === 'failed'")).toBeLessThan(sent)
  })

  it('claimAndSend claims before it works the row, and gates on the flag before it claims', () => {
    const body = bodyOf(src('lib/evites/sendOne.ts'), /export async function claimAndSend\(/)
    const flag = body.indexOf("mode === 'off'")
    const claim = body.indexOf('await claimSend(')
    const perform = body.indexOf('performSend(')
    expect(flag).toBeGreaterThan(-1)
    expect(flag).toBeLessThan(claim)
    expect(claim).toBeLessThan(perform)
    expect(squash(body)).toMatch(/claim\.kind === 'duplicate'\) return \{ kind: 'duplicate' \}/)
  })

  it('the inline hooks only ever send through claimAndSend', () => {
    const code = src('lib/evites/inlineSends.ts')
    expect(code).not.toMatch(/\bperformSend\s*\(/)
    expect(code).not.toMatch(/\bsendEviteEmail\s*\(/)
    expect(Array.from(code.matchAll(/\bclaimAndSend\s*\(/g)).length).toBeGreaterThanOrEqual(2)
  })

  it('every send type has a sendable-until rule and a preparation branch', () => {
    const code = src('lib/evites/sendOne.ts')
    const until = bodyOf(code, /function sendableUntil\(/)
    const prep = bodyOf(code, /async function prepare\(/)
    let examined = 0
    for (const t of EVITE_SEND_TYPES) {
      examined++
      expect(until).toContain(`case '${t}'`)
      expect(prep).toContain(`case '${t}'`)
    }
    expect(examined).toBe(10)
  })
})

describe('every write reads its {error}', () => {
  it('each .update / .insert in the mail path is assigned, and the assigned name\'s error is read', () => {
    let examined = 0
    const offenders: string[] = []
    for (const rel of ['lib/evites/sends.ts', 'lib/evites/sendOne.ts', 'lib/evites/inlineSends.ts']) {
      const code = src(rel)
      for (const m of Array.from(code.matchAll(/\.(update|insert)\(/g))) {
        examined++
        const before = code.slice(Math.max(0, (m.index as number) - 260), m.index as number)
        const decl = Array.from(before.matchAll(/(?:const|let)\s+(\{[^}]*\}|\w+)\s*=\s*await\s+supabase/g)).pop()
        if (!decl) {
          offenders.push(`${rel}: write not assigned @${m.index}`)
          continue
        }
        const name = decl[1]
        const after = code.slice(m.index as number, (m.index as number) + 900)
        const reads = name.startsWith('{') ? /\berror\b/.test(name) : new RegExp(`\\b${name}\\.error\\b`).test(code.slice(decl.index as number, (m.index as number) + 1500))
        if (!reads) offenders.push(`${rel}: ${name} .error never read @${m.index}`)
        expect(after.length).toBeGreaterThan(0)
      }
    }
    expect(examined).toBeGreaterThanOrEqual(6)
    expect(offenders).toEqual([])
  })
})

describe('house rules for the new files', () => {
  it('no setHours / setMinutes, no `new Date(x + "T")`, no select("*"), no raw .or()', () => {
    let examined = 0
    const offenders: string[] = []
    for (const rel of MAIL_FILES) {
      examined++
      const code = src(rel)
      if (/\.(setHours|setMinutes)\s*\(/.test(code)) offenders.push(`${rel}: setHours`)
      if (/new Date\([^)]*\+\s*['"`]T/.test(code) || /new Date\(`\$\{[^}]*\}T/.test(code)) offenders.push(`${rel}: new Date(x + 'T')`)
      if (/\.select\(\s*['"`]\s*\*\s*['"`]/.test(code)) offenders.push(`${rel}: select('*')`)
      if (/\.or\(/.test(code)) offenders.push(`${rel}: .or(`)
      if (/\.(skip|todo)\(|\bxit\(/.test(code)) offenders.push(`${rel}: skipped test syntax`)
    }
    expect(examined).toBe(MAIL_FILES.length)
    expect(offenders).toEqual([])
  })

  it('nothing logs an address, a name or a body', () => {
    let examined = 0
    const offenders: string[] = []
    for (const rel of MAIL_FILES) {
      const code = src(rel)
      for (const m of Array.from(code.matchAll(/console\.(log|warn|error|info)\s*\(([^;]*)/g))) {
        examined++
        if (/\$\{[^}]*(?:\bto\b|email|Email|parent_name|parentName|\.html|\.text|reminder|contact_)[^}]*\}/.test(m[2])) offenders.push(`${rel}: ${m[0].slice(0, 90)}`)
      }
    }
    expect(examined).toBeGreaterThanOrEqual(4)
    expect(offenders).toEqual([])
  })

  it('the customer-facing text says Allie, never Adam, and never "tomorrow" or "today"', () => {
    const code = src('lib/email-templates/evites.ts')
    // the signature is a constant used by every template
    expect(code).toContain("'Allie & the Host Hampton team'")
    expect(code).toContain("'Allie &amp; the Host Hampton team'")
    expect(code).not.toMatch(/\bAdam\b/)
    expect(code).not.toMatch(/\b(tomorrow|today)\b/i)
  })

  it('the templates never call escapeHtml (they escape once, at entry, with escapeFields)', () => {
    const code = src('lib/email-templates/evites.ts')
    expect(code).not.toMatch(/\bescapeHtml\s*\(/)
    const exported = Array.from(code.matchAll(/export function (\w+)\(/g)).map((m) => m[1])
    expect(exported).toHaveLength(10)
    for (const name of exported) expect(bodyOf(code, new RegExp(`export function ${name}\\(`))).toContain('escapeFields(')
  })

  it('the arrival-note placeholder can never be rendered: the template checks the sentinel itself', () => {
    const tpl = src('lib/email-templates/evites.ts')
    const note = bodyOf(tpl, /function usableArrivalNote\(/)
    expect(note).toContain('STUDIO_ARRIVAL_NOTE_SENTINEL')
    expect(note).toContain('STUDIO_ARRIVAL_NOTE_READY')
    const loc = fs.readFileSync(path.join(SRC_ROOT, 'lib/studioLocation.ts'), 'utf8')
    expect(loc).toMatch(/STUDIO_ARRIVAL_NOTE_READY: boolean =[\s\S]*startsWith\(STUDIO_ARRIVAL_NOTE_SENTINEL\)/)
  })
})
