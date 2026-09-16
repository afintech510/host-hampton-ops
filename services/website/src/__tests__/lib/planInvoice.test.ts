/**
 * The invoice view model (Phase 5 item 1).
 *
 * The page itself is a rendering of this, so the properties worth locking down
 * are all here: the studio deposit rule, what counts towards a total, the
 * numbering's idempotency, and the two things the mobile menu must not do.
 */

import {
  docTitleFor,
  formatClockTime,
  formatEventDateTime,
  hiddenSectionsFrom,
  orderLineItems,
  loadPlanInvoice,
  money,
} from '@/lib/planInvoice'
import { contentFromRows, FALLBACK_CONTENT_ROWS } from '@/lib/planContent'
import { ensureInvoiceNumber } from '@/lib/invoiceNumber'
import type { BookingLineItem } from '@/types/booking-flow'

const item = (over: Partial<BookingLineItem> & Record<string, unknown> = {}): BookingLineItem =>
  ({
    name: 'Thing',
    category: 'addon',
    quantity: 1,
    unit_price_cents: 10000,
    price_type: 'flat',
    guest_multiplied: false,
    sort_order: 0,
    ...over,
  }) as BookingLineItem

describe('money', () => {
  it('formats cents the way the template does', () => {
    expect(money(0)).toBe('$0.00')
    expect(money(25000)).toBe('$250.00')
    expect(money(140100)).toBe('$1,401.00')
  })
})

describe('docTitleFor', () => {
  it('names the product', () => {
    expect(docTitleFor('studio_rental', 'lead')).toBe('Studio Rental Quotation')
    expect(docTitleFor('mobile_party', 'lead')).toBe('Mobile Party Quotation')
  })

  it('becomes an Invoice once the deposit is paid', () => {
    // SKILL.md's own rule: it stops being a quote when it becomes a booking.
    expect(docTitleFor('studio_rental', 'deposit_paid')).toBe('Studio Rental Invoice')
    expect(docTitleFor('mobile_party', 'paid_in_full')).toBe('Mobile Party Invoice')
  })

  it('falls back rather than rendering a blank title for an unclassified lead', () => {
    expect(docTitleFor('unknown', 'lead')).toBe('Party Quotation')
    expect(docTitleFor('something_new', null)).toBe('Party Quotation')
  })
})

describe('formatClockTime', () => {
  it('turns the stored 24-hour clock into the one a customer reads', () => {
    // The whole point: `party_time` holds '17:00' on 25 of 30 live rows, and the
    // invoice printed it that way — including on HH-PTY-NVLCP, a corporate quote.
    expect(formatClockTime('17:00')).toBe('5:00 PM')
    expect(formatClockTime('09:30')).toBe('9:30 AM')
  })

  it('gets both ends of the 12-hour wrap right', () => {
    expect(formatClockTime('00:15')).toBe('12:15 AM')
    expect(formatClockTime('12:00')).toBe('12:00 PM')
  })

  it('passes through anything that is not a clock rather than guessing', () => {
    // 'TBD' is a real stored value, and so is prose. Mangling it would be worse
    // than leaving it alone.
    expect(formatClockTime('TBD')).toBe('TBD')
    expect(formatClockTime('5-7pm')).toBe('5-7pm')
    expect(formatClockTime('25:00')).toBe('25:00')
    expect(formatClockTime('11:75')).toBe('11:75')
  })
})

describe('formatEventDateTime', () => {
  it('reads as a date a human would say out loud', () => {
    expect(formatEventDateTime('2026-03-14', '11:00')).toBe('Saturday, March 14, 2026 · 11:00 AM')
  })

  it('formats the clock even when the date half is free text', () => {
    expect(formatEventDateTime('mid-March', '17:00')).toBe('mid-March · 5:00 PM')
  })

  it('does not shift the day', () => {
    // A party_date is a calendar day. Building it in local time puts an early
    // date one day west, which is how an invoice ends up naming the wrong
    // Saturday.
    expect(formatEventDateTime('2026-01-01', null)).toBe('Thursday, January 1, 2026')
  })

  it('says nothing rather than guessing when there is no date yet', () => {
    expect(formatEventDateTime(null, '11:00')).toBeNull()
  })
})

describe('orderLineItems', () => {
  it('puts the featured package first and the optional add-ons last', () => {
    const out = orderLineItems(
      [
        item({ name: 'Extra hour' }),
        item({ name: 'Balloon arch', is_optional: true }),
        item({ name: 'Studio Rental — 3 hours', is_featured: true }),
      ],
      10,
    )
    expect(out.map(i => i.name)).toEqual(['Studio Rental — 3 hours', 'Extra hour', 'Balloon arch'])
  })

  it('multiplies a per-guest item by the guest count', () => {
    const [row] = orderLineItems([item({ unit_price_cents: 3500, guest_multiplied: true })], 12)
    expect(row.amountCents).toBe(42000)
  })
})

/* ── The whole thing, against a stubbed DB ─────────────────────────────── */

function makeSupabase(
  booking: Record<string, unknown> | null,
  items: unknown[] = [],
  errors: { booking?: { message: string }; items?: { message: string }; payments?: { message: string } } = {},
  payments: unknown[] = [],
) {
  const from = jest.fn((table: string) => {
    const chain: Record<string, unknown> = {
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
        if (table === 'bookings') {
          return Promise.resolve({ data: errors.booking ? null : booking, error: errors.booking ?? null }).then(res, rej)
        }
        if (table === 'booking_line_items') {
          return Promise.resolve({ data: errors.items ? null : items, error: errors.items ?? null }).then(res, rej)
        }
        if (table === 'booking_payments') {
          return Promise.resolve({
            data: errors.payments ? null : payments,
            error: errors.payments ?? null,
          }).then(res, rej)
        }
        // pricing_items / plan_content: empty, so both fall back to their
        // compiled seed — which is exactly the state this must still render in.
        return Promise.resolve({ data: [], error: null }).then(res, rej)
      },
    }
    for (const m of ['select', 'eq', 'in', 'order', 'limit', 'maybeSingle', 'single', 'update', 'is']) {
      chain[m] = () => chain
    }
    return chain
  })
  return { from } as never
}

const STUDIO = {
  id: 'bk-1',
  booking_ref: 'HH-PTY-AAA',
  status: 'quoted',
  party_type: 'studio_rental',
  contact_name: 'Holly Green',
  contact_email: 'holly@example.com',
  party_date: '2026-10-03',
  party_time: '11:00',
  guest_count_approx: 30,
  party_tags: {},
  invoice_number: '444124-000116',
}

describe('loadPlanInvoice', () => {
  it('STUDIO: the deposit comes off the balance, like every other product', async () => {
    const supabase = makeSupabase(STUDIO, [
      { ...item({ name: 'Studio Rental — 3 hours', unit_price_cents: 60000, is_featured: true }) },
    ])
    const res = await loadPlanInvoice('HH-PTY-AAA', supabase)
    expect(res.ok).toBe(true)
    if (!res.ok) return

    expect(res.invoice.totalCents).toBe(60000)
    expect(res.invoice.depositCents).toBe(25000)
    // needs-Adam 41, ruled 2026-09-16: the $250 is a RESERVATION payment that
    // books the date, not a damage deposit. This assertion used to read `true`
    // / 60000, which is the $250 the document overstated on every studio rental.
    expect(res.invoice.depositIsSeparate).toBe(false)
    expect(res.invoice.balanceDueCents).toBe(35000)
    expect(res.invoice.depositOwedCents).toBe(25000)
    // The refundable card hold is a different thing again, and never a charge.
    expect(res.invoice.securityHoldCents).toBe(25000)
  })

  it('MOBILE: the deposit does come off the balance', async () => {
    const supabase = makeSupabase({ ...STUDIO, party_type: 'mobile_party' }, [
      { ...item({ name: 'Mobile Party Package', unit_price_cents: 75000, is_featured: true }) },
    ])
    const res = await loadPlanInvoice('HH-PTY-AAA', supabase)
    if (!res.ok) throw new Error('expected ok')

    expect(res.invoice.depositIsSeparate).toBe(false)
    expect(res.invoice.balanceDueCents).toBe(50000)
    expect(res.invoice.securityHoldCents).toBeNull()
  })

  it('an optional add-on is quoted but never added to the total', async () => {
    const supabase = makeSupabase(STUDIO, [
      item({ name: 'Studio Rental', unit_price_cents: 60000, is_featured: true }),
      item({ name: 'Balloon arch', unit_price_cents: 20000, is_optional: true }),
    ])
    const res = await loadPlanInvoice('HH-PTY-AAA', supabase)
    if (!res.ok) throw new Error('expected ok')

    // It is on the page — with a tag — but a client must not be billed for
    // something they have not agreed to.
    expect(res.invoice.lineItems).toHaveLength(2)
    expect(res.invoice.totalCents).toBe(60000)
  })

  it('renders a lead with no line items instead of failing', async () => {
    // Every lead is a plan now, so most plans have nothing on them yet. The page
    // still has to be openable — that is the whole point of it being the place
    // the planner lands.
    const res = await loadPlanInvoice('HH-PTY-AAA', makeSupabase({ ...STUDIO, guest_count_approx: null }, []))
    if (!res.ok) throw new Error('expected ok')
    expect(res.invoice.totalCents).toBe(0)
    expect(res.invoice.lineItems).toEqual([])
  })

  it('says "not found" rather than throwing on a bad ref', async () => {
    const res = await loadPlanInvoice('HH-PTY-NOPE', makeSupabase(null))
    expect(res.ok).toBe(false)
  })

  describe('a read that FAILED is not an empty plan (hard-won rule 12)', () => {
    it('reports a failed line-items read rather than a $0 total', async () => {
      // Every figure on the invoice derives from these rows. Discarding the error
      // gave `totalCents: 0`, and `recordPlanPayment` then computed
      // `max(0, 0 - paid) = 0` — writing balance 0 and advancing the plan to
      // `paid_in_full`. Reproduced in production on a throwaway plan before this
      // fix: a $600 payment against a plan whose items could not be read marked
      // it PAID IN FULL with nothing outstanding.
      const supabase = makeSupabase(STUDIO, [], { items: { message: 'connection reset' } })
      const res = await loadPlanInvoice('HH-PTY-AAA', supabase)
      expect(res.ok).toBe(false)
      if (res.ok) throw new Error('expected failure')
      // `notFound: false` is the load-bearing half: the webhook answers 500 and
      // Stripe redelivers, instead of 200 and the payment being lost.
      expect(res.notFound).toBe(false)
      expect(res.error).toMatch(/line items/)
    })

    it('still distinguishes a plan that genuinely does not exist', async () => {
      const res = await loadPlanInvoice('HH-NOPE', makeSupabase(null, []))
      expect(res).toMatchObject({ ok: false, notFound: true })
    })

    it('still separates a failed BOOKING read from an absent booking', async () => {
      const res = await loadPlanInvoice('HH-PTY-AAA', makeSupabase(STUDIO, [], { booking: { message: 'timeout' } }))
      expect(res).toMatchObject({ ok: false, notFound: false })
    })

    it('renders fine when the plan genuinely has no line items', async () => {
      // An empty plan is legitimate — a lead nobody has priced yet. It must not
      // be conflated with the failure above in the other direction either.
      const res = await loadPlanInvoice('HH-PTY-AAA', makeSupabase(STUDIO, []))
      if (!res.ok) throw new Error('expected ok')
      expect(res.invoice.totalCents).toBe(0)
      expect(res.invoice.depositCents).toBe(0)
    })

    it('reports a failed PAYMENTS read rather than saying nothing has been paid', async () => {
      // Since link 23 every figure on the document derives from these rows too.
      // Discarding the error would reproduce the exact statement that was live —
      // "Balance Due: $1,475.00" to a customer who had paid in full — on a blip
      // rather than by design, and the pay buttons would be priced as if nothing
      // had been paid. `notFound: false`, so the page says "we couldn't load
      // this" and the pay route answers 503 rather than 404.
      const res = await loadPlanInvoice(
        'HH-PTY-AAA',
        makeSupabase(STUDIO, [item({ unit_price_cents: 60000 })], { payments: { message: 'connection reset' } }),
      )
      expect(res.ok).toBe(false)
      if (res.ok) throw new Error('expected failure')
      expect(res.notFound).toBe(false)
      expect(res.error).toMatch(/payments/)
    })
  })

  describe('the Balance Due a customer reads accounts for what they have paid', () => {
    const PARTY = { ...STUDIO, party_type: 'in_studio_theme', guest_count_approx: 10 }
    const load = (payments: unknown[]) =>
      loadPlanInvoice('HH-PTY-AAA', makeSupabase(PARTY, [item({ unit_price_cents: 60000 })], {}, payments))

    it('a fresh quote still reads total minus deposit, as the template lays it out', async () => {
      const res = await load([])
      if (!res.ok) throw new Error('expected ok')
      expect(res.invoice.totalCents).toBe(60000)
      expect(res.invoice.depositOwedCents).toBe(25000)
      expect(res.invoice.balanceDueCents).toBe(35000)
    })

    /**
     * The headline defect, at its own source. `balanceDueCents` was
     * `total - the notional deposit` and no payment ever moved it. HH-PTY-6GGMB
     * and HH-PTY-PF3LJ — both real, both paid in full — were shown $1,475.00 and
     * $1,560.00 outstanding.
     */
    it('a plan paid IN FULL shows a zero balance, not the quote-time figure', async () => {
      const res = await load([{ payment_type: 'partial', amount_cents: 60000 }])
      if (!res.ok) throw new Error('expected ok')
      expect(res.invoice.outstandingCents).toBe(0)
      expect(res.invoice.balanceDueCents).toBe(0)
      expect(res.invoice.depositOwedCents).toBe(0)
    })

    it('a part payment moves it by exactly what was paid', async () => {
      // HH-2026-1052's shape: $99 paid against a $1,590 party. The column holds
      // $1,491 and the document used to print $1,340 — $151 apart.
      const res = await loadPlanInvoice(
        'HH-PTY-AAA',
        makeSupabase(PARTY, [item({ unit_price_cents: 159000 })], {}, [
          { payment_type: 'partial', amount_cents: 9900 },
        ]),
      )
      if (!res.ok) throw new Error('expected ok')
      expect(res.invoice.outstandingCents).toBe(149100)
      expect(res.invoice.depositOwedCents + res.invoice.balanceDueCents).toBe(149100)
    })

    it('carries the payment rows it derived them from, so nothing re-reads them', async () => {
      const res = await load([{ payment_type: 'partial', amount_cents: 1000 }])
      if (!res.ok) throw new Error('expected ok')
      expect(res.invoice.payments).toEqual([{ payment_type: 'partial', amount_cents: 1000 }])
      expect(res.invoice.paidCents).toBe(1000)
    })
  })

  describe('the mobile menu appendix', () => {
    it('is mobile-only', async () => {
      const studio = await loadPlanInvoice('HH-PTY-AAA', makeSupabase(STUDIO, []))
      if (!studio.ok) throw new Error('expected ok')
      expect(studio.invoice.mobileStations).toEqual([])
    })

    it('excludes a station already billed on this booking', async () => {
      const supabase = makeSupabase({ ...STUDIO, party_type: 'mobile_party' }, [
        item({ name: 'Slime', unit_price_cents: 30000, is_featured: true }),
      ])
      const res = await loadPlanInvoice('HH-PTY-AAA', supabase)
      if (!res.ok) throw new Error('expected ok')

      const names = res.invoice.mobileStations.map(s => s.name)
      // "More you could add", not a re-listing of what they just bought.
      expect(names).not.toContain('Slime')
      expect(names).toContain('Hair Tinsel')
    })

    it('carries no price of any kind', async () => {
      const res = await loadPlanInvoice('HH-PTY-AAA', makeSupabase({ ...STUDIO, party_type: 'mobile_party' }, []))
      if (!res.ok) throw new Error('expected ok')
      for (const s of res.invoice.mobileStations) {
        expect(Object.keys(s).sort()).toEqual(['emoji', 'name'])
      }
    })
  })

  /* ── Per-plan section suppression ────────────────────────────────────── */

  describe('sections one plan hides', () => {
    const mobile = (tags: Record<string, unknown>) =>
      makeSupabase({ ...STUDIO, party_type: 'mobile_party', party_tags: tags }, [])

    it('drops the kids station menu off a corporate quote', async () => {
      // HH-PTY-NVLCP: still a mobile_party, but "Adopt a Puppy" has no business
      // on a quote going to Gusto's head office.
      const res = await loadPlanInvoice('HH-PTY-AAA', mobile({ hidden_sections: ['mobile_menu'] }))
      if (!res.ok) throw new Error('expected ok')
      expect(res.invoice.mobileStations).toEqual([])
    })

    it('empties the whole good-to-know block, policies included', async () => {
      const res = await loadPlanInvoice('HH-PTY-AAA', mobile({ hidden_sections: ['good_to_know'] }))
      if (!res.ok) throw new Error('expected ok')
      expect(res.invoice.content.goodToKnow).toEqual([])
      expect(res.invoice.content.policies).toEqual([])
    })

    it('hides only what was named', async () => {
      const res = await loadPlanInvoice('HH-PTY-AAA', mobile({ hidden_sections: ['good_to_know'] }))
      if (!res.ok) throw new Error('expected ok')
      expect(res.invoice.mobileStations.length).toBeGreaterThan(0)
    })

    it('changes nothing for a plan that names no sections', async () => {
      const res = await loadPlanInvoice('HH-PTY-AAA', mobile({}))
      if (!res.ok) throw new Error('expected ok')
      expect(res.invoice.mobileStations.length).toBeGreaterThan(0)
      expect(res.invoice.content.goodToKnow.length).toBeGreaterThan(0)
    })

    it('IGNORES a value it does not recognise rather than blanking the page', async () => {
      // `party_tags` is free-form jsonb several writers merge into. A stray
      // entry must not be able to empty a section of a real customer's invoice.
      for (const junk of [['everything'], ['GOOD_TO_KNOW'], 'mobile_menu', { mobile_menu: true }, null, 42]) {
        const res = await loadPlanInvoice('HH-PTY-AAA', mobile({ hidden_sections: junk }))
        if (!res.ok) throw new Error('expected ok')
        expect(res.invoice.mobileStations.length).toBeGreaterThan(0)
        expect(res.invoice.content.goodToKnow.length).toBeGreaterThan(0)
      }
    })

    it('takes both at once', async () => {
      const res = await loadPlanInvoice(
        'HH-PTY-AAA',
        mobile({ hidden_sections: ['mobile_menu', 'good_to_know'] }),
      )
      if (!res.ok) throw new Error('expected ok')
      expect(res.invoice.mobileStations).toEqual([])
      expect(res.invoice.content.goodToKnow).toEqual([])
    })
  })

  describe('hiddenSectionsFrom', () => {
    it('reads the recognised names and drops the rest', () => {
      expect([...hiddenSectionsFrom({ hidden_sections: ['mobile_menu', 'nope'] })]).toEqual(['mobile_menu'])
      expect([...hiddenSectionsFrom({})]).toEqual([])
      expect([...hiddenSectionsFrom(null)]).toEqual([])
      expect([...hiddenSectionsFrom(undefined)]).toEqual([])
    })
  })
})

/* ── Content ───────────────────────────────────────────────────────────── */

describe('plan content', () => {
  it('gives the studio its What’s Included block and nobody else', () => {
    expect(contentFromRows(FALLBACK_CONTENT_ROWS, 'studio_rental').whatsIncluded).toContain('Dessert cart')
    // SKILL.md: omit it entirely for a mobile party.
    expect(contentFromRows(FALLBACK_CONTENT_ROWS, 'mobile_party').whatsIncluded).toEqual([])
  })

  it('keeps the two studio policy bullets verbatim', () => {
    const policies = contentFromRows(FALLBACK_CONTENT_ROWS, 'studio_rental').policies
    expect(policies).toHaveLength(2)
    expect(policies[0]).toContain('Setup & cleanup time is included in your rental window')
    expect(policies[1]).toContain('sweep-clean')
  })

  it('does not put the studio policy bullets on an off-site party', () => {
    expect(contentFromRows(FALLBACK_CONTENT_ROWS, 'mobile_party').policies).toEqual([])
  })

  it('falls back to the shared copy for a lead nobody has classified yet', () => {
    const c = contentFromRows(FALLBACK_CONTENT_ROWS, 'unknown')
    expect(c.goodToKnow.length).toBeGreaterThan(0)
    expect(c.depositLabel).toBe('Reservation Deposit — Required to Book')
  })

  it('names the studio deposit a RESERVATION deposit, like every other product', () => {
    // It used to read "Security Deposit" here, and the words were the point:
    // they told the customer the $250 was refundable damage money held apart
    // from the total. needs-Adam 41 (ruled 2026-09-16) says it is a reservation
    // payment credited against the balance, so the label has to move with the
    // arithmetic — the numbers changed on the same page as these words.
    const c = contentFromRows(FALLBACK_CONTENT_ROWS, 'studio_rental')
    expect(c.depositLabel).toBe('Reservation Deposit — Required to Book')
    expect(c.depositLabel).not.toMatch(/Security/)
    // The callout and the Balance Due line must not contradict each other.
    expect(c.depositNote).toMatch(/comes off your total/)
    expect(c.balanceNote).toMatch(/already deducted/)
    expect(c.balanceNote).not.toMatch(/not deducted/)
  })
})

/* ── Invoice numbering ─────────────────────────────────────────────────── */

describe('ensureInvoiceNumber', () => {
  function supaFor(opts: {
    existing?: string | null
    minted?: string
    /** The guarded write matched nothing: somebody else numbered it first. */
    raced?: boolean
    racedValue?: string
  }) {
    let reads = 0
    const rpc = jest.fn().mockResolvedValue({ data: opts.minted ?? '444124-000116', error: null })
    const from = jest.fn(() => {
      const ops: string[] = []
      const chain: Record<string, unknown> = {
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
          if (ops.includes('update')) {
            return Promise.resolve({ data: opts.raced ? [] : [{ invoice_number: opts.minted }], error: null }).then(res, rej)
          }
          reads++
          const value = reads === 1 ? (opts.existing ?? null) : (opts.racedValue ?? null)
          return Promise.resolve({ data: { invoice_number: value }, error: null }).then(res, rej)
        },
      }
      for (const m of ['select', 'eq', 'is', 'maybeSingle']) chain[m] = () => (ops.push(m), chain)
      chain.update = () => (ops.push('update'), chain)
      return chain
    })
    return { supabase: { from, rpc } as never, rpc }
  }

  it('issues the first number for a plan that has never had one', async () => {
    const { supabase, rpc } = supaFor({ existing: null, minted: '444124-000116' })
    const res = await ensureInvoiceNumber('bk-1', supabase)
    expect(res).toEqual({ ok: true, invoiceNumber: '444124-000116', issued: true })
    expect(rpc).toHaveBeenCalledWith('next_invoice_number')
  })

  it('a refresh does NOT burn a second number', async () => {
    // The whole reason numbering happens on render rather than at insert: most
    // leads never get quoted, and a page reload must not consume the sequence.
    const { supabase, rpc } = supaFor({ existing: '444124-000116' })
    const res = await ensureInvoiceNumber('bk-1', supabase)
    expect(res).toEqual({ ok: true, invoiceNumber: '444124-000116', issued: false })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('two tabs at once agree on one number', async () => {
    // Losing the guarded write means somebody else numbered the row. Theirs is
    // the row's number; ours is discarded, leaving a gap in the sequence — which
    // is cosmetic, unlike one booking carrying two different invoice numbers.
    const { supabase } = supaFor({ existing: null, minted: '444124-000117', raced: true, racedValue: '444124-000116' })
    const res = await ensureInvoiceNumber('bk-1', supabase)
    expect(res).toEqual({ ok: true, invoiceNumber: '444124-000116', issued: false })
  })

  it('reports "could not decide" rather than inventing a number', async () => {
    const from = jest.fn(() => {
      const chain: Record<string, unknown> = {
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: 'boom' } }).then(res),
      }
      for (const m of ['select', 'eq', 'is', 'maybeSingle', 'update']) chain[m] = () => chain
      return chain
    })
    const res = await ensureInvoiceNumber('bk-1', { from, rpc: jest.fn() } as never)
    expect(res.ok).toBe(false)
  })
})
