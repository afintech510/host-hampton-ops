/**
 * Crew onboarding (migration 082): phone sign-in, the profile, the agreement.
 *
 *   O1  a birthday under 18 is refused, and the boundary is the birthday itself;
 *   O2  the screens: names, state, ZIP, phone, emergency contact;
 *   O3  who has to onboard, and the stage an admin sees;
 *   O4  phone sign-in parsing is enumeration-neutral (the same shape either way);
 *   O5  no crew-facing code reads or returns a profile column outside the allow-list;
 *   O6  the `crew_agreement` writer takes the member from SignWell, not the POST;
 *   O7  the quiet-hours exemption is named once;
 *   O8  the agreement: reference markdown matches, the PDF renders with the tag;
 *   O9  an admin profile view is refused when the audit row cannot be written.
 */

import fs from 'fs'
import path from 'path'

jest.mock('@/lib/supabase', () => ({ getSupabase: () => ({}) }))

import { ageOn, onboardingRequired, onboardingStateFrom, ownProfileView, screenDateOfBirth, screenProfileEdit, screenProfileInput, screenPhone, profileIsFilled } from '@/lib/crew/profile'
import { onboardingStage } from '@/lib/crew/adminMembers'
import { parseLoginIdentity } from '@/lib/crew/loginIdentity'
import { AGREEMENT_CLAUSES, agreementMarkdown } from '@/lib/crew/agreementText'
import { renderAgreementPdf, winAnsiSafe, SIGNATURE_TAG } from '@/lib/crew/agreementPdf'
import { viewProfile } from '@/lib/crew/adminOnboarding'

const SRC = path.join(process.cwd(), 'src')
const REPO = path.join(process.cwd(), '..', '..')

function decomment(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\/|(^|[^:'"`\\])\/\/[^\n\r]*/g, (m, p) => {
    const keep = p ?? ''
    return keep + m.slice(keep.length).replace(/[^\n\r]/g, ' ')
  })
}
const read = (rel: string) => decomment(fs.readFileSync(path.join(SRC, rel), 'utf8'))
function walk(dir: string, pick: (n: string) => boolean): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p, pick))
    else if (pick(e.name)) out.push(path.relative(SRC, p).split(path.sep).join('/'))
  }
  return out.sort()
}

const NOW = new Date('2026-11-05T15:00:00Z') // 10am Eastern, 5 Nov 2026

const GOOD = {
  legalFirstName: 'Jordan', legalLastName: "O'Neil-Smith", preferredName: 'Jo', dateOfBirth: '2000-06-15',
  addressLine1: '12 Main St', addressLine2: '', city: 'Speonk', state: 'ny', zip: '11972',
  emergencyName: 'Pat Smith', emergencyRelationship: 'mom', emergencyPhone: '(631) 555-0123',
}

describe('O1: the age rule', () => {
  it('refuses a birthday under 18, accepts exactly 18, and counts from the birthday not the year', () => {
    expect(screenDateOfBirth('2008-11-06', NOW).ok).toBe(false) // turns 18 tomorrow
    expect(screenDateOfBirth('2008-11-05', NOW).ok).toBe(true)  // turns 18 today
    expect(screenDateOfBirth('2008-11-04', NOW).ok).toBe(true)
    expect(screenDateOfBirth('2015-01-01', NOW)).toEqual({ ok: false, error: expect.stringMatching(/18 or older/) })
    expect(ageOn('2008-11-05', '2026-11-05')).toBe(18)
    expect(ageOn('2008-11-06', '2026-11-05')).toBe(17)
  })

  it('refuses the future, a non-date, an impossible date and a century-old one', () => {
    for (const v of ['2027-01-01', 'yesterday', '', '2000-02-30', '2000-13-01', 20000101, null, '1900-01-01']) {
      expect(screenDateOfBirth(v as never, NOW).ok).toBe(false)
    }
  })

  it('the full profile screen refuses an under-18 member', () => {
    expect(screenProfileInput({ ...GOOD, dateOfBirth: '2012-01-01' }, NOW).ok).toBe(false)
  })
})

describe('O2: the screens', () => {
  it('accepts a good profile and normalises it', () => {
    const r = screenProfileInput(GOOD, NOW)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.state).toBe('NY')
      expect(r.value.emergency_phone).toBe('+16315550123')
      expect(r.value.preferred_name).toBe('Jo')
      expect(r.value.address_line2).toBeNull()
    }
  })

  it('refuses each missing or malformed field with a message naming it', () => {
    const cases: [Partial<typeof GOOD>, RegExp][] = [
      [{ legalFirstName: '' }, /first name/i],
      [{ legalLastName: '<script>' }, /last name/i],
      [{ addressLine1: '' }, /address/i],
      [{ city: '' }, /city/i],
      [{ state: 'ZZ' }, /state/i],
      [{ zip: '1197' }, /zip/i],
      [{ emergencyName: '' }, /emergency contact name/i],
      [{ emergencyRelationship: '' }, /relationship/i],
      [{ emergencyPhone: '555' }, /phone/i],
    ]
    for (const [patch, re] of cases) {
      const r = screenProfileInput({ ...GOOD, ...patch }, NOW)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toMatch(re)
    }
  })

  it('a US phone must start 2-9 and is stored +1XXXXXXXXXX', () => {
    expect(screenPhone('631-555-0123', 'x')).toEqual({ ok: true, value: '+16315550123' })
    expect(screenPhone('131-555-0123', 'x').ok).toBe(false)
  })

  it('the after-signing edit screen has no legal name or birthday in it', () => {
    const r = screenProfileEdit({ ...GOOD, legalFirstName: 'Hacker', dateOfBirth: '1990-01-01' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(Object.keys(r.value)).not.toEqual(expect.arrayContaining(['legal_first_name']))
      expect(Object.keys(r.value)).not.toContain('date_of_birth')
      expect(Object.keys(r.value)).not.toContain('legal_last_name')
    }
  })

  it('strips control characters from free text', () => {
    const r = screenProfileInput({ ...GOOD, addressLine1: '12 Main\u0000 St\n' }, NOW)
    expect(r.ok && r.value.address_line1).toBe('12 Main St')
  })
})

describe('O3: who onboards, and the stage', () => {
  const real = { is_owner: false, is_test: false, phone: '+16315550123' }

  it('the owner and phone-less test members are exempt; a test member WITH a phone is not', () => {
    expect(onboardingRequired({ is_owner: true, is_test: false, phone: null })).toBe(false)
    expect(onboardingRequired({ is_owner: false, is_test: true, phone: null })).toBe(false)
    expect(onboardingRequired({ is_owner: false, is_test: true, phone: '+16315550123' })).toBe(true)
    expect(onboardingRequired(real)).toBe(true)
  })

  it('incomplete until the details AND a current-version agreement are both done (agreement required)', () => {
    const base = { onboarding_completed_at: null, agreement_signed_at: null, agreement_version: null }
    expect(onboardingStateFrom(real, null, 'v1', true).incomplete).toBe(true)
    expect(onboardingStateFrom(real, { ...base, onboarding_completed_at: 'x' }, 'v1', true).incomplete).toBe(true)
    expect(onboardingStateFrom(real, { onboarding_completed_at: 'x', agreement_signed_at: 'y', agreement_version: 'v1' }, 'v1', true).incomplete).toBe(false)
    // Raising the version sends everyone back through the agreement step.
    expect(onboardingStateFrom(real, { onboarding_completed_at: 'x', agreement_signed_at: 'y', agreement_version: 'v1' }, 'v2', true).incomplete).toBe(true)
    // A signature without the details is still incomplete.
    expect(onboardingStateFrom(real, { ...base, agreement_signed_at: 'y', agreement_version: 'v1' }, 'v1', true).incomplete).toBe(true)
  
    // Tabled (the default): the agreement does not hold anyone back, but the details still do.
    const done = { onboarding_completed_at: 'x', agreement_signed_at: null, agreement_version: null }
    expect(onboardingStateFrom(real, done, 'v1', false).incomplete).toBe(false)
    expect(onboardingStateFrom(real, null, 'v1', false).incomplete).toBe(true)
    expect(onboardingStateFrom(real, { ...base, onboarding_completed_at: null }, 'v1', false).incomplete).toBe(true)
  })

  it('the admin stage runs added → link sent → signed in → profile done → agreement signed', () => {
    const none = null
    expect(onboardingStage(real, none, false, 'v1')).toBe('added')
    expect(onboardingStage(real, none, true, 'v1')).toBe('link_sent')
    expect(onboardingStage(real, { onboarding_completed_at: null, agreement_signed_at: null, agreement_version: null }, true, 'v1')).toBe('signed_in')
    expect(onboardingStage(real, { onboarding_completed_at: 'x', agreement_signed_at: null, agreement_version: 'v1' }, true, 'v1')).toBe('profile_done')
    expect(onboardingStage(real, { onboarding_completed_at: 'x', agreement_signed_at: 'y', agreement_version: 'v1' }, true, 'v1')).toBe('agreement_signed')
    expect(onboardingStage(real, { onboarding_completed_at: 'x', agreement_signed_at: 'y', agreement_version: 'v1' }, true, 'v2')).toBe('profile_done')
    expect(onboardingStage({ is_owner: true, is_test: false, phone: null }, none, false, 'v1')).toBe('not_required')
  })

  it('profileIsFilled needs every field', () => {
    expect(profileIsFilled(null)).toBe(false)
    expect(profileIsFilled({ legal_first_name: 'a' } as never)).toBe(false)
  })
})

describe('O4: sign-in identity', () => {
  it('a phone in any common spelling becomes the same +1 key; an email is lowercased', () => {
    for (const p of ['6315550123', '(631) 555-0123', '+1 631 555 0123', '1-631-555-0123']) {
      const r = parseLoginIdentity({ phone: p })
      expect(r).toEqual({ ok: true, identity: { kind: 'phone', phone: '+16315550123', key: '6315550123' } })
    }
    expect(parseLoginIdentity({ email: ' Jo@Example.COM ' })).toEqual({ ok: true, identity: { kind: 'email', email: 'jo@example.com' } })
  })

  it('refuses junk without saying anything about the crew', () => {
    for (const b of [{}, { phone: '123' }, { email: 'nope' }, { phone: '%' }, null, 'x']) {
      expect(parseLoginIdentity(b as never).ok).toBe(false)
    }
  })

  it('both login routes answer ok:true for an unknown number and judge the member before any code is touched', () => {
    const req = read('app/api/crew/auth/request/route.ts')
    const ver = read('app/api/crew/auth/verify/route.ts')
    for (const src of [req, ver]) {
      const judged = src.search(/crewMemberMayEnter\s*\(\s*member,\s*'onboarding'\s*\)/)
      expect(judged).toBeGreaterThan(-1)
      expect(src.search(/from\('crew_login_codes'\)/)).toBeGreaterThan(judged)
    }
    // Unknown member: the same { ok: true } as the success path, never an error.
    const unknown = req.slice(req.search(/if\s*\(\s*!member\s*\|\|/), req.search(/guardRecipient\(/))
    expect(unknown).toMatch(/NextResponse\.json\(\{ ok: true \}\)/)
    expect(unknown).not.toMatch(/status:\s*4/)
    // The attempt is claimed before the comparison, in verify.
    expect(ver.search(/\.update\(\{ attempts: row\.attempts \+ 1 \}\)/)).toBeLessThan(ver.search(/verifyEmailLoginCode\(/))
    // A sign-in code row can only be read with purpose 'login'.
    expect(ver).toMatch(/\.eq\('purpose',\s*'login'\)/)
    expect(req).toMatch(/\.eq\('purpose',\s*'login'\)/)
  })

  it('the recipient is bounded per member and per channel', () => {
    expect(read('app/api/crew/auth/request/route.ts')).toMatch(/guardRecipient\(`\$\{identity\.kind\}:crew:\$\{member\.id\}`/)
  })
})

describe('O5: profile columns never reach a crew-facing response outside the allow-list', () => {
  const crewFiles = [
    ...walk(path.join(SRC, 'app', 'crew'), n => /\.tsx?$/.test(n)),
    ...walk(path.join(SRC, 'app', 'api', 'crew'), n => n === 'route.ts'),
  ]
  const PROFILE_TABLE = /crew_member_profiles/
  const PII_COLUMNS = /\b(date_of_birth|address_line1|emergency_phone|emergency_name|agreement_document_id)\b/

  it('walks the surface it claims to', () => {
    expect(crewFiles.length).toBeGreaterThan(30)
    expect(crewFiles).toContain('app/api/crew/me/profile/route.ts')
  })

  it('no crew page or route names the profile table or a profile column — they go through lib/crew/profile.ts', () => {
    const offenders = crewFiles.filter(f => PROFILE_TABLE.test(read(f)) || PII_COLUMNS.test(read(f)))
    expect(offenders).toEqual([])
  })

  it('only /api/crew/me/* routes use the profile readers, and nothing returns agreement_document_id', () => {
    const users = crewFiles.filter(f => /\b(readOwnProfile|ownProfileView|saveProfile|saveProfileEdit)\b/.test(read(f)))
    expect(users.length).toBeGreaterThanOrEqual(2)
    for (const f of users) expect(f.startsWith('app/api/crew/me/')).toBe(true)
    const view = read('lib/crew/profile.ts')
    const fn = view.slice(view.indexOf('export function ownProfileView'), view.indexOf('/* ── Screening'))
    expect(fn).not.toMatch(/agreement_document_id|agreementDocumentId/)
  })

  it('ownProfileView returns blanks, never nulls, and nothing outside its list', () => {
    const v = ownProfileView(null)
    expect(Object.values(v).filter(x => x === null)).toEqual([])
    expect(Object.keys(v)).not.toEqual(expect.arrayContaining(['member_id']))
  })

  it('the table is named in exactly these four library files, nowhere else', () => {
    const all = walk(path.join(SRC, 'lib'), n => n.endsWith('.ts')).concat(walk(path.join(SRC, 'app'), n => /\.tsx?$/.test(n)))
    expect(all.filter(f => PROFILE_TABLE.test(read(f))).sort()).toEqual([
      'lib/crew/adminMembers.ts',   // roster stage: non-PII columns only (next test)
      'lib/crew/agreement.ts',      // binds the issued document id
      'lib/crew/profile.ts',        // the readers and writers
      'lib/signwellHandlers.ts',    // the crew_agreement writer
    ])
  })

  it('the roster stage query selects no PII column', () => {
    const src = read('lib/crew/adminMembers.ts')
    const m = /from\('crew_member_profiles'\)\.select\('([^']*)'\)/.exec(src)
    expect(m).not.toBeNull()
    expect(m![1]).not.toMatch(PII_COLUMNS)
  })
})

describe('O6: the crew_agreement writer', () => {
  const src = read('lib/signwellHandlers.ts')
  const start = src.indexOf('export const writeCrewAgreementSigned')
  const body = src.slice(start, src.indexOf('export const SIGNWELL_WRITERS'))

  it('is registered under the document type the PDF is created with', () => {
    expect(start).toBeGreaterThan(-1)
    expect(src).toMatch(/\[CREW_AGREEMENT_DOC_TYPE\]:\s*writeCrewAgreementSigned/)
    expect(read('lib/crew/agreement.ts')).toMatch(/type:\s*CREW_AGREEMENT_DOC_TYPE,\s*member_id:\s*member\.id/)
  })

  it('takes the member from SignWell\'s response and never from the POST body', () => {
    expect(body).toMatch(/truth\.metadata\.member_id/)
    expect(body).not.toMatch(/parsed\.metadata|parsed\.bookingRef|parsed\.releaseId/)
    expect(body).not.toMatch(/req\.|body\./)
  })

  it('binds the write to the document id issued to that member, and takes the version from SignWell', () => {
    expect(body).toMatch(/\.eq\('member_id',\s*memberId\)/)
    expect(body.match(/\.eq\('agreement_document_id',\s*parsed\.documentId\)/g)?.length).toBe(2) // the lookup AND the update
    expect(body).toMatch(/truth\.metadata\.version/)
  })

  it('agreement.ts never records a signature or a signed version — only the webhook writer does', () => {
    const a = read('lib/crew/agreement.ts')
    expect(a).not.toMatch(/agreement_signed_at\s*:|agreement_version\s*:/)
  })

  it('a non-UUID member id writes nothing', async () => {
    jest.resetModules()
    const update = jest.fn()
    jest.doMock('@/lib/supabase', () => ({ getSupabase: () => ({ from: () => ({ update }) }) }))
    const { writeCrewAgreementSigned } = await import('@/lib/signwellHandlers')
    const out = await writeCrewAgreementSigned(
      { documentId: 'doc1', eventType: 'document_completed', status: 'completed', metadata: { member_id: 'forged' }, docType: 'crew_agreement', bookingRef: null, releaseId: null },
      { kind: 'completed', metadata: { member_id: "' or 1=1" }, bookingRef: null, releaseId: null },
    )
    expect(update).not.toHaveBeenCalled()
    expect(out.status).toBe(200)
  })
})

describe('O7: the quiet-hours exemption is named once', () => {
  it('sendLoginCodeSms is called from the login-code route only, and is documented in quietHours.ts', () => {
    const callers = [
      ...walk(path.join(SRC, 'app'), n => /\.tsx?$/.test(n)),
      ...walk(path.join(SRC, 'lib'), n => n.endsWith('.ts')),
    ].filter(f => /\bsendLoginCodeSms\b/.test(read(f)) && f !== 'lib/crew/notify.ts')
    expect(callers).toEqual(['app/api/crew/auth/request/route.ts'])
    expect(fs.readFileSync(path.join(SRC, 'lib', 'quietHours.ts'), 'utf8')).toMatch(/sendLoginCodeSms/)
  })

  it('every other crew text sender in notify.ts checks quiet hours', () => {
    const src = read('lib/crew/notify.ts')
    const fns = Array.from(src.matchAll(/export async function (\w+)\(/g)).map(m => m[1])
    const senders = fns.filter(n => {
      const i = src.indexOf(`export async function ${n}(`)
      const next = src.indexOf('export async function', i + 10)
      const body = src.slice(i, next < 0 ? undefined : next)
      return /senders\.sms\(|deliverSms\(/.test(body)
    })
    expect(senders.length).toBeGreaterThanOrEqual(3)
    const exempt = senders.filter(n => {
      const i = src.indexOf(`export async function ${n}(`)
      const next = src.indexOf('export async function', i + 10)
      return !/checkSmsQuietHours\(/.test(src.slice(i, next < 0 ? undefined : next))
    })
    // Delivery of an already-claimed row is `deliverSms` (called after the check by its callers).
    expect(exempt.filter(n => n !== 'deliverSms' && n !== 'sendLoginCodeSms')).toEqual([])
  })
})

describe('O8: the agreement', () => {
  it('the reference copy in docs/ is exactly the text the PDF is made from', () => {
    const file = path.join(REPO, 'docs', 'crew', 'subcontractor-agreement-v1.md')
    if (process.env.UPDATE_AGREEMENT_MD === '1') fs.writeFileSync(file, agreementMarkdown())
    expect(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).toBe(agreementMarkdown())
  })

  it('covers what the Freelance Isn\'t Free Act requires, and the terms Adam listed', () => {
    const all = AGREEMENT_CLAUSES.map(c => `${c.heading}\n${c.paragraphs.join('\n')}`).join('\n').toLowerCase()
    for (const needle of [
      'the services', 'rate and method of pay', 'when payment is due', 'submitted', 'no minimum', 'decline', 'other people and businesses',
      'transportation', 'form 1099', 'w-9', 'benefits', 'child', 'confidential', 'photograph', 'supplies', 'solicit',
      'end this agreement', 'independent contractor', 'new york', 'electronically',
    ]) expect(all).toContain(needle)
    // No tax id is ever collected by the agreement.
    expect(all).toMatch(/does not collect any tax identification number/)
  })

  it('renders a PDF whose signature tag is the documented SignWell syntax', async () => {
    expect(SIGNATURE_TAG).toMatch(/^\{\{signature:1:y\s*\}\}$/)
    const bytes = await renderAgreementPdf({
      legalName: 'Jordan O’Neil ☃', addressLine1: '12 Main St', addressLine2: null, city: 'Speonk', state: 'NY', zip: '11972', email: 'j@example.com',
    })
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-')
    expect(bytes.length).toBeGreaterThan(2000)
  })

  it('winAnsiSafe never leaves a character the standard fonts cannot draw', () => {
    expect(winAnsiSafe('café — “quoted” ☃ \u{1F600}')).toBe('café — “quoted” ? ?')
  })
})

describe('O9: viewing a profile is audited, and the audit is the gate', () => {
  function fakeSb(opts: { auditFails: boolean }) {
    const reads: string[] = []
    const sb = {
      from: (table: string) => {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => {
            reads.push(table)
            return table === 'crew_members' ? { data: { steps: 2 }, error: null } : { data: { member_id: 'm', legal_first_name: 'Jo', date_of_birth: '2000-01-01', agreement_document_id: 'secret-doc', agreement_signed_at: 'x' }, error: null }
          },
          insert: () => ({ select: async () => (opts.auditFails ? { data: null, error: { message: 'down' } } : { data: [{ id: 1 }], error: null }) }),
        }
        return chain
      },
    }
    return { sb: sb as never, reads }
  }

  it('returns the profile only after the audit row is written, minus the document id', async () => {
    const { sb } = fakeSb({ auditFails: false })
    const r = await viewProfile(sb, 'm', 'admin:a@b.c')
    expect(r.ok).toBe(true)
    expect(JSON.stringify(r)).not.toContain('secret-doc')
    expect(JSON.stringify(r)).toContain('hasSignedAgreement')
  })

  it('a failed audit write returns nothing about the person', async () => {
    const { sb, reads } = fakeSb({ auditFails: true })
    const r = await viewProfile(sb, 'm', 'admin:a@b.c')
    expect(r.ok).toBe(false)
    expect(reads).not.toContain('crew_member_profiles')
  })
})

describe('O10: the agreement is tabled until CREW_AGREEMENT_REQUIRED=true', () => {
  it('startAgreement creates nothing (no read, no SignWell document) while it is off', async () => {
    const { startAgreement } = await import('@/lib/crew/agreement')
    const touched: string[] = []
    const sb = { from: (t: string) => { touched.push(t); throw new Error('must not read') } } as never
    const prev = process.env.CREW_AGREEMENT_REQUIRED
    delete process.env.CREW_AGREEMENT_REQUIRED
    expect(await startAgreement(sb, { id: 'm', email: 'a@b.co' })).toEqual({ kind: 'disabled' })
    expect(touched).toEqual([])
    if (prev !== undefined) process.env.CREW_AGREEMENT_REQUIRED = prev
  })

  it('the route answers 404 for it, and the onboarding flow only shows the step when the server says it is required', () => {
    expect(read('app/api/crew/me/agreement/route.ts')).toMatch(/case 'disabled':\s*return NextResponse\.json\(\{ error: 'Not found' \}, \{ status: 404 \}\)/)
    expect(read('app/crew/_components/OnboardingFlow.tsx')).toMatch(/d\.agreementRequired && !d\.state\.agreementSigned/)
  })
})
