/**
 * The Venmo parser, against REAL notification bodies.
 *
 * Every fixture below is a verbatim (whitespace-collapsed) body or subject out
 * of hosthampton295@gmail.com in September 2026, including the four shapes that
 * share the vocabulary of an incoming payment and are not one — the outbound
 * refund especially, because that refund is the one that cancelled a real
 * ticket four minutes after it was bought.
 */

import {
  decodeVenmoNote,
  isVenmoSender,
  matchEvent,
  normalizeForMatch,
  parseVenmoReceipt,
  type MatchableEvent,
} from '@/lib/venmoReceipt'

/** The three-times-repeated shape Venmo really sends. */
const body = (payer: string, amount: string, note: string) =>
  `${payer} paid you $${amount} ${payer} paid you $${amount} | | | | |---| | | |---|---| | | | | | |---| ` +
  `| ${payer} paid you $ ${amount.split('.')[0]}. ${amount.split('.')[1]} ${note} See transaction[](https://venmo.com/story/4683252657061977606) ` +
  `## Money credited to your Venmo account. ## Transaction details### Date Sep 15, 2026### Transaction ID 5B510947J9727241V### Sent to @hosthampton`

const SQUISHY: MatchableEvent = {
  id: 'evt-squishy',
  title: 'Make Your Own Squishy',
  event_date: '2026-09-25',
  price_cents: 4500,
  sibling_price_cents: null,
  variants: [
    { label: 'First Child', seats: 1, priceCents: 4500 },
    { label: 'SIbling', seats: 1, priceCents: 3500 },
  ],
}
const BINGO: MatchableEvent = {
  id: 'evt-bingo',
  title: 'Bitchy Bingo 🎃',
  event_date: '2026-10-09',
  price_cents: 2500,
  sibling_price_cents: null,
  variants: [],
}
const BEJEWEL: MatchableEvent = {
  id: 'evt-bejewel',
  title: 'Bejewel Drop-Off',
  event_date: '2026-10-26',
  price_cents: 4500,
  sibling_price_cents: null,
  variants: [],
}

describe('isVenmoSender', () => {
  it('matches venmo.com and its subdomains, and nothing else', () => {
    expect(isVenmoSender('venmo@venmo.com')).toBe(true)
    expect(isVenmoSender('no-reply@notify.venmo.com')).toBe(true)
    expect(isVenmoSender('VENMO@Venmo.Com')).toBe(true)
    expect(isVenmoSender('venmo@venmo.com.attacker.net')).toBe(false)
    expect(isVenmoSender('venmo@notvenmo.com')).toBe(false)
    expect(isVenmoSender(null)).toBe(false)
  })
})

describe('parseVenmoReceipt — money that arrived', () => {
  it('reads payer, amount and note from a real receipt', () => {
    const r = parseVenmoReceipt('Meg McKeel paid you $45.00', body('Meg McKeel', '45.00', 'Make+Your+Own+Squishy'))
    expect(r).not.toBeNull()
    expect(r!.payerName).toBe('Meg McKeel')
    expect(r!.amountCents).toBe(4500)
    expect(r!.note).toBe('Make Your Own Squishy')
    expect(r!.transactionId).toBe('5B510947J9727241V')
  })

  it('reads the "paid $N to your Venmo account" subject form', () => {
    const r = parseVenmoReceipt(
      'Kyra Possin paid $45.00 to your Venmo account. Leave it in Venmo or transfer it to your bank account.',
      body('Kyra possin', '45.00', 'Bejewel+Drop-Off. Margaret Ottati'),
    )
    expect(r!.payerName).toBe('Kyra Possin')
    expect(r!.amountCents).toBe(4500)
    expect(r!.note).toBe('Bejewel Drop-Off. Margaret Ottati')
  })

  it('handles a thousands separator', () => {
    const r = parseVenmoReceipt('Kate Kanas paid you $1,491.00', body('Kate Kanas', '1491.00', 'HH-2026-1052'))
    expect(r!.amountCents).toBe(149100)
  })

  it('takes the LAST rendering of the note, not the first', () => {
    // The body says "paid you $80.00" three times before the real note. A lazy
    // match from the first one swallows the repeats and the table scaffolding.
    const r = parseVenmoReceipt('Randi Lynch paid you $80.00', body('Randi Lynch', '80.00', 'Lynch Kiddos Squishy Night 💕💕'))
    expect(r!.note).toBe('Lynch Kiddos Squishy Night 💕💕')
    expect(r!.note).not.toMatch(/paid you/i)
    expect(r!.note).not.toContain('|')
  })

  it('treats a blank note as a receipt, not a failure', () => {
    const r = parseVenmoReceipt('Casey McCabe paid you $20.00', body('Casey McCabe', '20.00', ''))
    expect(r).not.toBeNull()
    expect(r!.note).toBe('')
  })

  it('survives a body it cannot find a note in', () => {
    const r = parseVenmoReceipt('Meg McKeel paid you $45.00', 'nothing useful here')
    expect(r!.amountCents).toBe(4500)
    expect(r!.note).toBe('')
  })
})

describe('parseVenmoReceipt — the things that are not money arriving', () => {
  const notReceipts: [string, string][] = [
    // The refund that cancelled a real ticket, four minutes after it was bought.
    ['You paid Kyra Possin $45.00', 'You paid Kyra Possin $ 45. 00 Refund See transaction'],
    ['You paid Adam Larkin $500.00', 'You paid Adam Larkin $ 500. 00 🍆 See transaction'],
    ['Receipt from SATURDAY CANDY CO - $12.44', 'SATURDAY CANDY CO Purchase on Friday, September 4'],
    ['TARGET T-2847 refunded you $8.31', 'TARGET T-2847 refunded you $ 8 . 31 See transaction'],
    ['Kyra Possin commented on a payment between you and Kyra Possin', 'Kyra Possin just commented on a payment'],
  ]
  it.each(notReceipts)('rejects %s', (subject, bodyText) => {
    expect(parseVenmoReceipt(subject, bodyText)).toBeNull()
  })

  it('rejects an empty subject', () => {
    expect(parseVenmoReceipt('', body('x', '10.00', 'y'))).toBeNull()
    expect(parseVenmoReceipt(null, null)).toBeNull()
  })
})

describe('decodeVenmoNote', () => {
  it('decodes form encoding', () => {
    expect(decodeVenmoNote('Blair+—+Mobile+Party+10/3+Deposit')).toBe('Blair — Mobile Party 10/3 Deposit')
    expect(decodeVenmoNote('Make%20Your%20Own%20Squishy')).toBe('Make Your Own Squishy')
  })

  it('leaves a lone % alone rather than throwing the receipt away', () => {
    expect(decodeVenmoNote('50% deposit')).toBe('50% deposit')
  })
})

describe('normalizeForMatch', () => {
  it('strips emoji and punctuation', () => {
    expect(normalizeForMatch('Bitchy Bingo 🎃')).toBe('bitchy bingo')
    expect(normalizeForMatch('Bejewel Drop-Off')).toBe('bejewel drop off')
  })
})

describe('matchEvent', () => {
  const events = [SQUISHY, BINGO, BEJEWEL]
  const receipt = (amountCents: number, note: string) => ({ payerName: 'x', amountCents, note, transactionId: null })

  it('matches on the event title and splits one seat', () => {
    const m = matchEvent(receipt(4500, 'Make Your Own Squishy'), events)
    expect(m.eventId).toBe('evt-squishy')
    expect(m.confidence).toBe('title')
    expect(m.seats).toEqual([{ variantLabel: 'First Child', unitPriceCents: 4500, quantity: 1 }])
  })

  it('matches on a distinctive word inside a chatty note', () => {
    const m = matchEvent(receipt(8000, 'Lynch Kiddos Squishy Night 💕💕'), events)
    expect(m.eventId).toBe('evt-squishy')
    expect(m.confidence).toBe('title')
  })

  it('splits $80 into a first child and a sibling, using the event’s own spelling', () => {
    const m = matchEvent(receipt(8000, 'Make Your Own Squishy (Lottie and Sophie Dwyer)'), events)
    expect(m.seats).toEqual([
      { variantLabel: 'First Child', unitPriceCents: 4500, quantity: 1 },
      { variantLabel: 'SIbling', unitPriceCents: 3500, quantity: 1 },
    ])
  })

  it('splits a round multiple into full-price seats', () => {
    const m = matchEvent(receipt(9000, 'Make Your Own Squishy'), events)
    expect(m.seats).toEqual([{ variantLabel: 'First Child', unitPriceCents: 4500, quantity: 2 }])
  })

  it('matches the emoji title', () => {
    const m = matchEvent(receipt(2500, 'Bitchy+Bingo+🎃'), events)
    expect(m.eventId).toBe('evt-bingo')
    expect(m.seats).toEqual([{ variantLabel: null, unitPriceCents: 2500, quantity: 1 }])
  })

  it('names the event but refuses to invent seats when the amount does not fit', () => {
    const m = matchEvent(receipt(6000, 'Make Your Own Squishy'), events)
    expect(m.eventId).toBe('evt-squishy')
    expect(m.seats).toBeNull()
    expect(m.reason).toMatch(/not a whole number of seats/)
  })

  it('falls back to the amount when the note names no event', () => {
    // Ruvimbo Nyakurimwa's real note: "Host Hampton event ticket Sophia and
    // Ethan Lettieri". $80 is the squishy night's first-child + sibling and
    // nothing else on the calendar can make it.
    const m = matchEvent(receipt(8000, 'Host Hampton event ticket Sophia and Ethan Lettieri'), events)
    expect(m.eventId).toBe('evt-squishy')
    expect(m.confidence).toBe('amount')
  })

  it('says it does not know when two events explain the amount equally', () => {
    // $45 is both the squishy night and the bejewel drop-off.
    const m = matchEvent(receipt(4500, 'thanks!!'), events)
    expect(m.eventId).toBeNull()
    expect(m.confidence).toBe('none')
  })

  it('does not match a party deposit to an event on the common words alone', () => {
    const m = matchEvent(receipt(25000, 'Blair — Mobile Party 10/3 Deposit'), events)
    expect(m.eventId).toBeNull()
    expect(m.confidence).toBe('none')
  })

  it('says it does not know when there are no events at all', () => {
    const m = matchEvent(receipt(4500, 'Make Your Own Squishy'), [])
    expect(m.confidence).toBe('none')
    expect(m.reason).toMatch(/no upcoming events/)
  })
})
