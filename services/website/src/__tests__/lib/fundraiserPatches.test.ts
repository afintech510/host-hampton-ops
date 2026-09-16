import {
  PATCH_COST_CENTS,
  PATCH_UNIT_PRICE_CENTS,
  isLoosePatchInput,
  patchLineName,
  patchOrderLine,
  patchPriceCents,
  patchPriceDollars,
  totalPatchQty,
} from '@/lib/fundraiserPatches'
import { screenCmCheerTotals } from '@/lib/cmCheerOrder'

describe('patchPriceCents', () => {
  it('charges list price below the tier', () => {
    expect(patchPriceCents(0)).toBe(0)
    expect(patchPriceCents(1)).toBe(800)
    expect(patchPriceCents(2)).toBe(1600)
  })

  it('applies the 3-for-$20 tier', () => {
    expect(patchPriceCents(3)).toBe(2000)
  })

  it('charges the tier rate beyond the third patch', () => {
    expect(patchPriceCents(4)).toBe(2665)
    expect(patchPriceCents(5)).toBe(3330)
    expect(patchPriceCents(10)).toBe(2000 + 7 * 665)
  })

  it('never returns a fraction of a cent', () => {
    // 6.65 * 3 in floating point is 19.949999999999996. Anything that leaks a
    // float here gets compared for equality against the server's sum.
    for (let n = 0; n <= 40; n++) {
      expect(Number.isInteger(patchPriceCents(n))).toBe(true)
    }
  })

  it('treats nonsense quantities as nothing bought', () => {
    expect(patchPriceCents(-1)).toBe(0)
    expect(patchPriceCents(NaN)).toBe(0)
    expect(patchPriceCents(Infinity)).toBe(0)
  })

  it('reports dollars for the page total', () => {
    expect(patchPriceDollars(3)).toBe(20)
    expect(patchPriceDollars(5)).toBe(33.3)
  })
})

describe('the tier mixes across designs', () => {
  // Adam's rule, 2026-09-16: "if they choose 3 patches it can be 2 of 1 and 1
  // of the other". This is the behaviour the old per-card tiering got wrong.
  it('prices 2 circle + 1 script as three patches, not two lots', () => {
    const mix = [
      { design: 'Circle', qty: 2 },
      { design: 'Script', qty: 1 },
    ]
    expect(totalPatchQty(mix)).toBe(3)
    expect(patchOrderLine(mix)!.line_total).toBe(20)
  })

  it('charges the same for a mix as for three of one design', () => {
    const three = patchPriceCents(3)
    expect(patchPriceCents(totalPatchQty([{ design: 'Circle', qty: 3 }]))).toBe(three)
    expect(
      patchPriceCents(totalPatchQty([
        { design: 'Circle', qty: 1 },
        { design: 'Script', qty: 2 },
      ])),
    ).toBe(three)
  })

  it('does NOT tier each design separately', () => {
    // The bug being guarded: 2 + 1 priced per card is $16 + $8 = $24.
    const mix = [
      { design: 'Circle', qty: 2 },
      { design: 'Script', qty: 1 },
    ]
    const perCard = mix.reduce((c, s) => c + patchPriceCents(s.qty), 0)
    expect(perCard).toBe(2400)
    expect(patchOrderLine(mix)!.line_total).toBe(20)
  })
})

describe('patchLineName', () => {
  it('keeps a single design plainly named', () => {
    expect(patchLineName([{ design: 'Circle', qty: 2 }])).toBe('Circle Patch')
    expect(patchLineName([
      { design: 'Circle', qty: 2 },
      { design: 'Script', qty: 0 },
    ])).toBe('Circle Patch')
  })

  it('spells out a mix so it can be packed', () => {
    expect(patchLineName([
      { design: 'Circle', qty: 2 },
      { design: 'Script', qty: 1 },
    ])).toBe('Patches (2x Circle, 1x Script)')
  })

  it('is empty when nothing was chosen', () => {
    expect(patchLineName([])).toBe('')
    expect(patchLineName([{ design: 'Circle', qty: 0 }])).toBe('')
  })

  it('names every design that was actually ordered', () => {
    const name = patchLineName([
      { design: 'Circle', qty: 2 },
      { design: 'Script', qty: 1 },
    ])
    for (const design of ['Circle', 'Script']) {
      expect(name).toContain(design)
    }
  })
})

describe('patchOrderLine', () => {
  it('is null when no patch was chosen', () => {
    expect(patchOrderLine([])).toBeNull()
    expect(patchOrderLine([{ design: 'Circle', qty: 0 }, { design: 'Script', qty: 0 }])).toBeNull()
  })

  it('reports the LIST unit price, not the tiered average', () => {
    const line = patchOrderLine([{ design: 'Circle', qty: 3 }])!
    expect(line.unit_price).toBe(PATCH_UNIT_PRICE_CENTS / 100)
    expect(line.line_total).toBe(20)
    // The discount must stay visible; 20/3 would hide it.
    expect(line.unit_price).not.toBeCloseTo(line.line_total / line.qty)
  })

  it('costs the same per patch whichever design', () => {
    const line = patchOrderLine([
      { design: 'Circle', qty: 2 },
      { design: 'Script', qty: 1 },
    ])!
    expect(line.cost_per_unit).toBe(PATCH_COST_CENTS / 100)
    expect(line.qty).toBe(3)
  })
})

describe('isLoosePatchInput', () => {
  it('accepts only an explicit opt-in', () => {
    expect(isLoosePatchInput({ dataset: { tier: 'patch' } })).toBe(true)
    expect(isLoosePatchInput({ dataset: {} })).toBe(false)
    expect(isLoosePatchInput({})).toBe(false)
  })

  it('does not tier a PRODUCT row whose id or name mentions a patch', () => {
    // The trap the old `id.startsWith('qty-patch')` rule set: every product is
    // a patch choice now, so patch-shaped ids and names are everywhere. None of
    // them may pick up $6.65 patch pricing on a $25 hat.
    const productRows = [
      { id: 'qty-patch-hat-navy', dataset: { name: 'Navy Trucker Hat — Circle Patch', price: '25' } },
      { id: 'qty-hat-navy-circle', dataset: { name: 'Navy Trucker Hat — Circle Patch', price: '25' } },
      { id: 'qty-patchwork-tote', dataset: { name: 'Patchwork Tote', price: '40' } },
    ]
    for (const row of productRows) {
      expect(isLoosePatchInput(row)).toBe(false)
    }
  })
})

describe('the money the server will accept', () => {
  // The page sends line_total and the server re-adds the lines. If these two
  // disagree by a cent, a real order gets a "did not match the items" note.
  it('reconciles a mixed order against screenCmCheerTotals with no note', () => {
    const hat = { name: 'Navy Trucker Hat — Circle Patch', qty: 1, unit_price: 25, line_total: 25, cost_per_unit: 20 }
    const tote = { name: 'Silver Canvas Tote — Script Patch', qty: 1, unit_price: 40, line_total: 40, cost_per_unit: 30 }
    const patches = patchOrderLine([
      { design: 'Circle', qty: 2 },
      { design: 'Script', qty: 1 },
    ])!

    const items = [hat, tote, patches]
    const total = items.reduce((t, i) => t + i.line_total, 0)
    const cost = items.reduce((t, i) => t + i.cost_per_unit * i.qty, 0)

    const screened = screenCmCheerTotals(total, cost, total - cost, items)
    expect(screened.ok).toBe(true)
    if (!screened.ok) return
    expect(screened.subtotalCents).toBe(8500) // 25 + 40 + 20
    expect(screened.costCents).toBe(6500) // 20 + 30 + 3*5
    expect(screened.note).toBeNull()
  })

  it('reconciles the awkward tier quantities too', () => {
    for (const qty of [4, 5, 7, 11]) {
      const line = patchOrderLine([
        { design: 'Circle', qty: qty - 1 },
        { design: 'Script', qty: 1 },
      ])!
      const cost = line.cost_per_unit * line.qty
      const screened = screenCmCheerTotals(line.line_total, cost, line.line_total - cost, [line])
      expect(screened.ok).toBe(true)
      if (!screened.ok) continue
      expect(screened.note).toBeNull()
      expect(screened.subtotalCents).toBe(patchPriceCents(qty))
    }
  })
})
