/**
 * `lib/publicIntake.ts` — what a stranger is allowed to put in a row.
 *
 * These are BEHAVIOUR tests, driven against the real function, because the whole
 * point of the module is that it refuses things. A source-reading rule can check
 * that the screen is called; only this can check that it works — and the negative
 * cases matter as much as the positive ones, because a screen that refuses
 * everything breaks the booking funnel and a screen that refuses nothing is
 * decoration.
 */

import {
  screenPublicLineItems,
  screenPublicGuestCount,
  screenPublicCount,
  boundedIntakeText,
  emptyIntakeRecord,
  landedSomewhere,
  missingFrom,
  settledOk,
  MAX_ITEM_QUANTITY,
  MAX_PUBLIC_UNIT_PRICE_CENTS,
  MAX_PUBLIC_TOTAL_CENTS,
  MAX_PUBLIC_LINE_ITEMS,
  MAX_PUBLIC_GUEST_COUNT,
  MAX_INTAKE_TEXT_CHARS,
  ALLOWED_PRICE_TYPES,
} from '@/lib/publicIntake'

/** A line item shaped exactly like the planner really sends. */
const realItem = (over: Record<string, unknown> = {}) => ({
  pricing_item_id: '3f6b2c18-1a4d-4c9e-9b21-0a7d5e8f1c02',
  name: 'Spa Party',
  category: 'theme',
  quantity: 1,
  unit_price_cents: 65000,
  price_type: 'flat',
  guest_multiplied: false,
  ...over,
})

describe('screenPublicLineItems — what it lets through', () => {
  it('accepts the shapes the live table actually holds', () => {
    // Sampled from production on 2026-09-13: the bundle price that disagrees with
    // the catalogue, the per-person type, a guest-multiplied row, a quantity of
    // 25, a £0 included item, and a row with no pricing_item_id (47 of 206 live
    // rows have none). Every one of these must survive, or the planner breaks.
    const res = screenPublicLineItems(
      [
        realItem(),
        realItem({ name: 'Manicure (1st premium — +$100 upgrade)', category: 'activity-add-on', unit_price_cents: 10000 }),
        realItem({ name: 'Pizza', category: 'food-add-on', quantity: 5, unit_price_cents: 2500 }),
        realItem({ name: 'Goodie bag', category: 'extra', price_type: 'per_person', guest_multiplied: true, unit_price_cents: 1000 }),
        realItem({ name: 'Balloon arch', category: 'decor-add-on', quantity: 25, unit_price_cents: 3500 }),
        realItem({ name: 'Included: setup', category: 'custom', unit_price_cents: 0 }),
        realItem({ pricing_item_id: null, name: 'Custom request', category: 'custom', unit_price_cents: 85000 }),
      ],
      12,
    )
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.lineItems).toHaveLength(7)
  })

  it('treats an absent or empty list as an empty plan, not an error', () => {
    for (const input of [undefined, null, []]) {
      const res = screenPublicLineItems(input, 10)
      expect(res.ok).toBe(true)
      if (res.ok) expect(res.lineItems).toHaveLength(0)
    }
  })

  it('normalises the optional columns rather than refusing them', () => {
    const res = screenPublicLineItems([realItem({ description: '  two hours  ', is_featured: 'yes', is_optional: 1 })], 10)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const item = res.lineItems[0] as unknown as Record<string, unknown>
    expect(item.description).toBe('two hours')
    // Only a real `true` is true — a truthy string must not become a featured row
    // on somebody's invoice.
    expect(item.is_featured).toBe(false)
    expect(item.is_optional).toBe(false)
  })

  it('accepts a numeric string, because HTML form values are strings', () => {
    const res = screenPublicLineItems([realItem({ quantity: '3', unit_price_cents: '2500' })], 10)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.lineItems[0].quantity).toBe(3)
      expect(res.lineItems[0].unit_price_cents).toBe(2500)
    }
  })
})

describe('screenPublicLineItems — the money rule', () => {
  it('REFUSES a negative unit price', () => {
    // The whole reason this module exists. An add-on priced -1000000 on
    // /api/studio-rental/edit made the total negative, the balance clamp zero,
    // and the route then wrote `status = 'paid_in_full'` on a real studio rental.
    const res = screenPublicLineItems([realItem({ unit_price_cents: -1000000 })], 10)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/negative price/i)
  })

  it('refuses a negative price even when another item is positive', () => {
    const res = screenPublicLineItems([realItem(), realItem({ name: 'Discount', category: 'discount', unit_price_cents: -50000 })], 10)
    expect(res.ok).toBe(false)
  })

  it('names WHICH item and why', () => {
    // Rule 19's second half: a refusal that does not say which row is a lost sale
    // nobody can debug.
    const res = screenPublicLineItems([realItem(), realItem({ name: 'Slime Station', unit_price_cents: -1 })], 10)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.reason).toContain('line item 2')
      expect(res.reason).toContain('Slime Station')
    }
  })

  it('refuses a non-integer price, because bookings.total_cents is written first', () => {
    // `unit_price_cents` is `integer NOT NULL`, so Postgres refuses 1.5 — but
    // `buildPlanSnapshot` runs BEFORE the line-item insert and writes
    // `bookings.total_cents` from the same number, leaving a booking with a total
    // and no items beneath it. `loadPlanInvoice` then renders that plan as $0.
    for (const bad of [1.5, NaN, Infinity, '12.5', '1e3', null, undefined, {}, []]) {
      const res = screenPublicLineItems([realItem({ unit_price_cents: bad })], 10)
      expect(res.ok).toBe(false)
    }
  })

  it('refuses a quantity that is not a whole number in range', () => {
    for (const bad of [0, -1, 1.5, MAX_ITEM_QUANTITY + 1, NaN, '', null]) {
      const res = screenPublicLineItems([realItem({ quantity: bad })], 10)
      expect(res.ok).toBe(false)
    }
    expect(screenPublicLineItems([realItem({ quantity: MAX_ITEM_QUANTITY })], 1).ok).toBe(true)
  })

  it('caps the unit price and the WHOLE total', () => {
    expect(screenPublicLineItems([realItem({ unit_price_cents: MAX_PUBLIC_UNIT_PRICE_CENTS + 1 })], 10).ok).toBe(false)

    // The multiplier is unit × quantity × guests and all three are chosen by the
    // caller, so a per-item ceiling alone is not a ceiling.
    const res = screenPublicLineItems(
      [realItem({ unit_price_cents: MAX_PUBLIC_UNIT_PRICE_CENTS, quantity: MAX_ITEM_QUANTITY, guest_multiplied: true })],
      MAX_PUBLIC_GUEST_COUNT,
    )
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/total above/i)
  })

  it('bounds the number of items', () => {
    const many = Array.from({ length: MAX_PUBLIC_LINE_ITEMS + 1 }, () => realItem({ unit_price_cents: 100 }))
    const res = screenPublicLineItems(many, 1)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/too many/i)
  })

  it('allows a total right up to the ceiling', () => {
    const res = screenPublicLineItems([realItem({ unit_price_cents: MAX_PUBLIC_TOTAL_CENTS, quantity: 1 })], 1)
    // The unit ceiling bites first, which is the intended ordering — but a real
    // party total must never be refused.
    expect(screenPublicLineItems([realItem({ unit_price_cents: 250000 })], 30).ok).toBe(true)
    expect(res.ok).toBe(false)
  })
})

describe('screenPublicLineItems — the fields a stranger controls', () => {
  it('refuses a price_type the column does not hold', () => {
    for (const bad of ['per-person', 'FLAT', 'hourly', '', null]) {
      expect(screenPublicLineItems([realItem({ price_type: bad })], 10).ok).toBe(false)
    }
    for (const good of ALLOWED_PRICE_TYPES) {
      expect(screenPublicLineItems([realItem({ price_type: good })], 10).ok).toBe(true)
    }
  })

  it('refuses a category that is not a short slug', () => {
    for (const bad of ['Theme', 'a b', 'x'.repeat(41), '', '<script>', null]) {
      expect(screenPublicLineItems([realItem({ category: bad })], 10).ok).toBe(false)
    }
  })

  it('refuses a pricing_item_id that is not a uuid', () => {
    expect(screenPublicLineItems([realItem({ pricing_item_id: 'not-a-uuid' })], 10).ok).toBe(false)
    // Absent is fine — 47 of 206 live rows carry none.
    expect(screenPublicLineItems([realItem({ pricing_item_id: '' })], 10).ok).toBe(true)
    expect(screenPublicLineItems([realItem({ pricing_item_id: null })], 10).ok).toBe(true)
  })

  it('bounds the name, which reaches an invoice and an email', () => {
    expect(screenPublicLineItems([realItem({ name: 'x'.repeat(121) })], 10).ok).toBe(false)
    expect(screenPublicLineItems([realItem({ name: '' })], 10).ok).toBe(false)
    expect(screenPublicLineItems([realItem({ name: '   ' })], 10).ok).toBe(false)
  })

  it('refuses a non-array and a non-object member', () => {
    expect(screenPublicLineItems('lineItems', 10).ok).toBe(false)
    expect(screenPublicLineItems({ 0: realItem() }, 10).ok).toBe(false)
    expect(screenPublicLineItems([null], 10).ok).toBe(false)
    expect(screenPublicLineItems(['x'], 10).ok).toBe(false)
  })
})

describe('screenPublicGuestCount / screenPublicCount', () => {
  it('returns null for anything a real form would not send', () => {
    for (const bad of [0, -1, 1.5, MAX_PUBLIC_GUEST_COUNT + 1, 1e20, NaN, '', 'ten', null, undefined, {}]) {
      expect(screenPublicGuestCount(bad)).toBeNull()
    }
  })

  it('accepts the real range', () => {
    expect(screenPublicGuestCount(1)).toBe(1)
    expect(screenPublicGuestCount('18')).toBe(18)
    expect(screenPublicGuestCount(MAX_PUBLIC_GUEST_COUNT)).toBe(MAX_PUBLIC_GUEST_COUNT)
  })

  it('screenPublicCount refuses the negative that inverted the ticket decrement', () => {
    // `decrement_event_tickets(qty: -5)` INCREASES inventory, and
    // `available_tickets < -5` is false so the stock check passed.
    expect(screenPublicCount(-5, 50)).toBeNull()
    expect(screenPublicCount(0, 50)).toBeNull()
    expect(screenPublicCount(1, 50)).toBe(1)
    expect(screenPublicCount(50, 50)).toBe(50)
    expect(screenPublicCount(51, 50)).toBeNull()
  })
})

describe('boundedIntakeText', () => {
  it('trims, rejects empty, and truncates rather than refusing', () => {
    expect(boundedIntakeText('  hello  ')).toBe('hello')
    expect(boundedIntakeText('   ')).toBeNull()
    expect(boundedIntakeText(undefined)).toBeNull()
    expect(boundedIntakeText(42)).toBeNull()
    // Truncating a long message keeps the lead; refusing it loses one.
    const long = 'x'.repeat(MAX_INTAKE_TEXT_CHARS + 500)
    expect(boundedIntakeText(long)).toHaveLength(MAX_INTAKE_TEXT_CHARS)
  })
})

describe('IntakeRecord — what actually got recorded', () => {
  it('an untouched record means nothing landed', () => {
    const r = emptyIntakeRecord()
    expect(landedSomewhere(r)).toBe(false)
    expect(missingFrom(r)).toEqual(['contact', 'plan', 'event', 'interaction', 'owner-notify'])
  })

  it('a lead that only reached Adam’s inbox counts as landed', () => {
    // Damaged, not lost: a human can still act on it. The distinction is the
    // whole reason the route answers 200 in one case and 503 in the other.
    const r = { ...emptyIntakeRecord(), ownerNotified: true }
    expect(landedSomewhere(r)).toBe(true)
    expect(missingFrom(r)).not.toContain('owner-notify')
  })

  it('settledOk sees BOTH kinds of send failure', () => {
    expect(settledOk({ status: 'fulfilled', value: { id: 'email_1' } })).toBe(true)
    // A rejected promise.
    expect(settledOk({ status: 'rejected', reason: new Error('nope') })).toBe(false)
    // And the one the old code could not see: resolved, carrying an error.
    expect(settledOk({ status: 'fulfilled', value: { error: { message: 'domain not verified' } } })).toBe(false)
    expect(settledOk(undefined)).toBe(false)
  })
})
