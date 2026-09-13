/**
 * THE INBOUND MESSAGE SURFACE, read off disk (link 24).
 *
 * Everything that answers *"a message arrived — who is it from, what does it
 * mean, and did we act on it"*: the three provider webhooks, the Gmail poller,
 * the dispatcher's inbound half, the identity lookups, and the two prompts an
 * inbound message reaches.
 *
 * What was live in production when this file was written, every item measured
 * before a line changed:
 *
 *   - **`/api/webhooks/quo` rejected EVERY real inbound SMS for 2.5 days.** It
 *     verified a Standard Webhooks signature (`webhook-id` /
 *     `webhook-timestamp` / `webhook-signature`, over `id.timestamp.body`). Quo
 *     signs `openphone-signature: hmac;1;<ms>;<b64>` over `<ms>.<rawBody>`. So
 *     every genuine delivery arrived carrying none of the headers being looked
 *     for. The nginx log: **401 on every POST from 2026-09-11 12:00 UTC, 38 of
 *     them, and 200 on every delivery before that.** The SMS review loop was
 *     dead with 16 drafts waiting, inbound customer texts reached nothing, and a
 *     customer STOP could not be recorded. Nothing watched the 401s.
 *   - **How it passed review**: `docs/quo-webhook-setup.md` §4 verifies the
 *     endpoint by signing a payload the way the verifier checks it — a test that
 *     can only prove the verifier agrees with itself. Rule 8, and rule 17's ASK
 *     THE PROVIDER half: the answer was in Quo's own documentation.
 *   - **`/api/webhooks/twilio` verified NOTHING.** No signature check of any
 *     kind, no rate limit, on a public URL whose job is to write
 *     `contacts.sms_opt_in = false` for **every row holding a number** and
 *     cancel that contact's pending SMS reminders — while `TWILIO_AUTH_TOKEN`
 *     sat in the container the whole time.
 *   - **`recordInboundEvent` returned `null` for three different facts**
 *     (duplicate / refused / threw). `gmail-sync` counted a refusal in its
 *     `duplicates` column and **advanced the history checkpoint past the
 *     message**, three lines below a comment promising it never would; the Quo
 *     route answered **200**, so Quo never redelivered and a reviewer approval
 *     or a customer's text simply stopped existing.
 *   - **`gmail-sync` also advanced past a message `getMessage()` could not
 *     READ** — `null` means both "the API failed" and "it is gone" (rule 12).
 *   - **triage's `<email_body>` fence could be closed by the data inside it**,
 *     and `From:` / `Subject:` were interpolated unflattened, above the fence.
 *     `draftInquiry.buildUserPrompt` fixed exactly this in Phase 4 and said so
 *     at length; the prompt an inbound email reaches FIRST never got it.
 *   - **`resolveRecipient` filled email and phone INDEPENDENTLY**, so one
 *     conversation could be emailed to one person and texted to another. 21
 *     normalised phone numbers carry several contact rows and two of those
 *     groups are two different people sharing a household phone.
 *   - **The STOP keyword set was an inline literal in BOTH SMS routes**, both
 *     missing `STOPALL`, and neither recognised the opt-IN words at all.
 *   - **Brevo's webhook answered 200 over an opt-out write that had failed.**
 *   - **No webhook route had a rate limit of any kind.**
 *
 * Shape follows `planMoneySurface` / `agentSurface` / `publicIntakeSurface`:
 * comments are STRIPPED before any rule runs (this header names every defect it
 * tests for, and link 16 lost two rules to a file's own prose); bodies are
 * sliced to the NEXT declaration rather than by a fixed width (link 20's
 * 400-byte window spilled into the next branch and link 22's 200-byte "fix"
 * reproduced the same bug); every anchor tolerates CRLF because this repo is
 * `core.autocrlf=true` (six of link 23's 34 mutations silently failed to apply
 * over exactly that); and **every rule states how many sites it examined**,
 * because link 22's R9 examined 7 of 23 writes and found its offender by luck.
 *
 * No `.skip` rule here: `publicIntakeSurface`'s R10 walks every
 * `*Surface.test.ts` in this directory and fails on `.skip` / `xit` / `.todo`,
 * and this file matches that glob (rule 11 — the concept has one owner).
 */

import fs from 'fs'
import path from 'path'

const SRC = path.join(process.cwd(), 'src')

/** Blank out comments while preserving offsets and line structure. */
function decomment(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n\r]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n\r]*/g, (m, p) => p + ' '.repeat(m.length - p.length))
}

function walk(dir: string, match: (name: string) => boolean): string[] {
  const out: string[] = []
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p, match))
    else if (match(e.name)) out.push(p)
  }
  return out.sort()
}

const relSrc = (abs: string) => path.relative(SRC, abs).split(path.sep).join('/')
const read = (rel: string) => decomment(fs.readFileSync(path.join(SRC, rel), 'utf8'))
const raw = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8')

/**
 * Decommented source with every run of whitespace collapsed to one space.
 *
 * `decomment` deliberately PRESERVES OFFSETS — it blanks a comment rather than
 * removing it — which is right for anything that compares positions and is a
 * trap for anything that measures distance. A rule written as
 * `'unavailable'[\s\S]{0,240}status: 503` reads that gap in characters, and on
 * this surface a single explanatory comment is 400 characters of spaces, so the
 * rule fails over code that is correct.
 *
 * Found by the rule firing on `/api/webhooks/quo`, whose 503 is three lines
 * below its guard. When a rule fires on code you believe is right, suspect the
 * rule first (link 23's rule-19 lesson). Proximity rules read `squash`.
 */
const squash = (rel: string) => read(rel).replace(/\s+/g, ' ')

/**
 * A declaration's body, sliced to the NEXT top-level declaration.
 *
 * Not a fixed-width window: link 20's 400 characters ran into the following
 * branch, and link 22's 200-character "fix" for that reproduced the bug one
 * size down. A construct, never a window.
 */
function bodyOf(src: string, name: string): string {
  const decl = new RegExp(`^(?:export\\s+)?(?:async\\s+)?(?:function|const|let)\\s+${name}\\b`, 'm')
  const m = decl.exec(src)
  if (!m) return ''
  const from = m.index
  const rest = src.slice(from + m[0].length)
  const next = /^(?:export\s+)?(?:async\s+)?(?:function|const|let|class|interface|type)\s+\w/m.exec(rest)
  return src.slice(from, next ? from + m[0].length + next.index : src.length)
}

/* ── R0 · the walker ─────────────────────────────────────────────────────── */

/**
 * Every module on the inbound surface. Held EXACT in both directions: a module
 * that vanishes fails here rather than silently exempting itself from every rule
 * below, and a new one has to be classified by a human.
 */
const SURFACE = [
  'lib/inboundWebhookVerify.ts', // is this really from the provider
  'lib/smsOptOut.ts', // what a carrier keyword means, and what we do about it
  'lib/contactLookup.ts', // which person is this
  'lib/contacts.ts', // and the writer behind it
  'lib/agent/events.ts', // the single front door
  'lib/agent/triage.ts', // what does this message mean
  'lib/agent/reviewers.ts', // is this a reviewer
  'lib/gmail.ts', // the mailbox client
].sort()

/** The routes an inbound message arrives at or is processed by. */
const ROUTES = [
  'app/api/webhooks/quo/route.ts',
  'app/api/webhooks/twilio/route.ts',
  'app/api/webhooks/brevo/route.ts',
  'app/api/cron/gmail-sync/route.ts',
  'app/api/cron/agent-dispatch/route.ts',
].sort()

/** Every webhook route on disk, walked rather than listed. */
const WEBHOOK_ROUTES = walk(path.join(SRC, 'app', 'api', 'webhooks'), n => n === 'route.ts').map(relSrc)

describe('R0 · the surface is walked, and every file in it is accounted for', () => {
  it('every named module and route exists on disk and is readable', () => {
    for (const f of [...SURFACE, ...ROUTES]) {
      expect({ f, exists: fs.existsSync(path.join(SRC, f)) }).toEqual({ f, exists: true })
      expect(read(f).length).toBeGreaterThan(0)
    }
    expect(SURFACE.length).toBe(8)
    expect(ROUTES.length).toBe(5)
  })

  it('no webhook route exists that this file does not know about', () => {
    // A sixth webhook appearing under /api/webhooks must be classified — either
    // as an inbound message door (and subject to R1–R3) or as a SignWell route,
    // which `signwellSurface.test.ts` owns.
    const SIGNWELL = WEBHOOK_ROUTES.filter(f => f.includes('signwell'))
    const INBOUND = WEBHOOK_ROUTES.filter(f => !f.includes('signwell'))
    expect(SIGNWELL.length).toBe(3)
    expect(INBOUND.sort()).toEqual(
      ['app/api/webhooks/brevo/route.ts', 'app/api/webhooks/quo/route.ts', 'app/api/webhooks/twilio/route.ts'].sort(),
    )
    expect(WEBHOOK_ROUTES.length).toBe(6)
  })

  it('no module outside the list answers "is this delivery genuine"', () => {
    // One implementation, imported. Two SMS webhooks each had their own answer
    // and one of them had none at all.
    //
    // The three exclusions are CLASSIFIED rather than regex'd away, because a
    // regex that quietly excuses a file is how link 13's and link 14's tripwires
    // exempted whole modules:
    //   - lib/signwellWebhook.ts  — SignWell's scheme; signwellSurface owns it.
    //   - lib/slack/signature.ts  — Slack's scheme, plan §25, a different session.
    //   - lib/experiments/track.ts — signs our own tracking links, not a webhook.
    const CLASSIFIED_ELSEWHERE = [
      'lib/inboundWebhookVerify.ts',
      'lib/signwellWebhook.ts',
      'lib/slack/signature.ts',
      'lib/experiments/track.ts',
    ]
    let examined = 0
    const offenders = walk(SRC, n => n.endsWith('.ts') || n.endsWith('.tsx'))
      .map(relSrc)
      .filter(f => !f.startsWith('__tests__/'))
      .filter(f => {
        if (!/createHmac\(\s*'sha(1|256)'/.test(read(f))) return false
        examined++
        return !CLASSIFIED_ELSEWHERE.includes(f)
      })
      .filter(f => /webhook|x-twilio|openphone-signature/i.test(read(f)))
    expect(offenders).toEqual([])
    // Every classified file must still exist and still compute an HMAC —
    // otherwise the exclusion list is protecting nothing and the rule has
    // quietly stopped looking.
    expect(examined).toBeGreaterThanOrEqual(CLASSIFIED_ELSEWHERE.length)
    for (const f of CLASSIFIED_ELSEWHERE) {
      expect({ f, hmac: /createHmac\(/.test(read(f)) }).toEqual({ f, hmac: true })
    }
  })
})

/* ── R1 · every inbound door verifies, and fails closed ──────────────────── */

describe('R1 · a provider webhook proves who it is before it writes', () => {
  const verify = read('lib/inboundWebhookVerify.ts')

  it('the Quo route verifies with the shared module and refuses on failure', () => {
    const quo = read('app/api/webhooks/quo/route.ts')
    expect(quo).toMatch(/verifyQuoWebhook\(\s*req\.headers\s*,\s*rawBody/)
    expect(quo).toMatch(/if\s*\(\s*!verified\.ok\s*\)/)
    expect(quo).toMatch(/status:\s*401/)
    // The refusal comes BEFORE the body is parsed, so an unverified payload is
    // never read as a fact about anybody.
    expect(quo.indexOf('verifyQuoWebhook(')).toBeLessThan(quo.indexOf('JSON.parse(rawBody)'))
  })

  it('the Twilio route verifies before it reads a single parameter', () => {
    const twilio = read('app/api/webhooks/twilio/route.ts')
    expect(twilio).toMatch(/verifyTwilioWebhook\(\s*req\s*,\s*formData/)
    expect(twilio).toMatch(/if\s*\(\s*!verified\.ok\s*\)/)
    expect(twilio).toMatch(/status:\s*401/)
    // `From` decides whose consent gets written. It must not be read first.
    expect(twilio.indexOf('verifyTwilioWebhook(')).toBeLessThan(twilio.indexOf("formData.get('From')"))
  })

  it('BOTH verifiers hash the bytes their provider actually signs', () => {
    // The whole defect in one assertion. A rule that only checked "an HMAC is
    // computed" would have been green throughout the 2.5-day outage.
    const quoBody = bodyOf(verify, 'verifyQuoWebhook')
    expect(quoBody).not.toBe('')
    expect(quoBody).toMatch(/createHmac\('sha256',\s*key\)\.update\(`\$\{timestamp\}\.\$\{rawBody\}`\)/)
    expect(quoBody).toMatch(/createHmac\('sha256',\s*key\)\.update\(`\$\{id\}\.\$\{ts\}\.\$\{rawBody\}`\)/)
    expect(quoBody).toMatch(/openphone-signature/)

    const twBody = bodyOf(verify, 'verifyTwilioWebhook')
    expect(twBody).toMatch(/createHmac\('sha1',\s*token\)/)
    // Twilio signs the URL AND every POST parameter. Dropping the parameters
    // would make a stolen signature authorise any `From` at all.
    expect(twBody).toMatch(/params\.getAll\(k\)/)
    expect(twBody).toMatch(/payload\s*\+=\s*k\s*\+\s*v/)
  })

  it('the URL Twilio signs is the PUBLIC one, via the one sanctioned helper', () => {
    expect(bodyOf(verify, 'twilioSignedUrls')).toMatch(/publicOrigin\(/)
    // Never a raw forwarded header — `publicOrigin.test.ts` owns that rule and
    // this asserts the surface does not go around it (AGENTS.md §11).
    expect(verify).not.toMatch(/x-forwarded-host/)
  })

  it('an unconfigured secret is CLOSED in production, for both providers', () => {
    expect(bodyOf(verify, 'unsignedRequestsAllowed')).toMatch(/phase-production-build/)
    expect(bodyOf(verify, 'unsignedRequestsAllowed')).toMatch(/NODE_ENV\s*!==\s*'production'/)
    for (const fn of ['verifyQuoWebhook', 'verifyTwilioWebhook']) {
      const body = bodyOf(verify, fn)
      // The unconfigured branch must REFUSE when unsignedRequestsAllowed() is
      // false — and the refusal must be the first `return` inside it, not some
      // later one (link 23's R8: a rule that matched the wrong `return null`).
      const branch = /if\s*\(\s*!(?:secret|token)\s*\)\s*\{(?:(?!\breturn\b)[\s\S])*?return([\s\S]*?)\n\s*\}/.exec(body)
      expect({ fn, matched: !!branch }).toEqual({ fn, matched: true })
      expect(branch![0]).toMatch(/unsignedRequestsAllowed\(\)/)
      expect(branch![0]).toMatch(/reason:\s*'unconfigured'/)
    }
  })

  it('a refusal says WHY, and which signature headers were present', () => {
    // "verification FAILED" cannot distinguish a wrong key from a wrong scheme,
    // and that is exactly what cost 2.5 days of silence. Rule 10.
    for (const rel of ['app/api/webhooks/quo/route.ts', 'app/api/webhooks/twilio/route.ts']) {
      const src = read(rel)
      expect({ rel, ok: /verified\.reason/.test(src) }).toEqual({ rel, ok: true })
      expect({ rel, ok: /verified\.headersSeen/.test(src) }).toEqual({ rel, ok: true })
    }
  })

  it('the digest comparison is constant-time and length-checked', () => {
    expect(bodyOf(verify, 'sameDigest')).toMatch(/timingSafeEqual/)
    expect(bodyOf(verify, 'sameDigest')).toMatch(/a\.length\s*!==\s*b\.length/)
  })

  it('nothing on the surface logs a signature, a key or a secret', () => {
    // Fingerprints only. A prefix of a real HMAC is a piece of a real HMAC.
    //
    // It is the INTERPOLATION of a secret-valued expression that is the defect,
    // never the word. The first version of this rule matched `\btoken\b`
    // anywhere in a log call and fired on `gmail: token refresh failed` — a
    // string constant naming an operation, with no value in it. A rule that is
    // wrong in the false-positive direction gets relaxed by the next person, so
    // it is anchored on `${…}` and on the identifiers that hold a secret.
    const SECRET_VALUE =
      /\$\{[^}]*\b(?:secret|signature|sig|expected|apiKey|authToken|refreshToken|accessToken|process\.env\.[A-Z_]*(?:SECRET|TOKEN|KEY))\b[^}]*\}/i
    let examined = 0
    for (const rel of [...SURFACE, ...ROUTES]) {
      const src = read(rel)
      const logs = src.match(/console\.(log|warn|error)\([\s\S]{0,600}?\n\s*\)|console\.(log|warn|error)\([^\n]*\)/g) ?? []
      for (const line of logs) {
        examined++
        expect({ rel, line: line.slice(0, 90), leaks: SECRET_VALUE.test(line) })
          .toEqual({ rel, line: line.slice(0, 90), leaks: false })
      }
    }
    expect(examined).toBeGreaterThanOrEqual(20)
    // The negative case, so the narrowing cannot quietly become an escape
    // hatch: a log that DID interpolate a secret must still be caught.
    expect(SECRET_VALUE.test('console.error(`sig=${signature}`)')).toBe(true)
    expect(SECRET_VALUE.test("console.error('token refresh failed', res.status)")).toBe(false)
  })
})

/* ── R2 · a public write door is bounded ─────────────────────────────────── */

describe('R2 · every inbound webhook is rate limited', () => {
  it('each of the three message webhooks counts its callers', () => {
    let examined = 0
    for (const rel of [
      'app/api/webhooks/quo/route.ts',
      'app/api/webhooks/twilio/route.ts',
      'app/api/webhooks/brevo/route.ts',
    ]) {
      examined++
      const src = read(rel)
      expect({ rel, limited: /guardRate\(\s*req\s*,\s*webhookRule\(/.test(src) }).toEqual({ rel, limited: true })
    }
    expect(examined).toBe(3)
  })

  it('the webhook ceiling is far above the measured delivery rate', () => {
    // Sized from the ten-day nginx window (quo 96 requests, busiest hour 8) and
    // deliberately generous: a throttle that drops a provider delivery is the
    // same outage as a signature check that is too strict, with a different
    // cause. If somebody tightens this, they should have to say why.
    const rule = bodyOf(read('lib/rateLimit.ts'), 'webhookRule')
    expect(rule).not.toBe('')
    const perRoute = /perRoute:\s*(\d+)/.exec(rule)
    const perCaller = /perCaller:\s*(\d+)/.exec(rule)
    expect(Number(perRoute?.[1])).toBeGreaterThanOrEqual(300)
    expect(Number(perCaller?.[1])).toBeGreaterThanOrEqual(200)
  })
})

/* ── R3 · a 200 is a promise ─────────────────────────────────────────────── */

describe('R3 · a route never answers 2xx over something it did not do', () => {
  it('recordInboundEvent distinguishes duplicate from REFUSED', () => {
    const events = read('lib/agent/events.ts')
    expect(events).toMatch(/kind:\s*'duplicate'/)
    expect(events).toMatch(/kind:\s*'failed'/)
    expect(events).toMatch(/kind:\s*'recorded'/)
    // The duplicate branch keys on the SQLSTATE, never on message text.
    const body = bodyOf(events, 'recordInboundEventResult')
    // The 23505 check is the FIRST thing inside `if (error)`, and everything
    // after it is `failed`. Anchored on the construct rather than on a window
    // (link 22's hole 4: `[\s\S]{0,200}` still reaches the next branch), and
    // checked in order rather than by presence, because both strings exist in
    // the file either way.
    const errBranch = /if\s*\(error\)\s*\{([\s\S]*?)\n\s*\}/.exec(body)
    expect({ found: !!errBranch }).toEqual({ found: true })
    const inner = errBranch![1]
    expect(inner).toMatch(/code\s*===\s*'23505'[^\n]*return\s*\{\s*kind:\s*'duplicate'/)
    expect(inner).toMatch(/return\s*\{\s*kind:\s*'failed'/)
    expect(inner.indexOf("'23505'")).toBeLessThan(inner.indexOf("kind: 'failed'"))
    // …and nothing in that branch collapses back to a bare null.
    expect(inner).not.toMatch(/return\s+null/)

    // The THIRD outcome, which the first version of this rule did not check at
    // all: a THROWN error is a failure too. The attack harness turned the catch
    // block into `return { kind: 'duplicate' }` and went straight through — a
    // rule that reads one of two failure paths is a rule that reads neither
    // (link 22's wrong-occurrence family, one branch over).
    const catchBlock = /\}\s*catch\s*\([\s\S]*?\)\s*\{([\s\S]*?)\n\s*\}/.exec(body)
    expect({ found: !!catchBlock }).toEqual({ found: true })
    expect(catchBlock![1]).toMatch(/return\s*\{\s*kind:\s*'failed'/)
    expect(catchBlock![1]).not.toMatch(/kind:\s*'duplicate'|kind:\s*'recorded'/)
  })

  it('the Quo route asks for a redelivery when it could not record the message', () => {
    const quo = read('app/api/webhooks/quo/route.ts')
    expect(quo).toMatch(/recordInboundEventResult\(/)
    // A failed write is a 503 so Quo retries. A duplicate is a 200 — that is the
    // idempotency guarantee working, and retrying it forever would be wrong.
    const branch = /if\s*\(\s*recorded\.kind\s*===\s*'failed'\s*\)\s*\{(?:(?!\bif\s*\()[\s\S])*?status:\s*503/.exec(quo)
    expect(!!branch).toBe(true)
    expect(quo).not.toMatch(/recorded\.kind\s*!==\s*'recorded'[\s\S]{0,80}status:\s*503/)
  })

  it('a failed contact read or opt-out on an SMS webhook is a non-2xx', () => {
    // Proximity is measured on `squash`, not on `read`: see the helper. A single
    // explanatory comment is hundreds of blanked characters, so a window over
    // the decommented source fails on correct code.
    const quo = squash('app/api/webhooks/quo/route.ts')
    // A bounded window, not a character class: `[^}]` cannot span the `}` of the
    // JSON body being returned, which is how the first version of this rule
    // failed over code that was correct.
    expect(quo).toMatch(/byPhone\.kind === 'unavailable'\) \{[\s\S]{0,160}status: 503/)
    // BOTH consent writers — the opt-out and the opt-in — and counted, so a
    // rule that silently stops seeing one of them is visible.
    const unavailable503 = quo.match(/res\.kind === 'unavailable'\) \{[\s\S]{0,120}status: 503/g) ?? []
    expect(unavailable503.length).toBe(2)
    // Both directions of the STOP path: a read failure must NOT create a
    // contact, and must not fall through to recording the message as handled.
    expect(quo).toMatch(/byPhone\.kind === 'unavailable'/)
    expect(quo.indexOf("byPhone.kind === 'unavailable'")).toBeLessThan(quo.indexOf('upsertContactByPhone({'))
  })

  it('the Brevo webhook does not answer 200 over an opt-out write that failed', () => {
    const brevo = read('app/api/webhooks/brevo/route.ts')
    expect(brevo).toMatch(/optOutFailed/)
    expect(brevo).toMatch(/if\s*\(optOutFailed\)[\s\S]{0,200}status:\s*500/)
  })

  it('gmail-sync does not move its checkpoint past a message it did not get', () => {
    const gmail = read('app/api/cron/gmail-sync/route.ts')
    // Both non-throwing failure modes are named, and both stop the checkpoint.
    const left = bodyOf(gmail, 'leftUnread')
    expect(left).toMatch(/'unreadable'/)
    expect(left).toMatch(/'write_failed'/)
    expect(gmail).toMatch(/if\s*\(leftUnread\(outcome\.outcome\)\)\s*\{[\s\S]{0,220}failure\s*=/)
    // The checkpoint advance is still gated on `!failure`.
    expect(gmail).toMatch(/if\s*\(nextHistoryId\s*&&\s*!failure\)/)
    // A refused write must NOT be labelled SEEN — the label claims the message
    // is in `ingested_messages`.
    expect(gmail).toMatch(/recorded\.kind\s*===\s*'failed'[\s\S]{0,320}return\s*\{\s*id,\s*outcome:\s*'write_failed'/)
    expect(gmail.indexOf("outcome: 'write_failed'")).toBeLessThan(gmail.indexOf('applyLabel(msg.id, labelId)'))
  })
})

/* ── R4 · one answer to "which person is this" ───────────────────────────── */

describe('R4 · identity is asked in exactly one place', () => {
  it('nothing on the surface compares a phone number raw', () => {
    let examined = 0
    const offenders: string[] = []
    for (const rel of [...SURFACE, ...ROUTES]) {
      if (rel === 'lib/contactLookup.ts') continue
      examined++
      const src = read(rel)
      if (/\.(eq|ilike)\(\s*['"]phone['"]/.test(src)) offenders.push(rel)
    }
    expect(offenders).toEqual([])
    expect(examined).toBe(12)
  })

  it('the reviewer check is by phone number, and it is the first thing that happens', () => {
    const loop = read('lib/agent/reviewLoop.ts')
    const guard = loop.indexOf('isReviewerPhone(from)')
    const parse = loop.indexOf('parseReviewerReply(text)')
    expect(guard).toBeGreaterThan(-1)
    expect(parse).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(parse)
  })

  it('resolveRecipient will not assemble one recipient out of two people', () => {
    const send = read('lib/agent/sendApproved.ts')
    const body = bodyOf(send, 'resolveRecipient')
    expect(body).not.toBe('')
    // The sources are named, the split is detected, and the unlinked case DROPS
    // the second channel rather than sending to it.
    expect(body).toMatch(/emailFrom\.source\s*!==\s*phoneFrom\.source/)
    expect(body).toMatch(/sameEmail\(/)
    expect(body).toMatch(/samePhone\(/)
    const refusal = /if\s*\(!linked\)\s*\{(?:(?!\bif\s*\()[\s\S])*?phoneFrom\s*=\s*null/.exec(body)
    expect(!!refusal).toBe(true)
    // …and it says so. A dropped channel that nobody is told about is rule 10.
    expect(refusal![0]).toMatch(/console\.error/)
  })
})

/* ── R5 · a carrier keyword means one thing ──────────────────────────────── */

describe('R5 · STOP and START are defined once, and START does not grant consent', () => {
  it('neither SMS route carries its own keyword list', () => {
    let examined = 0
    for (const rel of ['app/api/webhooks/quo/route.ts', 'app/api/webhooks/twilio/route.ts']) {
      examined++
      const src = read(rel)
      expect({ rel, ok: /smsKeywordIntent\(/.test(src) }).toEqual({ rel, ok: true })
      // An inline array of keywords is the defect: both routes had one, both
      // were missing STOPALL, and the two could drift apart silently.
      expect({ rel, inline: /\[\s*'STOP'\s*,/.test(src) }).toEqual({ rel, inline: false })
    }
    expect(examined).toBe(2)
  })

  it('the keyword set covers what the carrier covers', () => {
    const opt = read('lib/smsOptOut.ts')
    for (const kw of ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']) {
      expect({ kw, present: new RegExp(`'${kw}'`).test(bodyOf(opt, 'SMS_STOP_KEYWORDS')) }).toEqual({ kw, present: true })
    }
    expect(bodyOf(opt, 'SMS_START_KEYWORDS')).toMatch(/'START'/)
  })

  it('the keyword match is EXACT, never "contains"', () => {
    // "Please don't stop sending me these" contains STOP and is not an opt-out.
    // A `contains` test on this surface writes a false statement about somebody's
    // consent.
    const body = bodyOf(read('lib/smsOptOut.ts'), 'smsKeywordIntent')
    expect(body).toMatch(/\.includes\(key\)/)
    expect(body).not.toMatch(/key\.includes\(|\.test\(key\)|indexOf\(/)
  })

  it('a STOP reaches every row holding the number, by id', () => {
    const body = bodyOf(read('lib/smsOptOut.ts'), 'recordSmsOptOut')
    expect(body).toMatch(/findContactsByPhone\(/)
    expect(body).toMatch(/\.in\('id',\s*ids\)/)
    expect(body).toMatch(/sms_opt_in:\s*false/)
    // It reports what it did in both directions, and a zero-row update is a
    // failure rather than a success (rules 10 and 19).
    expect(body).toMatch(/updated\.length\s*===\s*0/)
    expect(body).toMatch(/\.select\('id'\)/)
  })

  it('recordSmsOptIn does NOT write sms_opt_in', () => {
    // A number is not a person: two of the 21 duplicated phone groups are two
    // different people sharing a household phone. Over-recording an opt-OUT is
    // never expensive; re-granting consent across every row holding a number is
    // a decision, and the carrier resumes delivery on START by itself.
    const body = bodyOf(read('lib/smsOptOut.ts'), 'recordSmsOptIn')
    expect(body).not.toBe('')
    expect(body).not.toMatch(/sms_opt_in:\s*true/)
    expect(body).toMatch(/consent_written:\s*false/)
    expect(body).toMatch(/needs-Adam/i)
  })
})

/* ── R6 · a fence a stranger cannot close ────────────────────────────────── */

describe('R6 · both prompts an inbound message reaches are fenced properly', () => {
  it('the triage fence cannot be closed by the body inside it', () => {
    const body = bodyOf(read('lib/agent/triage.ts'), 'buildTriagePrompt')
    expect(body).not.toBe('')
    expect(body).toMatch(/<email_body>/)
    // Neutralised, not dropped — the sender keeps their words, they just cannot
    // spell our delimiter. And the replace must precede the interpolation.
    expect(body).toMatch(/\.replace\(\/<\\\/\?\\s\*email_body\\s\*>\/gi/)
    // `\r?\n`, because this repo is CRLF and a literal `\n` anchor matches
    // nothing — six of link 23's 34 mutations failed to apply over exactly this,
    // and the first version of this line did too.
    expect(body.indexOf('.replace(')).toBeLessThan(body.search(/<email_body>\r?\n/))
    expect(body.search(/<email_body>\r?\n/)).toBeGreaterThan(-1)
  })

  it('the triage prompt flattens every value printed ABOVE the fence', () => {
    const body = bodyOf(read('lib/agent/triage.ts'), 'buildTriagePrompt')
    // `From:` and `Subject:` are whatever the sender's client wrote. A newline
    // in either forges a section header in the trusted region.
    expect(body).toMatch(/const from = flattenToOneLine\(/)
    expect(body).toMatch(/const subject = flattenToOneLine\(/)
  })

  it('the draft prompt keeps its own fence and its own flattening', () => {
    const draft = read('lib/agent/draftInquiry.ts')
    expect(draft).toMatch(/\.replace\(\/<\\\/\?their_message>\/gi/)
    expect(draft).toMatch(/flattenToOneLine\(/)
  })

  it('flattening is one implementation, imported by both', () => {
    // Rule 11. It strips bidi and zero-width codepoints as well as line breaks,
    // and a second copy would not.
    const defs = walk(path.join(SRC, 'lib'), n => n.endsWith('.ts'))
      .map(relSrc)
      .filter(f => /export function flattenToOneLine/.test(read(f)))
    expect(defs).toEqual(['lib/agent/extractPlanFields.ts'])
    expect(read('lib/agent/triage.ts')).toMatch(/import \{ flattenToOneLine \}/)
  })
})

/* ── R7 · the inbound edge cannot reach the customer send ────────────────── */

describe('R7 · the module graph still enforces the separation', () => {
  it('the Quo webhook cannot reach sendApproved, even transitively', () => {
    const quo = read('app/api/webhooks/quo/route.ts')
    expect(quo).toMatch(/from '@\/lib\/agent\/reviewers'/)
    expect(quo).not.toMatch(/agent\/reviewLoop|agent\/sendApproved/)
  })

  it('no webhook route imports an Anthropic call site', () => {
    let examined = 0
    for (const rel of WEBHOOK_ROUTES) {
      examined++
      const src = read(rel)
      expect({ rel, ok: !/api\.anthropic\.com|@anthropic-ai/.test(src) }).toEqual({ rel, ok: true })
    }
    expect(examined).toBe(6)
  })
})

/* ── R8 · a body is a real person's words ────────────────────────────────── */

describe('R8 · neither SMS route logs the message body', () => {
  it('the inbound log line prints the keyword and a length, not the text', () => {
    let files = 0
    let statements = 0
    for (const rel of ['app/api/webhooks/quo/route.ts', 'app/api/webhooks/twilio/route.ts']) {
      files++
      // `\r?\n`, and it is not a nicety. The first version of this rule ended
      // `\)\n`, which matches NOTHING in a CRLF repo — so `logs` was empty, the
      // loop never ran, and the rule passed over a `console.log` that printed
      // a real customer's SMS. The attack harness found it because the rule did
      // not COUNT the sites it examined. It counts them now: link 22's R9
      // lesson, reproduced in my own new file at the first opportunity.
      const logs = read(rel).match(/console\.log\([\s\S]{0,400}?\)\r?\n/g) ?? []
      for (const line of logs) {
        statements++
        // `${text}` / `${body}` / `${rawBody}` inside a log is the defect: it is
        // a real person's message, and a newline in it forges a log line.
        expect({ rel, line: line.slice(0, 80), leaks: /\$\{(text|body|rawBody)\}|body="/.test(line) })
          .toEqual({ rel, line: line.slice(0, 80), leaks: false })
      }
    }
    expect(files).toBe(2)
    expect(statements).toBeGreaterThanOrEqual(3)
  })
})

/* ── R9 · every write reads its own result ───────────────────────────────── */

describe('R9 · no write on the inbound surface discards its error', () => {
  it('every supabase write captures a result', () => {
    const offenders: string[] = []
    let examined = 0
    for (const rel of [...SURFACE, ...ROUTES]) {
      const src = read(rel)
      const re = /\.(insert|upsert|update|delete)\s*\(/g
      let m: RegExpExecArray | null
      while ((m = re.exec(src)) !== null) {
        // Walk back to the nearest real statement boundary. NEWLINES ARE NOT
        // ONE — every supabase call in this codebase is a chain spanning several
        // lines, and treating `\n` as a boundary is how link 22's equivalent
        // examined 7 of 23 sites and found its offender by luck.
        const head = src.slice(Math.max(0, m.index - 400), m.index)
        const boundary = Math.max(head.lastIndexOf(';'), head.lastIndexOf('{'), head.lastIndexOf('}'))
        const stmt = head.slice(boundary + 1)
        if (!/supabase|\bsupa\b|\bdb\b/.test(stmt)) continue // crypto.update(), string.replace()
        examined++
        const captured =
          /(const|let)\s*\{[^}]*\berror\b/.test(stmt) ||
          /(const|let)\s+\w+\s*=/.test(stmt) ||
          /return\s+/.test(stmt) ||
          /await\s+[\w.]*\s*$/.test(stmt) === false
        if (!captured) offenders.push(`${rel} :: ${stmt.trim().slice(0, 70)}`)
      }
    }
    // Counting is the only thing that surfaces a rule which has stopped looking.
    expect(examined).toBeGreaterThanOrEqual(12)
    expect(offenders).toEqual([])
  })
})

/* ── R10 · the header is the deliverable ─────────────────────────────────── */

describe('R10 · this file states the substance, not one phrase', () => {
  it('the header records what was measured, so it cannot be tidied away', () => {
    // Link 23's hole 2: a rule that asserts a single sentence lets the
    // surrounding explanation be deleted. Assert the SUBSTANCE — the numbers and
    // the names a later reader needs.
    const header = raw('__tests__/lib/inboundSurface.test.ts').slice(0, 5000)
    for (const fact of [
      'openphone-signature',
      'webhook-timestamp',
      '2026-09-11',
      '38 of',
      'TWILIO_AUTH_TOKEN',
      'sms_opt_in = false',
      'email_body',
      'STOPALL',
    ]) {
      expect({ fact, present: header.includes(fact) }).toEqual({ fact, present: true })
    }
  })

  it('the verifier module records why it exists, in numbers', () => {
    // Link 23's hole 2, and my own repeat of it: the first version asserted
    // four strings that a mutation could leave in place while dissolving the
    // structure around them. Assert the SUBSTANCE — the header that says this
    // is measured, the provider scheme, the dates, the counts, and the two
    // environment variables — so a tidy-up has to delete a fact, not a heading.
    const header = raw('lib/inboundWebhookVerify.ts').slice(0, 5000)
    for (const fact of [
      'WHY THIS FILE EXISTS, MEASURED',
      'openphone-signature',
      '`${timestamp}.${rawBody}`',
      '2026-09-11 12:00 UTC',
      '38 of them',
      'TWILIO_AUTH_TOKEN',
      'sms_opt_in = false',
      'rule 8',
      'ASK THE PROVIDER',
    ]) {
      expect({ fact, present: header.includes(fact) }).toEqual({ fact, present: true })
    }
  })
})
