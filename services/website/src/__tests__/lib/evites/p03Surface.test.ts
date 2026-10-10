import fs from 'fs'
import path from 'path'

/**
 * Source tripwires for the P03 modules. CRLF-tolerant: every regex below reads
 * `\r?\n`, and the file text is normalised first.
 */

const DIR = path.join(process.cwd(), 'src', 'lib', 'evites')
const read = (f: string) => fs.readFileSync(path.join(DIR, f), 'utf8').replace(/\r\n/g, '\n')
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.ts'))

/** Source with block and line comments blanked, so prose cannot satisfy or trip a rule. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`])\/\/[^\n]*/g, (_m, p: string) => p)
}

const PURE = ['themes.ts', 'partyWindow.ts', 'location.ts', 'state.ts', 'facts.ts', 'hash.ts', 'fit.ts', 'eligibility.ts', 'slug.ts']

describe('evites P03 surface', () => {
  it('examines every module in lib/evites (the count guards the loop)', () => {
    expect(files.length).toBeGreaterThanOrEqual(15)
    for (const f of ['facts.ts', 'state.ts', 'themes.ts', 'partyWindow.ts', 'hash.ts', 'glyphs.ts', 'fit.ts']) expect(files).toContain(f)
  })

  it('no module uses a local-time Date setter (the box is UTC)', () => {
    for (const f of files) expect(code(read(f))).not.toMatch(/\.set(Hours|Minutes|Date|Month|FullYear)\s*\(/)
    for (const f of files) expect(read(f)).not.toMatch(/setHours/)
  })

  it('no module builds a Date from a date string plus a time suffix', () => {
    for (const f of files) {
      const c = code(read(f))
      expect(c).not.toMatch(/\+\s*['"`]T\d/)
      expect(c).not.toMatch(/\$\{[^}]*\}T\d{2}:/)
      expect(c).not.toMatch(/new Date\(\s*[`'"][^`'"]*T\d{2}:/)
      expect(read(f)).not.toMatch(/T12:00/)
    }
  })

  it('the pure modules read no environment and touch no filesystem', () => {
    for (const f of PURE) {
      const c = code(read(f))
      expect(c).not.toMatch(/process\.env/)
      expect(c).not.toMatch(/from ['"](fs|path)['"]/)
    }
  })

  it('glyphs.ts is the one module that reads the filesystem, from process.cwd()/public/evites/fonts', () => {
    const c = code(read('glyphs.ts'))
    expect(c).toMatch(/process\.cwd\(\)/)
    expect(c).toMatch(/'public',\s*'evites',\s*'fonts'/)
    expect(c).not.toMatch(/process\.env/)
  })

  it('facts never imports the payments contact (631-599-2469 is the Venmo/Zelle number)', () => {
    for (const f of files) expect(code(read(f))).not.toMatch(/paymentContacts/)
    expect(code(read('facts.ts'))).toMatch(/STUDIO_PHONE_DISPLAY/)
    expect(read('facts.ts')).not.toMatch(/599.?2469/)
  })

  it('"booked" comes only from bookingStage(): state.ts calls it and keeps no status list of its own', () => {
    const c = code(read('state.ts'))
    expect(c).toMatch(/bookingStage\(/)
    expect(c).toMatch(/sumPayments\(/)
    for (const legacy of ['deposit_paid', 'paid_in_full', 'modifications_locked', 'awaiting_deposit', 'pending_review']) {
      expect(c).not.toContain(legacy)
    }
  })

  it('state.ts reads time through partyWindow and etDateString only', () => {
    const c = code(read('state.ts'))
    expect(c).toMatch(/partyWindow\(/)
    expect(c).toMatch(/etDateString\(/)
    expect(c).not.toMatch(/new Date\(\)|Date\.now\(\)/)
  })

  it('partyWindow converts through etToUtc and enforces the 08:00-21:00 window', () => {
    const c = code(read('partyWindow.ts'))
    expect(c).toMatch(/etToUtc\(/)
    expect(c).toMatch(/PARTY_START_EARLIEST_MIN\s*=\s*8 \* 60/)
    expect(c).toMatch(/PARTY_START_LATEST_MIN\s*=\s*21 \* 60/)
  })

  it('facts formats dates only in America/New_York (PARTY_TZ)', () => {
    const c = code(read('facts.ts'))
    expect(c).toMatch(/timeZone:\s*PARTY_TZ/)
    expect(c).not.toMatch(/toLocale(Date|Time)String/)
    expect(c).not.toMatch(/getHours|getDay\(|getMonth\(|getDate\(/)
  })

  it('every string facts binds to an image goes through screenForImage', () => {
    const c = code(read('facts.ts'))
    const calls = c.match(/screenForImage\(/g) ?? []
    expect(calls.length).toBeGreaterThanOrEqual(10)
  })

  it('no module in this phase selects *', () => {
    for (const f of files) expect(code(read(f))).not.toMatch(/select\(\s*['"`]\*['"`]/)
  })
})
