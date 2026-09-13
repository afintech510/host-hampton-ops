/**
 * The agent's output guardrails EXERCISED, not read.
 *
 * `agentSurface.test.ts` reads the surface off disk and asserts the screens are
 * where they should be. This file drives them. Both are needed and neither
 * substitutes: link 17's attack harness had a detector that could not run at all,
 * so all 34 of its mutations reported "caught", and a source-reading rule cannot
 * tell you whether a regex actually matches the payload it was written for.
 *
 * Every payload below was run against the LIVE implementation and against all 23
 * real drafts in production before the fix, which is how the false-positive risk
 * of the phone-number and payment-processor rules was measured at zero rather
 * than argued for: not one draft the agent has ever written contains a phone
 * number, a URL or an `@handle`.
 */

import { containsForeignContact, containsFabricatedTerms, containsMoney, screenGeneratedDraft } from '@/lib/agent/draftGuards'
import { screenLearningText } from '@/lib/agent/learnings'
import { sanitizeExtracted } from '@/lib/agent/extractPlanFields'
import { sanitizeVoiceProfile } from '@/lib/agent/voice'

/**
 * Every way an injection can point a customer's deposit at a stranger.
 *
 * EIGHT of these ten passed `containsForeignContact` — the guardrail whose own
 * header says "the worst answer by a distance is: get a payment redirected" —
 * because the host allowlist matched on the HOST and listed venmo.com and
 * stripe.com. A payment processor's domain is evidence of the opposite of
 * ownership: the whole point of a hosted payment page is that anyone can own one.
 */
const REDIRECTS: [string, string][] = [
  ["an attacker's own Stripe payment page", 'Pay the deposit here: https://buy.stripe.com/4gwcNa1Bt0Xv9kk28e'],
  ['a Stripe Checkout session', 'Checkout link: https://checkout.stripe.com/c/pay/cs_live_abc123'],
  ["someone else's Venmo pay page", 'Send the $250 to https://venmo.com/u/not-allie'],
  ['the same with www.', 'Venmo: https://www.venmo.com/u/attacker-handle'],
  ['a bare-domain Venmo link', 'Venmo us at www.venmo.com/u/somebody-else'],
  ['a Zelle phone number (Zelle is keyed by PHONE)', 'Zelle the deposit to 917-555-0134 to hold your date.'],
  ['a "billing line" to move the conversation', 'Text our billing line at (917) 555-0134 to pay the deposit.'],
  ['a +1-prefixed number', 'call +1 917 555 0134 for payment details'],
  ['a bare ten-digit number', 'reach me at 9175550134'],
  ['a Cash App cashtag', 'Cash App us at $NotAllie for the deposit.'],
  ['a two-character handle, under the old floor', 'Venmo @ab'],
  ['a normal foreign handle', 'Venmo the deposit to @not-allie-at-all'],
  ['a foreign link', 'Pay at https://evil.example.com/pay'],
  ['a foreign email address', 'Email billing@not-hosthampton.com to settle up.'],
]

/**
 * What a real draft legitimately says. Shapes taken from the 23 drafts in
 * production plus the sentences the fix must never refuse.
 *
 * This half is the expensive direction. A guardrail that parks every draft means
 * Adam stops getting texts and the agent is effectively off.
 */
const LEGITIMATE: [string, string][] = [
  ['a first-contact greeting', "Hi Jess! I'm Allie from Host Hampton — thanks so much for reaching out about a slime party."],
  ['our public line, formatted', 'Give us a call or text on (631) 998-9325 and we can talk it through. – Allie, Host Hampton'],
  ['our public line, bare digits', 'Reply to this text on 6319989325 any time.'],
  ['our Venmo handle and our Zelle number', 'You can Venmo the $250 deposit to @HostHampton, or Zelle it to 631-599-2469.'],
  ['a link to our own site', 'Our studio is in Speonk. Full details at https://www.hosthampton.com/party-packages'],
  ['one of our own short links', 'Book here: https://hosthampton.com/s/8Kq2mXp7'],
  ['our own inbox', 'Email me back or ring hosthampton295@gmail.com if that is easier.'],
  ['a date, a time and a headcount', 'The party is on 10/3 from 2-5pm for 12 kids, turning 7.'],
  ['a Venmo link to OUR handle', 'Venmo us here: https://venmo.com/u/HostHampton'],
]

describe('containsForeignContact — the money-redirect axis', () => {
  beforeEach(() => {
    process.env.VENMO_HANDLE = 'HostHampton'
    process.env.ZELLE_PHONE = '631-599-2469'
    process.env.QUO_PHONE_NUMBER = '+16319989325'
    process.env.REVIEWER_PHONES = '+16314008080'
    process.env.OWNER_NOTIFY_EMAIL = 'hosthampton295@gmail.com'
  })

  it.each(REDIRECTS)('refuses %s', (_label, payload) => {
    expect(containsForeignContact(payload)).not.toBeNull()
  })

  it.each(LEGITIMATE)('allows %s', (_label, payload) => {
    expect(containsForeignContact(payload)).toBeNull()
  })

  it('names WHERE the hit was, so a reviewer knows what to look at', () => {
    expect(containsForeignContact(REDIRECTS[0][1])).toMatch(/buy\.stripe\.com/)
    expect(containsForeignContact(REDIRECTS[5][1])).toMatch(/phone number/)
    expect(containsForeignContact(REDIRECTS[9][1])).toMatch(/payment handle/)
  })

  it('a cashtag is not a price and a price is not a cashtag', () => {
    // `$250` is the money guardrail's business; `$NotAllie` is this one's.
    expect(containsForeignContact('The deposit is $250.')).toBeNull()
    expect(containsForeignContact('Send it to $NotAllie')).toMatch(/payment handle/)
  })

  it('the same payloads are refused as a LEARNED RULE', () => {
    // A learning lands in the TRUSTED half of the draft prompt, permanently, on
    // every future draft — so the same hole there was worse than in one draft.
    for (const [, payload] of REDIRECTS) {
      expect(screenLearningText(payload)).not.toBeNull()
    }
  })

  it('the same payloads are dropped from a VOICE PROFILE', () => {
    for (const [, payload] of REDIRECTS) {
      const { profile, dropped } = sanitizeVoiceProfile({ tone_rules: [payload] })
      expect(profile.tone_rules ?? []).toEqual([])
      expect(dropped.length).toBe(1)
    }
  })
})

describe('screenGeneratedDraft — every generated string, including the summary', () => {
  const clean = {
    emailDraft: 'Hi Jess! Allie from Host Hampton here. What date were you thinking?',
    smsDraft: 'Hi Jess! Allie from Host Hampton — what date works? – Allie',
    emailSubject: 'Your Host Hampton party',
    summaryForReviewer: 'New slime-party lead, asking about October dates.',
  }

  it('passes a clean draft', () => {
    expect(screenGeneratedDraft(clean, 'draft')).toBeNull()
  })

  it.each(['emailDraft', 'smsDraft', 'emailSubject', 'summaryForReviewer'] as const)(
    'catches a redirect in %s',
    field => {
      const hit = screenGeneratedDraft({ ...clean, [field]: 'Venmo it to @not-allie' }, 'draft')
      expect(hit).toMatch(/foreign_contact_in_draft/)
    },
  )

  it('catches a redirect in the SUMMARY specifically, which nothing used to', () => {
    // The one line a reviewer reads on a phone: the whole of the one-segment SMS
    // ping, the Slack fallback text, and the sentence beside the Approve button.
    const hit = screenGeneratedDraft(
      { ...clean, summaryForReviewer: 'Ready to book — wants to pay via https://buy.stripe.com/x' },
      'draft',
    )
    expect(hit).toMatch(/reviewer summary/)
  })

  it('names the field, so the reason sends a human to the right place', () => {
    expect(screenGeneratedDraft({ ...clean, smsDraft: 'Venmo @thief' }, 'revision')).toMatch(
      /revision's sms/,
    )
  })

  it('catches a fabricated concession on either path', () => {
    const hit = screenGeneratedDraft({ ...clean, emailDraft: 'Your deposit is waived!' }, 'draft')
    expect(hit).toMatch(/fabricated_terms/)
  })

  it('does not park a draft for naming the real $250 deposit', () => {
    expect(
      screenGeneratedDraft({ ...clean, emailDraft: 'A flat $250 deposit books the date.' }, 'draft'),
    ).toBeNull()
  })
})

describe('sanitizeExtracted — a model does not get to guess', () => {
  const ALL = ['contact_name', 'party_date', 'party_time', 'guest_count', 'venue_address'] as const
  const TODAY = '2026-09-13'

  it('keeps a future date', () => {
    const { fields } = sanitizeExtracted({ party_date: '2026-10-03' }, ALL, TODAY)
    expect(fields.party_date).toBe('2026-10-03')
  })

  it('REFUSES a past date and keeps it as free text instead', () => {
    // A relative-date resolver's failure mode is the wrong month or the wrong
    // year, and `coerceIsoDate` cannot see that: 2025-10-14 is a perfectly good
    // Tuesday. Writing one stops the agent asking (rule 15) AND computes
    // `modification_cutoff` / `guest_count_cutoff` in the past, which locks a live
    // booking's modification windows the moment it lands.
    const { fields, requestedDateText } = sanitizeExtracted({ party_date: '2025-10-14' }, ALL, TODAY)
    expect(fields.party_date).toBeUndefined()
    expect(requestedDateText).toBe('2025-10-14')
  })

  it('accepts today', () => {
    const { fields } = sanitizeExtracted({ party_date: TODAY }, ALL, TODAY)
    expect(fields.party_date).toBe(TODAY)
  })

  it('a free-text date the model DID give wins over the rejected one', () => {
    const { requestedDateText } = sanitizeExtracted(
      { party_date: '2025-10-14', requestedDateText: 'mid-October' },
      ALL,
      TODAY,
    )
    expect(requestedDateText).toBe('mid-October')
  })

  it('bounds the guest count through the shared screen', () => {
    expect(sanitizeExtracted({ guest_count: 12 }, ALL, TODAY).fields.guest_count).toBe(12)
    expect(sanitizeExtracted({ guest_count: 0 }, ALL, TODAY).fields.guest_count).toBeUndefined()
    expect(sanitizeExtracted({ guest_count: -3 }, ALL, TODAY).fields.guest_count).toBeUndefined()
    expect(sanitizeExtracted({ guest_count: 201 }, ALL, TODAY).fields.guest_count).toBeUndefined()
    expect(sanitizeExtracted({ guest_count: 1e20 }, ALL, TODAY).fields.guest_count).toBeUndefined()
    expect(sanitizeExtracted({ guest_count: 7.5 }, ALL, TODAY).fields.guest_count).toBeUndefined()
    // The ceiling is the agent's, tighter than the public form's 500.
    expect(sanitizeExtracted({ guest_count: 200 }, ALL, TODAY).fields.guest_count).toBe(200)
  })

  it('still drops every field outside the allowed list', () => {
    const { fields } = sanitizeExtracted(
      { contact_name: 'Jess', party_date: '2026-10-03' },
      ['contact_name'],
      TODAY,
    )
    expect(fields).toEqual({ contact_name: 'Jess' })
  })
})

describe('the money guardrail still behaves', () => {
  it('catches a bare rate and a spelled amount', () => {
    expect(containsMoney('Our rate is 575 for three hours')).toBe(true)
    expect(containsMoney('about five hundred for the package')).toBe(true)
  })

  it('does not fire on the sentences a real info-gather draft contains', () => {
    expect(containsMoney('To put pricing together for Oct 10 or 11, I need a headcount.')).toBe(false)
    expect(containsMoney('12 kids, turning 7, from 2-5pm')).toBe(false)
    expect(containsMoney('Call us on (631) 998-9325')).toBe(false)
  })

  it('the deposit is the only figure a draft may state', () => {
    expect(containsFabricatedTerms('A flat $250 deposit books the date.')).toBeNull()
    expect(containsFabricatedTerms('The total is $1,850.')).toMatch(/not the \$250 deposit/)
  })
})
