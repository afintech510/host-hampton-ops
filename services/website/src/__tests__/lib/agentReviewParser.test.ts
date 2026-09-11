/**
 * Regression tests for the review-loop parser, written from an adversarial pass
 * over Phase 2 on 2026-09-11. Each block below is a defect that was found in
 * production code, not a restatement of the original author's intent.
 */

import { parseReviewerReply } from '@/lib/agent/reviewLoop'

describe('parseReviewerReply — a quoted original must not be parsed as intent', () => {
  // An iPhone inline reply carries the whole original SMS back, and the agent's
  // own review text says "Reply SEND, CANCEL, or say what to change".
  const QUOTE = '> [HH-2026-0313] mobile party info-gather. Reply SEND, CANCEL, or say what to change.'

  it('approves on the typed word when the rest is quoted', () => {
    const p = parseReviewerReply(`Send\n\n${QUOTE}`)
    expect(p.intent).toBe('approve')
    expect(p.code).toBe('HH-2026-0313')
  })

  it('reads the code out of the quote even when the typing came after it', () => {
    const p = parseReviewerReply(`${QUOTE}\nSEND`)
    expect(p.intent).toBe('approve')
    expect(p.code).toBe('HH-2026-0313')
  })

  it('does not let quoted command words turn a revision into an approval', () => {
    const p = parseReviewerReply(`add her phone number\n\n${QUOTE}`)
    expect(p.intent).toBe('revise')
    // The note is what the human typed — not our own boilerplate.
    expect(p.note).toBe('add her phone number')
  })
})

describe('parseReviewerReply — a trailing number is only a short code after a command', () => {
  // Regression: "make the price 1200" parsed as command "make the price" +
  // short code "1200". The number was deleted from the note and the loop
  // replied "I can't find a draft matching 1200" instead of revising.
  it.each([
    'make the price 1200',
    'change the guest count to 2026',
    'move the party to 2030',
  ])('keeps the number in the note: %s', text => {
    const p = parseReviewerReply(text)
    expect(p.intent).toBe('revise')
    expect(p.shortCode).toBeNull()
    expect(p.note).toBe(text)
  })

  it.each([
    ['APPROVE 0313', 'approve'],
    ['STOP 0313', 'cancel'],
    ['TEST 0313', 'test'],
  ])('still reads a real short code: %s', (text, intent) => {
    const p = parseReviewerReply(text)
    expect(p.intent).toBe(intent)
    expect(p.shortCode).toBe('0313')
  })
})

describe('parseReviewerReply — everything ambiguous stays a revision', () => {
  it.each([
    'send it to her',
    "don't send this yet",
    'send it after you fix the date',
    'can we send tomorrow?',
    'looks good but fix the date first',
  ])('%s is NOT an approval', text => {
    expect(parseReviewerReply(text).intent).toBe('revise')
  })
})

describe('parseReviewerReply — plain approvals a human would expect to work', () => {
  it.each(['SEND', 'send it', 'Send it!', 'SEND 👍', 'yes send it', 'send\nit', 'Approve it.'])(
    '%s approves',
    text => {
      expect(parseReviewerReply(text).intent).toBe('approve')
    },
  )
})

describe('parseReviewerReply — EDIT: prefix', () => {
  it('strips the prefix when the colon is there', () => {
    expect(parseReviewerReply('EDIT: make it warmer').note).toBe('make it warmer')
  })

  it('leaves a bare verb alone so the instruction stays whole', () => {
    expect(parseReviewerReply('change the date to Nov 30').note).toBe('change the date to Nov 30')
  })
})
