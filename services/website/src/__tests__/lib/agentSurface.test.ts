/**
 * THE BOOKING AGENT SURFACE, read off disk.
 *
 * Link 22's tripwire. The agent is the only live, model-driven, customer-facing
 * path in this business: it reads `ingested_messages` (461 rows, written from
 * stranger-supplied email and SMS), it PATCHes real `bookings` rows from model
 * output, and its approved text is emailed and texted to a real person. Links 3,
 * 4 and plan §24 attacked the prompt-injection layers; nothing had attacked the
 * dispatcher, the classifier, the draft writer and the review loop as ONE
 * surface, and nothing had audited what the agent WRITES.
 *
 * ── House rules this file follows ─────────────────────────────────────────
 *
 *  * **Comments are stripped before any rule runs.** This header names every
 *    defect the file tests for, so an un-stripped scan would match its own
 *    paragraphs and every rule would pass for the wrong reason.
 *  * **Handler and function bodies are sliced to the NEXT declaration**, never
 *    by a fixed number of lines — link 16's family.
 *  * **Every anchor tolerates CRLF**, because this repo is `core.autocrlf=true`
 *    and a `\n` in a multiline pattern silently matches nothing.
 *  * **R0 counts what it examined** and holds its own module list exact in BOTH
 *    directions: a module the walker cannot see is a module every rule below
 *    silently skips (link 16's R6b matched nothing and therefore passed), and a
 *    stale entry means the rules are reasoning about code nobody can reach.
 *  * **No `.skip` rule here**: `publicIntakeSurface` R10 already walks every
 *    `*Surface.test.ts` and fails on `.skip` / `xit` / `.todo`, and this file
 *    matches that glob. The concept has an owner (rule 11).
 */

import fs from 'fs'
import path from 'path'

const SRC = path.join(__dirname, '..', '..')

function read(rel: string): string {
  return fs.readFileSync(path.join(SRC, rel), 'utf8')
}

/**
 * Remove `//` and block comments, preserving offsets and line count so a
 * reported line number still means something.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n\r]/g, ' '))
    .replace(/(^|[^:/])\/\/[^\n\r]*/g, (m, p1: string) => p1 + ' '.repeat(m.length - p1.length))
}

/** Every .ts/.tsx file under `dir`, excluding tests. */
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === '__tests__' || e.name === 'node_modules') continue
      walk(p, out)
    } else if (/\.tsx?$/.test(e.name)) {
      out.push(path.relative(SRC, p).replace(/\\/g, '/'))
    }
  }
  return out
}

/**
 * The body of a named TOP-LEVEL function/const, sliced to the next top-level
 * declaration rather than by a fixed width. Returns '' when the name is absent,
 * which every caller asserts against separately — a rule that silently scans an
 * empty string passes for the wrong reason.
 *
 * TOP-LEVEL ONLY, and that is load-bearing: the `^` anchor requires column 0, so
 * this returns '' for an INDENTED `const` inside a function. My R4 rule asked it
 * for `parkedReason`, which is declared inside `handleReviewerReply`, and got ''.
 * It failed loudly only because every caller asserts `not.toBe('')` — without
 * that assertion the rule would have scanned an empty string and passed. Use
 * plain `toMatch` on the file for anything inside a function.
 */
function bodyOf(src: string, name: string): string {
  const decl = new RegExp(
    `^(?:export\\s+)?(?:async\\s+)?(?:function|const|let)\\s+${name}\\b`,
    'm',
  )
  const m = decl.exec(src)
  if (!m) return ''
  const from = m.index
  const rest = src.slice(from + m[0].length)
  const next = /^(?:export\s+)?(?:async\s+)?(?:function|const|let|class|interface|type)\s+\w/m.exec(rest)
  return src.slice(from, next ? from + m[0].length + next.index : src.length)
}

/* ── R0 · The walker ──────────────────────────────────────────────────── */

/**
 * Every module that is part of the booking agent. Held EXACT in both directions.
 *
 * `lib/agent/**` plus the four routes that drive it, the inbound edge, and the
 * public review page. When a module is added to `lib/agent/`, this list fails
 * until somebody decides which rules below apply to it — which is the point.
 */
const SURFACE = [
  'lib/agent/config.ts',
  'lib/agent/distill.ts',
  'lib/agent/draftGuards.ts',
  'lib/agent/draftInquiry.ts',
  'lib/agent/events.ts',
  'lib/agent/extractPlanFields.ts',
  'lib/agent/learnings.ts',
  'lib/agent/manualDraft.ts',
  'lib/agent/memoryImport.ts',
  'lib/agent/notifyReviewers.ts',
  'lib/agent/reviewLink.ts',
  'lib/agent/reviewLoop.ts',
  'lib/agent/reviewers.ts',
  'lib/agent/sendApproved.ts',
  'lib/agent/slackLoop.ts',
  'lib/agent/threadTimeline.ts',
  'lib/agent/tonePresets.ts',
  'lib/agent/triage.ts',
  'lib/agent/voice.ts',
]

/** The routes and pages that drive the surface. Also exact. */
const SURFACE_ROUTES = [
  'app/api/cron/agent-dispatch/route.ts',
  'app/api/cron/agent-distill/route.ts',
  'app/api/cron/gmail-sync/route.ts',
  'app/api/admin/agent/route.ts',
  'app/api/webhooks/quo/route.ts',
  'app/review/[token]/page.tsx',
]

describe('R0 · the walker sees the whole surface', () => {
  it('every module in lib/agent is accounted for, and every account is real', () => {
    const onDisk = walk(path.join(SRC, 'lib', 'agent')).sort()
    expect(onDisk).toEqual([...SURFACE].sort())
    // Count what was examined, so "all clear" cannot mean "found nothing".
    expect(onDisk.length).toBeGreaterThanOrEqual(19)
  })

  it('every route on the list exists on disk', () => {
    const missing = SURFACE_ROUTES.filter(r => !fs.existsSync(path.join(SRC, r)))
    expect(missing).toEqual([])
  })
})

/* ── R1 · The payment-redirect guard ──────────────────────────────────── */

describe('R1 · containsForeignContact refuses every way to redirect a payment', () => {
  const guards = stripComments(read('lib/agent/draftGuards.ts'))

  it('does not allowlist a payment processor by HOST', () => {
    // The hole this file exists for. `OUR_HOSTS` was matched against the host
    // alone and listed venmo.com and stripe.com, so an attacker's own
    // buy.stripe.com payment page — live, real, chargeable — passed the one
    // guardrail whose stated purpose is stopping a payment redirect.
    const ours = bodyOf(guards, 'OUR_HOSTS')
    expect(ours).not.toBe('')
    expect(ours).not.toMatch(/stripe\\?\./)
    expect(ours).not.toMatch(/venmo\\?\./)
    expect(ours).toMatch(/hosthampton/)
  })

  it('decides a Venmo link by its PATH, against our own handle', () => {
    const fn = bodyOf(guards, 'isOurVenmoUrl')
    expect(fn).not.toBe('')
    expect(fn).toMatch(/venmoHandle\(\)/)
    expect(fn).toMatch(/pathname/)
  })

  it('has a phone-number detector with our own numbers allowlisted', () => {
    // Zelle is keyed by PHONE NUMBER, so "Zelle the deposit to 917-555-0134" is
    // the same attack as an @handle redirect. The axis was missing entirely.
    const body = bodyOf(guards, 'containsForeignContact')
    expect(body).not.toBe('')
    expect(body).toMatch(/phone number/)
    expect(body).toMatch(/ourPhoneDigits\(\)/)
    const ours = bodyOf(guards, 'ourPhoneDigits')
    expect(ours).not.toBe('')
    // Our numbers come from the module that already owns them (rule 11), not
    // from a literal re-typed here.
    expect(ours).toMatch(/PUBLIC_PHONE_DISPLAY/)
    expect(ours).toMatch(/zellePhone\(\)/)
  })

  it('reads our Venmo handle from paymentContacts, not from a second copy of the env', () => {
    expect(guards).toMatch(/from '@\/lib\/paymentContacts'/)
    // The old second definition: its own read of VENMO_HANDLE with its own
    // normalisation. Rule 11 — our handle spelled twice is a handle nothing is
    // checking.
    expect(guards).not.toMatch(/process\.env\.VENMO_HANDLE/)
  })

  it('detects a Cash App cashtag but not a price', () => {
    const body = bodyOf(guards, 'containsForeignContact')
    expect(body).toMatch(/cashtag/)
    // `$` followed by a LETTER. `\$\s?\d` is the money guardrail's business.
    expect(body).toMatch(/\\\$\(\[A-Za-z\]/)
  })

  it('does not floor the @handle detector above two characters', () => {
    const body = bodyOf(guards, 'containsForeignContact')
    // `{2,31}` meant a minimum of THREE characters, so the two-character handles
    // both Venmo and Instagram allow walked through.
    expect(body).toMatch(/\{1,31\}/)
    expect(body).not.toMatch(/\{2,31\}/)
  })
})

/* ── R2 · What the guardrails are pointed AT ──────────────────────────── */

describe('R2 · every generated string is screened, in one implementation', () => {
  const draft = stripComments(read('lib/agent/draftInquiry.ts'))
  const guards = stripComments(read('lib/agent/draftGuards.ts'))

  it('screenGeneratedDraft covers summaryForReviewer as well as the drafts', () => {
    // `summaryForReviewer` is the ONE line a reviewer reads: the whole of the
    // one-segment SMS ping, the Slack fallback text, and the sentence beside the
    // Approve button. It is model output over a stranger's email exactly like the
    // two drafts beside it, and NEITHER copy of the guardrail block screened it.
    const fn = bodyOf(guards, 'screenGeneratedDraft')
    expect(fn).not.toBe('')
    for (const field of ['emailDraft', 'smsDraft', 'emailSubject', 'summaryForReviewer']) {
      expect(fn).toContain(`draft.${field}`)
    }
    expect(fn).toMatch(/containsForeignContact/)
    expect(fn).toMatch(/containsFabricatedTerms/)
  })

  it('both draft paths call the shared screen and neither re-implements it', () => {
    const calls = draft.match(/screenGeneratedDraft\(/g) ?? []
    expect(calls.length).toBe(2) // the first draft, and the revision
    // The two hand-rolled `containsForeignContact(...) || containsForeignContact(...)`
    // chains this replaced. Two copies of a guardrail is a guardrail nothing is
    // checking, and these two had already drifted in the way that mattered.
    expect(draft).not.toMatch(/containsForeignContact\([\s\S]{0,40}\)\s*\|\|/)
    expect(draft).not.toMatch(/containsFabricatedTerms\([\s\S]{0,40}\)\s*\|\|/)
  })

  it('the send path re-screens the exact bytes it is about to deliver', () => {
    // The last point at which refusing is free. Between the draft node's screen
    // and here the text has been through an admin `edit` (free text, no screen),
    // a re-draft, and a human skimming SMS — and the screen itself was found to
    // be broken, so drafts that passed it are in the queue right now.
    const send = stripComments(read('lib/agent/sendApproved.ts'))
    expect(send).toMatch(/from '\.\/draftGuards'/)
    // Anchor on the CONSTRUCT, not on the presence of the call. My first version
    // of this rule asserted only that `containsForeignContact(draft.email_draft`
    // appeared somewhere, and the harness walked straight through it by keeping
    // the call and assigning it to an unused variable — the screen was still
    // spelled and no longer did anything. A guardrail is its refusal, not its
    // detector.
    expect(send).toMatch(
      /const redirect =\s*containsForeignContact\(draft\.email_draft \|\| ''\) \|\|\s*containsForeignContact\(draft\.sms_draft \|\| ''\)/,
    )
    // …and the refusal itself: the branch, the early return, and the record.
    expect(send).toMatch(/if \(redirect\) \{/)
    const branch = send.slice(send.indexOf('if (redirect) {'))
    expect(branch.slice(0, 1200)).toMatch(/refusing to send/)
    expect(branch.slice(0, 1200)).toMatch(/send_refused/)
    expect(branch.slice(0, 1200)).toMatch(/return \{\s*ok: false/)
  })
})

/* ── R3 · The stand-down plan §4.6 promised ───────────────────────────── */

describe('R3 · a cancelled party gets no draft, no approval and no send', () => {
  const draft = stripComments(read('lib/agent/draftInquiry.ts'))

  it('the draft node selects status and stands down on it', () => {
    // §4.6 has said since the first version of the plan: "or the plan is
    // cancelled, no draft". `PLAN_COLUMNS` did not even SELECT status, and
    // production had grown three open drafts on cancelled plans — two of them
    // real customers whose parties had been called off.
    expect(bodyOf(draft, 'PLAN_COLUMNS')).toMatch(/\bstatus\b/)
    expect(draft).toMatch(/planIsStoodDown/)
    expect(bodyOf(draft, 'STAND_DOWN_PLAN_STATUSES')).toMatch(/'cancelled'/)
  })

  it('both the first draft and the re-draft stand down', () => {
    const calls = draft.match(/planIsStoodDown\(/g) ?? []
    // The definition, plus the first-draft path, plus the redraft path, plus
    // planStatusOf.
    expect(calls.length).toBeGreaterThanOrEqual(4)
  })

  it('the WRITE half stands down too', () => {
    // `applyExtractedFields` is exported and reachable independently of the
    // draft node, and it PATCHes a real bookings row from model output.
    const extract = stripComments(read('lib/agent/extractPlanFields.ts'))
    const fn = bodyOf(extract, 'applyExtractedFields')
    expect(fn).not.toBe('')
    expect(fn).toMatch(/'cancelled'/)
    expect(fn).toMatch(/select\('id, status,/)
  })

  it('"is this party still happening" has exactly one implementation', () => {
    // Three surfaces need it: the SMS loop, the admin Inbox, and Slack if it
    // ever grows one. Three copies is the rule-11 shape this chain keeps finding.
    expect(bodyOf(draft, 'planStatusOf')).not.toBe('')
    for (const rel of ['lib/agent/reviewLoop.ts', 'app/api/admin/agent/route.ts']) {
      const src = stripComments(read(rel))
      expect(src).toMatch(/planStatusOf/)
      // Imported, never redeclared.
      expect(src).not.toMatch(/(?:async\s+)?function\s+planStatusOf/)
    }
  })

  it('the review loop refuses an approval and a test for a stood-down plan', () => {
    const loop = stripComments(read('lib/agent/reviewLoop.ts'))
    expect(loop).toMatch(/plan_stood_down/)
    expect(loop).toMatch(/plan\.standDown/)
  })

  it('the admin route refuses approve, send and test for a stood-down plan', () => {
    const admin = stripComments(read('app/api/admin/agent/route.ts'))
    const gate = /body\.action === 'approve' \|\| body\.action === 'send' \|\| body\.action === 'test'/
    expect(admin).toMatch(gate)
    const after = admin.slice(gate.exec(admin)!.index)
    expect(after.slice(0, 900)).toMatch(/planStatusOf/)
    expect(after.slice(0, 900)).toMatch(/standDown/)
  })
})

/* ── R4 · A parked draft is the one a human must read ─────────────────── */

describe('R4 · a guardrail hold cannot be cleared or approved by accident', () => {
  it('the review loop asks for confirmation when the draft is parked', () => {
    // `parkedSmsBody` deliberately does NOT end with "Reply SEND" precisely
    // because a parked draft is the one a reviewer must not approve by reflex.
    // Approving it was nevertheless completely unguarded: `SEND <code>` on a
    // draft held for `foreign_contact_in_draft` went straight to the customer
    // without the reason being mentioned once.
    const loop = stripComments(read('lib/agent/reviewLoop.ts'))
    // `parkedReason` is declared INSIDE handleReviewerReply, so `bodyOf` cannot
    // see it — see the note on that helper. Anchored on the construct instead.
    expect(loop).toMatch(/const parkedReason =[\s\S]{0,120}draft\.error/)
    // The condition has to include the parked case, not merely mention it.
    expect(loop).toMatch(/needsConfirm =[\s\S]{0,200}!!parkedReason/)
    // The reason has to reach the reviewer, not just the branch.
    expect(loop).toMatch(/HELD BACK/)
    // And the resolver has to read the column at all: a `draft.error` that is
    // never SELECTed is always undefined, and the whole rule above would pass
    // while never firing.
    expect(bodyOf(loop, 'OPEN_COLUMNS')).toMatch(/\berror\b/)
  })

  it('an admin edit clears the hold only when the TEXT actually changed', () => {
    // `{action:'edit', id}` with no fields — or with only a new subject — used to
    // set `error: null` and move the draft to sent_for_review without touching
    // the flagged bytes. A no-op edit laundered a parked draft.
    const admin = stripComments(read('app/api/admin/agent/route.ts'))
    expect(admin).toMatch(/textChanged/)
    expect(admin).toMatch(/heldBack/)
    const idx = admin.indexOf('const textChanged')
    const clearIdx = admin.search(/\berror:\s*null\b/)
    expect(idx).toBeGreaterThan(-1)
    expect(clearIdx).toBeGreaterThan(-1)
    // The check must PRECEDE the clear. Ordering a guard so it cannot depend on
    // knowing which — link 21's own-fix lesson.
    expect(idx).toBeLessThan(clearIdx)
  })
})

/* ── R5 · Model output is never a conclusion ──────────────────────────── */

describe('R5 · what the model writes to a real booking is bounded', () => {
  const extract = stripComments(read('lib/agent/extractPlanFields.ts'))

  it('refuses a date in the past rather than writing it to the plan', () => {
    // `coerceIsoDate` asks whether a date EXISTS, not whether it could be a
    // party. A relative-date resolver's failure mode is the wrong month or the
    // wrong year, and 2025-10-14 is a perfectly good Tuesday. Writing one stops
    // the agent asking (rule 15) AND computes `modification_cutoff` and
    // `guest_count_cutoff` in the past, locking a live booking.
    const fn = bodyOf(extract, 'sanitizeExtracted')
    expect(fn).not.toBe('')
    expect(fn).toMatch(/v >= today/)
    expect(fn).toMatch(/rejectedDate/)
  })

  it('uses the shared guest-count screen, not a fourth hand-rolled bound', () => {
    // link 21 established that `guest_count_approx` is the MULTIPLIER in
    // loadPlanInvoice's per-head arithmetic, so it is a money input whichever
    // door it comes through — and this door is a MODEL reading a stranger's prose.
    expect(extract).toMatch(/screenPublicGuestCount/)
    expect(bodyOf(extract, 'sanitizeExtracted')).toMatch(/MAX_EXTRACTED_GUESTS/)
    // The old private bound.
    expect(extract).not.toMatch(/n > 0 && n <= 200/)
  })

  it('the fill-blanks compare-and-swap covers the zero case', () => {
    // `blank()` for the guest count is `!(Number(x) > 0)`, so a literal 0 counts
    // as fillable — and `.is(col, null)` does not match a 0, so that one column
    // was written unconditionally, losing the guard the whole function rests on.
    const fn = bodyOf(extract, 'applyExtractedFields')
    expect(fn).toMatch(/guest_count_approx' && Number\(was\) === 0/)
    expect(fn).toMatch(/write\.eq\(col, 0\)/)
  })

  it('the plan read distinguishes "could not read" from "not found"', () => {
    const fn = bodyOf(extract, 'applyExtractedFields')
    expect(fn).toMatch(/could not read the plan/)
    expect(fn).toMatch(/'plan not found'/)
  })
})

/* ── R6 · Three outcomes where a guard depends on a read ──────────────── */

describe('R6 · a failed read never silently disables a guard', () => {
  const loop = stripComments(read('lib/agent/reviewLoop.ts'))

  it('mostRecentlyTexted has three outcomes and unavailable means CONFIRM', () => {
    // This returned `string | null` and the caller computed
    // `outOfContext: !!top && top !== draft.id`, so a failed read produced
    // `false` — silently skipping the one guard between a reviewer's typo and a
    // real quote reaching the wrong real customer.
    const fn = bodyOf(loop, 'mostRecentlyTexted')
    expect(fn).not.toBe('')
    // `return { ok: … }`, not a bare `ok: false` — the function's own RETURN TYPE
    // annotation spells both, so my first version of this rule was satisfied by
    // the type while the harness had replaced the whole error branch with
    // `return { ok: true, id: null }`. The signature is not the behaviour.
    expect(fn).toMatch(/return \{ ok: false, error: error\.message \}/)
    expect(fn).toMatch(/return \{ ok: true, id:/)
    // And the error branch has to be reached from an actual error test.
    expect(fn).toMatch(/if \(error\) \{[\s\S]{0,200}return \{ ok: false/)
    expect(loop).toMatch(/!top\.ok \|\|/)
  })

  it('resolveDraft reports a read failure as a read failure', () => {
    // "I can't find a draft matching HH-2026-0042" over a Supabase timeout is a
    // confident false statement about a row that is sitting right there, to the
    // one person who could act on it (rules 10 and 12).
    const fn = bodyOf(loop, 'resolveDraft')
    expect(fn).not.toBe('')
    // BOTH reads, counted. `resolveDraft` has two — the named-code lookup and the
    // open-draft list — and the `Resolution` type also spells `kind:
    // 'unavailable'`, so a rule that merely finds the string was satisfied by the
    // type plus whichever branch the harness had not removed. Count the returns.
    const returns = fn.match(/return \{ kind: 'unavailable', error: error\.message \}/g) ?? []
    expect(returns.length).toBe(2)
    // And each one must sit immediately after its own error test, not somewhere
    // else in the function.
    const guarded = fn.match(/if \(error\) return \{ kind: 'unavailable', error: error\.message \}/g) ?? []
    expect(guarded.length).toBe(2)
    expect(loop).toMatch(/resolution\.kind === 'unavailable'/)
    expect(loop).toMatch(/couldn.t look that up/)
  })

  it('the ambiguity list does not report its own limit as a count', () => {
    // "There are 10 open drafts" whenever there were ten or more. Production has
    // fifteen. A number in a message to a human is read as a fact.
    expect(bodyOf(loop, 'OPEN_LIST_LIMIT')).not.toBe('')
    expect(loop).toMatch(/OPEN_LIST_LIMIT \+ 1/)
    expect(loop).toMatch(/truncated/)
    expect(loop).toMatch(/more than \$\{/)
  })
})

/* ── R7 · The budget ─────────────────────────────────────────────────── */

describe('R7 · the daily cap counts all of the agent’s spend and fails closed', () => {
  const dispatch = stripComments(read('app/api/cron/agent-dispatch/route.ts'))

  it('counts by entity, not by a single actor', () => {
    // The agent bills under four actors: AGENT, agent:distill, admin:<email> /
    // 'ADMIN', and REVIEWER:+1…. Production already held six llm_call rows the
    // cap could not see.
    const fn = bodyOf(dispatch, 'spentTodayUsd')
    expect(fn).not.toBe('')
    expect(fn).toMatch(/AGENT_SPEND_ENTITIES/)
    expect(fn).not.toMatch(/\.eq\('actor'/)
    expect(bodyOf(dispatch, 'AGENT_SPEND_ENTITIES')).toMatch(/agent_learning/)
  })

  it('an unreadable ledger stands the run down rather than reading zero', () => {
    const fn = bodyOf(dispatch, 'spentTodayUsd')
    expect(fn).not.toBe('')
    // Anchored INSIDE the error branch, and the anchoring took two goes.
    //
    // v1 asserted only that `return null` appeared in the function; the harness
    // replaced the error branch with `return 0` and `if (!data) return null` two
    // lines below kept the rule happy. v2 was `if (error) {[\s\S]{0,200}return
    // null`, which is the SAME defect with a window bolted on — 200 characters
    // still reaches the next branch's `return null`. Rule 8 applied to my own fix
    // for a rule-8 problem, which is how link 21 described its own three.
    //
    // The construct: the first `return null` after `if (error) {` must come before
    // any subsequent `if (`, so the match cannot escape the block it is about.
    expect(fn).toMatch(/if \(error\) \{(?:(?!\bif\s*\()[\s\S])*?return null/)
    expect(dispatch).toMatch(/spent === null/)
    // And it says so, rather than reporting a clean run (rule 10).
    expect(dispatch).toMatch(/standing down this run/)
  })
})

/* ── R8 · The inbound edge fails closed ──────────────────────────────── */

describe('R8 · an unsigned inbound SMS cannot approve a draft', () => {
  const quo = stripComments(read('app/api/webhooks/quo/route.ts'))

  it('an unset secret is closed in production', () => {
    // `if (!secret) return null` meant SKIP VERIFICATION. That was honest in
    // Phase 2, when this route only logged an opt-out. It became a latent hole
    // the moment an inbound SMS could approve a draft and send a real customer
    // an email and a text.
    expect(bodyOf(quo, 'unsignedRequestsAllowed')).not.toBe('')
    expect(quo).toMatch(/unsignedRequestsAllowed\(\) \? null : false/)
    expect(bodyOf(quo, 'unsignedRequestsAllowed')).toMatch(/phase-production-build/)
  })

  it('still rejects a present-but-wrong signature', () => {
    expect(quo).toMatch(/verified === false/)
    expect(quo).toMatch(/status: 401/)
  })

  it('the webhook cannot reach the customer-send path, even transitively', () => {
    // Enforced by the module graph, not only by discipline: it imports
    // lib/agent/reviewers and never lib/agent/reviewLoop or sendApproved.
    expect(quo).toMatch(/from '@\/lib\/agent\/reviewers'/)
    expect(quo).not.toMatch(/agent\/reviewLoop|agent\/sendApproved/)
  })
})

/* ── R9 · Every write reads its error ────────────────────────────────── */

describe('R9 · no write on the surface discards its own error', () => {
  it('every supabase write on the surface captures a result', () => {
    const offenders: string[] = []
    let examined = 0
    for (const rel of [...SURFACE, ...SURFACE_ROUTES]) {
      const src = stripComments(read(rel))
      const re = /\.(insert|upsert|update|delete)\s*\(/g
      let m: RegExpExecArray | null
      while ((m = re.exec(src)) !== null) {
        // Walk back to the nearest real statement boundary.
        //
        // NEWLINES ARE NOT ONE, and getting that wrong is how the first version
        // of this rule examined SEVEN of twenty-three writes and found its one
        // real offender by luck. Every supabase call in this codebase is a chain
        // spanning several lines, so stopping at `\n` yields a head of pure
        // indentation: the capture test then matches nothing (so a captured write
        // reads as bare) and the `.from(` proximity test fails (so most writes are
        // skipped entirely). Link 21's family — the rule matched, but not over the
        // occurrences that mattered.
        let i = m.index
        while (i > 0 && !';{}'.includes(src[i - 1])) i--
        const head = src.slice(i, m.index).replace(/\s+/g, ' ').trim()
        if (!/\.from\s*\(/.test(head)) continue // not a supabase table write
        examined++
        const captured =
          /^(?:const|let|var)\b/.test(head) ||
          /^return\b/.test(head) ||
          /=\s*await\b/.test(head) ||
          // `.then(({ error }) => …)` does read it, even though it reads as a bare
          // write to a human and to every source-reading tool. Accepted here.
          /\.then\s*\(\s*\(\s*\{/.test(src.slice(m.index, m.index + 400))
        if (!captured) offenders.push(`${rel}: …${head.slice(-70)}.${m[1]}(…)`)
      }
    }
    // Count what was examined: "no offenders" over seven writes is not a result
    // about twenty-three of them.
    expect(examined).toBeGreaterThanOrEqual(20)
    expect(offenders).toEqual([])
  })
})

/* ── R10 · The fences that must not quietly move ─────────────────────── */

describe('R10 · the load-bearing fences are still where they were', () => {
  it('is_active is never set by a propose path', () => {
    // THE fence: `agent_learnings.is_active` DEFAULTS FALSE and the distiller may
    // only propose, so the customer→prompt chain ends at a human.
    const learnings = stripComments(read('lib/agent/learnings.ts'))
    const propose = bodyOf(learnings, 'proposeLearning')
    expect(propose).not.toBe('')
    expect(propose).not.toMatch(/is_active/)
    const voice = stripComments(read('lib/agent/voice.ts'))
    expect(bodyOf(voice, 'proposeVoiceProfile')).toMatch(/is_active: false/)
  })

  it('the learned-rule screen is the SAME one a draft is screened with', () => {
    const learnings = stripComments(read('lib/agent/learnings.ts'))
    expect(learnings).toMatch(/from '\.\/draftGuards'/)
    const screen = bodyOf(learnings, 'screenLearningText')
    expect(screen).toMatch(/containsFabricatedTerms/)
    expect(screen).toMatch(/containsForeignContact/)
  })

  it('the voice profile is screened on the way OUT as well as in', () => {
    const voice = stripComments(read('lib/agent/voice.ts'))
    expect(bodyOf(voice, 'loadVoiceProfile')).toMatch(/sanitizeVoiceProfile/)
    expect(bodyOf(voice, 'activateVoiceProfile')).toMatch(/sanitizeVoiceProfile/)
    expect(bodyOf(voice, 'sanitizeVoiceProfile')).not.toBe('')
  })

  it('active learnings are screened on the way out too', () => {
    const learnings = stripComments(read('lib/agent/learnings.ts'))
    expect(bodyOf(learnings, 'loadActiveLearnings')).toMatch(/screenLearningText/)
  })

  it('the send path runs no model call', () => {
    const send = stripComments(read('lib/agent/sendApproved.ts'))
    expect(send).not.toMatch(/api\.anthropic\.com/)
    expect(send).not.toMatch(/ANTHROPIC_API_KEY/)
  })

  it('reviewer identity is by phone number and nothing else', () => {
    const reviewers = stripComments(read('lib/agent/reviewers.ts'))
    expect(reviewers).toMatch(/reviewerPhones\(\)\.includes/)
    const loop = stripComments(read('lib/agent/reviewLoop.ts'))
    // The check is first and unconditional: nothing may read the body before it.
    const handler = loop.indexOf('export async function handleReviewerReply')
    const check = loop.indexOf('isReviewerPhone(from)', handler)
    const parse = loop.indexOf('parseReviewerReply(text)', handler)
    expect(check).toBeGreaterThan(handler)
    expect(check).toBeLessThan(parse)
  })

  it('every Claude call finds the first TEXT block, never content[0]', () => {
    // Hard-won rule 1. Four call sites now.
    let callers = 0
    for (const rel of SURFACE) {
      const src = stripComments(read(rel))
      if (!/api\.anthropic\.com/.test(src)) continue
      callers++
      expect(src).toMatch(/find\(b => b\.type === 'text'\)/)
      expect(src).not.toMatch(/content\[0\]/)
    }
    expect(callers).toBeGreaterThanOrEqual(3)
  })

  it('the triage model call carries no effort key', () => {
    // Rule 2: `output_config.effort` works on Sonnet 5 and 400s the whole request
    // on Haiku 4.5, which is how the first production Gmail run failed every
    // single message.
    for (const rel of ['lib/agent/triage.ts', 'lib/agent/extractPlanFields.ts']) {
      const src = stripComments(read(rel))
      expect(src).toMatch(/triageModel\(\)/)
      expect(src).not.toMatch(/effort:/)
    }
  })
})
