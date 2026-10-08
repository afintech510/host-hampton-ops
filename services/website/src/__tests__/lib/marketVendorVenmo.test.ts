/**
 * "I see the Venmo — mark paid" must put the booth fee in the books.
 *
 * Until 2026-10-07 it only flipped the vendor to paid. Three real $50 booths
 * (HHM-0006/7/8) sat in the vendor book as paid-in-waiting with nothing in the
 * Financials tab, and their receipts sat pending in the Venmo queue where they
 * could have been recorded a second time. Fixtures are those three, verbatim.
 */

import { CHRISTMAS_MARKET_2026 } from '@/lib/christmasMarket'
import { confirmVendorVenmo, pickVendorReceipt, venmoBoothNote } from '@/lib/marketVendorVenmo'
import { makeFakeMoneyDb } from '../helpers/fakeMoneyDb'

const MARKET = CHRISTMAS_MARKET_2026
const NOW = new Date('2026-10-08T15:00:00Z')

const vendor = (over: Record<string, unknown> = {}) => ({
  id: 'v-0008',
  vendor_ref: 'HHM-0008',
  market_slug: MARKET.slug,
  business_name: 'East coast babes',
  contact_name: 'Maeve Dowd',
  email: 'eastcoastbabes2@gmail.com',
  status: 'pending_payment',
  payment_method: 'venmo',
  booth_fee_cents: 5000,
  service_fee_cents: 0,
  total_cents: 5000,
  paid_at: null,
  status_note: 'Booth 3 of 9 at signup.',
  ...over,
})

const receipt = (over: Record<string, unknown> = {}) => ({
  id: 'r-maeve',
  status: 'pending',
  // 8:40am ET on 9/26 — the ledger must say 9/26, not the day of the click.
  paid_at: '2026-09-26T12:40:10Z',
  payer_name: 'Maeve Dowd',
  note: 'Holiday Market booth — East coast babes',
  amount_cents: 5000,
  transaction_id: '4694700000000000001',
  ...over,
})

describe('venmoBoothNote', () => {
  it('is the note the real vendors actually sent', () => {
    expect(venmoBoothNote(MARKET, 'East coast babes')).toBe('Holiday Market booth — East coast babes')
  })
})

describe('pickVendorReceipt', () => {
  const v = vendor()
  it('matches on the note we told them to send', () => {
    expect(pickVendorReceipt(v, MARKET, [receipt({ payer_name: 'Someone Else' })])?.id).toBe('r-maeve')
  })
  it('matches on the payer when the note was retyped', () => {
    expect(pickVendorReceipt(v, MARKET, [receipt({ note: 'booth!!' })])?.id).toBe('r-maeve')
  })
  it('never matches a different amount', () => {
    expect(pickVendorReceipt(v, MARKET, [receipt({ amount_cents: 5205 })])).toBeNull()
  })
  it('refuses to choose between two that both match', () => {
    expect(pickVendorReceipt(v, MARKET, [receipt(), receipt({ id: 'r-2' })])).toBeNull()
  })
  it('ignores an unrelated $50', () => {
    expect(pickVendorReceipt(v, MARKET, [receipt({ payer_name: 'Sherri Luther', note: 'Holiday Market booth — SherriWithAnEye' })])).toBeNull()
  })
})

describe('confirmVendorVenmo', () => {
  it('marks paid, books the fee on the RECEIPT date, and closes the receipt', async () => {
    const db = makeFakeMoneyDb({ market_vendors: [vendor()], venmo_payments: [receipt()] })
    const r = await confirmVendorVenmo(db.client, { vendorId: 'v-0008', actor: 'ADMIN', market: MARKET, now: NOW })

    expect(r.ok).toBe(true)
    const [fin] = db.rows('financial_transactions')
    expect(db.count('financial_transactions')).toBe(1)
    expect(fin).toMatchObject({
      date: '2026-09-26',
      amount_cents: 5000,
      source: 'cash',
      category: 'Vendor Fee',
      customer_name: 'Maeve Dowd',
      reference: 'venmo-vendor-HHM-0008',
    })
    expect(db.rows('market_vendors')[0]).toMatchObject({ status: 'paid', paid_at: '2026-09-26T12:40:10Z' })
    expect(db.rows('venmo_payments')[0]).toMatchObject({ status: 'recorded', resolved_by: 'ADMIN' })
  })

  it('with no receipt in the queue, still books it — dated today, with a notice', async () => {
    const db = makeFakeMoneyDb({ market_vendors: [vendor()], venmo_payments: [] })
    const r = await confirmVendorVenmo(db.client, { vendorId: 'v-0008', actor: 'ADMIN', market: MARKET, now: NOW })

    expect(r.ok && r.notice).toMatch(/dated today/)
    expect(db.rows('financial_transactions')[0]).toMatchObject({ date: '2026-10-08', amount_cents: 5000 })
    expect(db.rows('market_vendors')[0]).toMatchObject({ status: 'paid', paid_at: NOW.toISOString() })
  })

  it('a second click writes nothing twice', async () => {
    const db = makeFakeMoneyDb({ market_vendors: [vendor()], venmo_payments: [receipt()] })
    await confirmVendorVenmo(db.client, { vendorId: 'v-0008', actor: 'ADMIN', market: MARKET, now: NOW })
    const again = await confirmVendorVenmo(db.client, { vendorId: 'v-0008', actor: 'ADMIN', market: MARKET, now: NOW })

    expect(again).toMatchObject({ ok: false, status: 409 })
    expect(db.count('financial_transactions')).toBe(1)
  })

  it('a booth already booked by hand (same reference) is a duplicate, not a second row', async () => {
    const db = makeFakeMoneyDb({
      market_vendors: [vendor()],
      venmo_payments: [receipt()],
      financial_transactions: [{ id: 'f1', date: '2026-09-26', description: 'x', amount_cents: 5000, source: 'cash', category: 'Vendor Fee', reference: 'venmo-vendor-HHM-0008' }],
    })
    const r = await confirmVendorVenmo(db.client, { vendorId: 'v-0008', actor: 'ADMIN', market: MARKET, now: NOW })

    expect(r).toMatchObject({ ok: true, ledger: 'duplicate' })
    expect(db.count('financial_transactions')).toBe(1)
  })

  it('if the books cannot be written, the vendor is NOT marked paid', async () => {
    const db = makeFakeMoneyDb({ market_vendors: [vendor()], venmo_payments: [receipt()] })
    db.breakReadsOn('financial_transactions')
    const r = await confirmVendorVenmo(db.client, { vendorId: 'v-0008', actor: 'ADMIN', market: MARKET, now: NOW })

    expect(r).toMatchObject({ ok: false, status: 500 })
    expect(db.rows('market_vendors')[0]).toMatchObject({ status: 'pending_payment', paid_at: null })
    expect(db.rows('venmo_payments')[0]).toMatchObject({ status: 'pending' })
  })

  it('an unreadable Venmo queue changes nothing — it is not "no receipt"', async () => {
    const db = makeFakeMoneyDb({ market_vendors: [vendor()], venmo_payments: [receipt()] })
    db.breakReadsOn('venmo_payments')
    const r = await confirmVendorVenmo(db.client, { vendorId: 'v-0008', actor: 'ADMIN', market: MARKET, now: NOW })

    expect(r).toMatchObject({ ok: false, status: 503 })
    expect(db.count('financial_transactions')).toBe(0)
    expect(db.rows('market_vendors')[0]).toMatchObject({ status: 'pending_payment' })
  })

  it('refuses a card vendor and a cancelled one', async () => {
    const card = makeFakeMoneyDb({ market_vendors: [vendor({ payment_method: 'card', total_cents: 5205, service_fee_cents: 205 })] })
    expect(await confirmVendorVenmo(card.client, { vendorId: 'v-0008', actor: 'ADMIN', market: MARKET, now: NOW })).toMatchObject({ ok: false, status: 409 })

    const gone = makeFakeMoneyDb({ market_vendors: [vendor({ status: 'cancelled' })] })
    expect(await confirmVendorVenmo(gone.client, { vendorId: 'v-0008', actor: 'ADMIN', market: MARKET, now: NOW })).toMatchObject({ ok: false, status: 409 })
    expect(card.count('financial_transactions') + gone.count('financial_transactions')).toBe(0)
  })
})
