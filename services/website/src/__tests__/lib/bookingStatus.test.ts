import { bookingStage, paymentStatus, partyStatuses, etToday } from '@/lib/bookingStatus'

const today = '2026-10-07'
const stage = (status: string | null, paidCents = 0, partyDate: string | null = '2026-11-21') =>
  bookingStage({ status, paidCents, partyDate, today })

describe('bookingStage — the shapes production held on 2026-10-07', () => {
  it('approved with no money is a quote, not a booking (Jenna, Jaclyn)', () => {
    expect(stage('approved', 0)).toBe('quoted')
  })
  it('approved with a deposit landed is booked (Alyssa, Shannon)', () => {
    expect(stage('approved', 25000)).toBe('booked')
  })
  it('awaiting_deposit with $250 landed is booked (Gabriella)', () => {
    expect(stage('awaiting_deposit', 25000)).toBe('booked')
  })
  it('a booked party whose date has passed is completed (28 paid_in_full rows)', () => {
    expect(stage('paid_in_full', 95000, '2026-09-20')).toBe('completed')
    expect(stage('approved', 25000, '2026-10-06')).toBe('completed')
  })
  it('today is not past', () => {
    expect(stage('approved', 25000, today)).toBe('booked')
  })
  it('legacy booked statuses count without a payment row (hand-entered phone bookings)', () => {
    for (const s of ['confirmed', 'deposit_paid', 'modifications_locked', 'paid_in_full']) {
      expect(stage(s, 0)).toBe('booked')
    }
  })
  it('an unpaid quote whose date passed stays a quote — it never happened as a booking', () => {
    expect(stage('approved', 0, '2026-10-02')).toBe('quoted')
  })
  it('exits win over money: cancelled and lost', () => {
    expect(stage('cancelled', 25000)).toBe('cancelled')
    expect(stage('lost', 0)).toBe('lost')
  })
  it('lead and pending_review without money are inquiries', () => {
    expect(stage('lead')).toBe('inquiry')
    expect(stage('pending_review')).toBe('inquiry')
    expect(stage(null)).toBe('inquiry')
  })
  it('quoted and awaiting_deposit without money are quotes', () => {
    expect(stage('quoted')).toBe('quoted')
    expect(stage('awaiting_deposit')).toBe('quoted')
  })
  it('a refund that nets to zero is not money landed', () => {
    expect(stage('approved', 0)).toBe('quoted')
  })
})

describe('paymentStatus — from the money, never the column', () => {
  const ps = (paidCents: number, totalCents: number | null = 90000, depositCents: number | null = 25000) =>
    paymentStatus({ totalCents, paidCents, depositCents })
  it('nothing paid is unpaid', () => expect(ps(0)).toBe('unpaid'))
  it('a refund past zero is unpaid, not negative', () => expect(ps(-5000)).toBe('unpaid'))
  it('the deposit exactly is deposit paid', () => expect(ps(25000)).toBe('deposit_paid'))
  it('a $100 hold on a $250-deposit party is deposit paid', () => expect(ps(10000)).toBe('deposit_paid'))
  it('more than the deposit, less than the total, is partly paid', () => expect(ps(30000)).toBe('partly_paid'))
  it('the total is paid in full; over it is still paid in full', () => {
    expect(ps(90000)).toBe('paid_in_full')
    expect(ps(95000)).toBe('paid_in_full')
  })
  it('an unpriced plan with money is deposit paid — there is no total to be paid in full of', () => {
    expect(ps(25000, 0)).toBe('deposit_paid')
    expect(ps(25000, null)).toBe('deposit_paid')
  })
})

describe('partyStatuses', () => {
  it('returns both, consistently', () => {
    expect(partyStatuses({ status: 'approved', paidCents: 25000, partyDate: '2026-10-10', today, totalCents: 90000, depositCents: 25000 }))
      .toEqual({ stage: 'booked', payment_status: 'deposit_paid' })
  })
})

describe('etToday', () => {
  it('is the Eastern date, not the UTC one', () => {
    // 2026-10-08 02:30 UTC is still the 7th in New York.
    expect(etToday(new Date('2026-10-08T02:30:00Z'))).toBe('2026-10-07')
  })
})
