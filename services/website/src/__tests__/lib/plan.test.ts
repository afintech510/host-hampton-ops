/**
 * Tests for lib/plan.ts — the Party Plan layer (Phase 4).
 *
 * The properties that matter here are the ones that cost money or texts if they
 * regress:
 *   - `buildPlanSnapshot` recomputes totals and never trusts a client's figure;
 *   - `ensureLeadPlan` reuses an open plan instead of creating a second one
 *     (a duplicate plan gets its own draft and its own SMS to Adam);
 *   - a lookup failure does NOT fall through to "create a new plan";
 *   - a lead with neither email nor phone is not written at all (the 035 CHECK);
 *   - a free-text date is kept as text rather than failing the insert;
 *   - enrichment fills blanks and never overwrites what is already set;
 *   - nothing in here ever throws into the route that called it.
 */

import {
  buildPlanSnapshot,
  planTotals,
  writeLineItems,
  ensureLeadPlan,
  coerceIsoDate,
  PLAN_REUSE_WINDOW_DAYS,
} from '@/lib/plan'
import type { BookingLineItem } from '@/types/booking-flow'

/* ── Supabase double ───────────────────────────────────────────────────── */

interface SupaOpts {
  /** Rows returned by the open-plan lookups, in call order. */
  planLookups?: { data: unknown[] | null; error?: { message: string } | null }[]
  insertError?: { message: string } | null
  lineItemInsertError?: { message: string } | null
  lineItemDeleteError?: { message: string } | null
}

function makeSupabase(opts: SupaOpts = {}) {
  const inserted: { table: string; row: any }[] = []
  const updated: { table: string; row: any }[] = []
  const deleted: string[] = []
  /** Every `or=` expression `findOpenPlan` built, so a test can inspect it. */
  const orFilters: string[] = []
  let lookupIdx = 0

  function resolve(table: string, ops: [string, ...unknown[]][]) {
    const op = (name: string) => ops.find(o => o[0] === name)

    if (table === 'bookings') {
      if (op('insert')) {
        return opts.insertError
          ? { data: null, error: opts.insertError }
          : { data: { id: 'plan-1', booking_ref: 'HH-2026-0001' }, error: null }
      }
      if (op('update')) return { data: null, error: null }
      const next = opts.planLookups?.[lookupIdx++] ?? { data: [], error: null }
      return { data: next.data, error: next.error ?? null }
    }
    if (table === 'booking_line_items') {
      if (op('delete')) return { data: null, error: opts.lineItemDeleteError ?? null }
      if (op('insert')) return { data: null, error: opts.lineItemInsertError ?? null }
    }
    return { data: null, error: null }
  }

  const from = jest.fn((table: string) => {
    const ops: [string, ...unknown[]][] = []
    const chain: any = {
      then: (res: any, rej: any) => Promise.resolve(resolve(table, ops)).then(res, rej),
    }
    for (const m of ['select', 'eq', 'in', 'or', 'gte', 'order', 'limit', 'single', 'maybeSingle']) {
      chain[m] = jest.fn((...args: unknown[]) => {
        ops.push([m, ...args])
        if (m === 'or' && typeof args[0] === 'string') orFilters.push(args[0])
        return chain
      })
    }
    chain.insert = jest.fn((row: any) => {
      ops.push(['insert', row])
      inserted.push({ table, row })
      return chain
    })
    chain.update = jest.fn((row: any) => {
      ops.push(['update', row])
      updated.push({ table, row })
      return chain
    })
    chain.delete = jest.fn(() => {
      ops.push(['delete'])
      deleted.push(table)
      return chain
    })
    return chain
  })

  return {
    supabase: { from } as any,
    orFilters,
    inserted,
    updated,
    deleted,
    bookingInserts: () => inserted.filter(i => i.table === 'bookings').map(i => i.row),
    bookingUpdates: () => updated.filter(u => u.table === 'bookings').map(u => u.row),
    lineItemInserts: () => inserted.filter(i => i.table === 'booking_line_items').map(i => i.row),
    /** Calls made against `bookings` that were lookups, not writes. */
    lookupCount: () => lookupIdx,
  }
}

const item = (over: Partial<BookingLineItem> = {}): BookingLineItem => ({
  name: 'Slime Station',
  category: 'station',
  quantity: 1,
  unit_price_cents: 5000,
  price_type: 'flat',
  guest_multiplied: false,
  ...over,
})

// Keep the noise out of the test output; these paths log by design.
let errSpy: jest.SpyInstance
beforeEach(() => {
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => errSpy.mockRestore())

/* ── buildPlanSnapshot ─────────────────────────────────────────────────── */

describe('buildPlanSnapshot', () => {
  it('computes total, deposit and balance from the line items', () => {
    const snap = buildPlanSnapshot({ lineItems: [item({ unit_price_cents: 120000 })], guestCount: 20 })
    expect(snap.totalCents).toBe(120000)
    expect(snap.depositCents).toBe(25000) // flat $250, every party type
    expect(snap.balanceDueCents).toBe(95000)
  })

  it('never lets a client-supplied total survive into the snapshot', () => {
    // This is the bug the planner's quoteData passthrough used to allow: the
    // browser said the party cost $10, and that number got persisted.
    const snap = buildPlanSnapshot({
      lineItems: [item({ unit_price_cents: 120000 })],
      guestCount: 20,
      extra: { totalCents: 1000, depositCents: 1000, lineItems: [] },
    })
    expect(snap.totalCents).toBe(120000)
    expect(snap.depositCents).toBe(25000)
    expect(snap.lineItems).toHaveLength(1)
  })

  it('keeps unrelated planner selections from `extra`', () => {
    const snap = buildPlanSnapshot({ lineItems: [], extra: { theme: 'unicorn', foodChoices: ['pizza'] } })
    expect(snap.theme).toBe('unicorn')
    expect(snap.foodChoices).toEqual(['pizza'])
  })

  it('an empty plan totals zero and owes zero', () => {
    const snap = buildPlanSnapshot({})
    expect(snap.totalCents).toBe(0)
    expect(snap.balanceDueCents).toBe(0)
    expect(planTotals(snap).card_fee_rate).toBe(0.03)
  })
})

/* ── coerceIsoDate ─────────────────────────────────────────────────────── */

describe('coerceIsoDate', () => {
  it('accepts a real ISO day', () => {
    expect(coerceIsoDate('2026-11-28')).toBe('2026-11-28')
  })

  it.each(['mid-March', '3/15/2026', 'next Saturday', '', '   ', null, undefined])(
    'rejects free text (%s)',
    v => expect(coerceIsoDate(v as string)).toBeNull(),
  )

  it('rejects a well-formed but impossible day rather than rolling it over', () => {
    // new Date('2026-02-30') silently becomes March 2 — a wrong date on a plan
    // is worse than none, because the agent stops asking for it.
    expect(coerceIsoDate('2026-02-30')).toBeNull()
    expect(coerceIsoDate('2026-13-01')).toBeNull()
  })
})

/* ── writeLineItems ────────────────────────────────────────────────────── */

describe('writeLineItems', () => {
  it('writes the 035 columns with safe defaults', async () => {
    const s = makeSupabase()
    const n = await writeLineItems(s.supabase, 'plan-1', [item()])
    expect(n).toBe(1)
    const rows = s.lineItemInserts()[0]
    expect(rows[0]).toMatchObject({
      booking_id: 'plan-1',
      description: null,
      is_featured: false,
      is_optional: false,
      sort_order: 0,
    })
  })

  it('carries description / featured / optional through when supplied', async () => {
    const s = makeSupabase()
    await writeLineItems(s.supabase, 'plan-1', [
      { ...item(), description: 'Two hours of slime', is_featured: true, is_optional: true } as BookingLineItem,
    ])
    expect(s.lineItemInserts()[0][0]).toMatchObject({
      description: 'Two hours of slime',
      is_featured: true,
      is_optional: true,
    })
  })

  it('does not insert on top of rows it failed to clear', async () => {
    // Inserting after a failed delete would double every line on the invoice.
    const s = makeSupabase({ lineItemDeleteError: { message: 'permission denied' } })
    const n = await writeLineItems(s.supabase, 'plan-1', [item()], { replace: true })
    expect(n).toBe(0)
    expect(s.lineItemInserts()).toHaveLength(0)
  })

  it('reports zero rather than throwing when the insert fails', async () => {
    const s = makeSupabase({ lineItemInsertError: { message: 'boom' } })
    await expect(writeLineItems(s.supabase, 'plan-1', [item()])).resolves.toBe(0)
  })

  it('is a no-op for an empty plan', async () => {
    const s = makeSupabase()
    expect(await writeLineItems(s.supabase, 'plan-1', [])).toBe(0)
    expect(s.lineItemInserts()).toHaveLength(0)
  })
})

/* ── ensureLeadPlan: creation ──────────────────────────────────────────── */

describe('ensureLeadPlan — creating a plan', () => {
  it('creates a lead row with the classified party type and the form fields', async () => {
    const s = makeSupabase()
    const res = await ensureLeadPlan({
      supabase: s.supabase,
      contactName: 'Jess Rivera',
      contactEmail: 'Jess@Example.com',
      contactPhone: '+16315550100',
      partyDate: '2026-11-28',
      guestCount: 18,
      notes: 'Looking for a mobile party at our house',
      eventType: 'mobile party',
      source: 'website_form',
      tags: { source_page: 'mobile-party' },
    })

    expect(res.reused).toBe(false)
    expect(res.bookingId).toBe('plan-1')
    expect(res.partyType).toBe('mobile_party')

    const row = s.bookingInserts()[0]
    expect(row).toMatchObject({
      status: 'lead',
      party_type: 'mobile_party',
      source: 'website_form',
      party_date: '2026-11-28',
      guest_count_approx: 18,
      contact_phone: '+16315550100',
    })
    // Emails are matched with a case-sensitive .eq, so they are stored folded.
    expect(row.contact_email).toBe('jess@example.com')
  })

  it('stores an unparseable date as text instead of losing the plan', async () => {
    const s = makeSupabase()
    const res = await ensureLeadPlan({
      supabase: s.supabase,
      contactEmail: 'a@b.com',
      partyDate: 'sometime in March',
      eventType: 'mobile party',
    })
    expect(res.bookingId).toBe('plan-1')
    const row = s.bookingInserts()[0]
    expect(row.party_date).toBeNull()
    expect(row.party_tags).toMatchObject({ requested_date_text: 'sometime in March' })
  })

  it('refuses to write a plan with no way to reach the customer', async () => {
    // migration 035's bookings_contact_reachable_check would reject this anyway;
    // not attempting it keeps the error out of the logs on every newsletter bot.
    const s = makeSupabase()
    const res = await ensureLeadPlan({ supabase: s.supabase, contactName: 'No Handle' })
    expect(res.bookingId).toBeNull()
    expect(s.bookingInserts()).toHaveLength(0)
  })

  it('writes line items when the form carried a quote', async () => {
    const s = makeSupabase()
    await ensureLeadPlan({
      supabase: s.supabase,
      contactEmail: 'a@b.com',
      eventType: 'kids birthday party',
      guestCount: 12,
      lineItems: [item({ unit_price_cents: 40000 })],
    })
    expect(s.lineItemInserts()[0]).toHaveLength(1)
    expect(s.bookingInserts()[0]).toMatchObject({ total_cents: 40000, balance_due_cents: 15000 })
  })

  it('returns a null id, and does not throw, when the insert is rejected', async () => {
    const s = makeSupabase({ insertError: { message: 'violates check constraint' } })
    const res = await ensureLeadPlan({ supabase: s.supabase, contactEmail: 'a@b.com' })
    expect(res).toMatchObject({ bookingId: null, reused: false })
  })
})

/* ── ensureLeadPlan: matching ──────────────────────────────────────────── */

describe('ensureLeadPlan — matching an open plan', () => {
  const openPlan = (over: Record<string, unknown> = {}) => ({
    id: 'existing-1',
    booking_ref: 'HH-2026-0042',
    party_type: 'mobile_party',
    party_date: '2026-11-28',
    party_time: null,
    guest_count_approx: null,
    contact_name: 'Jess Rivera',
    contact_email: 'jess@example.com',
    contact_phone: null,
    notes: 'First message',
    party_tags: { source_page: 'mobile-party' },
    ...over,
  })

  it('reuses the plan for the same contact on the same date', async () => {
    const s = makeSupabase({ planLookups: [{ data: [openPlan()] }] })
    const res = await ensureLeadPlan({
      supabase: s.supabase,
      contactEmail: 'jess@example.com',
      partyDate: '2026-11-28',
      eventType: 'mobile party',
    })
    expect(res).toMatchObject({ reused: true, bookingId: 'existing-1', bookingRef: 'HH-2026-0042' })
    expect(s.bookingInserts()).toHaveLength(0)
  })

  it('reuses a recent open plan even when this touch carries no date', async () => {
    // No date → the date rule is skipped entirely and only the 30-day rule runs.
    const s = makeSupabase({ planLookups: [{ data: [openPlan()] }] })
    const res = await ensureLeadPlan({ supabase: s.supabase, contactEmail: 'jess@example.com' })
    expect(res.reused).toBe(true)
    expect(s.lookupCount()).toBe(1)
  })

  it('falls back to the 30-day rule when the date does not match', async () => {
    const s = makeSupabase({ planLookups: [{ data: [] }, { data: [openPlan()] }] })
    const res = await ensureLeadPlan({
      supabase: s.supabase,
      contactEmail: 'jess@example.com',
      partyDate: '2027-01-01',
    })
    expect(res.reused).toBe(true)
    expect(s.lookupCount()).toBe(2)
  })

  it('creates a new plan when nothing matches', async () => {
    const s = makeSupabase({ planLookups: [{ data: [] }, { data: [] }] })
    const res = await ensureLeadPlan({
      supabase: s.supabase,
      contactEmail: 'new@example.com',
      partyDate: '2026-11-28',
    })
    expect(res.reused).toBe(false)
    expect(s.bookingInserts()).toHaveLength(1)
  })

  it('matches on phone alone, for a lead that has never given an email', async () => {
    const s = makeSupabase({ planLookups: [{ data: [openPlan({ contact_email: null, contact_phone: '+16315550100' })] }] })
    const res = await ensureLeadPlan({ supabase: s.supabase, contactPhone: '+16315550100', source: 'sms' })
    expect(res.reused).toBe(true)
  })

  it('does NOT create a duplicate plan when the lookup itself fails', async () => {
    // "No match" and "lookup broken" are different answers. Treating the second
    // as the first would create a second plan, which earns its own draft and its
    // own text to the reviewer.
    const s = makeSupabase({ planLookups: [{ data: null, error: { message: 'timeout' } }] })
    const res = await ensureLeadPlan({
      supabase: s.supabase,
      contactEmail: 'jess@example.com',
      partyDate: '2026-11-28',
    })
    expect(res.bookingId).toBeNull()
    expect(s.bookingInserts()).toHaveLength(0)
  })

  it('bounds the recent-plan rule to the documented window', async () => {
    expect(PLAN_REUSE_WINDOW_DAYS).toBe(30)
  })
})

/* ── ensureLeadPlan: enrichment ────────────────────────────────────────── */

describe('ensureLeadPlan — enriching the plan it reused', () => {
  const base = {
    id: 'existing-1',
    booking_ref: 'HH-2026-0042',
    party_type: 'unknown',
    party_date: null,
    party_time: null,
    guest_count_approx: null,
    contact_name: null,
    contact_email: 'jess@example.com',
    contact_phone: null,
    notes: 'First message',
    party_tags: { source_page: 'contact-us' },
  }

  it('fills the blanks the second touch carried', async () => {
    const s = makeSupabase({ planLookups: [{ data: [base] }] })
    await ensureLeadPlan({
      supabase: s.supabase,
      contactEmail: 'jess@example.com',
      contactName: 'Jess Rivera',
      contactPhone: '+16315550100',
      partyDate: '2026-11-28',
      partyTime: '2:00 PM',
      guestCount: 18,
      eventType: 'mobile party',
      tags: { location_address: '12 Main St' },
    })
    const patch = s.bookingUpdates()[0]
    expect(patch).toMatchObject({
      contact_name: 'Jess Rivera',
      contact_phone: '+16315550100',
      party_date: '2026-11-28',
      party_time: '2:00 PM',
      guest_count_approx: 18,
      party_type: 'mobile_party', // 'unknown' is upgraded
    })
    // Tags merge rather than replace, so the original source page survives.
    expect(patch.party_tags).toEqual({ source_page: 'contact-us', location_address: '12 Main St' })
    // A newly learned date must bring its cutoffs with it.
    expect(patch.modification_cutoff).toBeTruthy()
  })

  it('never overwrites a field that is already set, and never clears one', async () => {
    const filled = {
      ...base,
      party_type: 'studio_rental',
      party_date: '2026-12-01',
      party_time: '10:00 AM',
      guest_count_approx: 30,
      contact_name: 'Jessica Rivera',
      contact_phone: '+16319998888',
    }
    const s = makeSupabase({ planLookups: [{ data: [filled] }] })
    await ensureLeadPlan({
      supabase: s.supabase,
      contactEmail: 'jess@example.com',
      contactName: 'J. Rivera',
      contactPhone: '+16315550100',
      partyDate: '2026-11-28',
      partyTime: '2:00 PM',
      guestCount: 18,
      eventType: 'mobile party',
    })
    const patch = s.bookingUpdates()[0] ?? {}
    for (const k of ['party_date', 'party_time', 'guest_count_approx', 'contact_name', 'contact_phone']) {
      expect(patch).not.toHaveProperty(k)
    }
    // A confident existing type is never downgraded or reclassified.
    expect(patch).not.toHaveProperty('party_type')
  })

  it('appends the new message to the notes instead of replacing them', async () => {
    const s = makeSupabase({ planLookups: [{ data: [base] }] })
    await ensureLeadPlan({
      supabase: s.supabase,
      contactEmail: 'jess@example.com',
      notes: 'Second message',
    })
    const patch = s.bookingUpdates()[0]
    expect(patch.notes).toContain('First message')
    expect(patch.notes).toContain('Second message')
  })

  it('writes nothing when the second touch adds nothing', async () => {
    const s = makeSupabase({ planLookups: [{ data: [{ ...base, party_type: 'mobile_party', notes: null }] }] })
    await ensureLeadPlan({ supabase: s.supabase, contactEmail: 'jess@example.com', eventType: 'mobile party' })
    expect(s.bookingUpdates()).toHaveLength(0)
  })
})

/**
 * `findOpenPlan` builds a PostgREST `or()` expression out of the email and phone
 * a stranger typed into a form. Two things were wrong with doing that by string
 * concatenation, and both were confirmed against the live PostgREST on
 * 2026-09-11 rather than reasoned about.
 */
describe('matching a contact to their open plan', () => {
  it('quotes handles so a crafted value cannot add a disjunct', async () => {
    const { supabase, orFilters } = makeSupabase()

    // Live probe: this value as an unquoted email turned
    // `or=(contact_email.eq.<value>)` into a second, attacker-chosen condition
    // and returned two real production bookings. `findOpenPlan` would have
    // handed one back as "this person's open plan", and `enrichPlan` writes the
    // new inquiry's name, notes and tags onto whatever plan it is given — i.e.
    // onto a stranger's booking, which then feeds that stranger's next draft.
    await ensureLeadPlan({
      supabase,
      contactEmail: 'x@y.com,contact_phone.eq.6314008080',
      contactName: 'Mallory',
    })

    expect(orFilters.length).toBeGreaterThan(0)
    for (const f of orFilters) {
      // The payload survives only inside quotes, as a value.
      expect(f).toContain('contact_email.eq."x@y.com,contact_phone.eq.6314008080"')
      // Exactly one condition: the comma is data, not a separator.
      expect(f.split('",').length).toBe(1)
    }
  })

  it('matches the same number however it was typed', async () => {
    // Phase 2 creates a `lead` plan for an unknown texter with an E.164 number;
    // that same person then fills in the web form typing 631-555-1234. Every
    // other module normalises before comparing — this one compared raw strings,
    // so the open plan was missed and the lead got a SECOND plan, which earns
    // its own draft and its own text to Adam's phone.
    const { supabase, orFilters } = makeSupabase()
    await ensureLeadPlan({ supabase, contactPhone: '631-555-1234', contactName: 'Jo' })

    const filter = orFilters[0]
    expect(filter).toContain('contact_phone.eq."+16315551234"')
    expect(filter).toContain('contact_phone.eq."6315551234"')
    expect(filter).toContain('contact_phone.eq."631-555-1234"')
    expect(filter).toContain('contact_phone.eq."(631) 555-1234"')
  })

  it('reuses the plan created when the same person texted in', async () => {
    const { supabase, bookingInserts } = makeSupabase({
      planLookups: [
        { data: [{ id: 'plan-sms', booking_ref: 'HH-PTY-AAA', contact_phone: '+16315551234', party_tags: {} }] },
      ],
    })
    const res = await ensureLeadPlan({ supabase, contactPhone: '(631) 555-1234', contactName: 'Jo' })

    expect(res.reused).toBe(true)
    expect(res.bookingId).toBe('plan-sms')
    expect(bookingInserts()).toHaveLength(0)
  })
})
