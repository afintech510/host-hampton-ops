/**
 * The home-delivery upcharge.
 *
 * Two things are being guarded, and they are different:
 *
 *   1. An order that cannot be fulfilled must not be accepted. A home delivery
 *      with no address is a row nobody can act on AFTER the money is paid, so
 *      `screenDelivery` refuses it rather than storing a blank.
 *   2. The fee is the one charge on this storefront the server knows the price
 *      of. Every other line is whatever the browser said (see `cmCheerOrder`),
 *      but delivery is pinned — so a page that posts a $70 delivery, two
 *      deliveries, or a delivery on a classroom order gets corrected, and the
 *      correction is written where an organizer reads it.
 */

import {
  HOME_DELIVERY_FEE_CENTS,
  MAX_DELIVERY_ADDRESS_LENGTH,
  deliveryLineItem,
  reconcileDeliveryItems,
  screenDelivery,
} from '@/lib/fundraiserDelivery'

const hat = { name: 'Navy Trucker Hat', qty: 1, unit_price: 25, line_total: 25, cost_per_unit: 20 }

describe('screenDelivery', () => {
  it('treats an absent method as classroom, so the pages that predate the field still work', () => {
    for (const absent of [undefined, null, '']) {
      const r = screenDelivery(absent, undefined)
      expect(r).toEqual({ ok: true, method: 'classroom', address: null, feeCents: 0 })
    }
  })

  it('refuses an unknown method rather than defaulting it', () => {
    // Defaulting would turn a typo into "no delivery" for a parent who paid for delivery.
    for (const bad of ['Home', 'HOME', 'courier', 'home ', 0, true, {}, ['home']]) {
      expect(screenDelivery(bad, '1 Main St').ok).toBe(false)
    }
  })

  it('refuses a home delivery with no usable address', () => {
    for (const bad of [undefined, null, '', '   ', '\t\n ', 42, {}]) {
      const r = screenDelivery('home', bad)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toMatch(/address is required/i)
    }
  })

  it('accepts a home delivery and charges the fee once', () => {
    const r = screenDelivery('home', '  12 Oak St, Eastport NY 11941  ')
    expect(r).toEqual({
      ok: true,
      method: 'home',
      address: '12 Oak St, Eastport NY 11941', // trimmed
      feeCents: HOME_DELIVERY_FEE_CENTS,
    })
  })

  it('bounds the address length', () => {
    expect(screenDelivery('home', 'x'.repeat(MAX_DELIVERY_ADDRESS_LENGTH)).ok).toBe(true)
    expect(screenDelivery('home', 'x'.repeat(MAX_DELIVERY_ADDRESS_LENGTH + 1)).ok).toBe(false)
  })

  it('DISCARDS an address on a classroom order', () => {
    // A child's home address on an order that never leaves the school is PII in
    // a CSV parent volunteers download, for no purpose the order has.
    const r = screenDelivery('classroom', '12 Oak St')
    expect(r).toEqual({ ok: true, method: 'classroom', address: null, feeCents: 0 })
  })
})

describe('reconcileDeliveryItems', () => {
  it('adds the canonical line when home delivery was chosen but not billed', () => {
    const { items, note } = reconcileDeliveryItems([hat], 'home')
    expect(items).toEqual([hat, deliveryLineItem()])
    expect(note).toMatch(/no delivery charge was submitted/i)
  })

  it('passes a correctly-billed delivery through without a note', () => {
    const { items, note } = reconcileDeliveryItems([hat, deliveryLineItem()], 'home')
    expect(items).toEqual([hat, deliveryLineItem()])
    expect(note).toBeNull()
  })

  it('OVERRIDES an inflated delivery charge and says so', () => {
    // 70 is the attacker's number and stays a literal. The CORRECT figure is
    // derived, because hard-coding it here made this test fail the day the PTO
    // changed the fee — a tripwire firing on a legitimate price change, which
    // teaches the next person to edit the test rather than read it.
    const fee = HOME_DELIVERY_FEE_CENTS / 100
    const inflated = { ...deliveryLineItem(), unit_price: 70, line_total: 70 }
    const { items, note } = reconcileDeliveryItems([hat, inflated], 'home')
    expect(items).toEqual([hat, deliveryLineItem()])
    expect(items.map(i => (i as typeof hat).line_total)).toEqual([25, fee])
    expect(note).toMatch(new RegExp(`\\$70\\.00.*\\$${fee.toFixed(2)} rate was used`, 'i'))
  })

  it('collapses several delivery lines into one', () => {
    const { items, note } = reconcileDeliveryItems([hat, deliveryLineItem(), deliveryLineItem()], 'home')
    expect(items).toEqual([hat, deliveryLineItem()])
    expect(note).toMatch(/2 delivery charges/i)
  })

  it('strips a delivery charge off a classroom order', () => {
    const { items, note } = reconcileDeliveryItems([hat, deliveryLineItem()], 'classroom')
    expect(items).toEqual([hat])
    expect(note).toMatch(/classroom order and was removed/i)
  })

  it('leaves an ordinary classroom order and its note alone', () => {
    expect(reconcileDeliveryItems([hat], 'classroom')).toEqual({ items: [hat], note: null })
  })

  it('matches a delivery line whatever case or padding the page used', () => {
    // The strip must not be defeatable by casing, or a second delivery line
    // survives alongside the canonical one and the parent is charged twice.
    for (const name of ['home delivery', 'HOME DELIVERY', ' Home Delivery ']) {
      const { items } = reconcileDeliveryItems([hat, { ...deliveryLineItem(), name, line_total: 70 }], 'home')
      expect(items).toEqual([hat, deliveryLineItem()])
    }
  })

  it('ignores a non-string item name instead of throwing', () => {
    const junk = [hat, { name: 42 }, null, { qty: 1 }]
    expect(() => reconcileDeliveryItems(junk, 'classroom')).not.toThrow()
    expect(reconcileDeliveryItems(junk, 'classroom').items).toHaveLength(4)
  })

  it('gives the fee a zero cost, so the whole fee counts as raised', () => {
    // profit_cents is subtotal − cost, and the dashboard's "Total Raised" tile
    // is the sum of it. A non-zero cost here would quietly net the PTO's
    // donation off against itself.
    expect(deliveryLineItem().cost_per_unit).toBe(0)
    expect(deliveryLineItem().line_total * 100).toBe(HOME_DELIVERY_FEE_CENTS)
  })
})
