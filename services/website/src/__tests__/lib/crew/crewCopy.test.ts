/**
 * Every crew message, rendered. Promises (spec §3.3, §6):
 *   1. it signs "— Allie, Host Hampton" (messages are always from Allie);
 *   2. it never names a level, a tier or points — crew see dollars a party;
 *   3. LAUNCH MODE (the pay ladder and pay figures are OFF): no dollar sign and
 *      no word about a rate, a step, a reset or "two parties" in anything a crew
 *      member is sent. The same templates are rendered both ways, so the ladder
 *      wording that survives behind the switch is still checked too.
 *
 * The template list is DISCOVERED from the module, not typed out here, so a
 * new template cannot skip the check by not being added to a list. Every
 * argument is filled from a sample by its parameter name; a template whose
 * parameters this file cannot fill fails, loudly.
 */
import fs from 'fs'
import path from 'path'
import { templates, adminTemplates, CREW_SIGNATURE, type PartyRef } from '@/lib/crew/templates'
import { decomment } from '../../helpers/sourceScan'

const party: PartyRef = {
  theme: 'Glow Party', dayLabel: 'Sat Oct 31', timeLabel: '1:30–4:30 PM', setupLabel: '1:00 PM', kids: 14,
  url: 'https://www.hosthampton.com/crew/parties/x',
}

const SAMPLES: Record<string, unknown> = {
  p: party, firstName: 'Sam', requesterFirst: 'Sam', memberFirst: 'Sam', coverFirst: 'Jo', loginUrl: 'https://www.hosthampton.com/crew/login',
  code: '123456', payLabel: '$58.50', dueLabel: 'Tue 5pm', address: '295 Montauk Hwy, Speonk, NY 11972',
  newRateLabel: '$55.00', rateLabel: '$51.00', resetRateLabel: '$51.00', stepLabel: '$2.50', waived: false, role: 'lead',
  url: 'https://www.hosthampton.com/crew', adminUrl: 'https://www.hosthampton.com/admin/crew', monthLabel: 'December',
  tipLabel: '$20.00', reason: 'sick', standbys: 2, noticeDays: 9,
  spots: 2, count: 3, open: true, crewShort: 2, leadShort: true, daysOut: 4, asked: 3, ladder: true,
  items: [{ theme: 'Glow Party', dayLabel: 'Sat Oct 31' }, { theme: 'Unicorn Party', dayLabel: 'Sun Nov 1' }], more: 1,
}

/** What the launch build passes: no pay figure, no ladder wording. */
const LAUNCH: Record<string, unknown> = { payLabel: null, ladder: false }

function paramNames(fn: (...a: never[]) => unknown): string[] {
  const src = fn.toString()
  const open = src.indexOf('(')
  let depth = 0, close = open
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')' && --depth === 0) { close = i; break }
  }
  return src.slice(open + 1, close).split(',').map(s => s.trim().split(/[\s:=]/)[0]).filter(Boolean)
}

function render(fn: (...a: never[]) => unknown, over: Record<string, unknown> = {}): unknown {
  const args = paramNames(fn).map(n => {
    if (n in over) return over[n]
    if (!(n in SAMPLES)) throw new Error(`crewCopy: no sample for parameter "${n}"`)
    return SAMPLES[n]
  })
  return (fn as (...a: unknown[]) => unknown)(...args)
}

type Out = { sms: string; email: { subject: string; text: string }; inApp: string }
const parts = (o: Out) => [o.sms, o.email.subject, o.email.text, o.inApp]

const BANNED = /\b(level|levels|tier|tiers|points?|captain|crew pro|pro)\b/i
/** Anything that tells a crew member their pay moves or what it is. */
const LADDER_WORDS = /\b(rate|rates|step|steps|ladder|reset|two parties|counts as)\b/i

/**
 * Phase 5 templates: sent only when attendance moves a step or records pay,
 * which never happens while the ladder is off (and nothing calls them yet —
 * asserted below, so this exemption cannot quietly start protecting a live send).
 */
const PHASE_5_NEVER_SENT_AT_LAUNCH = ['paid', 'stepUp', 'stepReset'] as const

describe('crew templates', () => {
  const names = Object.keys(templates) as (keyof typeof templates)[]

  it('discovers the whole module (so the checks below are not vacuous)', () => {
    expect(names.length).toBeGreaterThanOrEqual(22)
    for (const n of ['openSpots', 'partiesDigest'] as const) expect(names).toContain(n)
  })

  for (const name of names) {
    it(`${name}: signs as Allie and talks in dollars`, () => {
      const out = render(templates[name] as never) as Out
      expect(out.sms.endsWith(CREW_SIGNATURE)).toBe(true)
      expect(out.email.text.endsWith(CREW_SIGNATURE)).toBe(true)
      for (const s of parts(out)) {
        expect(s).not.toMatch(BANNED)
        expect(s).not.toMatch(/undefined|\[object Object\]|NaN/)
        expect(s).not.toMatch(/Adam\b/)
      }
    })
  }

  describe('LAUNCH MODE (payLabel null, ladder false)', () => {
    let examined = 0
    for (const name of names) {
      if ((PHASE_5_NEVER_SENT_AT_LAUNCH as readonly string[]).includes(name)) continue
      // `partiesDigest` has two bodies (new / still open); every other template has one.
      const variants: Record<string, unknown>[] = name === 'partiesDigest' ? [{ open: true }, { open: false }] : [{}]
      for (const v of variants) {
        it(`${name}${'open' in v ? ` (open=${String(v.open)})` : ''}: signs as Allie, no dollars, no word about a rate`, () => {
          const out = render(templates[name] as never, { ...LAUNCH, ...v }) as Out
          expect(out.sms.endsWith(CREW_SIGNATURE)).toBe(true)
          expect(out.email.text.endsWith(CREW_SIGNATURE)).toBe(true)
          for (const s of parts(out)) {
            expect(s).not.toContain('$')
            expect(s).not.toMatch(LADDER_WORDS)
            expect(s).not.toMatch(BANNED)
            expect(s).not.toMatch(/undefined|\[object Object\]|NaN/)
            expect(s).not.toMatch(/Adam\b/)
          }
          examined++
        })
      }
    }

    it('examined every non-Phase-5 template (the loop above is not vacuous)', () => {
      expect(examined).toBe(names.length - PHASE_5_NEVER_SENT_AT_LAUNCH.length + 1)
    })

    it('the exemption names templates that exist', () => {
      for (const n of PHASE_5_NEVER_SENT_AT_LAUNCH) expect(names).toContain(n)
    })
  })

  it('invite says nothing about pay in either mode', () => {
    const out = render(templates.invite as never) as Out
    for (const s of parts(out)) {
      expect(s).not.toContain('$')
      expect(s).not.toMatch(/\bpay\b|\brate\b/i)
    }
  })

  it('a pay label shows up when one is given, and not when it is null', () => {
    const withPay = render(templates.newParty as never, { payLabel: '$58.50' }) as Out
    const without = render(templates.newParty as never, { payLabel: null }) as Out
    expect(withPay.sms).toContain('$58.50')
    expect(withPay.email.text).toContain('$58.50')
    expect(without.sms).not.toContain('$')
    expect(without.email.text).not.toContain('$')
  })

  it('ladder wording appears only when the ladder is on', () => {
    const on = render(templates.coverOffer as never, { ladder: true }) as Out
    const off = render(templates.coverOffer as never, { ladder: false }) as Out
    expect(on.email.text).toMatch(/two parties/)
    expect(off.email.text).not.toMatch(/two parties/)
  })

  it('nothing in src/lib or src/app calls a Phase 5 template (paid, stepUp, stepReset)', () => {
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
      e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(dir, e.name)] : [])
    const files = [...walk(path.join(process.cwd(), 'src', 'lib')), ...walk(path.join(process.cwd(), 'src', 'app'))]
    expect(files.length).toBeGreaterThan(100)
    const call = new RegExp(`\\btemplates\\s*(?:\\.|\\[\\s*['"\`])\\s*(?:${PHASE_5_NEVER_SENT_AT_LAUNCH.join('|')})\\b`)
    const offenders: string[] = []
    let sawTemplatesModule = false
    for (const f of files) {
      const src = decomment(fs.readFileSync(f, 'utf8'))
      if (f.endsWith(path.join('crew', 'templates.ts'))) { sawTemplatesModule = true; continue }
      if (call.test(src)) offenders.push(path.relative(process.cwd(), f))
    }
    expect(sawTemplatesModule).toBe(true)
    expect(offenders).toEqual([])
  })

  it('never hard-codes a phone number (it comes from lib/studioLocation)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../../lib/crew/templates.ts'), 'utf8') as string
    expect(src).not.toMatch(/\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}/)
  })

  it('never hard-codes the step amount (it is a setting)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../../lib/crew/templates.ts'), 'utf8') as string
    expect(src).not.toMatch(/\$2\.50/)
  })
})

describe('admin templates', () => {
  const adminNames = Object.keys(adminTemplates) as (keyof typeof adminTemplates)[]

  it('has the new alerts and no longer has noLead', () => {
    expect(adminNames).toEqual(expect.arrayContaining(['coverOfferedToAll', 'coverNobodyFree', 'understaffed']))
    expect(adminNames).not.toContain('noLead')
  })

  for (const name of adminNames) {
    it(`${name} renders`, () => {
      const out = render(adminTemplates[name] as never) as { subject: string; text: string }
      expect(out.subject.length).toBeGreaterThan(5)
      expect(out.text).not.toMatch(/undefined|\[object Object\]|NaN/)
      expect(out.text).not.toMatch(BANNED)
    })
  }

  it('understaffed names what is short: a Lead, crew, or both', () => {
    const both = adminTemplates.understaffed(party, 2, true, 4, 'https://x/admin/crew')
    expect(both.text).toMatch(/a Party Lead and 2 crew spots/)
    expect(both.text).toMatch(/4 days out/)
    const crewOnly = adminTemplates.understaffed(party, 1, false, 1, 'https://x/admin/crew')
    expect(crewOnly.text).toMatch(/still needs 1 crew spot\./)
    expect(crewOnly.text).toMatch(/1 day out/)
    expect(crewOnly.text).not.toMatch(/Party Lead/)
  })
})
