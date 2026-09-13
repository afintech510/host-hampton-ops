/**
 * The public intake surface, read off disk.
 *
 * These routes are the only unauthenticated write surface this business has, and
 * every other subsystem — the sequencer, the Stripe webhook, the customer portal,
 * the admin panel, the reminder crons, the booking agent — acts on rows they
 * create from input a stranger typed into a web form. What was live before this
 * file existed:
 *
 *   - `lineItems[].unit_price_cents` arrived in the request body and became
 *     `bookings.total_cents`, `deposit_amount` and every downstream invoice and
 *     Stripe charge. A NEGATIVE add-on on `/api/studio-rental/edit` made the
 *     balance clamp to zero and the route wrote `status = 'paid_in_full'`.
 *   - `/api/party-builder/save`'s "never fold into a plan money has landed on"
 *     guard was on ONE of its three paths, and that path replaces the line items.
 *   - Four public routes computed a balance themselves, with `(total || 0)` and
 *     both reads discarded, and two of them wrote `paid_in_full` from it.
 *   - `/api/cm-cheer-orders` compared a Bearer token against
 *     `process.env.CM_CHEER_PASSWORD || 'cmcheer2026'` — and the variable was not
 *     set, so the literal in this repository was the live credential over 21 real
 *     customers' names, emails and phone numbers.
 *   - `/api/gift-cards/redeem` was public, called by nothing, and spent a
 *     customer's gift card by code with an amount the caller chose.
 *   - `/api/boggle-ocr` was public and billed `ANTHROPIC_API_KEY` per call.
 *   - `quantity` on both ticket routes was never checked; a negative value passed
 *     the stock check and inverted `decrement_event_tickets` into an increase.
 *   - Nothing anywhere bounded how many times a stranger could do any of it.
 *   - Every intake route ended `{ success: true }` regardless of whether the
 *     contact, the plan, the event, the interaction or the owner email landed.
 *
 * Shape follows `cronSurface` / `adminSurface` / `contactIdentitySurface`:
 * comments are STRIPPED before any rule runs (link 16 lost two rules to a file's
 * own prose), function bodies are brace-matched from the end of the PARAMETER
 * LIST (link 19's tripwire found a two-character body otherwise), and every
 * anchor tolerates CRLF — this repository is `core.autocrlf=true` and a fresh
 * worktree gets CRLF while the main checkout may hold LF, which is exactly how
 * link 19's own `summer-hair-reminders` rule silently stopped checking.
 */

import fs from 'fs'
import path from 'path'

const API_ROOT = path.join(process.cwd(), 'src', 'app', 'api')
const LIB_ROOT = path.join(process.cwd(), 'src', 'lib')

/** Blank out comments while preserving offsets and line structure. */
function decomment(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n\r]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n\r]*/g, (m, p) => p + ' '.repeat(m.length - p.length))
}

function walkRoutes(dir: string): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walkRoutes(p))
    else if (e.name === 'route.ts') out.push(p)
  }
  return out.sort()
}

function walkTs(dir: string): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walkTs(p))
    else if (/\.tsx?$/.test(e.name)) out.push(p)
  }
  return out.sort()
}

const rel = (abs: string) => path.relative(API_ROOT, abs).split(path.sep).join('/')

/**
 * The surfaces other links own. Excluded here so this file cannot quietly become
 * a second opinion about them — but note the exclusions are by DIRECTORY, and the
 * walker below fails if a route file yields no recognised handler, so a new
 * directory cannot hide in the gap.
 */
const OWNED_ELSEWHERE = /^(admin\/|cron\/|webhook$|webhooks\/|slack\/)/

const ALL_ROUTE_FILES = walkRoutes(API_ROOT).map(rel)
const SURFACE_FILES = ALL_ROUTE_FILES.filter(f => !OWNED_ELSEWHERE.test(f.replace(/\/route\.ts$/, '')))

/**
 * `/api/portal/*` is CLASSIFIED here but not governed by the behavioural rules.
 *
 * Link 14 audited what those routes AUTHENTICATE; nobody has yet audited what
 * they WRITE, and it is the next link's scope. They are deliberately inside R0's
 * walker — so a new portal route still has to be accounted for, and the count
 * below fails if the surface changes size — and deliberately outside R1/R3/R5, so
 * this file does not claim to have checked something it has not. The alternative
 * is an exclusion nobody can see, which is how a rule ends up matching nothing
 * and passing.
 */
const DEFERRED_TO_NEXT_LINK = (route: string) => route.startsWith('portal/')

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

interface Handler {
  /** Route path, e.g. `party-builder/save`. */
  route: string
  method: string
  /** Comment-stripped source of this handler, to the next handler or EOF. */
  body: string
  /** Comment-stripped source of the whole file, for import checks. */
  file: string
}

function handlersOf(routeFile: string): Handler[] {
  const src = decomment(fs.readFileSync(path.join(API_ROOT, routeFile), 'utf8'))
  const route = routeFile.replace(/\/route\.ts$/, '')
  const marks: { method: string; idx: number }[] = []
  for (const m of HTTP_METHODS) {
    const re = new RegExp(`export\\s+(?:async\\s+)?function\\s+${m}\\s*\\(|export\\s+const\\s+${m}\\s*[:=]`, 'g')
    let mt: RegExpExecArray | null
    while ((mt = re.exec(src))) marks.push({ method: m, idx: mt.index })
  }
  marks.sort((a, b) => a.idx - b.idx)
  return marks.map((mk, i) => ({
    route,
    method: mk.method,
    body: src.slice(mk.idx, i + 1 < marks.length ? marks[i + 1].idx : src.length),
    file: src,
  }))
}

const HANDLERS: Handler[] = SURFACE_FILES.flatMap(handlersOf)
const id = (h: Handler) => `${h.method} ${h.route}`

/* ── Classification ───────────────────────────────────────────────────────── */

type Gate = 'admin' | 'cm-cheer' | 'portal-required' | 'provider-signature' | 'public'

/**
 * How this handler decides whether the caller may proceed.
 *
 * `portal-required` means it REFUSES without a session, which is a credential.
 * Reading a cookie is not the same thing: `/api/party-builder/save` reads the
 * portal cookie to decide WHICH plan a save belongs to and proceeds happily
 * without one, so it is `public` — and mis-classifying it as gated is exactly how
 * an audit talks itself out of looking at the route that needed it most.
 */
function gateOf(h: Handler): Gate {
  if (/isAdminAuthorized\s*\(/.test(h.body)) return 'admin'
  if (/isCmCheerAuthorized\s*\(/.test(h.body)) return 'cm-cheer'
  if (/handleSignwellWebhook\s*\(/.test(h.body)) return 'provider-signature'
  // A gate refuses. Look for a session read whose falsiness returns 401.
  if (/const\s+\w+\s*=\s*get(?:PortalBookingRef|EmailFromCookie)\s*\([\s\S]{0,200}?if\s*\(\s*!\s*\w+\s*\)\s*(?:\{[\s\S]{0,120}?)?return[\s\S]{0,160}?401/.test(h.body)) {
    return 'portal-required'
  }
  return 'public'
}

/**
 * Every handler on this surface that is deliberately reachable with no
 * credential at all, as of 2026-09-13. A new one fails R0 until somebody adds it
 * here, which is the point: link 16's R6b matched nothing and therefore passed,
 * and a handler a walker cannot see is a handler every rule below silently skips.
 */
const DELIBERATELY_PUBLIC = new Set([
  'GET availability',
  'GET booking-types',
  'POST canvas-bag-inquiry',
  'POST cart-checkout',
  'GET checkin/[token]',
  'POST checkin/[token]',
  'POST checkin/[token]/agreement',
  'POST checkout',
  'POST cm-cheer-order',
  'POST contact',
  'GET events',
  'GET events/[slug]',
  'POST events/checkout',
  'POST fundraiser-inquiry',
  'POST gift-cards/checkout',
  'POST gift-cards/validate',
  'POST lead',
  'POST mobile-party-inquiry',
  'POST party-builder/confirm-session',
  'POST party-builder/mileage',
  'POST party-builder/save',
  'POST party-checkout',
  'GET pricing',
  'POST quote/save',
  'POST signup',
  'POST studio-rental/checkout',
  'POST studio-rental/confirm-session',
  'GET summer-hair/book',
  'POST summer-hair/book',
  'GET themes',
  'POST trucker-inquiry',
  'POST unsubscribe',
  'POST vendor-registration',
  // Portal auth's own front door: it must be reachable without a session,
  // because handing one out is what it does. Audited by link 14.
  'GET portal/auth',
  'POST portal/clear',
  'POST portal/email-auth/request',
  'POST portal/email-auth/verify',
  'DELETE portal/my-bookings',
  'POST portal/resend-link',
])

/** Handlers that write to the database or spend money at a third party. */
const WRITE_RE = /\.(insert|update|upsert|delete)\s*\(|\.rpc\s*\(|stripe\.[a-zA-Z.]*\.create\s*\(|emails\.send\s*\(|upsertContact\s*\(|ensureLeadPlan\s*\(|writeLineItems/
const isWriter = (h: Handler) => WRITE_RE.test(h.body)

/* ── R0: the walker ───────────────────────────────────────────────────────── */

describe('R0: every route on this surface is seen and classified', () => {
  it('finds the whole API tree, not a remembered list of it', () => {
    // The brief for this session named about ten routes. The directory holds 130,
    // and 52 of them are outside admin/cron/webhooks/slack. Link 19's brief named
    // nine cron jobs against fourteen on disk, and the five nobody had listed
    // included the dangerous one. Walk the directory.
    expect(ALL_ROUTE_FILES.length).toBeGreaterThanOrEqual(130)
    expect(SURFACE_FILES.length).toBeGreaterThanOrEqual(50)
  })

  it('every route file yields at least one recognised handler', () => {
    const silent = SURFACE_FILES.filter(f => handlersOf(f).length === 0)
    expect(silent).toEqual([])
  })

  it('every handler is either gated or listed as deliberately public', () => {
    const unaccounted = HANDLERS.filter(h => gateOf(h) === 'public' && !DELIBERATELY_PUBLIC.has(id(h)))
    expect(unaccounted.map(id)).toEqual([])
  })

  it('nothing in the public list has quietly grown a gate it does not have', () => {
    // The negative direction. If a route is listed as public but actually refuses
    // unauthenticated callers, the list is stale and every rule below is checking
    // a route nobody can reach — a rule passing for the wrong reason.
    const stale = Array.from(DELIBERATELY_PUBLIC).filter(entry => {
      const h = HANDLERS.find(x => id(x) === entry)
      return h && gateOf(h) !== 'public'
    })
    expect(stale).toEqual([])
  })

  it('the public list has no entries for handlers that no longer exist', () => {
    const ghosts = Array.from(DELIBERATELY_PUBLIC).filter(entry => !HANDLERS.some(h => id(h) === entry))
    expect(ghosts).toEqual([])
  })

  it('the two routes that spend money or model tokens on demand are ADMIN-gated', () => {
    // `/api/gift-cards/redeem` deducts from a customer's gift card and is called
    // by nothing in this codebase; `/api/boggle-ocr` bills ANTHROPIC_API_KEY per
    // call and `/boggle` is linked from nowhere. Both were public.
    for (const route of ['gift-cards/redeem', 'boggle-ocr']) {
      const h = HANDLERS.find(x => x.route === route && x.method === 'POST')
      expect(h).toBeDefined()
      expect(gateOf(h!)).toBe('admin')
    }
  })
})

/* ── R1: a bound on how many times ────────────────────────────────────────── */

describe('R1: every public write is rate-limited', () => {
  /**
   * `/api/unsubscribe` is the one deliberate exemption and it is asserted rather
   * than assumed. A false 429 on a one-click opt-out is far worse than the abuse
   * it would prevent: that endpoint already answered 200 over a write that never
   * happened for 21 real people, and an email client's link prefetcher hitting a
   * throttle would recreate the same damage by a different route.
   */
  const RATE_EXEMPT = new Set(['POST unsubscribe'])

  it('is guarded, or exempt on the record', () => {
    const offenders = HANDLERS.filter(h => {
      if (DEFERRED_TO_NEXT_LINK(h.route)) return false
      if (gateOf(h) !== 'public' && gateOf(h) !== 'portal-required') return false
      if (!isWriter(h)) return false
      if (RATE_EXEMPT.has(id(h))) return false
      return !/guardRate\s*\(/.test(h.body)
    })
    expect(offenders.map(id)).toEqual([])
  })

  it('the exemption still names a handler that exists and still writes', () => {
    for (const entry of RATE_EXEMPT) {
      const h = HANDLERS.find(x => id(x) === entry)
      expect(h).toBeDefined()
      expect(isWriter(h!)).toBe(true)
    }
  })

  it('the guard runs BEFORE the handler does any work', () => {
    // A limiter called after the write has already happened is decoration. The
    // guard must appear before the first `await` in the body.
    const late: string[] = []
    for (const h of HANDLERS) {
      const guardAt = h.body.search(/guardRate\s*\(/)
      if (guardAt < 0) continue
      const firstAwait = h.body.search(/\bawait\b/)
      if (firstAwait > -1 && firstAwait < guardAt) late.push(id(h))
    }
    expect(late).toEqual([])
  })

  it('the limiter is defined exactly once', () => {
    const offenders = walkTs(path.join(process.cwd(), 'src'))
      .filter(f => !f.includes('__tests__'))
      .filter(f => path.basename(f) !== 'rateLimit.ts')
      .filter(f => /function\s+checkRateLimit|function\s+callerKey/.test(decomment(fs.readFileSync(f, 'utf8'))))
    expect(offenders).toEqual([])
  })
})

/* ── R2: the money is not the caller's to choose ──────────────────────────── */

describe('R2: client line items are screened before they become money', () => {
  /** The functions that turn line items into a figure somebody is charged. */
  const MONEY_FROM_ITEMS = /buildPlanSnapshot\s*\(|calculateLineItemTotal\s*\(|writeLineItems(?:Result)?\s*\(/

  it('no public handler feeds unscreened items into the arithmetic', () => {
    const offenders = HANDLERS.filter(h => {
      if (gateOf(h) === 'admin') return false // an admin may price a custom quote
      if (!MONEY_FROM_ITEMS.test(h.body)) return false
      return !/screenPublicLineItems\s*\(/.test(h.body)
    })
    expect(offenders.map(id)).toEqual([])
  })

  it('the screen runs BEFORE the arithmetic, in every one of them', () => {
    // Ordering, not presence. Link 16 named the family: a rule satisfied by an
    // occurrence other than the one that broke. Calling the screen after
    // `buildPlanSnapshot` has already computed `total_cents` screens nothing.
    const wrongOrder: string[] = []
    for (const h of HANDLERS) {
      if (!MONEY_FROM_ITEMS.test(h.body)) continue
      const screenAt = h.body.search(/screenPublicLineItems\s*\(/)
      if (screenAt < 0) continue
      const moneyAt = h.body.search(MONEY_FROM_ITEMS)
      expect(moneyAt).toBeGreaterThan(-1)
      if (moneyAt < screenAt) wrongOrder.push(id(h))
    }
    expect(wrongOrder).toEqual([])
  })

  it('the screened result is what gets used, not the raw body', () => {
    /**
     * A handler can call the screen, ignore its output and pass `body.lineItems`
     * on regardless. The first version of this rule asked whether
     * `screened.lineItems` OR `screened.ok` appeared ANYWHERE in the body — and
     * `screened.ok` appears in the refusal check, so replacing
     * `const addOns = screened.lineItems` with `const addOns = body.lineItems`
     * kept the rule green. My own attack harness walked straight through it:
     * link 16's family, in the file whose job is to stop exactly that.
     *
     * So the raw field is counted instead. It may be referenced ONCE — as the
     * screen's own argument — and nowhere else.
     */
    const offenders: string[] = []
    for (const h of HANDLERS) {
      const screenAt = h.body.search(/screenPublicLineItems\s*\(/)
      if (screenAt < 0) continue
      if (!/screened\.lineItems/.test(h.body)) {
        offenders.push(`${id(h)}: never uses screened.lineItems`)
        continue
      }
      // Every mention of the unscreened field, wherever it is spelled from.
      const rawMentions = [...h.body.matchAll(/\bbody\.lineItems\b|\baddOns\s*=\s*body\b/g)].map(m => m.index ?? 0)
      const afterScreen = rawMentions.filter(i => i > screenAt + 40)
      if (afterScreen.length) offenders.push(`${id(h)}: uses the raw body after screening`)
    }
    expect(offenders).toEqual([])
  })

  it('a refusal is acted on, not logged', () => {
    const offenders: string[] = []
    for (const h of HANDLERS) {
      if (!/screenPublicLineItems\s*\(/.test(h.body)) continue
      // `if (!screened.ok) { … return … }`
      if (!/if\s*\(\s*!\s*screened\.ok\s*\)[\s\S]{0,400}?return/.test(h.body)) offenders.push(id(h))
    }
    expect(offenders).toEqual([])
  })

  it('the screen is defined exactly once', () => {
    const offenders = walkTs(path.join(process.cwd(), 'src'))
      .filter(f => !f.includes('__tests__'))
      .filter(f => path.basename(f) !== 'publicIntake.ts')
      .filter(f => /function\s+screenPublicLineItems/.test(decomment(fs.readFileSync(f, 'utf8'))))
    expect(offenders).toEqual([])
  })
})

/* ── R3: one definition of what a booking owes ────────────────────────────── */

describe('R3: no public handler computes a balance itself', () => {
  it('nothing on this surface carries its own paid-loop', () => {
    // "What has this booking been paid, and what does it still owe" had SEVEN
    // answers. Four of them were in public routes, and two of those wrote
    // `paid_in_full` from a read whose error they discarded.
    const offenders = HANDLERS.filter(h => /payment_type\s*===\s*'refund'/.test(h.body))
    expect(offenders.map(id)).toEqual([])
  })

  it("nothing on this surface reads a total as `total_cents || 0`", () => {
    /**
     * `(null || 0) - paid` clamps to zero, which marks every UNPRICED lead paid in
     * full on its first deposit. `computeBalance` refuses to.
     *
     * The adjacency is deliberately loose. The first version required
     * `total_cents || 0` with nothing between them, and the harness got through
     * with `((inputs.row.total_cents as number) || 0)` — a cast is enough to break
     * a tight anchor, and a rule that a cast defeats is not a rule.
     */
    const offenders = HANDLERS.filter(h => /total_cents\b[^\n]{0,40}?\|\|\s*0/.test(h.body))
    expect(offenders.map(id)).toEqual([])
  })

  it('every handler that writes paid_in_full derives it from computeBalance', () => {
    const offenders = HANDLERS.filter(h => {
      // A WRITE of the settled state, not a column a route reads and hands back:
      // `/api/portal/my-bookings` selects `paid_in_full_at` and returns it, which
      // the first version of this rule flagged. Matching a mention rather than an
      // assignment is the family link 16 named.
      if (!/status:\s*'paid_in_full'|paid_in_full_at:\s*(?:new Date|null)/.test(h.body)) return false
      return !/computeBalance\s*\(/.test(h.body) || !/paidInFull/.test(h.body)
    })
    expect(offenders.map(id)).toEqual([])
  })

  it('the GUARD in front of that write tests paidInFull, not a zero balance', () => {
    /**
     * The rule above asks whether `computeBalance` and `paidInFull` appear in the
     * body — and they do, in the destructure, whatever the guard beside them says.
     * My harness changed `if (paidInFull) {` to `if (newBalance === 0) {` and it
     * stayed green: link 16's family for the second time in this file.
     *
     * So the guard's own condition is sliced, from its `if` to its `{`, and the
     * ordering is asserted against the write. `newBalance === 0` is true for an
     * unpriced booking (`max(0, null - anything)` clamps), which is the whole
     * reason `paidInFull` exists as a separate answer.
     */
    /**
     * BOTH spellings of the write.
     *
     * The first version matched only `status: 'paid_in_full'` — an object-literal
     * property — and `party-builder/confirm-session` writes
     * `updateFields.status = 'paid_in_full'`, an ASSIGNMENT. So the rule skipped the
     * one handler the harness mutated and passed by not looking. That is rule 8's
     * shape inside a rule: vacuously green. The count below is the guard against it
     * happening again.
     */
    const WRITE_RE = /status:\s*'paid_in_full'|status\s*=\s*'paid_in_full'|\?\s*'paid_in_full'/
    let examined = 0
    for (const h of HANDLERS) {
      if (!WRITE_RE.test(h.body)) continue
      examined++
      const writeAt = h.body.search(WRITE_RE)

      // Two legitimate shapes. `studio-rental/confirm-session` writes
      // `status: paidInFull ? 'paid_in_full' : 'pending_review'` — the ternary IS
      // the guard, and there is no `if` in front of it to inspect.
      const atSite = h.body.slice(Math.max(0, writeAt - 40), writeAt + 40)
      if (/paidInFull\s*\?/.test(atSite)) {
        expect(atSite).not.toMatch(/===\s*0|<=\s*0/)
        continue
      }

      // Otherwise the nearest preceding `if (…)` is the guard.
      const guards = [...h.body.slice(0, writeAt).matchAll(/if\s*\(([^)]*)\)\s*\{?/g)]
      expect(guards.length).toBeGreaterThan(0)
      const nearest = guards[guards.length - 1][1]
      expect(nearest).toMatch(/paidInFull/)
      expect(nearest).not.toMatch(/===\s*0|<=\s*0/)
    }
    // Three handlers on this surface advance a booking to settled. If this ever
    // drops, the rule has stopped finding them rather than the writes going away.
    expect(examined).toBeGreaterThanOrEqual(3)
  })

  it('the balance is defined exactly once', () => {
    const offenders = walkTs(path.join(process.cwd(), 'src'))
      .filter(f => !f.includes('__tests__'))
      .filter(f => path.basename(f) !== 'bookingBalance.ts')
      .filter(f => /function\s+computeBalance|function\s+readBalanceInputs/.test(decomment(fs.readFileSync(f, 'utf8'))))
    expect(offenders).toEqual([])
  })
})

/* ── R4: money that has landed is not a stranger's to rewrite ─────────────── */

describe('R4: a public save cannot rewrite a booking money has landed on', () => {
  const save = () => HANDLERS.find(h => h.route === 'party-builder/save' && h.method === 'POST')!

  it('the payment check has three outcomes and is applied to whichever ref wins', () => {
    const body = save().body
    // Sliced to the helper's own declaration, so a different occurrence of
    // `booking_payments` elsewhere in the handler cannot satisfy this.
    const at = body.indexOf('const moneyHasLanded')
    expect(at).toBeGreaterThan(-1)
    const helper = body.slice(at, body.indexOf('\n    }', at))

    /**
     * Sliced past the SIGNATURE.
     *
     * `expect(helper).toMatch(/'unknown'/)` was green after the harness changed
     * `return 'unknown'` to `return 'no'`, because `'unknown'` still appears in the
     * return type `Promise<'yes' | 'no' | 'unknown'>`. A type annotation is not an
     * outcome. The body after the arrow is what gets sliced now, and the third
     * outcome has to be RETURNED from the error branch.
     */
    const bodyAt = helper.indexOf('=> {')
    expect(bodyAt).toBeGreaterThan(-1)
    const impl = helper.slice(bodyAt)
    expect(impl).toMatch(/if\s*\(\s*error\s*\)/)
    const errAt = impl.search(/if\s*\(\s*error\s*\)/)
    // The error branch itself must hand back the third outcome.
    expect(impl.slice(errAt, errAt + 300)).toMatch(/return\s+'unknown'/)

    // And it is consulted on the existing-plan path, not only in the scan.
    const updatePathAt = body.indexOf('const landed = await moneyHasLanded')
    expect(updatePathAt).toBeGreaterThan(-1)
    // Before the line items are replaced.
    const replaceAt = body.indexOf('writeLineItemsResult')
    expect(replaceAt).toBeGreaterThan(updatePathAt)
  })

  it('a REDUCTION of a paid plan is refused, and "could not tell" refuses too', () => {
    const body = save().body
    expect(body).toMatch(/landed\s*===\s*'unknown'/)
    expect(body).toMatch(/totalCents\s*<\s*priorTotal/)
    expect(body).toMatch(/status:\s*409|\{\s*status:\s*409\s*\}/)
  })
})

/* ── R5: an error you do not read did not happen ──────────────────────────── */

describe('R5: every write on this surface reads its result', () => {
  /**
   * A DB write whose result is neither destructured nor `.then`-inspected.
   *
   * Matched on the statement, not the file: `await supabase.from(x).insert(y)`
   * with nothing on the left-hand side. Writes that go through a helper which
   * reads the error for us (`logInteraction`, `writeLineItems*`, `upsertContact`,
   * `mintPortalLink`, `recordAdminPayment`) are not raw writes at all.
   */
  it('no bare `await …insert/update/upsert/delete(...)` statement', () => {
    const offenders: string[] = []
    for (const h of HANDLERS) {
      if (DEFERRED_TO_NEXT_LINK(h.route)) continue
      const re = /(^|[\n;{}])\s*await\s+[\w.]*supabase[\s\S]{0,400}?\.(insert|update|upsert|delete)\s*\(/g
      let m: RegExpExecArray | null
      while ((m = re.exec(h.body))) {
        // A `const { … } = await` would have matched `=` before `await`.
        offenders.push(`${id(h)} @${m.index}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('a write whose result decides an ANSWER carries .select()', () => {
    // An UPDATE with no `.select()` cannot tell you it matched zero rows, and
    // these handlers quote the figures they wrote back to a customer.
    for (const route of ['party-builder/save', 'studio-rental/edit']) {
      const h = HANDLERS.find(x => x.route === route && x.method === 'POST')!
      const at = h.body.search(/\.from\('bookings'\)\s*\r?\n?\s*\.update\(/)
      expect(at).toBeGreaterThan(-1)
      expect(h.body.slice(at, at + 400)).toMatch(/\.select\(/)
    }
  })

  it('the interaction log goes through the typed writer, never a raw insert', () => {
    // `contact_interactions.type` is CHECK-constrained and the app did not know
    // it: five months of `sequence_email_sent` rows were refused and the refusal
    // thrown away. Six intake routes each held their own raw insert inside a
    // try/catch that discarded the SQLSTATE.
    const offenders = HANDLERS.filter(
      h => !DEFERRED_TO_NEXT_LINK(h.route) && /from\('contact_interactions'\)\s*\r?\n?\s*\.?\s*insert/.test(h.body),
    )
    expect(offenders.map(id)).toEqual([])
  })
})

/* ── R6: a default credential is a credential ─────────────────────────────── */

describe('R6: no credential has a literal default', () => {
  const CREDENTIAL_ENV = /process\.env\.[A-Z0-9_]*(?:SECRET|PASSWORD|TOKEN|API_KEY)[A-Z0-9_]*\s*\|\|\s*'[^']+'/

  it('nothing in src falls back to a literal for a secret', () => {
    // `process.env.CM_CHEER_PASSWORD || 'cmcheer2026'` was the live credential on
    // `/api/cm-cheer-orders` because the variable was never set, over a table of
    // 21 real customers. `PORTAL_LINK_SIGNING_SECRET || 'dev-secret'` was the same
    // shape written out twenty-seven times; it IS set in production, so nothing
    // leaked, but a default credential is a credential either way.
    const offenders = walkTs(path.join(process.cwd(), 'src'))
      .filter(f => !f.includes('__tests__'))
      .filter(f => CREDENTIAL_ENV.test(decomment(fs.readFileSync(f, 'utf8'))))
      .map(f => path.relative(process.cwd(), f).split(path.sep).join('/'))
    expect(offenders).toEqual([])
  })

  it("the literal 'dev-secret' exists in exactly one file, and that file fails closed", () => {
    const holders = walkTs(path.join(process.cwd(), 'src'))
      .filter(f => !f.includes('__tests__'))
      .filter(f => decomment(fs.readFileSync(f, 'utf8')).includes("'dev-secret'"))
      .map(f => path.basename(f))
    expect(holders).toEqual(['portalAuth.ts'])

    const src = decomment(fs.readFileSync(path.join(LIB_ROOT, 'portalAuth.ts'), 'utf8'))
    const at = src.indexOf('function portalSigningSecret')
    expect(at).toBeGreaterThan(-1)
    const body = src.slice(at, src.indexOf('\n}', at))
    // Production throws; the dev fallback is reachable only outside production.
    expect(body).toMatch(/NODE_ENV\s*===\s*'production'/)
    const throwAt = body.search(/throw new Error/)
    const fallbackAt = body.indexOf("'dev-secret'")
    expect(throwAt).toBeGreaterThan(-1)
    expect(fallbackAt).toBeGreaterThan(throwAt)
  })

  it('the cm-cheer check is one definition and it fails closed', () => {
    const src = decomment(fs.readFileSync(path.join(LIB_ROOT, 'cmCheerAuth.ts'), 'utf8'))
    const at = src.indexOf('function isCmCheerAuthorized')
    expect(at).toBeGreaterThan(-1)
    const body = src.slice(at, src.indexOf('\n}', at))
    // The emptiness check comes BEFORE the comparison: `undefined !== undefined`
    // is false, which is how an unset credential becomes a passing check.
    const guardAt = body.search(/if\s*\(\s*!expected\s*\)/)
    const compareAt = body.indexOf('=== `Bearer')
    expect(guardAt).toBeGreaterThan(-1)
    expect(compareAt).toBeGreaterThan(guardAt)

    const copies = walkTs(path.join(process.cwd(), 'src'))
      .filter(f => !f.includes('__tests__'))
      .filter(f => path.basename(f) !== 'cmCheerAuth.ts')
      .filter(f => /CM_CHEER_PASSWORD/.test(decomment(fs.readFileSync(f, 'utf8'))))
    expect(copies).toEqual([])
  })

  it('no NEXT_PUBLIC_ variable holds anything credential-shaped', () => {
    // `NEXT_PUBLIC_*` is baked into the JavaScript every visitor downloads. The
    // cm-cheer orders page read `NEXT_PUBLIC_CM_CHEER_PASSWORD` and compared it
    // client-side, so the password was published whatever its value.
    const offenders = walkTs(path.join(process.cwd(), 'src'))
      .filter(f => !f.includes('__tests__'))
      .filter(f =>
        /process\.env\.NEXT_PUBLIC_[A-Z0-9_]*(?:SECRET|PASSWORD|TOKEN)/.test(decomment(fs.readFileSync(f, 'utf8'))),
      )
      .map(f => path.relative(process.cwd(), f).split(path.sep).join('/'))
    expect(offenders).toEqual([])
  })
})

/* ── R7: ticket quantities ────────────────────────────────────────────────── */

describe('R7: a ticket quantity is a positive whole number', () => {
  it('both checkout routes screen it', () => {
    for (const route of ['events/checkout', 'cart-checkout']) {
      const h = HANDLERS.find(x => x.route === route && x.method === 'POST')!
      expect(h.body).toMatch(/screenPublicCount\s*\(/)
    }
  })

  it('the screen runs before the inventory decrement', () => {
    // `available_tickets < -5` is false, so a negative quantity passed the stock
    // check, and `decrement_event_tickets(qty: -5)` INCREASES inventory by five.
    for (const route of ['events/checkout', 'cart-checkout']) {
      const h = HANDLERS.find(x => x.route === route && x.method === 'POST')!
      const screenAt = h.body.search(/screenPublicCount\s*\(/)
      const decAt = h.body.search(/decrement_(?:event|session)_tickets/)
      expect(screenAt).toBeGreaterThan(-1)
      if (decAt > -1) expect(decAt).toBeGreaterThan(screenAt)
    }
  })

  it('the per-order ceiling is one constant, not two', () => {
    const holders = walkTs(path.join(process.cwd(), 'src'))
      .filter(f => !f.includes('__tests__'))
      .filter(f => /MAX_TICKETS_PER_ORDER\s*=/.test(decomment(fs.readFileSync(f, 'utf8'))))
      .map(f => path.basename(f))
    expect(holders).toEqual(['ticketLimits.ts'])
  })

  it('no route file exports anything but handlers and framework config', () => {
    // `export const FOO` in a `route.ts` is a build-time type error that neither
    // jest nor `tsc --noEmit` reports. Link 17 nearly shipped one; link 19 did,
    // and only `npx next build` caught it. This is the cheap version of that.
    const ALLOWED = new Set([
      ...HTTP_METHODS,
      'dynamic',
      'revalidate',
      'runtime',
      'fetchCache',
      'dynamicParams',
      'preferredRegion',
      'maxDuration',
      'generateStaticParams',
    ])
    const offenders: string[] = []
    for (const f of ALL_ROUTE_FILES) {
      const src = decomment(fs.readFileSync(path.join(API_ROOT, f), 'utf8'))
      // VALUE exports only. `export interface TimeSlot` in `availability/route.ts`
      // is erased at compile time and Next does not object; `export const FOO` is
      // the build-time error link 19 shipped and only `next build` reports.
      const re = /export\s+(?:const|let|var|async\s+function|function|class)\s+(\w+)/g
      let m: RegExpExecArray | null
      while ((m = re.exec(src))) {
        if (!ALLOWED.has(m[1])) offenders.push(`${f}: ${m[1]}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

/* ── R8: a 200 means something landed ─────────────────────────────────────── */

describe('R8: an intake route does not claim to have saved a lead it lost', () => {
  /** The routes whose whole job is to capture a lead. */
  const LEAD_ROUTES = [
    'contact',
    'lead',
    'quote/save',
    'mobile-party-inquiry',
    'trucker-inquiry',
    'canvas-bag-inquiry',
    'fundraiser-inquiry',
  ]

  it('each one tracks what it recorded and checks it before answering', () => {
    for (const route of LEAD_ROUTES) {
      const h = HANDLERS.find(x => x.route === route && x.method === 'POST')
      expect(h).toBeDefined()
      const body = h!.body
      expect(body).toMatch(/emptyIntakeRecord\s*\(/)
      expect(body).toMatch(/landedSomewhere\s*\(/)
      // The check must come BEFORE the success response, or it is a log line.
      const checkAt = body.search(/if\s*\(\s*!\s*landedSomewhere/)
      const okAt = body.search(/success:\s*true/)
      expect(checkAt).toBeGreaterThan(-1)
      expect(okAt).toBeGreaterThan(checkAt)
    }
  })

  it('each one records all four subsystems, not just the convenient ones', () => {
    for (const route of LEAD_ROUTES) {
      const body = HANDLERS.find(x => x.route === route && x.method === 'POST')!.body
      for (const field of ['recorded.contact', 'recorded.plan', 'recorded.event', 'recorded.ownerNotified']) {
        expect(body).toContain(field)
      }
    }
  })

  it('the owner notification is judged on its RESULT, not on having been called', () => {
    // `Promise.allSettled([...])` with the result discarded treats a bounced
    // notification as a delivered one — and "the lead is at least in Adam's
    // inbox" is the only thing that makes a lost row recoverable.
    for (const route of LEAD_ROUTES) {
      const body = HANDLERS.find(x => x.route === route && x.method === 'POST')!.body
      expect(body).toMatch(/settledOk\s*\(\s*results\[\d\]\s*\)/)

      /**
       * The index must point at the send addressed to the OWNER.
       *
       * This is not pedantry: `results[0]` is the owner on five of these routes
       * and the CUSTOMER on `fundraiser-inquiry` and `quote/save`, and the first
       * version of this session's codemod wrote `results[0]` into all seven. The
       * rule would have passed on every one of them while measuring the wrong
       * email on two, so the check has to find the send itself.
       *
       * Two construction shapes exist: an inline array of `resend.emails.send({…})`
       * calls, and `/api/lead`'s `emails` array mapped through
       * `emails.map(e => resend.emails.send(e))`. For the second, the ordering is
       * the ARRAY's, so the `to:` fields are counted instead.
       */
      const ownerIdx = Number(/settledOk\s*\(\s*results\[(\d)\]\s*\)/.exec(body)![1])
      const inlineSends = [...body.matchAll(/resend\.emails\.send\s*\(\s*\{/g)].map(m => m.index ?? 0)

      /**
       * Each send is sliced to the START OF THE NEXT ONE, not a fixed 400 bytes.
       *
       * With a fixed window the first send's slice ran past the end of its own
       * object literal and into the second's, so the harness's mutation —
       * `results[1]` → `results[0]` on `fundraiser-inquiry`, which is precisely the
       * slip this session's codemod made for real — found `ownerEmail()` in the
       * spill-over and the rule stayed green. An overlapping window is a rule
       * satisfied by the wrong occurrence.
       */
      const recipients =
        inlineSends.length > ownerIdx
          ? inlineSends.map((start, k) => body.slice(start, inlineSends[k + 1] ?? body.length))
          : [...body.matchAll(/\n\s*to:\s*([^\n,]+)/g)].map(m => m[1])
      expect(recipients.length).toBeGreaterThan(ownerIdx)
      expect(recipients[ownerIdx]).toMatch(/ownerEmail\(\)/)
      // And the OTHER sends must not be the owner's, or the slice is too wide to
      // be distinguishing anything.
      recipients.forEach((r, k) => {
        if (k !== ownerIdx) expect(r).not.toMatch(/to:\s*ownerEmail\(\)/)
      })
    }
  })
})

/* ── R9: a public route names its columns ─────────────────────────────────── */

describe('R9: no public handler hands out whole rows', () => {
  it("nothing on this surface selects '*' from a table holding customer data", () => {
    const PII_TABLES = ['bookings', 'contacts', 'cm_cheer_orders', 'summer_hair_bookings', 'booking_payments', 'gift_cards']
    const offenders: string[] = []
    for (const h of HANDLERS) {
      if (gateOf(h) === 'admin') continue
      for (const table of PII_TABLES) {
        const re = new RegExp(`from\\('${table}'\\)\\s*\\r?\\n?\\s*\\.select\\(\\s*'\\*'`)
        if (re.test(h.body)) offenders.push(`${id(h)} → ${table}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

/* ── R10: an email address is never a filter ──────────────────────────────── */

describe('R10: the email lookup, including the spelling link 17 could not see', () => {
  it("R1 in contactIdentitySurface now covers the STRING spelling it could not see", () => {
    /**
     * The check itself lives in `contactIdentitySurface.test.ts`, which owns "no
     * file filters an email column" — putting a second copy here would be the
     * concept-in-two-places defect this whole chain keeps finding. What is asserted
     * HERE is that the fix is present in that file, so it cannot be reverted
     * silently and leave `lib/plan.ts` standing in the hole again.
     *
     * The hole: R1 looked for `.eq('contact_email'` / `.ilike('contact_email'`, and
     * a PostgREST `or()` expression is a STRING, so `lib/plan.ts` spelled its
     * case-sensitive filter `contact_email.eq.${value}` and no method call appeared
     * at all. It passed for two links over nine live mixed-case `bookings` rows.
     */
    const r1 = decomment(
      fs.readFileSync(path.join(process.cwd(), 'src', '__tests__', 'lib', 'contactIdentitySurface.test.ts'), 'utf8'),
    )
    expect(r1).toMatch(/raw PostgREST expression/)
    expect(r1).toContain('(eq|ilike|like)\\\\.')
  })

  it('no rule in any surface tripwire is skipped', () => {
    /**
     * A skipped rule is a disabled tripwire, and grepping for a rule's CONTENT
     * cannot tell you it has been turned off. The harness proved that: changing
     * `it(` to `it.skip(` in `contactIdentitySurface.test.ts` left every string the
     * assertion above looks for exactly where it was, and the whole suite stayed
     * green over a rule that no longer ran.
     *
     * So the skip itself is what gets checked, across every source-reading
     * tripwire at once — there is no honest reason for one of these to be off.
     */
    const dir = path.join(process.cwd(), 'src', '__tests__', 'lib')
    const surfaces = fs.readdirSync(dir).filter(f => /Surface\.test\.ts$/.test(f))
    expect(surfaces.length).toBeGreaterThanOrEqual(6)

    const offenders: string[] = []
    for (const f of surfaces) {
      const src = decomment(fs.readFileSync(path.join(dir, f), 'utf8'))
      const hits = src.match(/\b(?:it|test|describe)\.skip\s*\(|\bx(?:it|describe)\s*\(|\.todo\s*\(/g)
      if (hits) offenders.push(`${f}: ${hits.join(', ')}`)
    }
    expect(offenders).toEqual([])
  })

  it('lib/plan.ts resolves the person through the one lookup and builds no .or()', () => {
    const src = decomment(fs.readFileSync(path.join(LIB_ROOT, 'plan.ts'), 'utf8'))
    expect(src).toMatch(/findBookingsByContactEmail\s*\(/)
    expect(src).not.toMatch(/\.or\s*\(/)
    // The phone variants go through `.in()`, which PostgREST parameter-encodes,
    // so `(631) 400-8080`'s parentheses are data rather than syntax.
    expect(src).toMatch(/\.in\('contact_phone',\s*phoneVariants\)/)
    // And the hand-rolled quoter that existed only to make `.or()` safe is gone.
    expect(src).not.toMatch(/function\s+orValue/)
  })
})
