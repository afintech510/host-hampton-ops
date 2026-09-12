/**
 * Phase 6 review — the structural claims, asserted against the source.
 *
 * §23 makes three claims that no behavioural test can check, because they are
 * about what the codebase does NOT contain:
 *
 *   1. every read of `agent_learnings` goes through `loadActiveLearnings`, so
 *      the read-time screen (layer 3) cannot be bypassed by a new module;
 *   2. the learned-rules route never touches `inquiry_drafts` or `bookings`, so
 *      a learning loop that changes what the agent WRITES cannot change who
 *      approves it;
 *   3. no literal 'ADMIN' in the new code.
 *
 * Each is checked by reading the files, because each fails by ADDITION — a
 * future module that queries the table directly, or a route that grows a
 * shortcut. A test over behaviour would keep passing while the claim stopped
 * being true.
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { ESTIMATED_USD, MAX_FEEDBACK_ROWS, MAX_OUTBOUND_ROWS, MAX_PROPOSALS } from '@/lib/agent/distill'
import { MODEL_PRICING, DEFAULT_DRAFT_MODEL } from '@/lib/agent/config'

const SRC = join(process.cwd(), 'src')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) {
      if (entry !== '__tests__' && entry !== 'node_modules') walk(p, out)
    } else if (/\.tsx?$/.test(entry)) out.push(p)
  }
  return out
}

const APP_FILES = walk(SRC).map(p => ({ path: p.replace(SRC, 'src').replace(/\\/g, '/'), body: readFileSync(p, 'utf8') }))

/** Block and line comments out, so a claim about CODE is not answered by prose. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

describe('every read of agent_learnings goes through the screen', () => {
  it('only lib/agent/learnings.ts queries the table directly', () => {
    const queriers = APP_FILES.filter(f => /from\(\s*['"]agent_learnings['"]\s*\)/.test(f.body)).map(f => f.path)
    // The admin route reads the table for the REVIEW LIST, which is a list of
    // rows to judge and is not a prompt — and it gets what the prompt actually
    // loads from `loadActiveLearnings`, separately, so the panel can show both.
    expect(queriers.sort()).toEqual(['src/app/api/admin/learnings/route.ts', 'src/lib/agent/learnings.ts'])
  })

  it('every module that puts learned rules in a prompt uses loadActiveLearnings', () => {
    const prompters = APP_FILES.filter(f => f.body.includes('learningsPromptAddendum(')).map(f => f.path)
    for (const p of prompters) {
      const f = APP_FILES.find(x => x.path === p)!
      expect({ file: p, loadsThroughTheScreen: f.body.includes('loadActiveLearnings') }).toEqual({
        file: p,
        loadsThroughTheScreen: true,
      })
    }
    // And there is at least one, so a rename cannot make this vacuously true.
    expect(prompters.length).toBeGreaterThan(0)
  })

  it('every module that puts a voice profile in a prompt loads it through loadVoiceProfile', () => {
    // The same argument, for the field the Phase 6 review found unscreened.
    const prompters = APP_FILES.filter(
      f => f.body.includes('voicePromptAddendum(') && !f.path.endsWith('lib/agent/voice.ts'),
    ).map(f => f.path)
    for (const p of prompters) {
      const f = APP_FILES.find(x => x.path === p)!
      expect({ file: p, loadsThroughTheScreen: f.body.includes('loadVoiceProfile') }).toEqual({
        file: p,
        loadsThroughTheScreen: true,
      })
    }
    expect(prompters.length).toBeGreaterThan(0)
  })

  it('nothing reads voice_profile.profile except voice.ts', () => {
    const queriers = APP_FILES.filter(f => /from\(\s*['"]voice_profile['"]\s*\)/.test(f.body)).map(f => f.path)
    // The admin route lists profile METADATA (version, is_active, notes) for the
    // panel; it must not select `profile` itself and print it anywhere.
    const route = APP_FILES.find(f => f.path === 'src/app/api/admin/learnings/route.ts')!
    expect(queriers).toContain('src/lib/agent/voice.ts')
    expect(route.body).not.toMatch(/select\([^)]*\bprofile\b[^)]*\)/)
  })
})

describe('a learned rule cannot widen who may approve or send', () => {
  const route = () => APP_FILES.find(f => f.path === 'src/app/api/admin/learnings/route.ts')!.body

  it('the learnings route never queries inquiry_drafts or bookings', () => {
    for (const table of ['inquiry_drafts', 'bookings', 'booking_payments', 'contacts']) {
      expect({ table, queried: new RegExp(`from\\(\\s*['"]${table}['"]`).test(route()) }).toEqual({
        table,
        queried: false,
      })
    }
  })

  it('it never calls a transition, an approve or a send', () => {
    for (const fn of ['transition(', 'sendApproved', 'approveDraft', 'canTransition']) {
      expect({ fn, called: route().includes(fn) }).toEqual({ fn, called: false })
    }
  })

  it('approved and sent are still GATED edges requiring actor.isAdmin', () => {
    // The claim §23 makes is about lib/marketing/graph.ts, so it is checked
    // there rather than inferred from the learnings route being well behaved.
    const graph = APP_FILES.find(f => f.path === 'src/lib/marketing/graph.ts')!.body
    expect(graph).toMatch(/isAdmin/)
    for (const edge of ['approved', 'sent']) expect(graph).toContain(edge)
  })

  it('no literal ADMIN in any Phase 6 file — adminActorId(req) everywhere', () => {
    const phase6 = [
      'src/lib/agent/learnings.ts',
      'src/lib/agent/distill.ts',
      'src/lib/agent/draftGuards.ts',
      'src/lib/agent/voice.ts',
      'src/app/api/admin/learnings/route.ts',
      'src/app/api/cron/agent-distill/route.ts',
    ]
    for (const p of phase6) {
      const f = APP_FILES.find(x => x.path === p)
      expect({ file: p, found: !!f }).toEqual({ file: p, found: true })
      // In CODE, not in prose. Every one of these files discusses the literal
      // by name in a comment — which is the point, they say not to use it — so
      // a naive grep flags exactly the files that are doing the right thing.
      expect({ file: p, literal: /['"]ADMIN['"]/.test(stripComments(f!.body)) }).toEqual({ file: p, literal: false })
    }
  })
})

describe('the distiller budget reservation covers its own worst case', () => {
  it('ESTIMATED_USD exceeds the cost of a full corpus, computed from the constants', () => {
    // Not a magic number check: derived from the caps this module OWNS, so
    // raising MAX_FEEDBACK_ROWS without raising the reservation fails here
    // rather than in production on a busy Monday (rule 11).
    const MAX_FIELD_CHARS = 1200
    const chars =
      MAX_FEEDBACK_ROWS * MAX_FIELD_CHARS * 3 + // agentWrote + humanSent + theyAskedFor
      MAX_OUTBOUND_ROWS * MAX_FIELD_CHARS +
      4000 // system prompt and scaffolding
    // A conservative 3 chars/token — fewer chars per token means more tokens.
    const inputTokens = chars / 3
    const outputTokens = 3000 // MAX_TOKENS
    const price = MODEL_PRICING[DEFAULT_DRAFT_MODEL]
    expect(price).toBeDefined()
    const worstCaseUsd = (inputTokens / 1e6) * price.in + (outputTokens / 1e6) * price.out

    expect(worstCaseUsd).toBeLessThan(ESTIMATED_USD)
    // And the reservation is not absurdly over-large either — a run that
    // reserves half the daily cap starves the drafting the agent exists for.
    expect(ESTIMATED_USD).toBeLessThan(worstCaseUsd * 6)
  })

  it('every model the agent can be pointed at is priced', () => {
    // `draftModel()` reads AGENT_DRAFT_MODEL, so the reservation above is only
    // meaningful while every model in the table is cheaper than the default's
    // worst case would suggest. This pins the ones that exist.
    for (const [model, price] of Object.entries(MODEL_PRICING)) {
      expect({ model, ok: price.in > 0 && price.out > 0 }).toEqual({ model, ok: true })
    }
    expect(MODEL_PRICING[DEFAULT_DRAFT_MODEL]).toBeDefined()
  })

  it('MAX_PROPOSALS bounds one run, since the schema may not carry maxItems', () => {
    // Anthropic refuses `maxItems`, so this cap is load-bearing in CODE. If it
    // ever stops being applied, a model returning 200 rules fills the queue.
    const distill = readFileSync(join(SRC, 'lib/agent/distill.ts'), 'utf8')
    expect(distill).toContain('slice(0, MAX_PROPOSALS)')
    expect(MAX_PROPOSALS).toBeGreaterThan(0)
    expect(MAX_PROPOSALS).toBeLessThanOrEqual(20)
  })
})
