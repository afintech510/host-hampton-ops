/**
 * The customer-portal tripwire.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS. Every defect `docs/portal-auth-review.md` records had been
 * live for months with a fully green suite, because **nothing failed when they
 * were written**. The three that mattered were all one line each:
 *
 *   * `.ilike('contact_email', cookieEmail)` as the authorization filter in
 *     `/api/portal/my-bookings` — a session for the single character `%`
 *     returned every kids party in the database;
 *   * `.eq('contact_email', lower(input))` in `/api/portal/resend-link` — the
 *     only login the site offers, blind to 9 of 61 bookings;
 *   * `select('*')` in `/api/portal/booking` — 62 columns to the customer,
 *     `admin_notes` among them, while the check-in route next door had a
 *     column allow-list and a comment explaining why.
 *
 * So this test reads the sources off disk, the way
 * `emailTemplateEscaping.test.ts` and `slugSafety.test.ts` do. It is a
 * DENY-list of shapes plus a positive convention check plus a staleness
 * walker, and every exemption carries its reason in code beside it.
 *
 * **It was attacked before it was trusted.** Each of the shapes below was
 * reintroduced by hand and the suite re-run; see §8 of the review for which
 * ones a first draft let through. A tripwire that has only ever passed is a
 * comment asserting its own correctness.
 */

import fs from 'fs'
import path from 'path'

const SRC = path.join(process.cwd(), 'src')

/** Every file that makes an authentication or authorization decision for a customer. */
const SURFACE = [
  'lib/portalAuth.ts',
  'lib/checkinAuth.ts',
  'lib/planAccess.ts',
  'lib/contactLookup.ts',
  'app/api/portal/auth/route.ts',
  'app/api/portal/booking/route.ts',
  'app/api/portal/clear/route.ts',
  'app/api/portal/email-auth/request/route.ts',
  'app/api/portal/email-auth/verify/route.ts',
  'app/api/portal/my-bookings/route.ts',
  'app/api/portal/notify-payment/route.ts',
  'app/api/portal/pay/route.ts',
  'app/api/portal/resend-link/route.ts',
  'app/api/portal/send-message/route.ts',
  'app/api/portal/session-status/route.ts',
  'app/api/plan/[ref]/email-me/route.ts',
  'app/api/plan/[ref]/pay-link/route.ts',
  'app/api/checkin/[token]/route.ts',
]

function read(rel: string): string {
  return fs.readFileSync(path.join(SRC, rel), 'utf8')
}

/** Strip `//` and block comments so a rule's own explanation cannot trip it. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map(l => l.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n')
}

describe('portal auth surface — the files exist and the list is not stale', () => {
  it('every listed file is on disk', () => {
    const missing = SURFACE.filter(f => !fs.existsSync(path.join(SRC, f)))
    expect(missing).toEqual([])
  })

  it('every route under app/api/portal is audited here', () => {
    const dir = path.join(SRC, 'app/api/portal')
    const found: string[] = []
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.name === 'route.ts') found.push(path.relative(SRC, p).split(path.sep).join('/'))
      }
    }
    walk(dir)
    // A new portal route must be added to SURFACE deliberately, which is the
    // moment somebody reads the rules below.
    expect(found.filter(f => !SURFACE.includes(f))).toEqual([])
  })
})

describe('a customer email address is never looked up by equality or by pattern', () => {
  /**
   * `contacts.email` and `bookings.contact_email` are plain `text` holding
   * whatever the customer typed. `.eq()` is case-sensitive (9 of 61 bookings
   * and 21 of 1217 contacts are not lowercase) and `.ilike()` is a LIKE PATTERN
   * (`%` and `_` are wildcards). Both must go through lib/contactLookup.ts,
   * which uses ilike for CANDIDATES and re-compares exactly in JS.
   */
  const EMAIL_COLUMNS = ['email', 'contact_email']

  it.each(SURFACE)('%s uses no .eq()/.ilike() on an email column', rel => {
    if (rel === 'lib/contactLookup.ts') return // the one implementation
    const body = code(read(rel))
    const offenders: string[] = []
    for (const col of EMAIL_COLUMNS) {
      for (const op of ['eq', 'ilike']) {
        const rx = new RegExp(`\\.${op}\\(\\s*['"\`]${col}['"\`]`, 'g')
        const hits = body.match(rx)
        if (hits) offenders.push(...hits)
      }
    }
    // EXEMPTION: `email_auth_codes.email` is written by us, always lowercased,
    // and is not a customer-typed value — it is our own index into a table we
    // populate. Link 13's handover listed these two `.eq('email', …)` sites as
    // suspected login failures; measuring them showed they are on a different
    // table with a different write path. The exemption is here rather than the
    // rule being weakened, so the distinction stays written down.
    const exempt = rel.startsWith('app/api/portal/email-auth/')
    expect(exempt ? [] : offenders).toEqual([])
  })

  it('the only .ilike on an email column in the whole app is in contactLookup', () => {
    const hits: string[] = []
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) {
          if (e.name === '__tests__' || e.name === 'node_modules') continue
          walk(p)
        } else if (/\.tsx?$/.test(e.name)) {
          const rel = path.relative(SRC, p).split(path.sep).join('/')
          if (rel === 'lib/contactLookup.ts') continue
          if (/\.ilike\(\s*['"`](email|contact_email)['"`]/.test(code(fs.readFileSync(p, 'utf8')))) {
            hits.push(rel)
          }
        }
      }
    }
    walk(SRC)
    expect(hits).toEqual([])
  })
})

describe('the customer is never handed the whole booking row', () => {
  it('no surface file selects * from bookings', () => {
    const offenders = SURFACE.filter(rel => {
      const body = code(read(rel))
      // `.from('bookings')` followed within a few lines by `.select('*')`.
      return /\.from\(\s*['"`]bookings['"`]\s*\)[\s\S]{0,200}?\.select\(\s*['"`]\*['"`]\s*\)/.test(body)
    })
    expect(offenders).toEqual([])
  })

  /**
   * The positive half. A lexer can tell you `select('*')` is absent; it cannot
   * tell you the allow-list is still an allow-list. These four columns are the
   * ones whose exposure was the finding, so they are named.
   */
  const MUST_NOT_REACH_A_CUSTOMER = [
    'admin_notes',
    'portal_token_hash',
    'quote_snapshot',
    'approved_by',
  ]

  it.each(['app/api/portal/booking/route.ts', 'app/api/portal/my-bookings/route.ts'])(
    '%s names no internal column anywhere in its code',
    rel => {
      // The first draft of this searched only the text inside `.select(…)`.
      // Both routes hold their column list in a CONSTANT — `PORTAL_BOOKING_COLUMNS`,
      // `LIST_COLUMNS` — so the names were never inside the parentheses and
      // adding `admin_notes` to the allow-list passed the check. Caught by
      // reintroducing the defect, which is the only way these get caught.
      // Comments are stripped by `code()`, so this file's own prose is safe.
      const body = code(read(rel))
      expect(MUST_NOT_REACH_A_CUSTOMER.filter(c => body.includes(c))).toEqual([])
    },
  )

  it('a customer is never shown a filtered subset of their own bookings', () => {
    // `/api/portal/my-bookings` carried `.in('event_type', ['kid-party',
    // 'kids-party', 'kids_party'])`. Measured: the third spelling has ZERO rows
    // and the list hid 15 live bookings — 9 room rentals, 4 mobile parties,
    // 8 kids parties spelled `Kids Birthday Party` / `kids-birthday-party`. A
    // customer signed in and was told they had no parties. Proved live: a real
    // session for an address with 8 bookings returned 0.
    //
    // A hand-written list of a free-text column's values is a list nobody is
    // checking against the column (rule 13). `cancelled` is the only filter a
    // customer's own list may apply.
    const offenders = SURFACE.filter(rel => /\.in\(\s*['"`]event_type['"`]/.test(code(read(rel))))
    expect(offenders).toEqual([])
  })

  it('the check-in route still keeps its own allow-list view', () => {
    // The precedent this file cites. If `publicBookingView` disappears, the
    // argument in ./booking's comment has lost its other half.
    expect(read('app/api/checkin/[token]/route.ts')).toContain('function publicBookingView')
  })
})

describe('a write whose error is discarded is a write that did not happen (rule 19)', () => {
  /**
   * Finds each `.insert(`/`.update(`/`.upsert(` on a supabase chain, walks BACK
   * to the line that opens the chain, and requires either an `error` in that
   * line's destructuring or a `.then(({ error })` on the chain.
   *
   * The first draft of this scanned a forward WINDOW from each line, which
   * matched the chain several lines early and so reported every correctly
   * handled write as an offender — a rule so noisy nobody would keep it. The
   * anchor has to be the write itself.
   */
  const writeSites = (body: string): number[] => {
    const lines = body.split('\n')
    const out: number[] = []
    lines.forEach((line, i) => {
      if (/\.(insert|update|upsert)\(/.test(line)) out.push(i)
    })
    return out
  }

  it.each(SURFACE)('%s reads the error on every write', rel => {
    const body = code(read(rel))
    const lines = body.split('\n')
    const offenders: string[] = []

    for (const i of writeSites(body)) {
      // Walk back at most 6 lines to the line that opens the chain.
      let head = -1
      for (let j = i; j >= Math.max(0, i - 6); j--) {
        if (/\bsupabase\b/.test(lines[j])) { head = j; break }
      }
      if (head === -1) continue // not a supabase write
      if (/error/.test(lines[head])) continue // destructured on the spot
      // `.then(({ error }) => …)` anywhere in the next few lines of the chain.
      if (/\.then\(\s*\(\s*\{\s*error/.test(lines.slice(i, i + 8).join('\n'))) continue
      offenders.push(`${rel}:${i + 1} ${lines[i].trim()}`)
    }
    expect(offenders).toEqual([])
  })

  it('the detector actually fires — a discarded error is caught', () => {
    // Rule 8 applies to a tripwire too. This is the shape the rule exists for,
    // checked against the rule rather than assumed to be checked by it.
    const sample = [
      'const supabase = getSupabase()',
      "await supabase.from('booking_modifications').insert({ a: 1 })",
    ].join('\n')
    const lines = sample.split('\n')
    const i = writeSites(sample)[0]
    let head = -1
    for (let j = i; j >= Math.max(0, i - 6); j--) if (/\bsupabase\b/.test(lines[j])) { head = j; break }
    expect(head).toBe(i)
    expect(/error/.test(lines[head])).toBe(false)
  })
})

describe('a lookup that can fail needs three outcomes (rule 12)', () => {
  /**
   * `.single()` reports a genuine miss as PGRST116 and everything else as a
   * real error, so the two are always distinguishable — which is exactly why
   * discarding the error and reading `!data` as "not found" is a bug and not a
   * shortcut. `.maybeSingle()` has the same property.
   *
   * The rule: a surface file may call `.single()`/`.maybeSingle()` only if it
   * also destructures an `error` on that statement.
   */
  it.each(SURFACE)('%s never drops the error from a single-row read', rel => {
    const body = code(read(rel))
    const lines = body.split('\n')
    const offenders: string[] = []
    lines.forEach((line, i) => {
      if (!/\.(single|maybeSingle)(<[^>]*>)?\(\)/.test(line)) return
      // Walk back to the line that opens the supabase chain, the same anchor
      // the write rule uses. Taking the last `const` in a window instead picks
      // up an unrelated local declared in between.
      let head = -1
      for (let j = i; j >= Math.max(0, i - 14); j--) {
        if (/\bsupabase\b\s*$|\bsupabase\s*\n?\s*\.from\(|await\s+supabase/.test(lines[j])) { head = j; break }
      }
      if (head === -1) return
      if (/error/.test(lines[head])) return
      offenders.push(`${rel}:${i + 1} ${line.trim()}`)
    })
    // EXEMPTION: none today. If one is ever needed it belongs here with the
    // sentence explaining why that particular read cannot fail informatively.
    expect(offenders).toEqual([])
  })
})

describe('session cookies carry their own expiry', () => {
  const src = code(read('lib/portalAuth.ts'))

  it('both portal cookies sign an issuedAt, not just the subject', () => {
    // The defect: `HMAC("cookie:" + ref)` is a CONSTANT, so `Max-Age` was a
    // hint to the browser and the value authenticated forever, unrevocably.
    expect(src).toMatch(/signPortalSession\([^)]*issuedAtMs/)
    expect(src).toMatch(/signEmailSession\([^)]*issuedAtMs/)
    expect(src).toContain('`cookie:${bookingRef}:${issuedAtMs}`')
    expect(src).toContain('`emailcookie:${email}:${issuedAtMs}`')
  })

  it('every Set-Cookie the portal builds is HttpOnly, SameSite and Path-scoped', () => {
    // Matched on `Path=/`, which every cookie header here carries, rather than
    // on the cookie NAME — the names arrive through `${COOKIE_NAME}`, so a
    // name-anchored match saw only the two `clear…` helpers that spell them out.
    // That is exactly the shape of hole link 13's tripwire had.
    const setters = (src.match(/`[^`]*Path=\/[^`]*`/g) ?? [])
    expect(setters.length).toBeGreaterThanOrEqual(4)
    for (const h of setters) {
      expect(h).toContain('HttpOnly')
      expect(h).toContain('SameSite=Lax')
    }
  })

  it('a cleared cookie is always Secure — there is no dev case for clearing', () => {
    for (const h of src.match(/`[^`]*Max-Age=0[^`]*`/g) ?? []) {
      expect(h).toContain('Secure')
    }
  })

  it('the Secure flag is only ever dropped for a locally-hosted request', () => {
    // Link 13's bug: `isLocalRequest` used to read the forwarded-host allowlist,
    // so a caller could ask for a cookie without `Secure`. The flag must still
    // be conditional (dev needs it off) and the condition must still be that
    // one function.
    expect(src.match(/const secureFlag = isInsecure \? '' : '; Secure'/g)?.length).toBe(2)
    for (const rel of SURFACE) {
      if (!rel.startsWith('app/')) continue
      const body = code(read(rel))
      if (!/setPortalCookieHeader\(|setEmailCookieHeader\(/.test(body)) continue
      // A route that mints a session cookie must decide `isInsecure` from
      // `isLocalRequest(req)` and from nothing else.
      expect(body).toMatch(/isLocalRequest\(req\)/)
    }
  })
})

describe('the payment number is the payment number', () => {
  it('no portal or plan route spells a phone number as a literal', () => {
    // 631-998-9325 is the public line; looking it up in Venmo finds nothing.
    // The Venmo/Zelle number lives in lib/paymentContacts.ts.
    //
    // The first draft of this rule read *"contains 998-9325 AND does not
    // mention PUBLIC_PHONE_DISPLAY"*. `/api/portal/pay` legitimately mentions
    // `PUBLIC_PHONE_DISPLAY` in its cash branch, so the exemption excused the
    // whole FILE — and putting the public line back as the Venmo destination
    // passed. That is the exact shape of hole link 13 found in its own
    // tripwire, and it was found the same way: by reintroducing the defect.
    //
    // So the rule is now per-line and takes no exemption: a ten-digit phone
    // number has no business being a literal in this surface at all.
    const PHONE = /\b\d{3}[-.)\s]?\s?\d{3}[-.\s]?\d{4}\b/
    const offenders: string[] = []
    for (const rel of SURFACE) {
      code(read(rel)).split('\n').forEach((line, i) => {
        if (PHONE.test(line)) offenders.push(`${rel}:${i + 1} ${line.trim()}`)
      })
    }
    expect(offenders).toEqual([])
  })

  it('lib/emailTemplates.ts takes the payment number from the shared module', () => {
    const body = code(read('lib/emailTemplates.ts'))
    expect(body).toContain("from '@/lib/paymentContacts'")
    expect(body).not.toMatch(/599[-.\s]?2469/)
  })
})

describe('the magic-link failure paths do not name which booking refs exist', () => {
  const src = code(read('app/api/portal/auth/route.ts'))

  it('there is no distinct not_found outcome', () => {
    // `error=not_found` vs `error=expired` was an unauthenticated oracle over a
    // structured ref space. Measured live before the fix.
    expect(src).not.toContain("'not_found'")
    expect(src).not.toContain('not_found')
  })

  it('a failed read is its own outcome, distinct from a bad link', () => {
    expect(src).toContain("loginRedirect('unavailable')")
  })

  it('the login page has copy for every code the route can emit', () => {
    const page = read('app/my-booking/login/page.tsx')
    for (const m of src.matchAll(/loginRedirect\(\s*'([a-z_]+)'\s*\)/g)) {
      expect(page).toContain(`${m[1]}:`)
    }
  })

  it('a successful authentication records that the link was used', () => {
    // `portal_tokens.used_at` held 0 values across 230 rows before this.
    expect(src).toMatch(/\.update\(\s*\{\s*used_at:/)
  })
})

describe('the attempt counter on the login code is claimed, not counted', () => {
  const src = code(read('app/api/portal/email-auth/verify/route.ts'))

  it('the increment is conditional on the value it read', () => {
    // Measured: 12 concurrent wrong codes recorded 3 attempts before this.
    expect(src).toMatch(/\.update\(\s*\{\s*attempts:[\s\S]*?\.eq\('attempts',\s*row\.attempts\)/)
    expect(src).toMatch(/\.lt\('attempts',\s*maxAttempts\)/)
  })

  it('the claim is taken BEFORE the code is compared', () => {
    const claimAt = src.indexOf(".eq('attempts', row.attempts)")
    const compareAt = src.indexOf('verifyEmailLoginCode(')
    expect(claimAt).toBeGreaterThan(-1)
    expect(compareAt).toBeGreaterThan(claimAt)
  })
})
