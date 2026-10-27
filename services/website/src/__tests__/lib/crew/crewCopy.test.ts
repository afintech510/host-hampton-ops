/**
 * Every crew message, rendered. Two promises (spec §3.3, §6):
 *   1. it signs "— Allie, Host Hampton" (messages are always from Allie);
 *   2. it never names a level, a tier or points — crew see dollars a party.
 *
 * The template list is DISCOVERED from the module, not typed out here, so a
 * new template cannot skip the check by not being added to a list. Every
 * argument is filled from a sample by its parameter name; a template whose
 * parameters this file cannot fill fails, loudly.
 */
import { templates, adminTemplates, CREW_SIGNATURE, type PartyRef } from '@/lib/crew/templates'

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
}

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

function render(fn: (...a: never[]) => unknown): unknown {
  const args = paramNames(fn).map(n => {
    if (!(n in SAMPLES)) throw new Error(`crewCopy: no sample for parameter "${n}"`)
    return SAMPLES[n]
  })
  return (fn as (...a: unknown[]) => unknown)(...args)
}

const BANNED = /\b(level|levels|tier|tiers|points?|captain|crew pro|pro)\b/i

describe('crew templates', () => {
  const names = Object.keys(templates) as (keyof typeof templates)[]

  it('discovers the whole module (so the checks below are not vacuous)', () => {
    expect(names.length).toBeGreaterThanOrEqual(20)
  })

  for (const name of names) {
    it(`${name}: signs as Allie and talks in dollars`, () => {
      const out = render(templates[name] as never) as { sms: string; email: { subject: string; text: string }; inApp: string }
      expect(out.sms.endsWith(CREW_SIGNATURE)).toBe(true)
      expect(out.email.text.endsWith(CREW_SIGNATURE)).toBe(true)
      for (const s of [out.sms, out.email.subject, out.email.text, out.inApp]) {
        expect(s).not.toMatch(BANNED)
        expect(s).not.toMatch(/undefined|\[object Object\]|NaN/)
        expect(s).not.toMatch(/Adam\b/)
      }
    })
  }

  it('never hard-codes a phone number (it comes from lib/studioLocation)', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../../lib/crew/templates.ts'), 'utf8') as string
    expect(src).not.toMatch(/\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}/)
  })

  it('never hard-codes the step amount (it is a setting)', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../../lib/crew/templates.ts'), 'utf8') as string
    expect(src).not.toMatch(/\$2\.50/)
  })
})

describe('admin templates', () => {
  for (const name of Object.keys(adminTemplates) as (keyof typeof adminTemplates)[]) {
    it(`${name} renders`, () => {
      const out = render(adminTemplates[name] as never) as { subject: string; text: string }
      expect(out.subject.length).toBeGreaterThan(5)
      expect(out.text).not.toMatch(/undefined|\[object Object\]|NaN/)
      expect(out.text).not.toMatch(BANNED)
    })
  }
})
