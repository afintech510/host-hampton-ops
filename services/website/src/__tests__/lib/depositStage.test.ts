/**
 * The stage at which a customer may pay a deposit — one rule, two call sites.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * `/api/party-builder/save` writes `status: 'awaiting_deposit'` when it CREATES
 * a booking. Its UPDATE branch — the one taken when the plan already exists,
 * which is every lead that arrived through the website form and was priced in
 * the planner afterwards — never touched `status` at all. Meanwhile the
 * builder's pay block tested the literal `status === 'awaiting_deposit'`.
 *
 * So pricing a lead left it at `lead`, and `lead` is recognised by nothing: the
 * builder hid its only payment module, and the admin panel's Approve button is
 * scoped to `pending_review`/`deposit_paid` and did not apply either. The plan
 * had no way forward from any surface.
 *
 * Measured in production 2026-09-23: HH-PTY-SEJ4P (Lauren Kovar, $750 Glow
 * Party, party 2026-10-18) opened her own portal link and was shown no way to
 * pay. HH-PTY-KMXWM ($1,250 mobile party, `quoted`) was one stage along in the
 * same hole. Both had priced line items, a date, and zero `booking_payments`.
 *
 * ── Why a tripwire and not only behaviour tests ──────────────────────────
 *
 * The predicates below are three lines each; a test that only exercises them
 * proves nothing about the bug, because the bug was that the call sites did not
 * ASK them. R1 and R2 slice each call site's own expression and fail if the
 * literal comes back. They are lexers: they prove the site names the shared
 * rule, not that the rule's answer is honoured downstream. The behaviour half
 * is `planBalance`/`planPayLinks`, which price what the button then charges.
 */

import fs from 'fs'
import path from 'path'
import {
  PRE_DEPOSIT_STAGES,
  PIPELINE_STAGES,
  canTakeDeposit,
  shouldAdvanceToAwaitingDeposit,
} from '@/lib/pipelineStages'

const SRC = path.join(process.cwd(), 'src')
const SAVE_ROUTE = path.join(SRC, 'app', 'api', 'party-builder', 'save', 'route.ts')
const BUILDER = path.join(SRC, 'app', 'party-builder', 'PartyBuilderContent.tsx')

/**
 * Both files carry long prose quoting the very statuses these rules are about,
 * so every rule below reads decommented source. Same one-pass, leftmost-match
 * lexer `cronSurface.test.ts` established, for the same reason.
 */
function decomment(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\/|(^|[^:'"`\\])\/\/[^\n\r]*/g, (m, p) => {
    const keep = p ?? ''
    return keep + m.slice(keep.length).replace(/[^\n\r]/g, ' ')
  })
}

/** Tolerates CRLF — these files are edited on Windows. */
function read(file: string): string {
  return decomment(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'))
}

describe('canTakeDeposit', () => {
  it('says yes at every stage where the plan is priced and unpaid', () => {
    expect(canTakeDeposit('lead')).toBe(true)
    expect(canTakeDeposit('quoted')).toBe(true)
    expect(canTakeDeposit('awaiting_deposit')).toBe(true)
  })

  it('is the exact set HH-PTY-SEJ4P and HH-PTY-KMXWM sat in', () => {
    // The regression, named. `lead` and `quoted` answering false is the whole
    // of what hid the payment module from two paying customers.
    expect(canTakeDeposit('lead')).toBe(true)
    expect(canTakeDeposit('quoted')).toBe(true)
  })

  it('says no once money has landed or the party is over', () => {
    for (const s of ['deposit_paid', 'approved', 'modifications_locked', 'paid_in_full', 'completed', 'cancelled']) {
      expect(canTakeDeposit(s)).toBe(false)
    }
  })

  it('says yes for a planner session with no booking row yet', () => {
    // The pre-save request flow, which is what CREATES the booking. A null here
    // must not be read as "not awaiting_deposit".
    expect(canTakeDeposit(null)).toBe(true)
    expect(canTakeDeposit(undefined)).toBe(true)
  })

  it('refuses an unknown status rather than defaulting open', () => {
    expect(canTakeDeposit('')).toBe(false)
    expect(canTakeDeposit('awaiting_Deposit')).toBe(false)
    expect(canTakeDeposit('lead ')).toBe(false)
  })

  it('only names stages the CHECK constraint allows', () => {
    // A stage this set invents is a stage no booking can ever hold, which is
    // the quietest possible way for this rule to match nothing.
    for (const s of PRE_DEPOSIT_STAGES) {
      expect(PIPELINE_STAGES as readonly string[]).toContain(s)
    }
  })
})

describe('shouldAdvanceToAwaitingDeposit', () => {
  it('advances the two stages that precede it', () => {
    expect(shouldAdvanceToAwaitingDeposit('lead')).toBe(true)
    expect(shouldAdvanceToAwaitingDeposit('quoted')).toBe(true)
  })

  it('never walks a plan BACKWARDS', () => {
    // The reason this is a predicate and not `status = 'awaiting_deposit'` on
    // every update: this route also saves edits to plans that have been paid.
    // Re-pricing an approved party must not un-approve it.
    for (const s of ['awaiting_deposit', 'pending_review', 'deposit_paid', 'approved', 'modifications_locked', 'paid_in_full', 'completed', 'cancelled']) {
      expect(shouldAdvanceToAwaitingDeposit(s)).toBe(false)
    }
  })

  it('leaves a booking that does not exist yet alone', () => {
    expect(shouldAdvanceToAwaitingDeposit(null)).toBe(false)
    expect(shouldAdvanceToAwaitingDeposit(undefined)).toBe(false)
  })

  it('advances only into a stage the pay block accepts', () => {
    // The two halves of the fix, checked against each other: the status the
    // save route writes has to be one `canTakeDeposit` says yes to, or quoting
    // a lead would move it out of `lead` and STILL leave no pay button.
    expect(canTakeDeposit('awaiting_deposit')).toBe(true)
  })
})

describe('the call sites ask the shared rule', () => {
  it('R1: the save route advances the status on its UPDATE path', () => {
    const src = read(SAVE_ROUTE)
    expect(src).toContain('shouldAdvanceToAwaitingDeposit')

    // Sliced to the `updateData` object and the statements that follow it, so
    // this cannot be satisfied by the INSERT branch's own `awaiting_deposit` —
    // which was always there and was never the defect.
    const anchor = src.indexOf('const updateData')
    expect(anchor).toBeGreaterThan(-1)
    const updateBranch = src.slice(anchor, src.indexOf('.from(\'bookings\').update(updateData)', anchor))
    expect(updateBranch).toContain('shouldAdvanceToAwaitingDeposit')
    expect(updateBranch).toMatch(/updateData\.status\s*=\s*'awaiting_deposit'/)
  })

  it('R2: the builder pay block tests the rule, not the literal', () => {
    const src = read(BUILDER)
    const anchor = src.indexOf("id=\"sec-book\"")
    expect(anchor).toBeGreaterThan(-1)
    // The single JSX condition that opens the pay block. Sliced from the
    // section anchor to the end of that expression rather than grepping the
    // 3,000-line file, because `awaiting_deposit` appears elsewhere in it.
    // Bounded by the element the block opens (`ref={payRef}`), never by a
    // character count: `decomment` blanks prose in place, so a fixed window
    // measures how much COMMENT sits above the condition rather than where the
    // condition is. This slice is exactly the JSX test and nothing else.
    const end = src.indexOf('ref={payRef}', anchor)
    expect(end).toBeGreaterThan(anchor)
    const block = src.slice(anchor, end)
    expect(block).toContain('canTakeDeposit(loadedBooking?.status)')
    expect(block).not.toContain("=== 'awaiting_deposit'")
  })

  it('R3: neither call site keeps a private copy of the stage list', () => {
    // Rule 11: a concept defined twice is a concept nothing is checking. This
    // bug WAS that duplication. Outside the import line, neither file may
    // compare a status to the literal again.
    for (const file of [SAVE_ROUTE, BUILDER]) {
      const src = read(file)
      expect(src).not.toMatch(/status\s*===\s*'awaiting_deposit'/)
      expect(src).not.toMatch(/'lead'\s*,\s*'quoted'/)
    }
  })

  it('R4: the rules above examined the files they claim to', () => {
    // A path that stopped resolving would make every rule here vacuously pass.
    for (const file of [SAVE_ROUTE, BUILDER]) {
      expect(fs.existsSync(file)).toBe(true)
      expect(read(file).length).toBeGreaterThan(2000)
    }
  })
})
