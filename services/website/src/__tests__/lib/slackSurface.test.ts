/**
 * THE SLACK REVIEWER SURFACE, read off disk (plan §25.9, link 26).
 *
 * Everything that answers *"a reviewer decided something in Slack — was it
 * really them, did we do it, and did we tell them the truth about it"*: the two
 * public routes, the four `lib/slack/*` modules, the delivery seam that chooses
 * a channel, the loop that executes a decision, and the dispatcher branch that
 * is the only path from a Slack button to a customer.
 *
 * ── What this file inherited, and what was wrong with it ─────────────────
 *
 * A version of this file existed with four rules. It was a good four — the
 * module graph walked in BOTH directions is still the best rule here — but it
 * **read the source with comments still in it**, and this surface is the most
 * heavily commented in the repo. `expect(code).toContain('isSlackReviewer(')`
 * is satisfied by a comment that merely mentions the function. That is the
 * tripwire family this project has hit repeatedly: a rule matching the wrong
 * occurrence, passing for a reason that has nothing to do with the code.
 * Everything below runs on `read()`, which blanks comments before any rule sees
 * the text.
 *
 * ── What was live in production when this file was written ───────────────
 *
 * Measured first, before a line changed (2026-09-13):
 *
 *   - **`handleSlackAction`'s draft lookup discarded its error.** A transient
 *     Supabase failure — this project has documented ones — made `data` null,
 *     which the code read as "the draft is gone". The reviewer was told *"I
 *     cannot find that draft any more. Nothing was sent."* about a draft still
 *     sitting in the queue, and because the dispatcher finalises a Slack event
 *     whether or not it was handled, **the button press was consumed and never
 *     retried.** Rules 3, 10, 12 and 19 in one expression.
 *   - **Approving a draft ERASED it from Slack.** `settle()` called
 *     `settledBlocks({ original: [], … })`, and that function keeps everything
 *     that is not an `actions` block — so an empty array meant the message was
 *     replaced by a single line reading "Sent — Adam". The channel is supposed
 *     to be the record of what went to a customer, and approving was the thing
 *     that deleted it. `slackBlocks.test.ts` passed REAL blocks and asserted the
 *     buttons were stripped, so it proved a capability no caller used.
 *   - **The button ack said "Sending HH-2026-0042".** At the moment it was sent
 *     the press was only queued; the dispatcher acts minutes later. In a system
 *     where a cron has silently stopped for a month, two 401 daily, and a
 *     webhook refused every message for 2.5 days, that sentence is a claim about
 *     a customer email that may never be sent, with nothing to correct it.
 *
 * ── What HELD, and is now pinned here so it cannot drift ─────────────────
 *
 *   - The signature scheme is **character-for-character Slack's own**, checked
 *     against docs.slack.dev rather than against our harness. That is the
 *     opposite of link 24's finding, where `/api/webhooks/quo` implemented
 *     Standard Webhooks, Quo signed something else, and the runbook "verified"
 *     it by signing a payload the way the verifier checks it.
 *   - `lib/slack/client.ts` reads `ok` out of the BODY. Slack fails with HTTP
 *     200 and puts the error in the JSON, so a client keyed on `res.ok` is blind
 *     to `not_in_channel`, `channel_not_found`, `invalid_auth` and
 *     `missing_scope`.
 *   - The SMS ping sends on every Slack failure path. A lead is never lost to
 *     Slack having a bad afternoon.
 *
 * ── Shape ────────────────────────────────────────────────────────────────
 *
 * Follows `inboundSurface` / `planMoneySurface` / `agentSurface` /
 * `publicIntakeSurface`: comments STRIPPED before any rule runs; bodies sliced
 * to the NEXT declaration rather than by a fixed width (link 20's 400-byte
 * window spilled into the next branch and link 22's 200-byte "fix" reproduced
 * it one size down); every anchor tolerates CRLF because this repo is
 * `core.autocrlf=true` (six of link 23's 34 mutations silently failed to apply
 * over exactly that); and **every rule states how many sites it examined**,
 * because link 22's R9 examined 7 of 23 writes and found its offender by luck.
 *
 * No `.skip` here: `publicIntakeSurface`'s R10 walks every `*Surface.test.ts` in
 * this directory and fails on `.skip` / `xit` / `.todo`, and this file matches
 * that glob (rule 11 — the concept has one owner).
 */

import fs from 'fs'
import path from 'path'

const SRC = path.join(__dirname, '..', '..')
const REPO = path.join(SRC, '..', '..', '..')

/**
 * Blank out comments while preserving offsets and line structure.
 *
 * ONE left-to-right pass, and that is the whole point.
 *
 * The version of this helper copied across the other `*Surface` tripwires runs
 * two passes, block comments FIRST:
 *
 *     .replace(/\/\*[\s\S]*?\*\/​/g, …)      // then
 *     .replace(/(^|[^:'"`\\])\/\/[^\n\r]*​/g, …)
 *
 * which corrupts any file where a LINE comment contains `/*`. This surface has
 * one — `app/api/slack/interactions/route.ts` opens with
 * `// lib/slack/*, and NOTHING from lib/agent/reviewLoop or …` — and the `/*`
 * inside `lib/slack/*` opened a block-comment match that ran to the next `*​/`
 * further down the file, blanking THREE `import` statements on the way.
 *
 * The module-graph rule then walked a file it believed imported nothing from
 * `lib/slack/*` at all, and "this route cannot reach sendApproved" passed
 * because the walker could no longer see what the route imported. A rule that
 * passes because its instrument went blind is the failure this whole family of
 * tests exists to prevent — and it is rule 8 pointed at the tooling: every
 * link's tripwire had holes its own harness found.
 *
 * A single alternation fixes it, because the regex engine takes the LEFTMOST
 * match: the `//` at the start of that line begins before the `/*` inside it,
 * so the line-comment branch wins and consumes to end of line.
 */
function decomment(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\/|(^|[^:'"`\\])\/\/[^\n\r]*/g, (m, p) => {
    const keep = p ?? ''
    return keep + m.slice(keep.length).replace(/[^\n\r]/g, ' ')
  })
}

/** Source with comments blanked. EVERY rule below reads through this. */
const read = (rel: string) => decomment(fs.readFileSync(path.join(SRC, rel), 'utf8'))
/** Source as it really is on disk — only for rules ABOUT comments or docs. */
const raw = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8')

/**
 * Decommented source with every run of whitespace collapsed to one space.
 *
 * `decomment` deliberately PRESERVES OFFSETS — it blanks a comment rather than
 * removing it — which is right for anything comparing positions and a trap for
 * anything measuring distance: on this surface one explanatory comment is 400
 * characters of spaces, so a proximity rule would fail over correct code.
 * Proximity rules read `squash`.
 */
const squash = (rel: string) => read(rel).replace(/\s+/g, ' ')

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

/**
 * A declaration's body, sliced to the NEXT top-level declaration.
 *
 * A construct, never a fixed window.
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

/**
 * The request handler, from `export async function POST` down.
 *
 * Ordering rules are about what the REQUEST does, so they are measured inside
 * the handler. Helpers defined above it — the interactions route's
 * `payloadFromForm` — contain a `JSON.parse` that is textually earlier and only
 * ever *called* after verification. Asserting on the whole file would fail on a
 * parser's definition while missing a parser invoked in the wrong place.
 */
function handlerBody(rel: string): string {
  const code = read(rel)
  const at = code.indexOf('export async function POST')
  expect(at).toBeGreaterThan(-1)
  return code.slice(at)
}

/* ── R0 · the walker ─────────────────────────────────────────────────────── */

/** The `lib/slack/*` modules. EXACT: a new one must be classified by a human. */
const SLACK_LIB = [
  'lib/slack/signature.ts', // is this really Slack, and is this really a reviewer
  'lib/slack/client.ts', // the Web API, fail-soft, ok-in-the-body
  'lib/slack/blocks.ts', // what a reviewer sees, escaped at entry
  'lib/slack/actor.ts', // which PERSON pressed the button
].sort()

/** The two public routes the app manifest points at. */
const SLACK_ROUTES = ['app/api/slack/interactions/route.ts', 'app/api/slack/events/route.ts'].sort()

/** The agent-side modules that are part of this surface. */
const SLACK_AGENT = ['lib/agent/notifyReviewers.ts', 'lib/agent/slackLoop.ts'].sort()

/** The one route that may turn a Slack decision into a customer message. */
const DISPATCHER = 'app/api/cron/agent-dispatch/route.ts'

const SURFACE = [...SLACK_LIB, ...SLACK_ROUTES, ...SLACK_AGENT, DISPATCHER]

describe('R0 · the surface is walked, and every file in it is accounted for', () => {
  it('every named module and route exists on disk and is readable', () => {
    for (const f of SURFACE) {
      expect({ f, exists: fs.existsSync(path.join(SRC, f)) }).toEqual({ f, exists: true })
      expect(read(f).length).toBeGreaterThan(0)
    }
    expect(SLACK_LIB.length).toBe(4)
    expect(SLACK_ROUTES.length).toBe(2)
    expect(SLACK_AGENT.length).toBe(2)
    expect(SURFACE.length).toBe(9)
  })

  it('no file under lib/slack/ or app/api/slack/ is unknown to this file', () => {
    // The other direction. A fifth lib/slack module, or a third route, must be
    // classified — not silently exempt from every rule below.
    const libFiles = walk(path.join(SRC, 'lib', 'slack'), n => n.endsWith('.ts')).map(relSrc)
    const routeFiles = walk(path.join(SRC, 'app', 'api', 'slack'), n => n === 'route.ts').map(relSrc)
    expect(libFiles.sort()).toEqual(SLACK_LIB)
    expect(routeFiles.sort()).toEqual(SLACK_ROUTES)
  })

  it('the app manifest points at exactly the two routes that exist', () => {
    const manifest = fs.readFileSync(path.join(REPO, 'docs', 'slack-app-manifest.yml'), 'utf8')
    // A manifest URL with no route file is a 404 that reads as "Slack is broken".
    const urls = [...manifest.matchAll(/request_url:\s*(\S+)/g)].map(m => m[1])
    expect(urls.length).toBeGreaterThanOrEqual(1)
    for (const u of urls) {
      const p = new URL(u).pathname.replace(/^\//, '')
      expect({ u, hasRoute: fs.existsSync(path.join(SRC, 'app', p, 'route.ts')) }).toEqual({ u, hasRoute: true })
    }
  })
})

/* ── R1 · the raw body, before anything touches it ───────────────────────── */

describe('R1 · the raw body is read before anything parses it', () => {
  it.each(SLACK_ROUTES)('%s calls req.text() before any parse', rel => {
    const code = handlerBody(rel)
    const textAt = code.indexOf('await req.text()')
    expect(textAt).toBeGreaterThan(-1)

    // Both of these consume the stream, so their presence AT ALL means the raw
    // bytes are gone by the time the hash is computed.
    for (const parser of ['req.json()', 'req.formData()']) {
      expect({ rel, parser, present: read(rel).includes(parser) }).toEqual({ rel, parser, present: false })
    }

    const parseAt = code.search(/payloadFromForm\(|JSON\.parse\(/)
    if (parseAt > -1) expect(parseAt).toBeGreaterThan(textAt)
  })

  it.each(SLACK_ROUTES)('%s verifies before it parses, and anything but ok is a rejection', rel => {
    const code = handlerBody(rel)
    const verifyAt = code.indexOf('verifySlackRequest(')
    expect(verifyAt).toBeGreaterThan(-1)

    // `!== 'ok'` catches 'unconfigured' along with everything else. Written as
    // `=== 'bad_signature'` it would let an unset secret through — the exact
    // SignWell failure: a verifier that silently passes when it has no key.
    expect(code).toMatch(/verdict\s*!==\s*'ok'/)
    expect(code).toMatch(/status:\s*401/)

    const parseAt = code.search(/payloadFromForm\(|JSON\.parse\(/)
    if (parseAt > -1) expect(parseAt).toBeGreaterThan(verifyAt)
  })

  it('the url_verification handshake gets NO exemption from the signature check', () => {
    // The ordering trap in docs/slack-app-setup.md §0 exists precisely BECAUSE
    // there is no exemption. If somebody "fixes" setup friction by answering the
    // challenge before verifying, this surface acquires an unauthenticated echo
    // endpoint and the setup doc becomes a lie.
    const code = handlerBody('app/api/slack/events/route.ts')
    const verifyAt = code.indexOf('verifySlackRequest(')
    const challengeAt = code.indexOf('url_verification')
    expect(verifyAt).toBeGreaterThan(-1)
    expect(challengeAt).toBeGreaterThan(-1)
    expect(challengeAt).toBeGreaterThan(verifyAt)
  })
})

/* ── R2 · the signature scheme is SLACK'S, not ours ──────────────────────── */

describe('R2 · the signature scheme matches Slack’s published spec exactly', () => {
  const sig = read('lib/slack/signature.ts')

  it('hashes v0:{timestamp}:{body} — the documented base string', () => {
    // docs.slack.dev: "Concatenate the version number, the timestamp, and the
    // request body together, using a colon as a delimiter."
    expect(sig).toMatch(/`v0:\$\{timestamp\}:\$\{rawBody\}`/)
  })

  it('uses HMAC-SHA256, hex, prefixed v0=', () => {
    expect(sig).toMatch(/createHmac\(\s*'sha256'/)
    expect(sig).toMatch(/digest\('hex'\)/)
    expect(sig).toMatch(/'v0='\s*\+/)
  })

  it('reads the two documented headers, and only those', () => {
    let examined = 0
    for (const rel of SLACK_ROUTES) {
      const code = read(rel)
      expect(code).toContain("req.headers.get('x-slack-signature')")
      expect(code).toContain("req.headers.get('x-slack-request-timestamp')")
      examined++
    }
    expect(examined).toBe(2)
  })

  it('bounds replay in BOTH directions, at the documented five minutes', () => {
    // Slack's own example is `abs(time.time() - timestamp) > 60 * 5`. One
    // direction only would leave a future-dated request valid indefinitely.
    expect(sig).toMatch(/SLACK_MAX_SKEW_SECONDS\s*=\s*60\s*\*\s*5/)
    expect(squash('lib/slack/signature.ts')).toMatch(/Math\.abs\(\s*nowSec\s*-\s*ts\s*\)\s*>\s*SLACK_MAX_SKEW_SECONDS/)
  })

  it('compares in constant time, after a length check', () => {
    // timingSafeEqual THROWS on a length mismatch, so the length check is not
    // an optimisation — without it a short signature is an exception, and the
    // catch below would turn every one of them into the same answer.
    const body = bodyOf(sig, 'verifySlackRequest')
    expect(body).toContain('timingSafeEqual')
    const lenAt = body.indexOf('a.length !== b.length')
    const cmpAt = body.indexOf('timingSafeEqual')
    expect(lenAt).toBeGreaterThan(-1)
    expect(lenAt).toBeLessThan(cmpAt)
  })

  it('fails closed: an unset secret is a verdict, not a skip', () => {
    const body = bodyOf(sig, 'verifySlackRequest')
    expect(body).toMatch(/if\s*\(\s*!secret\s*\)\s*return\s*'unconfigured'/)
    // And it is the FIRST thing decided, before any header is trusted.
    expect(body.indexOf("'unconfigured'")).toBeLessThan(body.indexOf("'missing_headers'"))
  })

  it('an empty reviewer allowlist authorises NOBODY', () => {
    const body = bodyOf(sig, 'isSlackReviewer')
    expect(body).toMatch(/ids\.length\s*===\s*0\s*\)?\s*return\s+false/)
  })
})

/* ── R3 · the module graph, walked in both directions ────────────────────── */

function resolveImport(fromRel: string, spec: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2))
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(path.join(SRC, fromRel)), spec)
  else return null

  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return path.relative(SRC, candidate).split(path.sep).join('/')
    }
  }
  return null
}

function importsOf(rel: string): string[] {
  const code = read(rel)
  const specs: string[] = []
  const re = /(?:^|\n)\s*import\s[^'"]*from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code))) specs.push(m[1] || m[2])
  return specs
}

function reachableFrom(entry: string): Set<string> {
  const seen = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const rel = queue.shift() as string
    if (seen.has(rel)) continue
    seen.add(rel)
    for (const spec of importsOf(rel)) {
      const next = resolveImport(rel, spec)
      if (next && !seen.has(next)) queue.push(next)
    }
  }
  seen.delete(entry)
  return seen
}

describe('R3 · /api/slack/* cannot reach the customer-send path', () => {
  const FORBIDDEN = ['lib/agent/sendApproved.ts', 'lib/agent/reviewLoop.ts', 'lib/agent/slackLoop.ts']

  it.each(SLACK_ROUTES)('%s does not import the send path, even transitively', rel => {
    const reachable = reachableFrom(rel)
    // Named, not counted: a failure should say WHICH import opened the door.
    expect(FORBIDDEN.filter(f => reachable.has(f))).toEqual([])
    // The walk must be non-trivial, or "reaches nothing" passes this vacuously.
    expect(reachable.size).toBeGreaterThan(3)
  })

  it('the walker actually walks — the dispatcher DOES reach sendApproved AND slackLoop', () => {
    // Without this, a resolver silently returning null for everything would make
    // the assertion above pass for the wrong reason. A guardrail test that
    // cannot fail is not a guardrail.
    const reachable = reachableFrom(DISPATCHER)
    expect(reachable.has('lib/agent/sendApproved.ts')).toBe(true)
    expect(reachable.has('lib/agent/slackLoop.ts')).toBe(true)
  })

  it('and slackLoop is the thing that reaches the send, not the routes', () => {
    const reachable = reachableFrom('lib/agent/slackLoop.ts')
    expect(reachable.has('lib/agent/sendApproved.ts')).toBe(true)
  })

  it('the Quo webhook still does not reach it either', () => {
    const reachable = reachableFrom('app/api/webhooks/quo/route.ts')
    expect(reachable.has('lib/agent/sendApproved.ts')).toBe(false)
    expect(reachable.has('lib/agent/reviewLoop.ts')).toBe(false)
  })

  it('the notify seam announces drafts and never sends one', () => {
    // notifyReviewers is imported BY draftInquiry, so a send path reachable from
    // it would be reachable from the draft node — a model-written message
    // reaching a customer with no approval at all.
    const reachable = reachableFrom('lib/agent/notifyReviewers.ts')
    expect(reachable.has('lib/agent/sendApproved.ts')).toBe(false)
  })

  it('no lib/slack/* module reaches the send path', () => {
    let examined = 0
    for (const rel of SLACK_LIB) {
      const reachable = reachableFrom(rel)
      expect({ rel, sends: reachable.has('lib/agent/sendApproved.ts') }).toEqual({ rel, sends: false })
      examined++
    }
    expect(examined).toBe(4)
  })
})

/* ── R4 · Slack fails with HTTP 200 ──────────────────────────────────────── */

describe('R4 · every Slack API call reads `ok` out of the BODY, not the status', () => {
  const client = read('lib/slack/client.ts')

  it('every fetch to slack.com is followed by an ok-in-the-body check', () => {
    // The trap this module exists to close: HTTP 200 with
    // {"ok":false,"error":"not_in_channel"}. A client keyed on res.ok marks the
    // draft posted, skips the SMS fallback, and loses the lead with a 200 in the
    // log. Counted, because "the module contains one such check" would pass
    // while a second, unchecked call site sat next to it.
    const apiCalls = client.match(/API_BASE/g) ?? []
    const bodyChecks = client.match(/\.ok\s*!==\s*true/g) ?? []
    expect(apiCalls.length).toBeGreaterThanOrEqual(2)
    // One body check per function that talks to the API directly: `call()` and
    // `getPermalink()`. `respondToInteraction` posts to a response_url, which is
    // not the Web API and answers plain text.
    expect(bodyChecks.length).toBeGreaterThanOrEqual(2)
  })

  it('names the Slack error rather than swallowing it, at EVERY call site', () => {
    // 'not_in_channel' is a one-line fix (/invite the bot); an unnamed failure
    // is an afternoon. Both halves of rule 19.
    //
    // COUNTED. `toMatch(/json\??\.error/)` passed while one of the two sites had
    // its error replaced with a fixed string, because the other one still
    // matched — link 22's R9 exactly, which examined 7 of 23 writes and found
    // its offender by luck.
    const named = client.match(/json\??\.error/g) ?? []
    expect(named.length).toBeGreaterThanOrEqual(2)
  })

  it('bounds every call with a timeout', () => {
    const fetches = client.match(/fetch\(/g) ?? []
    const timeouts = client.match(/AbortSignal\.timeout\(/g) ?? []
    expect(fetches.length).toBeGreaterThan(0)
    expect(timeouts.length).toBe(fetches.length)
  })

  it('never lets an error escape to a caller', () => {
    // A throw here would break notifyReviewers' promise that the SMS still
    // sends, which is the §18 rule and the reason a lead is not lost.
    expect(client).not.toMatch(/^\s*throw /m)
  })

  it('refuses to POST to a response_url that is not Slack’s', () => {
    // A URL out of a request body, posted to without screening, is how an SSRF
    // starts — even one inside a verified payload.
    expect(bodyOf(client, 'respondToInteraction')).toMatch(/hooks\\?\.slack\\?\.com/)
  })

  it('does not unfurl our own links into the channel', () => {
    // A review URL is a bearer token. Unfurling pastes a preview of the review
    // PAGE into #hh-leads as an image.
    expect(client).toContain('unfurl_links: false')
    expect(client).toContain('unfurl_media: false')
  })

  it('checks the channel is configured before claiming to post', () => {
    expect(bodyOf(client, 'postMessage')).toMatch(/if\s*\(\s*!channel\s*\)/)
  })

  it('an ok:true with no ts is still a failure', () => {
    // Returning a result with an empty ts would store an empty thread key, and
    // every later reply would fail to find the lead.
    expect(bodyOf(client, 'postMessage')).toMatch(/if\s*\(\s*!ts\s*\)/)
  })
})

/* ── R5 · identity: one implementation, on the verified id ───────────────── */

describe('R5 · "is this a reviewer" has exactly one implementation, gated on the verified id', () => {
  it('only lib/slack/signature.ts defines it', () => {
    // Rule 11. "Is this delivery genuine" was answered differently by two SMS
    // webhooks and not at all by a third; the STOP keyword set was an inline
    // literal in both. A third reviewer channel must not add a third answer.
    let examined = 0
    const definers = walk(SRC, n => n.endsWith('.ts') || n.endsWith('.tsx'))
      .map(relSrc)
      .filter(f => !f.startsWith('__tests__/'))
      .filter(f => {
        examined++
        return /function\s+isSlackReviewer\b/.test(read(f))
      })
    expect(definers).toEqual(['lib/slack/signature.ts'])
    expect(examined).toBeGreaterThan(100)
  })

  it('both routes AND the loop gate on it', () => {
    // Twice on purpose: by the time the dispatcher reads the row, the only
    // evidence of who pressed the button is a string in a table — and the admin
    // surface can write `ingested_messages`.
    let examined = 0
    for (const rel of [...SLACK_ROUTES, 'lib/agent/slackLoop.ts']) {
      expect({ rel, gated: read(rel).includes('isSlackReviewer(') }).toEqual({ rel, gated: true })
      examined++
    }
    expect(examined).toBe(3)
  })

  it('the loop gates BEFORE it looks anything up', () => {
    const body = bodyOf(read('lib/agent/slackLoop.ts'), 'handleSlackAction')
    const gateAt = body.indexOf('isSlackReviewer(')
    const queryAt = body.indexOf(".from('inquiry_drafts')")
    expect(gateAt).toBeGreaterThan(-1)
    expect(queryAt).toBeGreaterThan(-1)
    expect(gateAt).toBeLessThan(queryAt)
  })

  it('no route hand-rolls its own HMAC', () => {
    let examined = 0
    for (const rel of SLACK_ROUTES) {
      expect({ rel, rolls: read(rel).includes('createHmac') }).toEqual({ rel, rolls: false })
      examined++
    }
    expect(examined).toBe(2)
  })

  it('identity is never taken from message text', () => {
    // §4.2: identity by channel-verified sender, never by content. The id comes
    // from payload.user.id / event.user, both of which Slack's signature covers.
    const code = read('app/api/slack/interactions/route.ts')
    expect(code).toMatch(/payload\.user/)
    // Nothing parses a user id out of the body text.
    expect(code).not.toMatch(/\.body\s*\.\s*match\(/)
  })
})

/* ── R6 · a Slack id may NAME an admin, never CREATE one ─────────────────── */

describe('R6 · a Slack user id can only ever name an admin, never mint one', () => {
  const actor = read('lib/slack/actor.ts')

  it('the unmapped fallback is a specific person, not the anonymous ADMIN', () => {
    // Ten sessions have had to remove a literal 'ADMIN' actor. Falling back to
    // it here would throw away the one thing this phase was built to capture.
    expect(actor).toMatch(/`SLACK:\$\{slackUserId\}`/)
    expect(actor).not.toMatch(/id:\s*'ADMIN'/)
  })

  it('no module on this surface writes a literal ADMIN actor', () => {
    let examined = 0
    for (const rel of SURFACE) {
      const code = read(rel)
      expect({ rel, literal: /actor:\s*'(ADMIN|admin)'/.test(code) }).toEqual({ rel, literal: false })
      examined++
    }
    expect(examined).toBe(9)
  })

  it('isAdmin:true appears only in the actor module, which the allowlist licenses', () => {
    // The gated edges in lib/marketing/graph.ts require actor.isAdmin. If a
    // second module on this surface could assert it, the allowlist would stop
    // being the only thing that grants authority.
    let examined = 0
    const asserters = SURFACE.filter(rel => {
      examined++
      return /isAdmin:\s*true/.test(read(rel))
    })
    expect(asserters).toEqual(['lib/slack/actor.ts'])
    expect(examined).toBe(9)
  })

  it('does not add a gated edge, and does not widen one', () => {
    // The gate lives in ONE table in lib/marketing/graph.ts. Slack goes THROUGH
    // `advance`; it does not get a door of its own.
    //
    // Measured rather than assumed: the chain's notes say "six gated edges",
    // and the table actually declares EIGHT gated (entity, status) pairs across
    // five entity types. Pinning the real shape, because a rule asserting a
    // remembered number fails on correct code and gets deleted.
    const graph = read('lib/marketing/graph.ts')
    const sets = [...graph.matchAll(/^\s*(\w+):\s*new Set\(\[([^\]]*)\]\)/gm)]
    const pairs = sets.flatMap(m =>
      [...m[2].matchAll(/'([^']+)'/g)].map(s => `${m[1]}.${s[1]}`),
    )
    expect(pairs.sort()).toEqual(
      [
        'content_experiment.active',
        'inquiry_draft.approved',
        'inquiry_draft.sent',
        'marketing_task.approved',
        'social_post.approved',
        'social_post.published',
        'website_content.approved',
        'website_content.published',
      ].sort(),
    )
    // The two that matter here, named separately so widening THEM is loud.
    expect(pairs.filter(p => p.startsWith('inquiry_draft.')).sort()).toEqual([
      'inquiry_draft.approved',
      'inquiry_draft.sent',
    ])
  })

  it('no module on this surface declares a gate of its own', () => {
    let examined = 0
    for (const rel of SURFACE) {
      const code = read(rel)
      expect({ rel, ownGate: /\bGATED\b\s*[:=]|isGatedTransition\s*\(/.test(code) }).toEqual({ rel, ownGate: false })
      examined++
    }
    expect(examined).toBe(9)
  })

  it('every state change goes through advance(), never a bare status update', () => {
    const loop = read('lib/agent/slackLoop.ts')
    expect(loop).toContain('advance(')
    // No direct write of a draft status anywhere on the Slack path.
    expect(loop).not.toMatch(/update\(\s*\{[^}]*status:\s*'(approved|sent)'/)
  })
})

/* ── R7 · rule 12 — three outcomes wherever a lookup can fail ────────────── */

describe('R7 · a lookup that can fail has three outcomes, not two', () => {
  it('handleSlackAction distinguishes "gone" from "could not ask"', () => {
    // THE HEADLINE DEFECT. `const { data } = …` with no `error` made a transient
    // Supabase failure indistinguishable from a deleted draft, so the reviewer
    // was told "I cannot find that draft any more. Nothing was sent." about a
    // draft that was still there — and the dispatcher then finalised the event,
    // discarding the button press for good.
    const body = bodyOf(read('lib/agent/slackLoop.ts'), 'handleSlackAction')
    // THE DESTRUCTURE ITSELF. Checking only for `if (lookupError)` passed when
    // the error was put back to being discarded and a `const lookupError = null`
    // was introduced to keep the branches compiling — the guard was intact and
    // guarding a constant. Rule 8 pointed at a patch of my own.
    expect(body).toMatch(/const\s*\{\s*data,\s*error:\s*lookupError\s*\}\s*=\s*await/)
    expect(body).not.toMatch(/const\s+lookupError\s*=\s*null/)
    expect(body).toMatch(/if\s*\(\s*lookupError\s*\)/)
    expect(body).toMatch(/lookupError\.message/)
    // And the two branches produce DIFFERENT outcomes.
    expect(body).toContain("'lookup_failed'")
    expect(body).toContain("'no_draft'")
  })

  it('the transient branch is marked retryable and the terminal branch is not', () => {
    const body = bodyOf(read('lib/agent/slackLoop.ts'), 'handleSlackAction')
    const squashed = body.replace(/\s+/g, ' ')
    expect(squashed).toMatch(/outcome: 'lookup_failed', retryable: true/)
    // "The draft is genuinely gone" must NOT be retried forever.
    expect(squashed).not.toMatch(/outcome: 'no_draft', retryable: true/)
  })

  it('the dispatcher honours retryable instead of finalising', () => {
    // Rule 3: "could not decide" is not "decided no". Without this the flag
    // above would be a field nothing reads — which is how a guardrail becomes a
    // comment.
    const code = read(DISPATCHER)
    const at = code.indexOf("event.source === 'slack'")
    expect(at).toBeGreaterThan(-1)
    const branch = code.slice(at, at + 1800).replace(/\s+/g, ' ')
    expect(branch).toMatch(/action\.retryable/)
    expect(branch).toMatch(/requeueEvent\(/)
    // THE COMPARISON, not the identifiers. Both `attemptsOf` and
    // `MAX_DRAFT_ATTEMPTS` still appear in the error string that reads
    // "(attempt 2/3)", so a rule that only looked for the names passed over an
    // `if (true)` — an unbounded retry loop on an event that will never
    // succeed, described by a message claiming it was bounded. Rule 10 applied
    // to a log line, found by the harness.
    expect(branch).toMatch(/const attempts = attemptsOf\(event\) \+ 1/)
    expect(branch).toMatch(/if \(attempts < MAX_DRAFT_ATTEMPTS\)/)
  })

  it('the events route re-queues a lookup failure instead of dropping it', () => {
    // A non-2xx makes Slack redeliver. Answering 200 over a failed lookup would
    // silently lose a reviewer's instruction.
    const body = handlerBody('app/api/slack/events/route.ts').replace(/\s+/g, ' ')
    // Not `[^}]*`: the 503 sits inside `NextResponse.json({…}, { status: 503 })`
    // so there is a closing brace between the guard and the status. A bounded
    // character window is right here because the text is SQUASHED — the comment
    // that would otherwise inflate the gap is already gone.
    expect(body).toMatch(/if \(error\) \{[\s\S]{0,200}?status: 503/)
  })

  it('the thread lookup names its failure even though it cannot return it', () => {
    const body = bodyOf(read('lib/agent/notifyReviewers.ts'), 'slackThreadFor')
    expect(body).toMatch(/if\s*\(\s*error\s*\)/)
    expect(body).not.toMatch(/if\s*\(\s*error\s*\|\|\s*!data\s*\)/)
  })
})

/* ── R8 · rule 19 — an error you do not read did not happen ──────────────── */

describe('R8 · every write on this surface reads its error', () => {
  it('no supabase write on the surface discards its error', () => {
    // An UPDATE with no `.select()` also cannot tell you it matched zero rows,
    // which is the other half of rule 19.
    let examined = 0
    const offenders: string[] = []
    for (const rel of SURFACE) {
      const s = squash(rel)
      // Every `.from('x').update(` / `.insert(` occurrence must have an `error`
      // destructured on the same statement.
      const writes = [...s.matchAll(/(const\s*\{[^}]*\}\s*=\s*)?await\s+[\w.]*supabase\s*\.from\([^)]*\)\s*\.(update|insert|upsert)\(/g)]
      for (const m of writes) {
        examined++
        const prefix = m[1] ?? ''
        if (!/\berror\b/.test(prefix)) offenders.push(`${rel}: ${m[0].slice(0, 70)}`)
      }
    }
    expect(offenders).toEqual([])
    expect(examined).toBeGreaterThanOrEqual(1)
  })

  it('the settle path reports a failed chat.update', () => {
    // A failed update leaves a LIVE Approve button under a draft that has
    // already gone to the customer.
    const body = bodyOf(read('lib/agent/slackLoop.ts'), 'settle')
    expect(body).toMatch(/const\s+ok\s*=\s*await\s+updateMessage\(/)
    expect(body).toMatch(/if\s*\(\s*!ok\s*\)/)
  })

  it('the enqueue path says when nothing was recorded', () => {
    // recordInboundEvent returns null for a refused insert, and a button that
    // silently did nothing is the reminder-engine failure exactly.
    const code = read('app/api/slack/interactions/route.ts')
    expect(bodyOf(code, 'enqueue')).toMatch(/return\s+!!id/)
    expect(code.replace(/\s+/g, ' ')).toMatch(/queued\s*\?/)
  })
})

/* ── R9 · rule 10 — say what happened, and only what happened ────────────── */

describe('R9 · no message claims a transition that has not happened', () => {
  it('the button ack does not say "Sending" — the press is only QUEUED', () => {
    // THE SIGNATURE FAILURE OF THIS PROJECT. A nudge SMS said "Reply SEND,
    // CANCEL…" while every reply was refused at the door; `?limit=1` answered
    // {"scanned":1,"sent":0} to an operator draining a backlog, having drained
    // nobody. At the instant this text is produced, the route has written a row
    // and nothing else.
    const body = bodyOf(read('app/api/slack/interactions/route.ts'), 'ackText')
    expect(body).toMatch(/Queued/)
    expect(body).not.toMatch(/return\s+`Sending \$\{code\}/)
    expect(body).not.toMatch(/return\s+`Sent /)
  })

  it('the ack says what SILENCE means', () => {
    // Rule 10's second half, and the one this project keeps paying for: a
    // reviewer cannot tell "it worked" from "the cron is dead" unless told.
    const body = bodyOf(read('app/api/slack/interactions/route.ts'), 'ackText')
    expect(body).toMatch(/did NOT happen|did not happen/)
  })

  it('the events route does not claim the re-draft has started', () => {
    const body = handlerBody('app/api/slack/events/route.ts').replace(/\s+/g, ' ')
    expect(body).not.toMatch(/text: `Re-drafting \$\{draft\.review_code\} with that\./)
    expect(body).toMatch(/queued a re-draft/)
  })

  it('every reviewer-facing refusal states that nothing reached the customer', () => {
    // The one fact a reviewer needs when something goes wrong. Counted across
    // both routes and the loop.
    let examined = 0
    let stating = 0
    for (const rel of [...SLACK_ROUTES, 'lib/agent/slackLoop.ts']) {
      examined++
      if (/[Nn]othing (has gone|was sent|goes) to the customer|customer still (gets|has) nothing/.test(read(rel))) stating++
    }
    expect(examined).toBe(3)
    expect(stating).toBe(3)
  })

  it('EVERY settled message reports who decided it', () => {
    // Counted, not spot-checked: the first version of this rule matched one
    // `settle(…, actor.label)` and passed while a different call site had been
    // changed to the literal "someone" — which is the anonymous 'ADMIN' problem
    // reappearing in the channel rather than the ledger.
    const loop = squash('lib/agent/slackLoop.ts')
    const calls = [...loop.matchAll(/await settle\(meta,(.*?)\)\s*(?:;|$|await|return|})/g)]
    const sites = [...loop.matchAll(/await settle\(/g)]
    expect(sites.length).toBeGreaterThanOrEqual(2)
    const named = loop.match(/actor\.label\)/g) ?? []
    // One `actor.label` per settle call site, at least.
    expect(named.length).toBeGreaterThanOrEqual(sites.length)
    void calls
  })
})

/* ── R10 · approving must not erase the lead ─────────────────────────────── */

describe('R10 · settling a draft strikes the buttons off and keeps everything else', () => {
  it('settle passes the ORIGINAL blocks, not an empty array', () => {
    // `settledBlocks` keeps every block that is not an `actions` block, so
    // `original: []` replaced the whole lead — customer, date, guests, the
    // drafted email — with one line reading "Sent — Adam". Slack is meant to be
    // the record of what went to a customer; approving cannot be what deletes it.
    const body = bodyOf(read('lib/agent/slackLoop.ts'), 'settle')
    expect(body).toMatch(/settledBlocks\(\{\s*original\s*,/)
    expect(body).not.toMatch(/settledBlocks\(\{\s*original:\s*\[\]/)
  })

  it('the blocks reach it from the interaction payload', () => {
    // The route is the only place they exist. If it stops carrying them, the
    // rule above still passes while `original` is always empty — so the SOURCE
    // is pinned too.
    const code = read('app/api/slack/interactions/route.ts')
    expect(code).toMatch(/message\.blocks/)
    expect(code).toMatch(/slack_message_blocks/)
    expect(read('lib/agent/slackLoop.ts')).toMatch(/slack_message_blocks/)
  })

  it('the stored copy is bounded', () => {
    // `parsed` is jsonb on the table that holds every inbound message. An
    // unbounded copy of a Slack message on every press is how a row becomes an
    // outage — and a TRUNCATED block array would make chat.update fail with
    // invalid_blocks, which the fail-soft client reports as "Slack was down".
    const code = read('app/api/slack/interactions/route.ts')
    const body = bodyOf(code, 'blocksWithinLimit')
    expect(body).toMatch(/MAX_STORED_BLOCKS_BYTES/)
    expect(body).toMatch(/return null/)
    // AND IT IS CALLED. Asserting only that the bounding function exists let a
    // mutation store the raw payload straight into `parsed` while the limiter
    // sat unused two lines away — a guardrail nothing invokes is a comment.
    expect(code).toMatch(/slack_message_blocks:\s*blocksWithinLimit\(/)
  })

  it('settledBlocks drops actions blocks and nothing else', () => {
    const body = bodyOf(read('lib/slack/blocks.ts'), 'settledBlocks')
    expect(body).toMatch(/type\s*!==\s*'actions'/)
  })
})

/* ── R11 · the fallback is unconditional ─────────────────────────────────── */

describe('R11 · Slack failing never costs us the lead', () => {
  const notify = read('lib/agent/notifyReviewers.ts')

  it('every branch of notifyReviewers reaches notifyOwnerSms', () => {
    // §18: a real lead sat unanswered because a draft was parked and nothing
    // texted anybody, and Adam found out by noticing the ABSENCE of a text.
    // Counted: the sms branch, the unconfigured branch, the 'both' branch, the
    // ping branch and the fallback branch.
    const body = bodyOf(notify, 'notifyReviewers')
    const sends = body.match(/await notifyOwnerSms\(/g) ?? []
    expect(sends.length).toBeGreaterThanOrEqual(5)
  })

  it('an unrecognised REVIEWER_CHANNEL reads as sms, the channel known to work', () => {
    const body = bodyOf(notify, 'reviewerChannel')
    expect(body).toMatch(/return\s*'sms'/)
    expect(body).toMatch(/'slack'\s*\|\|\s*v\s*===\s*'both'/)
  })

  it('a Slack post failure is RECORDED, not swallowed', () => {
    // Silence is what success looks like. Every degrade appends a warning and
    // the set of them is logged.
    // COUNTED. A single `toMatch(/warnings.push\(/)` passed while the Slack-post
    // failure specifically had stopped being recorded, because four other
    // warnings still matched. The whole point of the warnings array is that a
    // DEGRADE is visible, and silence is what success looks like.
    const body = bodyOf(notify, 'notifyReviewers')
    const pushes = body.match(/warnings\.push\(/g) ?? []
    expect(pushes.length).toBeGreaterThanOrEqual(5)
    // The post failure is named specifically, since it is the one that decides
    // whether the ping carries a Slack link or the /review/ fallback.
    expect(body).toMatch(/warnings\.push\('Slack post failed'\)/)
    expect(body).toMatch(/console\.(warn|error)\(/)
  })

  it('the result reports what actually happened, not what was attempted', () => {
    expect(notify).toMatch(/reviewersTexted/)
    expect(notify).toMatch(/smsLink/)
  })

  it('an unconfigured Slack takes the SMS path without a doomed round trip', () => {
    const body = bodyOf(notify, 'notifyReviewers')
    const cfgAt = body.indexOf('slackConfigured()')
    const postAt = body.indexOf('postMessage(')
    expect(cfgAt).toBeGreaterThan(-1)
    expect(cfgAt).toBeLessThan(postAt)
  })

  it('the thread key is persisted only for the ROOT message', () => {
    // A revision posted INTO a thread returns the reply's own ts. Storing that
    // would move slack_ts off the thread parent, after which /api/slack/events
    // — which finds the draft by `.eq('slack_ts', thread_ts)` — would stop
    // matching this lead's thread forever.
    const body = bodyOf(notify, 'notifyReviewers').replace(/\s+/g, ' ')
    expect(body).toMatch(/else if \(!input\.threadTs\)/)
  })

  it('the ping is budgeted in GSM-7 UNITS, not characters', () => {
    // '{', '}', '[', ']', '~', '^', '\\' and '|' each cost TWO units. A length
    // check would under-count and produce the two-segment message this function
    // exists to prevent — which is the saving that justified the exercise.
    const body = bodyOf(notify, 'reviewerPingBody')
    expect(body).toMatch(/smsSegmentInfo\(/)
    expect(body).toMatch(/gsm7Sanitize\(/)
    expect(body).not.toMatch(/\.length\s*>\s*budget/)
  })

  it('the ping never truncates the LINK', () => {
    // A ping with a truncated URL is worse than no ping: it looks like it worked.
    const body = bodyOf(notify, 'reviewerPingBody')
    const tailAt = body.indexOf('const tail')
    const trimAt = body.indexOf('summary.slice(0, -1)')
    expect(tailAt).toBeGreaterThan(-1)
    expect(trimAt).toBeGreaterThan(tailAt)
    expect(body).toMatch(/summary\s*=\s*summary\.slice\(0, -1\)/)
  })
})

/* ── R12 · the events route cannot eat itself ────────────────────────────── */

describe('R12 · a thread reply cannot loop, replay, or come from a stranger', () => {
  const code = handlerBody('app/api/slack/events/route.ts')

  it('ignores bots before anything else — including ourselves', () => {
    // The agent posts the revised draft back into the same thread. Without this
    // that post is a new reply, which is a new revision, which posts again — an
    // unbounded loop of Sonnet calls billed to Adam.
    expect(code).toMatch(/event\.bot_id/)
    expect(code).toMatch(/subtype === 'bot_message'/)
    expect(code).toMatch(/event\.app_id/)
  })

  it('does NOT compare api_app_id with app_id', () => {
    // Both are absent on a human message, so `undefined === undefined` made that
    // comparison true for EVERY reviewer: the guard against an infinite loop was
    // instead ignoring all real input. Found by a test, not by reading.
    expect(code).not.toMatch(/api_app_id\s*===\s*/)
  })

  it('acts only on a reply INSIDE a thread', () => {
    // thread_ts === ts is the thread's own parent, which is the draft we posted.
    expect(code.replace(/\s+/g, ' ')).toMatch(/!threadTs \|\| threadTs === ts/)
  })

  it('dedupes on Slack’s own event id', () => {
    // Slack redelivers for three days. external_id is UNIQUE, so a redelivery is
    // refused by the database rather than re-drafted.
    expect(code).toMatch(/body\.event_id|eventId/)
    expect(code).toMatch(/externalId:\s*eventId\s*\?/)
  })

  it('refuses to revise a draft that has already gone to the customer', () => {
    expect(code).toMatch(/draft\.status === 'sent'/)
  })
})

/* ── R13 · escaping at entry ─────────────────────────────────────────────── */

describe('R13 · untrusted text is escaped as it ENTERS a block', () => {
  const blocks = read('lib/slack/blocks.ts')

  it('escapes & before < , or the escape eats itself', () => {
    const body = bodyOf(blocks, 'esc')
    const amp = body.indexOf("replace(/&/g")
    const lt = body.indexOf("replace(/</g")
    expect(amp).toBeGreaterThan(-1)
    expect(lt).toBeGreaterThan(amp)
  })

  it('escapes the three characters that are structural in mrkdwn', () => {
    const body = bodyOf(blocks, 'esc')
    for (const ch of ['&amp;', '&lt;', '&gt;']) expect(body).toContain(ch)
  })

  it('caps every field Slack would REJECT rather than truncate', () => {
    // Over-long text gets the whole message refused with invalid_blocks, which
    // under the fail-soft client reads as "Slack was down" and falls back to SMS
    // forever. A 3000-character email draft is not unusual.
    // The VALUES, not just the names. Asserting the constant existed let a
    // mutation raise SECTION_TEXT_MAX to 100000 — the cap still present, still
    // named, and no longer a cap. These are Slack's documented maxima; a bigger
    // number is not a looser limit, it is an `invalid_blocks` rejection that the
    // fail-soft client reports as "Slack was down".
    const caps: Array<[string, number]> = [
      ['SECTION_TEXT_MAX', 3000],
      ['HEADER_TEXT_MAX', 150],
      ['BUTTON_TEXT_MAX', 75],
    ]
    let examined = 0
    for (const [name, value] of caps) {
      const m = new RegExp(`${name}\\s*=\\s*(\\d+)`).exec(blocks)
      expect({ name, found: !!m }).toEqual({ name, found: true })
      expect({ name, value: Number(m![1]) }).toEqual({ name, value })
      examined++
    }
    expect(examined).toBe(3)
    expect(bodyOf(blocks, 'escCap')).toMatch(/slice\(0, max - 3\)/)
  })

  it('a button value is an IDENTIFIER, not an instruction', () => {
    // A value is round-tripped through Slack. Authority comes from the verified
    // user.id; a forged value can at most name a different draft, which the
    // allowlist and the status re-read then handle.
    const body = bodyOf(blocks, 'decodeActionValue')
    expect(body).toMatch(/typeof v\?\.draftId !== 'string'/)
    expect(body).toMatch(/return null/)
  })
})

/* ── R14 · no secret is ever printed ─────────────────────────────────────── */

describe('R14 · nothing on this surface logs a credential', () => {
  it('no console call interpolates a token or a secret', () => {
    // Never a PREFIX of a digest either — a prefix of a real HMAC is a piece of
    // a real HMAC.
    // What leaks a credential is INTERPOLATING one, not naming the variable it
    // lives in: `SLACK_BOT_TOKEN is unset` is a diagnostic a operator needs, and
    // an earlier version of this rule flagged it, which would have pushed
    // somebody to delete a useful log line to satisfy a test. So the rule reads
    // the `${…}` holes, and only those.
    let examined = 0
    const offenders: string[] = []
    for (const rel of SURFACE) {
      const s = read(rel)
      for (const m of s.matchAll(/console\.\w+\(([^\n]*)/g)) {
        examined++
        for (const hole of m[1].matchAll(/\$\{([^}]*)\}/g)) {
          if (/\b(token|secret|signingSecret|slackBotToken|slackSigningSecret|process\.env\.SLACK_)/i.test(hole[1])) {
            offenders.push(`${rel}: \${${hole[1]}}`)
          }
        }
      }
    }
    expect(offenders).toEqual([])
    expect(examined).toBeGreaterThan(20)
  })

  it('the bot token goes in an Authorization header and nowhere else', () => {
    const client = read('lib/slack/client.ts')
    const uses = client.match(/slackBotToken\(\)/g) ?? []
    expect(uses.length).toBeGreaterThanOrEqual(2)
    expect(client).toMatch(/Authorization:\s*`Bearer \$\{token\}`/)
  })
})

/* ── R15 · the env contract is written down in every place that needs it ─── */

describe('R15 · every SLACK_* variable the code reads is documented', () => {
  /** Every SLACK_* name the source actually reads. */
  const used = new Set<string>()
  for (const rel of SURFACE) {
    for (const m of read(rel).matchAll(/process\.env\.(SLACK_[A-Z_]+)/g)) used.add(m[1])
  }

  it('the code reads the four documented variables and no undocumented fifth', () => {
    expect([...used].sort()).toEqual(
      ['SLACK_BOT_TOKEN', 'SLACK_LEADS_CHANNEL', 'SLACK_REVIEWER_USER_IDS', 'SLACK_SIGNING_SECRET'].sort(),
    )
  })

  it('each one appears in the setup doc, AGENTS.md and docker-compose.yml', () => {
    // An env var added to compose does not reach a running container, and one
    // added to the box but not to compose vanishes on the next recreate. All
    // three, or the cutover breaks in a way that reads as a code bug.
    const setup = fs.readFileSync(path.join(REPO, 'docs', 'slack-app-setup.md'), 'utf8')
    const agents = fs.readFileSync(path.join(REPO, 'AGENTS.md'), 'utf8')
    const compose = fs.readFileSync(path.join(REPO, 'docker-compose.yml'), 'utf8')
    // WHOLE NAME, not substring. `includes('SLACK_SIGNING_SECRET')` is satisfied
    // by `SLACK_SIGNING_SECRET_X`, so a mutation that renamed the AGENTS.md row
    // out of existence passed this rule — the documentation was gone and the
    // test said it was there. A trailing `[A-Z0-9_]` is a different variable.
    const mentions = (hay: string, name: string) => new RegExp(`${name}(?![A-Z0-9_])`).test(hay)
    let examined = 0
    for (const name of used) {
      examined++
      for (const [where, hay] of [
        ['docs/slack-app-setup.md', setup],
        ['AGENTS.md', agents],
        ['docker-compose.yml', compose],
      ] as const) {
        expect({ name, where, documented: mentions(hay, name) }).toEqual({ name, where, documented: true })
      }
      // AGENTS.md must carry an actual TABLE ROW, not just a mention in the
      // bulk name list. The row is where the fail-closed behaviour is written
      // down — that unset SLACK_SIGNING_SECRET means 401 on the handshake, that
      // an empty allowlist authorises nobody — and a mutation that deleted the
      // row while leaving the name in the list satisfied "documented" while the
      // thing a reader needs had gone.
      const row = new RegExp(`^\\|\\s*\`${name}\`\\s*\\|`, 'm')
      expect({ name, hasRow: row.test(agents) }).toEqual({ name, hasRow: true })
      // And compose must actually MAP it, not merely mention it in a comment.
      const mapped = new RegExp(`^\\s*-\\s*${name}=`, 'm')
      expect({ name, mappedInCompose: mapped.test(compose) }).toEqual({ name, mappedInCompose: true })
    }
    expect(examined).toBe(4)
  })

  it('REVIEWER_CHANNEL is documented too, since it is the cutover switch', () => {
    const agents = fs.readFileSync(path.join(REPO, 'AGENTS.md'), 'utf8')
    const compose = fs.readFileSync(path.join(REPO, 'docker-compose.yml'), 'utf8')
    expect(agents).toContain('REVIEWER_CHANNEL')
    expect(compose).toContain('REVIEWER_CHANNEL')
  })
})

/* ── R16 · this file cannot be silently switched off ─────────────────────── */

describe('R16 · the tripwire is honest about itself', () => {
  it('contains no skipped or todo test', () => {
    // publicIntakeSurface's R10 owns this across every *Surface.test.ts, but a
    // file that cannot fail is worth refusing locally too.
    //
    // EVERY token is built by concatenation, including the `x`-prefixed one.
    // Spelling any of them literally makes this file its own offender — the
    // sibling walker greps the raw bytes and does not care that the occurrence
    // is inside a list of things to forbid. That is the same
    // wrong-occurrence family as the CI gate that failed every build for a day
    // while looking exactly like one that passed them.
    const self = fs.readFileSync(__filename, 'utf8')
    const SKIP = '.' + 'skip('
    const TODO = '.' + 'todo('
    const banned = ['it' + SKIP, 'describe' + SKIP, 'x' + 'it(', 'it' + TODO]
    for (const b of banned) expect({ b, found: self.includes(b) }).toEqual({ b, found: false })
  })

  it('reads every rule through the comment stripper', () => {
    // The defect in the version of this file that shipped before: rules ran on
    // RAW source, so a comment merely MENTIONING a function satisfied them. If a
    // later rule reaches for readFileSync directly it bypasses that.
    const self = decomment(fs.readFileSync(__filename, 'utf8'))
    const directReads = self.match(/fs\.readFileSync\(/g) ?? []
    // Allowed: the two helpers, the manifest, the four doc/compose reads, and
    // the two self-reads in this describe. Anything more must be justified.
    expect(directReads.length).toBeLessThanOrEqual(10)
  })

  it('the comment stripper actually strips', () => {
    // Rule 8 applied to the instrument: a decommenter that returned its input
    // would make every "not present" rule above pass vacuously.
    const sample = 'const a = 1 // isSlackReviewer(\n/* isSlackReviewer( */\nconst b = 2'
    expect(decomment(sample)).not.toContain('isSlackReviewer(')
    expect(decomment(sample)).toContain('const a = 1')
    expect(decomment(sample)).toContain('const b = 2')
    // And it preserves offsets, which the proximity rules depend on.
    expect(decomment(sample).length).toBe(sample.length)
  })

  it('a line comment containing /* does not eat the rest of the file', () => {
    // The instrument bug this file was written over. `interactions/route.ts`
    // really does open with `// lib/slack/*, and NOTHING from …`, and a
    // block-comments-first stripper blanked three import statements after it —
    // after which the module-graph rule passed because the walker had gone
    // blind. Pinned with the real shape, not a toy one.
    const sample = [
      "import { a } from '@/lib/a'",
      '// lib/slack/*, and NOTHING from lib/agent/sendApproved.',
      "import { b } from '@/lib/b'",
      '/* a real block comment */',
      "import { c } from '@/lib/c'",
    ].join('\n')
    const out = decomment(sample)
    for (const spec of ['@/lib/a', '@/lib/b', '@/lib/c']) expect(out).toContain(spec)
    expect(out).not.toContain('NOTHING from')
    expect(out).not.toContain('a real block comment')
  })

  it('the route that triggered it still shows all of its imports', () => {
    // The rule above proves the helper; this proves the FILE. Both, because a
    // helper that is correct on a sample and a file that is parsed correctly are
    // different claims, and it was the file that was wrong.
    const code = read('app/api/slack/interactions/route.ts')
    for (const spec of ['@/lib/slack/signature', '@/lib/slack/client', '@/lib/slack/blocks']) {
      expect({ spec, seen: code.includes(spec) }).toEqual({ spec, seen: true })
    }
  })

  it('tolerates CRLF, because this repo is core.autocrlf=true', () => {
    // Six of link 23's 34 mutations silently failed to apply over exactly this.
    const crlf = 'const a = 1 // x\r\nconst b = 2\r\n'
    expect(decomment(crlf)).toContain('const b = 2')
    expect(bodyOf('export function foo() {\r\n  return 1\r\n}\r\nexport function bar() {}', 'foo')).toContain('return 1')
  })
})
