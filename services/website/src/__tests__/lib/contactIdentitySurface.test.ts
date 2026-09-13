/**
 * THE CONTACT-IDENTITY TRIPWIRE.
 *
 * Reads the real sources off disk, in the shape `portalAuthSurface.test.ts`,
 * `signwellSurface.test.ts` and `stripeWebhookSurface.test.ts` established: a
 * deny-list of shapes, positive convention checks, a staleness walker, and
 * every exemption scoped to a NAMED FILE with a written reason.
 *
 * It exists because this defect family has now produced a finding in six
 * consecutive links, each time in a different file, each time because somebody
 * wrote the obvious thing:
 *
 *   `.eq('email', x)`     — case-sensitive against a column holding what the
 *                           customer typed (21 of 1217 rows carry capitals)
 *   `.ilike('email', x)`  — a LIKE PATTERN, so `_` and `%` are wildcards
 *   `upsert(…, {onConflict: 'email'})` — the same case-sensitivity, as a WRITE,
 *                           which is what duplicated eight real people
 *   `.eq('phone', x)`     — raw string equality on a column holding five
 *                           different formats of the same number
 *   `.or(\`phone.eq.${n}\`)` — a raw PostgREST expression built from a
 *                           provider's own payload
 *
 * Rule 8 applies to this file too: it was attacked by reintroducing every
 * defect it exists to catch — see `docs/contact-identity-review.md` §7.
 */

import fs from 'fs'
import path from 'path'

const SRC = path.join(process.cwd(), 'src')

/** The modules that ARE the contact-identity surface. */
const SURFACE = [
  'lib/contacts.ts',
  'lib/contactLookup.ts',
  'lib/contactSync.ts',
  'lib/sequences.ts',
  'lib/smsOptOut.ts',
  'lib/brevo.ts',
  'lib/quo.ts',
  'app/api/webhooks/quo/route.ts',
  'app/api/webhooks/twilio/route.ts',
  'app/api/webhooks/brevo/route.ts',
  'app/api/unsubscribe/route.ts',
  'app/api/admin/contacts/route.ts',
  'app/api/admin/contacts/[id]/route.ts',
  'app/api/admin/contacts/export/route.ts',
]

function read(rel: string): string {
  return fs.readFileSync(path.join(SRC, rel), 'utf8')
}

/**
 * Source with line and block comments removed, so PROSE cannot satisfy a rule.
 * Link 16's tripwire lost two rules to exactly that: the migration's own
 * explanatory comments quoted the clause being deleted, so a rule that grepped
 * the file stayed green over SQL that no longer existed.
 */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/([^:])\/\/.*$/gm, '$1')
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) out.push(full)
  }
  return out
}

const ALL_FILES = walk(SRC).filter(f => !f.includes('__tests__'))
function relative(f: string): string {
  return path.relative(SRC, f).split(path.sep).join('/')
}

/**
 * The body of a named function, matched by BRACE COUNTING rather than by
 * `[\s\S]*?\n\}` — which stops at the first line starting with `}` and in a
 * TypeScript signature that is the destructured parameter type, three lines in.
 * A rule reading that fragment is a rule that sees almost nothing.
 */
function functionBody(src: string, name: string): string {
  const start = src.search(new RegExp(`(export\\s+)?(async\\s+)?function\\s+${name}\\b`))
  if (start < 0) return ''
  const open = src.indexOf('{', src.indexOf(')', start))
  if (open < 0) return ''
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(open, i + 1)
    }
  }
  return ''
}

/** A `export type X = …` declaration, up to the next top-level statement. */
function typeDeclaration(src: string, name: string): string {
  const m = src.match(new RegExp(`export type ${name}\\s*=([\\s\\S]*?)(?=\\n(?:export|const|function|interface|/\\*\\*|async)|$)`))
  return m ? m[0] : ''
}

/** Columns that hold an email address somebody else chose the spelling of. */
const EMAIL_COLUMNS = ['email', 'contact_email', 'customer_email', 'from_address', 'to_address']
const PHONE_COLUMNS = ['phone', 'contact_phone', 'customer_phone']

describe('R1 — no file filters an email column except lib/contactLookup.ts', () => {
  /**
   * EXEMPTIONS, each scoped to one file with the measurement behind it:
   *
   *  - `lib/contactLookup.ts` is the implementation.
   *  - `app/api/portal/email-auth/*` filter `email_auth_codes.email`, a column
   *    WE write and always lowercase. Link 14 measured that and CLEARED it;
   *    `docs/portal-auth-review.md` §1. Do not "fix" these.
   *  - `app/api/admin/auth/*` filter `admin_users.email`, likewise ours.
   */
  const EXEMPT = new Set([
    'lib/contactLookup.ts',
    'app/api/portal/email-auth/request/route.ts',
    'app/api/portal/email-auth/verify/route.ts',
    'app/api/admin/auth/login/route.ts',
    'app/api/admin/auth/session/route.ts',
  ])

  it('no .eq() or .ilike() on an email column', () => {
    const offenders: string[] = []
    for (const file of ALL_FILES) {
      const rel = relative(file)
      if (EXEMPT.has(rel)) continue
      const src = code(rel)
      for (const col of EMAIL_COLUMNS) {
        // Both quote styles, both operators, and `?.` — link 15's tripwire hole
        // was a rule that matched `event.hash` but not `event?.hash`.
        const re = new RegExp(`\\.\\s*(eq|ilike)\\s*\\(\\s*['"\`]${col}['"\`]`, 'g')
        const hits = src.match(re)
        if (hits) offenders.push(`${rel}: ${hits.join(', ')}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('the rule can still SEE such a filter (it is not vacuous)', () => {
    // A negative case. A rule that silently matches nothing passes forever —
    // link 16 lost one to a character class that never matched.
    const sample = `supabase.from('contacts').select('id').eq('email', x)`
    const re = new RegExp(`\\.\\s*(eq|ilike)\\s*\\(\\s*['"\`]email['"\`]`)
    expect(re.test(sample)).toBe(true)
    expect(re.test(`supabase.from('contacts').select('id').eq?.('email', x)`)).toBe(false)
  })

  it('every exempt file still exists, so the exemption cannot outlive its file', () => {
    for (const rel of EXEMPT) {
      expect(fs.existsSync(path.join(SRC, rel))).toBe(true)
    }
  })
})

describe('R2 — no upsert keyed on an email address', () => {
  it('nothing anywhere passes onConflict: email', () => {
    const offenders: string[] = []
    for (const file of ALL_FILES) {
      const src = code(relative(file))
      if (/onConflict\s*:\s*['"`](email|contact_email)['"`]/.test(src)) offenders.push(relative(file))
    }
    // THE defect: `contacts_email_key` is unique on the RAW value, so this
    // conflict target is case-sensitive and `Foo@x.com` becomes a second row.
    expect(offenders).toEqual([])
  })

  it('lib/contacts.ts writes contacts by INSERT or by id, never by upsert', () => {
    const src = code('lib/contacts.ts')
    expect(src).not.toMatch(/from\(['"`]contacts['"`]\)\s*\.\s*upsert/)
    expect(src).toMatch(/from\(['"`]contacts['"`]\)\s*\.\s*insert/)
    expect(src).toMatch(/\.update\([^)]*\)\s*\.eq\(['"`]id['"`]/)
  })

  it('lib/contacts.ts never writes the `email` column on an UPDATE path', () => {
    // Rewriting the stored spelling risks a collision against
    // `contacts_email_key` — eight of the mixed-case rows WOULD collide.
    const src = code('lib/contacts.ts')
    const updateFields = src.match(/const fields:[\s\S]*?\n  \}/)?.[0] ?? ''
    expect(updateFields).not.toMatch(/(^|[\s,{])email\s*:/)
  })
})

describe('R2b — a lookup asks for the columns its own answer depends on', () => {
  it('both lookups append the columns they compare on', () => {
    // A shape rule beside the behaviour test, because the behaviour test could
    // only ever see this once the fake modelled PROJECTION — before that,
    // deleting the append changed nothing and the suite stayed green.
    const src = code('lib/contactLookup.ts')
    expect(src).toMatch(/withColumns\(columns,\s*\['email',\s*'created_at'\]\)/)
    expect(src).toMatch(/withColumns\(columns,\s*\['phone',\s*'created_at'\]\)/)
    expect(src).toMatch(/withColumns\(columns,\s*\['contact_email'\]\)/)
  })
})

describe('R3 — a phone number is normalised, never compared raw', () => {
  /** `lib/contactLookup.ts` implements it; `lib/twilio.ts` owns E.164 for SENDING. */
  const EXEMPT = new Set(['lib/contactLookup.ts'])

  it('no .eq() on a phone column outside the lookup', () => {
    const offenders: string[] = []
    for (const file of ALL_FILES) {
      const rel = relative(file)
      if (EXEMPT.has(rel)) continue
      const src = code(rel)
      for (const col of PHONE_COLUMNS) {
        const re = new RegExp(`\\.\\s*eq\\s*\\(\\s*['"\`]${col}['"\`]`, 'g')
        const hits = src.match(re)
        if (hits) offenders.push(`${rel}: ${hits.join(', ')}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('normalizePhoneKey exists and is the only definition of the comparable form', () => {
    expect(code('lib/contactLookup.ts')).toMatch(/export function normalizePhoneKey/)
    const others = ALL_FILES.filter(
      f => relative(f) !== 'lib/contactLookup.ts' && /function normalizePhoneKey/.test(code(relative(f)))
    )
    expect(others.map(relative)).toEqual([])
  })
})

describe('R4 — no RAW PostgREST .or() built from a template literal', () => {
  it('nothing on the surface interpolates into .or()', () => {
    const offenders: string[] = []
    for (const rel of SURFACE) {
      const src = code(rel)
      // A backtick string containing `${` passed to `.or(`.
      if (/\.or\(\s*`[^`]*\$\{/.test(src)) offenders.push(rel)
    }
    expect(offenders).toEqual([])
  })

  it('nowhere in src/ does .or() take a template literal with interpolation', () => {
    const offenders: string[] = []
    for (const file of ALL_FILES) {
      const src = code(relative(file))
      if (/\.or\(\s*`[^`]*\$\{/.test(src)) offenders.push(relative(file))
    }
    expect(offenders).toEqual([])
  })

  it('the admin search goes through contactSearchFilter', () => {
    expect(code('app/api/admin/contacts/route.ts')).toMatch(/\.or\(\s*contactSearchFilter\(/)
  })

  it('the rule can still SEE an interpolated .or() (not vacuous)', () => {
    expect(/\.or\(\s*`[^`]*\$\{/.test('q.or(`phone.eq.${n},phone.eq.+1${n}`)')).toBe(true)
    expect(/\.or\(\s*`[^`]*\$\{/.test('q.or(contactSearchFilter(term))')).toBe(false)
  })
})

describe('R5 — every write on the surface reads its result', () => {
  /**
   * A `.insert(`/`.update(`/`.delete(` whose statement does not destructure an
   * `error`. An error you do not read is an error that did not happen (rule 19).
   */
  it('no unchecked write', () => {
    const offenders: string[] = []
    for (const rel of SURFACE) {
      const src = code(rel)
      const lines = src.split(/\r?\n/)
      lines.forEach((line, i) => {
        if (!/\.\s*(insert|update|delete)\s*\(/.test(line)) return
        // A DATABASE write, not `crypto.createHmac(…).update(…)`. Narrowed —
        // with a negative case below, because link 16's first narrowing quietly
        // excused a real write and only its own negative case caught it.
        if (/createHmac|createHash|\.digest\(/.test(line)) return
        // Look back for the assignment and forward for the end of the statement.
        const window = lines.slice(Math.max(0, i - 4), i + 12).join('\n')
        const assigned = /const\s*\{[^}]*error[^}]*\}\s*=\s*await/.test(window)
        // A builder that is RETURNED or awaited into a named result is checked
        // by its caller; `recordSmsOptOut` and `updateContactById` both do that.
        const returned = /return\s+(await\s+)?supabase/.test(window)
        if (!assigned && !returned) offenders.push(`${rel}:${i + 1} ${line.trim().slice(0, 90)}`)
      })
    }
    expect(offenders).toEqual([])
  })

  it('the rule can still SEE an unchecked write, and is not fooled by an HMAC', () => {
    const unchecked = `await supabase.from('contacts').update({ email_opt_in: false }).eq('id', id)`
    expect(/\.\s*(insert|update|delete)\s*\(/.test(unchecked)).toBe(true)
    expect(/createHmac|createHash|\.digest\(/.test(unchecked)).toBe(false)
    expect(/const\s*\{[^}]*error[^}]*\}\s*=\s*await/.test(unchecked)).toBe(false)

    // …and the narrowing really is narrow: an HMAC line is excused, a DB write
    // that merely MENTIONS a hash nearby is not.
    const hmac = `const expected = crypto.createHmac('sha256', key).update(signed).digest('base64')`
    expect(/createHmac|createHash|\.digest\(/.test(hmac)).toBe(true)
    const dbWriteNamedHash = `await supabase.from('contacts').update({ portal_token_hash: h })`
    expect(/createHmac|createHash|\.digest\(/.test(dbWriteNamedHash)).toBe(false)
  })
})

describe('R6 — an UPDATE whose result decides an answer carries .select()', () => {
  it('the admin PATCH and the opt-out writers select their rows back', () => {
    // An UPDATE with no `.select()` cannot tell you it matched zero rows, which
    // is how `{ok: true}` got answered for a contact id that does not exist.
    expect(code('app/api/admin/contacts/[id]/route.ts')).toMatch(
      /\.update\([^)]*\)\s*\.eq\(['"`]id['"`][^)]*\)\s*\.select\(/
    )
    expect(code('lib/smsOptOut.ts')).toMatch(/\.update\(\{\s*sms_opt_in:\s*false\s*\}\)[\s\S]{0,120}\.select\(/)
    expect(code('lib/contacts.ts')).toMatch(/\.update\(fields\)\s*\.eq\(['"`]id['"`],\s*id\)\s*\.select\(/)
  })
})

describe('R7 — one definition of "may we market to this person"', () => {
  it('optedOutReason is defined exactly once', () => {
    const defs = ALL_FILES.filter(f => /export function optedOutReason/.test(code(relative(f))))
    expect(defs.map(relative)).toEqual(['lib/sequences/processor.ts'])
  })

  it('it reads BOTH email_opt_in and status', () => {
    const src = code('lib/sequences/processor.ts')
    const fn = functionBody(src, 'optedOutReason')
    expect(fn).not.toBe('')
    expect(fn).toContain('email_opt_in')
    expect(fn).toContain('unsubscribed')
  })

  it('the ad-platform export applies it, rather than reading email_opt_in alone', () => {
    const src = code('app/api/admin/contacts/export/route.ts')
    expect(src).toMatch(/optedOutReason\(/)
  })

  it('the outward mirror applies it too', () => {
    expect(code('lib/contacts.ts')).toMatch(/optedOutReason\(/)
  })
})

describe('R8 — the Brevo wrapper cannot go back to PUT', () => {
  it('no PUT to the contact endpoint', () => {
    // Measured: PUT is UPDATE-ONLY and 404s on an address Brevo does not hold,
    // which is why 253 of our people never reached the marketing list.
    // `cancelCampaign` legitimately PUTs to /emailCampaigns/{id}/status, so the
    // rule is scoped to the CONTACT endpoint rather than to the verb.
    const lines = code('lib/brevo.ts').split(/\r?\n/)
    const offenders = lines
      .map((l, i) => [l, i] as const)
      .filter(([l]) => /\/contacts\/\$\{encodeURIComponent/.test(l))
      .filter(([, i]) => /method:\s*['"`]PUT['"`]/.test(lines.slice(Math.max(0, i - 2), i + 4).join('\n')))
      .map(([l]) => l.trim())
    expect(offenders).toEqual([])
  })

  it('the contact upsert is POST /contacts with updateEnabled', () => {
    const fn = functionBody(code('lib/brevo.ts'), 'upsertBrevoContact')
    expect(fn).not.toBe('')
    expect(fn).toMatch(/\$\{BREVO_BASE\}\/contacts`/)
    expect(fn).toMatch(/method:\s*['"`]POST['"`]/)
    expect(fn).toMatch(/updateEnabled:\s*true/)
  })

  it('204 is treated as success, not as a failure', () => {
    const fn = functionBody(code('lib/brevo.ts'), 'upsertBrevoContact')
    expect(fn).toMatch(/status\s*!==\s*204/)
  })
})

describe('R9 — the Quo lookup uses the parameter Quo actually honours', () => {
  it('externalIds=, never externalIds[]=', () => {
    const src = code('lib/quo.ts')
    expect(src).toMatch(/externalIds=\$\{encodeURIComponent/)
    expect(src).not.toMatch(/externalIds\[\]/)
  })

  it('and the id is re-compared rather than trusted to the query', () => {
    const fn = functionBody(code('lib/quo.ts'), 'findQuoContactByExternalId')
    expect(fn).not.toBe('')
    expect(fn).toMatch(/\.find\(c => c\.externalId === externalId\)/)
  })

  it('a 409 is recovered, not reported as a permanent failure', () => {
    expect(code('lib/quo.ts')).toMatch(/res\.status === 409/)
  })
})

describe('R10 — three outcomes where a lookup can fail', () => {
  const THREE_OUTCOME = [
    ['lib/contactLookup.ts', 'ContactEmailLookup'],
    ['lib/contactLookup.ts', 'ContactPhoneLookup'],
    ['lib/contacts.ts', 'UpsertContactOutcome'],
    ['lib/sequences.ts', 'EnrollResult'],
    ['lib/smsOptOut.ts', 'SmsOptOutResult'],
    ['lib/contactSync.ts', 'ProviderOutcome'],
  ] as const

  it.each(THREE_OUTCOME)('%s exports %s with a distinct failure arm', (rel, type) => {
    const decl = typeDeclaration(code(rel), type)
    expect(decl).not.toBe('')
    expect(decl).toMatch(/unavailable|deferred|error/)
  })

  it('a failed contacts read never reaches the "create a new one" branch', () => {
    const src = code('lib/contacts.ts')
    for (const fn of ['upsertContactResult', 'upsertContactByPhone']) {
      const body = functionBody(src, fn)
      expect(body).not.toBe('')
      expect(body).toMatch(/kind === ['"`]unavailable['"`]/)
    }
  })
})

describe('R11 — nothing bulk-lowercases the stored addresses', () => {
  it('no write sets email to a lowercased value', () => {
    const offenders: string[] = []
    // Scoped to the files that WRITE the contacts table. Elsewhere,
    // `email: x.toLowerCase()` is a request being normalised on its way INTO
    // the shared lookup (`/api/signup` does exactly that) — correct, and not a
    // write to the column.
    for (const rel of SURFACE) {
      const src = code(rel)
      if (/(^|[\s,{])email\s*:\s*[^,\n]*\.toLowerCase\(\)/.test(src)) offenders.push(rel)
    }
    // Eight of the 21 mixed-case rows would collide against
    // `contacts_email_key`, and it does nothing about the 22nd address typed
    // tomorrow. The LOOKUP is the fix. needs-Adam 31.
    expect(offenders).toEqual([])
  })

  it('the rule can still SEE such a write (not vacuous)', () => {
    expect(/(^|[\s,{])email\s*:\s*[^,\n]*\.toLowerCase\(\)/.test(`{ email: input.toLowerCase() }`)).toBe(true)
    // …and a normalisation used only for COMPARISON is not a write.
    expect(
      /(^|[\s,{])email\s*:\s*[^,\n]*\.toLowerCase\(\)/.test(`const normalized = email.trim().toLowerCase()`)
    ).toBe(false)
  })
})

describe('R0 — the staleness walker', () => {
  it('every file that reads or writes the contacts table is in SURFACE or listed here', () => {
    /**
     * Files that legitimately touch `contacts` from outside this surface. Each
     * is a READER of an already-resolved contact id or a caller of the shared
     * lookup — none of them decides identity for itself.
     */
    const KNOWN_OUTSIDE = new Set([
      'lib/reminders.ts',
      'lib/checkinReminders.ts',
      'lib/agent/draftInquiry.ts',
      'lib/agent/events.ts',
      'lib/agent/threadTimeline.ts',
      'lib/agent/manualDraft.ts',
      'lib/contactInteractions.ts',
      'lib/experiments/assign.ts',
      'lib/experiments/analysis.ts',
      'lib/marketing/memory.ts',
      'lib/sequences/processor.ts',
      'app/api/cron/birthday-rebooking/route.ts',
      'app/api/cron/event-reminders/route.ts',
      'app/api/cron/gmail-sync/route.ts',
      'app/api/cron/process-sequences/route.ts',
      'app/api/cron/send-campaigns/route.ts',
      'app/api/cron/agent-dispatch/route.ts',
      'app/api/admin/photos/backfill-reminders/route.ts',
      'app/api/admin/campaigns/route.ts',
      'app/api/admin/dashboard/route.ts',
      'app/api/portal/resend-link/route.ts',
      'app/api/checkin/[token]/route.ts',
      'app/api/fundraiser-inquiry/route.ts',
      'app/api/cm-cheer-order/route.ts',
      'app/api/signup/route.ts',
      // Writes `is_business`/`business_name` to an id `upsertContact` returned.
      'app/api/trucker-inquiry/route.ts',
      // Reads `phone` for an SMS campaign by `sms_opt_in`, and dedupes on the
      // normalised number. It does NOT apply `optedOutReason` — handed to the
      // admin-surface review (link 18) rather than widened into this one.
      'app/api/admin/campaigns/[id]/route.ts',
      // Both read an already-resolved contact id.
      'lib/agent/sendApproved.ts',
      'lib/checkinLink.ts',
    ])

    const touching = ALL_FILES.filter(f => /from\(['"`]contacts['"`]\)/.test(code(relative(f)))).map(relative)
    const unlisted = touching.filter(rel => !SURFACE.includes(rel) && !KNOWN_OUTSIDE.has(rel))

    // A new file reading `contacts` must be classified deliberately — that is
    // how `.eq('email', …)` kept reappearing in a file nobody was watching.
    expect(unlisted).toEqual([])
  })

  it('every file named in SURFACE exists', () => {
    for (const rel of SURFACE) {
      expect(fs.existsSync(path.join(SRC, rel))).toBe(true)
    }
  })

  it('no branch on the surface is disabled with `if (false', () => {
    // Link 16's lesson: a behaviour test can pass for the wrong reason, so a
    // shape rule sits beside it.
    for (const rel of SURFACE) {
      expect(code(rel)).not.toMatch(/if\s*\(\s*false\s*&&/)
    }
  })
})
