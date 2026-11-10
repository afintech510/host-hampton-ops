/**
 * The assistant's field-edit tools: edit one invoice line, move a rental window, record
 * menu choices, append to the internal note. Each only PROPOSES a card (no write), refuses
 * the lines the system derives, and previews the money.
 */
type Row = Record<string, any>
let tables: Record<string, Row[]> = {}

const mockLoadInvoice = jest.fn()
jest.mock('@/lib/planInvoice', () => ({
  ...jest.requireActual('@/lib/planInvoice'),
  loadPlanInvoice: (...a: unknown[]) => mockLoadInvoice(...a),
}))
jest.mock('@/lib/pricingCatalog', () => ({
  ...jest.requireActual('@/lib/pricingCatalog'),
  loadPricingCatalog: async () => ({
    studioRates: {
      weekendBaseCents: 60000, weekdayBaseCents: 47500, weekendAddlHourCents: 15000, weekdayAddlHourCents: 10000,
      weekendFullDayCents: 97500, weekdayFullDayCents: 70000, minHours: 3, securityDepositCents: 25000,
    },
  }),
  loadLineItemAddOns: async () => [],
}))
jest.mock('@/lib/quoteRequest', () => ({
  ...jest.requireActual('@/lib/quoteRequest'),
  loadQuoteCatalog: async () => ({
    kind: 'ok',
    data: {
      cat: { guestRules: { miniPartyDiscountCents: 20000 } },
      groups: { themes: [{ id: 'glow', name: 'Glow Party', price_cents: 69500, category: 'party-theme' }] },
      themeInfo: [],
    },
  }),
}))
let mockIntroduced: boolean | null = false
jest.mock('@/lib/assistant/threadIntro', () => ({ threadHasIntroduced: async () => mockIntroduced }))
jest.mock('@/lib/phoneStop', () => ({ phoneHasExplicitStop: async () => 'clear' }))
jest.mock('@/app/api/admin/parties/create/route', () => ({ POST: jest.fn() }))
jest.mock('@/app/api/admin/parties/[id]/route', () => ({ POST: jest.fn(), PATCH: jest.fn() }))
jest.mock('@/app/api/plan/[ref]/pay-link/route', () => ({ POST: jest.fn() }))

const db = {
  from: (t: string) => {
    let rows = [...(tables[t] ?? [])]
    const q: Record<string, any> = {}
    q.select = () => q
    q.eq = (c: string, v: unknown) => ((rows = rows.filter(r => r[c] === v)), q)
    q.in = (c: string, vs: unknown[]) => ((rows = rows.filter(r => vs.includes(r[c]))), q)
    q.order = () => q
    q.limit = () => q
    q.maybeSingle = async () => ({ data: rows[0] ?? null, error: null })
    q.single = async () => ({ data: rows[0] ?? null, error: null })
    q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res)
    return q
  },
}

import { runAssistantTool } from '@/lib/assistant/tools'

const BK = 'bbbbbbbb-0000-4000-8000-0000000000f1'
const CTX = { actor: 'admin:test', supabase: db as never, now: new Date('2026-11-04T15:00:00Z') }
const BOOKING = {
  id: BK, booking_ref: 'HH-PTY-EDT01', status: 'approved', contact_name: 'Pat Example', contact_email: 'parent@example.com',
  contact_phone: '631-555-0100', child_name: 'Sam', child_age: 6, party_type: 'in_studio_theme', event_type: 'kid-party',
  party_date: '2026-12-05', party_time: '14:00', guest_count_approx: 10, package_type: 'Slime Party', admin_notes: null, total_cents: 90000,
}

beforeEach(() => {
  tables = {
    bookings: [{ ...BOOKING }],
    booking_line_items: [
      { id: 'li-1', booking_id: BK, name: 'Slime Party', category: 'theme', quantity: 1, unit_price_cents: 59500, guest_multiplied: false },
      { id: 'li-2', booking_id: BK, name: 'Balloon Garland', category: 'extra', quantity: 1, unit_price_cents: 15000, guest_multiplied: false },
      { id: 'li-3', booking_id: BK, name: 'Additional Guests', category: 'theme', quantity: 9, unit_price_cents: 3500, guest_multiplied: false },
      { id: 'li-4', booking_id: BK, name: 'Friends discount', category: 'discount', quantity: 1, unit_price_cents: -5000, guest_multiplied: false },
      { id: 'li-5', booking_id: BK, name: 'Studio Rental', category: 'rental', quantity: 1, unit_price_cents: 47500, guest_multiplied: false },
    ],
  }
  mockLoadInvoice.mockReset()
  mockLoadInvoice.mockResolvedValue({
    ok: true,
    invoice: { booking: BOOKING, totalCents: 90000, paidCents: 25000, outstandingCents: 65000, guestCount: 10, depositOwedCents: 0 },
  })
})

describe('propose_edit_line_item', () => {
  it('previews the price change and the new invoice total', async () => {
    const out = await runAssistantTool('propose_edit_line_item', { booking_ref: BOOKING.booking_ref, line_item_name: 'Balloon Garland', unit_price_cents: 18000 }, CTX)
    expect(out.isError).toBeFalsy()
    const shown = (out.result as { shown_to_manager: string[] }).shown_to_manager.join('\n')
    expect(shown).toContain('$150.00 → $180.00')
    expect(shown).toContain('$900.00 → $930.00')
    expect(out.proposal?.proposal.kind).toBe('edit_line_item')
  })

  it.each([
    ['Studio Rental', /propose_edit_rental/],
    ['Additional Guests', /guest count/],
    ['Friends discount', /discount/i],
  ])('refuses the derived or discount line %s', async (name, why) => {
    const out = await runAssistantTool('propose_edit_line_item', { booking_ref: BOOKING.booking_ref, line_item_name: name, unit_price_cents: 100 }, CTX)
    expect(out.isError).toBe(true)
    expect(JSON.stringify(out.result)).toMatch(why)
    expect(out.proposal).toBeUndefined()
  })

  it('refuses a negative price and an empty change', async () => {
    const neg = await runAssistantTool('propose_edit_line_item', { booking_ref: BOOKING.booking_ref, line_item_name: 'Balloon Garland', unit_price_cents: -100 }, CTX)
    expect(neg.isError).toBe(true)
    const none = await runAssistantTool('propose_edit_line_item', { booking_ref: BOOKING.booking_ref, line_item_name: 'Balloon Garland' }, CTX)
    expect(none.isError).toBe(true)
  })
})

describe('propose_edit_rental', () => {
  beforeEach(() => {
    tables.bookings = [{
      ...BOOKING, event_type: 'studio-rental', party_type: 'studio_rental',
      party_tags: { rental_start_time: '10:00', rental_end_time: '13:00', rental_hours: 3 },
    }]
  })

  it('previews the re-priced window', async () => {
    const out = await runAssistantTool('propose_edit_rental', { booking_ref: BOOKING.booking_ref, start_time: '10:00', end_time: '15:00' }, CTX)
    expect(out.isError).toBeFalsy()
    const shown = (out.result as { shown_to_manager: string[] }).shown_to_manager.join('\n')
    expect(shown).toContain('$475.00 → $900.00')
    expect(out.proposal?.proposal.kind).toBe('edit_rental')
  })

  it('uses the booking own hourly rate', async () => {
    tables.bookings[0].party_tags = { ...tables.bookings[0].party_tags, custom_hourly_rate_cents: 7500 }
    const out = await runAssistantTool('propose_edit_rental', { booking_ref: BOOKING.booking_ref, start_time: '10:00', end_time: '12:00' }, CTX)
    expect((out.result as { shown_to_manager: string[] }).shown_to_manager.join('\n')).toContain('$150.00')
  })

  it('refuses a window under the minimum, a backwards window and a non-rental', async () => {
    expect((await runAssistantTool('propose_edit_rental', { booking_ref: BOOKING.booking_ref, start_time: '10:00', end_time: '11:00' }, CTX)).isError).toBe(true)
    expect((await runAssistantTool('propose_edit_rental', { booking_ref: BOOKING.booking_ref, start_time: '15:00', end_time: '10:00' }, CTX)).isError).toBe(true)
    tables.bookings = [{ ...BOOKING }]
    expect((await runAssistantTool('propose_edit_rental', { booking_ref: BOOKING.booking_ref, start_time: '10:00', end_time: '14:00' }, CTX)).isError).toBe(true)
  })
})

describe('propose_set_preferences', () => {
  it('records menu choices and says they price nothing', async () => {
    const out = await runAssistantTool('propose_set_preferences', { booking_ref: BOOKING.booking_ref, pizza_or_bagels: 'bagels', cupcake_flavor: 'chocolate', character_request: 'Elsa' }, CTX)
    expect(out.isError).toBeFalsy()
    expect(out.proposal?.proposal.input).toMatchObject({ preferences: { pizzaOrBagels: 'bagels', cupcakeFlavor: 'chocolate', characterRequest: 'Elsa' } })
  })

  it('refuses an unknown choice and an empty call', async () => {
    expect((await runAssistantTool('propose_set_preferences', { booking_ref: BOOKING.booking_ref, pizza_or_bagels: 'tacos' }, CTX)).isError).toBe(true)
    expect((await runAssistantTool('propose_set_preferences', { booking_ref: BOOKING.booking_ref }, CTX)).isError).toBe(true)
  })
})

describe('admin_notes_append', () => {
  it('keeps the existing note and adds to it', async () => {
    tables.bookings[0].admin_notes = 'Allergy: nuts'
    const out = await runAssistantTool('propose_update_party', { booking_ref: BOOKING.booking_ref, admin_notes_append: 'Wants early setup' }, CTX)
    expect(out.isError).toBeFalsy()
    expect((out.proposal?.proposal.input as { updates: Row }).updates.admin_notes).toBe('Allergy: nuts\nWants early setup')
  })

  it('refuses replace and append together', async () => {
    const out = await runAssistantTool('propose_update_party', { booking_ref: BOOKING.booking_ref, admin_notes: 'x', admin_notes_append: 'y' }, CTX)
    expect(out.isError).toBe(true)
  })
})

describe('propose_change_theme', () => {
  it('previews the swap with the catalog price and says activities are not re-derived', async () => {
    const out = await runAssistantTool('propose_change_theme', { booking_ref: BOOKING.booking_ref, theme: 'Glow Party' }, CTX)
    expect(out.isError).toBeFalsy()
    const shown = (out.result as { shown_to_manager: string[] }).shown_to_manager.join('\n')
    expect(shown).toContain('Glow Party ($695.00)')
    expect(shown).toMatch(/Activity lines are not re-derived/)
    expect(out.proposal?.proposal.input).toMatchObject({ themeId: 'glow', themeName: 'Glow Party' })
  })

  it('applies the mini discount in the preview', async () => {
    const out = await runAssistantTool('propose_change_theme', { booking_ref: BOOKING.booking_ref, theme: 'Glow Party', mini_party: true }, CTX)
    expect((out.result as { shown_to_manager: string[] }).shown_to_manager.join('\n')).toContain('$495.00, mini party: $200.00 off')
  })

  it('refuses an unknown theme, and a mobile party unless it is a conversion', async () => {
    expect((await runAssistantTool('propose_change_theme', { booking_ref: BOOKING.booking_ref, theme: 'Nonsense' }, CTX)).isError).toBe(true)
    tables.booking_line_items = [{ id: 'm', booking_id: BK, name: 'Mobile Party Package', category: 'mobile-package', quantity: 1, unit_price_cents: 135000, guest_multiplied: false }]
    const plain = await runAssistantTool('propose_change_theme', { booking_ref: BOOKING.booking_ref, theme: 'Glow Party' }, CTX)
    expect(plain.isError).toBe(true)
    expect(JSON.stringify(plain.result)).toMatch(/convert_from_mobile/)
    const conv = await runAssistantTool('propose_change_theme', { booking_ref: BOOKING.booking_ref, theme: 'Glow Party', convert_from_mobile: true }, CTX)
    expect(conv.isError).toBeFalsy()
    expect(conv.proposal?.proposal.input).toMatchObject({ fromMobile: true })
  })

  it('refuses a studio rental', async () => {
    tables.bookings = [{ ...BOOKING, event_type: 'studio-rental' }]
    expect((await runAssistantTool('propose_change_theme', { booking_ref: BOOKING.booking_ref, theme: 'Glow Party' }, CTX)).isError).toBe(true)
  })
})

describe('propose_add_discount', () => {
  const shown = (out: { result: unknown }) => (out.result as { shown_to_manager: string[] }).shown_to_manager.join('\n')

  it('previews a dollar discount against the invoice and the balance', async () => {
    const out = await runAssistantTool('propose_add_discount', { booking_ref: BOOKING.booking_ref, amount_cents: 10000, reason: 'Returning client' }, CTX)
    expect(out.isError).toBeFalsy()
    expect(shown(out)).toContain('Invoice $900.00 → $800.00')
    expect(shown(out)).toContain('outstanding $650.00 → $550.00')
    expect(out.proposal?.proposal.input).toMatchObject({ discountCents: 10000, label: 'Discount: Returning client' })
  })

  it('works out a percent of the current total', async () => {
    const out = await runAssistantTool('propose_add_discount', { booking_ref: BOOKING.booking_ref, percent: 10, reason: 'Friends' }, CTX)
    expect(out.proposal?.proposal.input).toMatchObject({ discountCents: 9000 })
  })

  it('refuses a discount that would leave the client overpaid (no refunds in chat)', async () => {
    const out = await runAssistantTool('propose_add_discount', { booking_ref: BOOKING.booking_ref, amount_cents: 70000, reason: 'Too big' }, CTX)
    expect(out.isError).toBe(true)
    expect(JSON.stringify(out.result)).toMatch(/overpaid/)
    expect(out.proposal).toBeUndefined()
  })

  it.each([
    [{ reason: 'x' }, /amount_cents OR percent/],
    [{ amount_cents: 100, percent: 5, reason: 'x' }, /amount_cents OR percent/],
    [{ amount_cents: 100 }, /reason/],
    [{ amount_cents: -5, reason: 'x' }, /positive/],
    [{ percent: 150, reason: 'x' }, /between 0 and 100/],
  ])('refuses %j', async (extra, why) => {
    const out = await runAssistantTool('propose_add_discount', { booking_ref: BOOKING.booking_ref, ...(extra as object) }, CTX)
    expect(out.isError).toBe(true)
    expect(JSON.stringify(out.result)).toMatch(why as RegExp)
  })

  it('will not discount an unpriced party', async () => {
    mockLoadInvoice.mockResolvedValue({ ok: true, invoice: { booking: BOOKING, totalCents: 0, paidCents: 0, outstandingCents: 0, guestCount: 10, depositOwedCents: 0 } })
    const out = await runAssistantTool('propose_add_discount', { booking_ref: BOOKING.booking_ref, amount_cents: 100, reason: 'x' }, CTX)
    expect(out.isError).toBe(true)
  })
})

describe('propose_record_payment with a tip', () => {
  it('carries the tip on top of the payment and says it is not credited', async () => {
    const out = await runAssistantTool('propose_record_payment', { booking_ref: BOOKING.booking_ref, amount_cents: 20000, payment_method: 'venmo', tip_cents: 2500 }, CTX)
    expect(out.isError).toBeFalsy()
    expect(out.proposal?.proposal.input).toMatchObject({ amount_cents: 20000, tip_cents: 2500 })
    expect((out.result as { shown_to_manager: string[] }).shown_to_manager.join('\n')).toMatch(/\$25\.00 tip.*not credited/)
  })

  it('refuses a zero or junk tip instead of dropping it', async () => {
    const out = await runAssistantTool('propose_record_payment', { booking_ref: BOOKING.booking_ref, amount_cents: 20000, payment_method: 'venmo', tip_cents: 0 }, CTX)
    expect(out.isError).toBe(true)
  })
})

describe('propose_send_message', () => {
  const texts = (out: { result: unknown }) =>
    (out.result as { message_preview: { channels: { channel: string; text: string; editable: boolean }[] } }).message_preview.channels
  beforeEach(() => { mockIntroduced = false })

  it('the first message to a number introduces Allie, adds the STOP line, and is not editable in place', async () => {
    const out = await runAssistantTool('propose_send_message', { booking_ref: BOOKING.booking_ref, channel: 'text', message: 'We are all set for Saturday at 2.' }, CTX)
    expect(out.isError).toBeFalsy()
    const sms = texts(out)[0]
    expect(sms.text).toBe("Hi Pat! It's Allie from Host Hampton 🎉\nWe are all set for Saturday at 2.\nReply STOP to opt out")
    expect(sms.editable).toBe(false)
    expect(out.proposal?.proposal.kind).toBe('send_message')
    expect(out.proposal?.proposal.input).toMatchObject({ sms: true, email: false, introduced: false })
  })

  it('later messages do not name Allie again', async () => {
    mockIntroduced = true
    const out = await runAssistantTool('propose_send_message', { booking_ref: BOOKING.booking_ref, channel: 'text', message: 'Running 5 minutes early.' }, CTX)
    expect(texts(out)[0].text).toBe('Hi Pat!\nRunning 5 minutes early.\nReply STOP to opt out')
    expect(texts(out)[0].text).not.toMatch(/Allie/)
  })

  it('an email gets a subject and the sign-off only on the first message', async () => {
    const first = await runAssistantTool('propose_send_message', { booking_ref: BOOKING.booking_ref, channel: 'email', message: 'Please bring socks.', subject: 'Socks' }, CTX)
    expect(texts(first)[0].text).toBe('Hi Pat,\n\nPlease bring socks.\n\nAllie\nHost Hampton')
    mockIntroduced = true
    const later = await runAssistantTool('propose_send_message', { booking_ref: BOOKING.booking_ref, channel: 'email', message: 'Please bring socks.' }, CTX)
    expect(texts(later)[0].text).toBe('Hi Pat,\n\nPlease bring socks.')
  })

  it.each([
    ['a link', 'See https://example.com/deal'],
    ['a bare domain', 'Visit sparkleparties.co'],
    ['a promise of a discount', 'We will give you 20% off'],
    ['a payment handle', 'Venmo @someone-else'],
    ['the owner as the sender', 'This is Adam from the studio'],
    ['a link placeholder', 'Your link: {portal}'],
  ])('refuses %s in the body', async (_n, message) => {
    const out = await runAssistantTool('propose_send_message', { booking_ref: BOOKING.booking_ref, channel: 'text', message }, CTX)
    expect(out.isError).toBe(true)
    expect(out.proposal).toBeUndefined()
  })

  it('refuses a bad channel and an empty message', async () => {
    expect((await runAssistantTool('propose_send_message', { booking_ref: BOOKING.booking_ref, channel: 'fax', message: 'x' }, CTX)).isError).toBe(true)
    expect((await runAssistantTool('propose_send_message', { booking_ref: BOOKING.booking_ref, channel: 'text', message: '  ' }, CTX)).isError).toBe(true)
  })
})
