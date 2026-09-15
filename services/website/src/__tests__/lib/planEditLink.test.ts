/**
 * "Edit plan" on `/plan/[ref]/summary` points at `/party-planner`, the IN-STUDIO
 * builder. Opening it against a mobile party threw a client-side exception, so
 * the link is now gated to `in_studio_theme` only.
 *
 * Two halves, because the predicate being right proves nothing if the page has
 * stopped calling it:
 *
 *   1. `canEditPlanInBuilder` answers correctly for every `party_type` the
 *      column can hold, plus NULL.
 *   2. The summary page still renders the link THROUGH that predicate — and no
 *      customer-facing `/party-planner` link survives ungated on that page.
 *
 * The second half reads source, which the tripwire lesson says is the half that
 * quietly stops matching. So it counts what it examined and fails if the file or
 * the anchor is gone, rather than passing on an empty search.
 */

import fs from 'fs'
import path from 'path'
import { canEditPlanInBuilder } from '@/lib/planInvoice'
import { PARTY_TYPES } from '@/lib/pipelineStages'

const SUMMARY_PAGE = path.join(process.cwd(), 'src/app/plan/[ref]/summary/page.tsx')

describe('canEditPlanInBuilder', () => {
  it('allows only an in-studio theme party', () => {
    expect(canEditPlanInBuilder('in_studio_theme')).toBe(true)
  })

  it.each(['mobile_party', 'studio_rental', 'unknown'])('refuses %s', partyType => {
    expect(canEditPlanInBuilder(partyType)).toBe(false)
  })

  // The bug that started this: a mobile party offered the link and the builder
  // threw. Named separately so a regression says which party type broke.
  it('refuses a mobile party — the crash this gate exists for', () => {
    expect(canEditPlanInBuilder('mobile_party')).toBe(false)
  })

  it('refuses an unclassified plan — party_type is NULLable', () => {
    expect(canEditPlanInBuilder(null)).toBe(false)
    expect(canEditPlanInBuilder(undefined)).toBe(false)
  })

  // An allowlist, so a party type added to the enum later is refused until
  // someone decides otherwise. This fails loudly the day PARTY_TYPES grows.
  it('refuses every party type except in_studio_theme, whatever the enum holds', () => {
    const allowed = PARTY_TYPES.filter(t => canEditPlanInBuilder(t))
    expect(allowed).toEqual(['in_studio_theme'])
  })
})

describe('the summary page renders "Edit plan" through the gate', () => {
  let source: string

  beforeAll(() => {
    // Fail on a missing file rather than letting every assertion below vacuously
    // pass against an empty string if the page is ever moved.
    expect(fs.existsSync(SUMMARY_PAGE)).toBe(true)
    source = fs.readFileSync(SUMMARY_PAGE, 'utf8')
    expect(source.length).toBeGreaterThan(0)
  })

  it('imports and calls the predicate', () => {
    expect(source).toContain('canEditPlanInBuilder')
    expect(source).toMatch(/canEditPlanInBuilder\(\s*invoice\.partyType\s*\)/)
  })

  it('has no ungated /party-planner link left on the page', () => {
    // Count what was examined. Every occurrence must sit inside the gated block,
    // so there must be at least one and the gate must precede it.
    const offsets: number[] = []
    const re = /\/party-planner/g
    for (let m = re.exec(source); m !== null; m = re.exec(source)) offsets.push(m.index)
    expect(offsets.length).toBeGreaterThan(0)

    const gateAt = source.indexOf('canEditPlanInBuilder(invoice.partyType)')
    expect(gateAt).toBeGreaterThan(-1)
    for (const offset of offsets) {
      expect(offset).toBeGreaterThan(gateAt)
    }
  })
})
