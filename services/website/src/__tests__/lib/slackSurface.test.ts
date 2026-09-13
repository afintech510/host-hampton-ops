/**
 * The Slack surface as a SHAPE, not as behaviour (plan §25.9).
 *
 * Everything in this file is asserted by reading the source and walking the
 * import graph, because these are properties a behaviour test cannot see:
 *
 *   - "the handler reads the raw body before parsing" is true of the CODE, and
 *     a mock request whose .text() and .json() both work will pass either way;
 *   - "/api/slack/* cannot reach sendApproved.ts" is a property of the module
 *     GRAPH. A behaviour test only ever exercises the paths somebody thought
 *     to write, and the import that breaks this will be added by someone who
 *     did not know the rule existed. That is the whole point of enforcing it
 *     here rather than in review.
 *
 * Same approach as contactIdentitySurface.test.ts and portalAuthSurface.test.ts.
 */

import fs from 'fs'
import path from 'path'

const SRC = path.join(__dirname, '..', '..')

function read(rel: string): string {
  return fs.readFileSync(path.join(SRC, rel), 'utf8')
}

/**
 * The handler body, from `export async function POST` down.
 *
 * The ordering rules below are about what the REQUEST does, so they are
 * measured inside the request handler. Helpers defined above it — the
 * interactions route's `payloadFromForm` is one — contain a `JSON.parse` that
 * is textually earlier and only ever *called* after verification. Asserting on
 * the whole file would fail on a parser's definition while missing a parser
 * invoked in the wrong place, which is backwards.
 */
function handlerBody(rel: string): string {
  const code = read(rel)
  const at = code.indexOf('export async function POST')
  expect(at).toBeGreaterThan(-1)
  return code.slice(at)
}

/** Every file under `src/app/api/slack/`. */
const SLACK_ROUTES = ['app/api/slack/interactions/route.ts', 'app/api/slack/events/route.ts']

describe('the Slack routes exist where the manifest points', () => {
  it('both request URLs have a route file', () => {
    for (const rel of SLACK_ROUTES) {
      expect(fs.existsSync(path.join(SRC, rel))).toBe(true)
    }
  })

  it('the manifest names exactly these two URLs', () => {
    const manifest = fs.readFileSync(path.join(SRC, '..', '..', '..', 'docs', 'slack-app-manifest.yml'), 'utf8')
    expect(manifest).toContain('/api/slack/interactions')
    expect(manifest).toContain('/api/slack/events')
  })
})

describe('R1 — the raw body is read before anything parses it', () => {
  /**
   * Slack signs the bytes it sent. `new URLSearchParams(...)` or `req.json()`
   * ahead of the hash means re-encoding, which changes the bytes, which breaks
   * every signature — and the failure is total and confusing rather than
   * partial and obvious.
   */
  it.each(SLACK_ROUTES)('%s calls req.text() before any parse', rel => {
    const code = handlerBody(rel)
    const textAt = code.indexOf('await req.text()')
    expect(textAt).toBeGreaterThan(-1)

    // There is no second way to read the body, and both of these consume the
    // stream — so their presence at all means the raw bytes are gone.
    for (const parser of ['req.json()', 'req.formData()']) {
      expect(read(rel)).not.toContain(parser)
    }

    // And nothing parses the body before the read of it.
    const parseAt = code.search(/payloadFromForm\(|JSON\.parse\(/)
    if (parseAt > -1) expect(parseAt).toBeGreaterThan(textAt)
  })

  it.each(SLACK_ROUTES)('%s verifies before it parses, and treats anything but ok as a rejection', rel => {
    const code = handlerBody(rel)
    const verifyAt = code.indexOf('verifySlackRequest(')
    expect(verifyAt).toBeGreaterThan(-1)

    // The rejection is `!== 'ok'`, which catches 'unconfigured' along with
    // everything else. A check written as `=== 'bad_signature'` would let an
    // unset secret through, which is the exact failure the SignWell review
    // found: a verifier that silently passes when it has no key.
    expect(code).toMatch(/verdict\s*!==\s*'ok'/)
    expect(code).toMatch(/status:\s*401/)

    const parseAt = code.search(/payloadFromForm\(|JSON\.parse\(/)
    if (parseAt > -1) expect(parseAt).toBeGreaterThan(verifyAt)
  })

  it.each(SLACK_ROUTES)('%s gates on the verified user id, not on message content', rel => {
    const code = read(rel)
    expect(code).toContain('isSlackReviewer(')
    // There is no second verifier and no hand-rolled HMAC in a route.
    expect(code).not.toContain('createHmac')
  })
})

/* ── R2 — the module graph ──────────────────────────────────────────────── */

/**
 * Resolve a `@/...` or relative import to a file under src/.
 *
 * Returns null for a node_modules package, which is what stops the walk from
 * wandering into the dependency tree.
 */
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

/** Every import specifier in a file, `import type` included. */
function importsOf(rel: string): string[] {
  const code = read(rel)
  const specs: string[] = []
  const re = /(?:^|\n)\s*import\s[^'"]*from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code))) specs.push(m[1] || m[2])
  return specs
}

/** Transitive closure of a file's imports inside src/. */
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

describe('R2 — /api/slack/* cannot reach the customer-send path', () => {
  /**
   * §25.6, and the reason `lib/agent/reviewers.ts` and `lib/agent/slackLoop.ts`
   * are separate modules at all.
   *
   * `/api/slack/interactions` is a public URL whose whole job is to start an
   * approval. If a later change imports `handleSlackAction` here "to make the
   * button feel faster", a defect in a public handler becomes a message to a
   * customer. The routes record an event; the dispatcher acts on it.
   */
  const FORBIDDEN = ['lib/agent/sendApproved.ts', 'lib/agent/reviewLoop.ts', 'lib/agent/slackLoop.ts']

  it.each(SLACK_ROUTES)('%s does not import the send path, even transitively', rel => {
    const reachable = reachableFrom(rel)
    const violations = FORBIDDEN.filter(f => reachable.has(f))
    expect(violations).toEqual([])
  })

  it('the walker actually walks — the dispatcher DOES reach sendApproved', () => {
    // Without this, a resolver that silently returned null for everything would
    // make the assertion above pass for the wrong reason. Link 16's lesson: a
    // guardrail test that cannot fail is not a guardrail.
    const reachable = reachableFrom('app/api/cron/agent-dispatch/route.ts')
    expect(reachable.has('lib/agent/sendApproved.ts')).toBe(true)
    expect(reachable.has('lib/agent/slackLoop.ts')).toBe(true)
  })

  it('the Quo webhook still does not reach it either', () => {
    // The original subject of this rule, re-asserted so widening the test to
    // Slack did not quietly drop it.
    const reachable = reachableFrom('app/api/webhooks/quo/route.ts')
    expect(reachable.has('lib/agent/sendApproved.ts')).toBe(false)
    expect(reachable.has('lib/agent/reviewLoop.ts')).toBe(false)
  })

  it('the notify seam announces drafts and never sends one', () => {
    // notifyReviewers is imported BY draftInquiry, so a send path reachable
    // from it would be reachable from the draft node — which would mean a
    // model-written message could reach a customer with no approval at all.
    const reachable = reachableFrom('lib/agent/notifyReviewers.ts')
    expect(reachable.has('lib/agent/sendApproved.ts')).toBe(false)
  })
})

/* ── R3 — the Slack client's failure contract ───────────────────────────── */

describe('R3 — every Slack call is fail-soft, and checks the body not the status', () => {
  const client = read('lib/slack/client.ts')

  it('reads `ok` out of the RESPONSE BODY', () => {
    // Slack answers HTTP 200 with {"ok":false,"error":"not_in_channel"}. A
    // client that trusted the HTTP status would call that a success, skip the
    // SMS fallback, and lose the lead with a 200 in the logs.
    expect(client).toMatch(/json\??\.ok\s*!==\s*true/)
  })

  it('bounds every call with a timeout', () => {
    const fetches = client.match(/fetch\(/g) ?? []
    const timeouts = client.match(/AbortSignal\.timeout\(/g) ?? []
    expect(fetches.length).toBeGreaterThan(0)
    expect(timeouts.length).toBe(fetches.length)
  })

  it('never lets an error escape to a caller', () => {
    // `throw` anywhere in this module would break notifyReviewers' promise that
    // the SMS still sends — which is the §18 rule.
    expect(client).not.toMatch(/^\s*throw /m)
  })

  it('does not unfurl our own links into the channel', () => {
    // A review URL is a bearer token. Slack unfurling it would paste a preview
    // of the review PAGE into #hh-leads as an image.
    expect(client).toContain('unfurl_links: false')
  })
})
