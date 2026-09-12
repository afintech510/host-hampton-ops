/**
 * What the reminder engine is allowed to say, and what it costs to say it.
 *
 * These are compliance and money assertions, not copy assertions: every SMS the
 * engine can send must carry opt-out language (CTIA), no reminder template may
 * publish a price (the mobile rate card is being reworked and the rule binds
 * templated copy exactly as `seo.test.ts` binds structured data), and a
 * transactional text must not quietly cost four segments because somebody typed
 * an em dash.
 */

import {
  smsEventReminder1Day,
  smsEventReminder2Hr,
  smsBookingReminder1Day,
  smsBirthdayRebook,
  smsReviewRequest,
} from '@/lib/sms-templates'
import { buildCheckinSmsBody } from '@/lib/checkinLink'
import { smsSegmentInfo, smsEncodingOf } from '@/lib/smsSegments'

const CHECKIN_URL = 'https://www.hosthampton.com/checkin/' + 'a'.repeat(43)

/** Every SMS body the reminder engine can produce, with realistic inputs. */
const REMINDER_SMS: Record<string, string> = {
  event_sms_1day: smsEventReminder1Day({ firstName: 'Sarah', eventName: 'Make Your Own Squishy', time: '6:00 PM' }),
  event_sms_2hr: smsEventReminder2Hr({ firstName: 'Sarah', eventName: 'Make Your Own Squishy' }),
  booking_sms_1day: smsBookingReminder1Day({ firstName: 'Sarah', partyTime: '2:00 PM' }),
  birthday_rebook_sms: smsBirthdayRebook({ firstName: 'Sarah', childName: 'Emma', nextAge: 7 }),
  review_request_sms: smsReviewRequest({ firstName: 'Sarah' }),
  checkin_link: buildCheckinSmsBody('Sarah Jones', CHECKIN_URL),
}

describe('every reminder SMS carries opt-out language', () => {
  it.each(Object.keys(REMINDER_SMS))('%s says how to stop', key => {
    expect(REMINDER_SMS[key]).toMatch(/Reply STOP to opt out/)
  })
})

describe('no reminder template publishes a price', () => {
  // Mobile pricing is being reworked and the published numbers are Adam's call.
  // A template that quotes one is the same defect as a JSON-LD offer that does,
  // and it is far harder to retract once it has been texted.
  it.each(Object.keys(REMINDER_SMS))('%s quotes no figure', key => {
    expect(REMINDER_SMS[key]).not.toMatch(/\$\s?\d/)
  })
})

describe('the carrier arithmetic of the transactional texts', () => {
  it('the check-in link body stays GSM-7 — one em dash doubles its cost', () => {
    const body = REMINDER_SMS.checkin_link
    expect(smsEncodingOf(body)).toBe('GSM-7')
    // Measured: 224 characters. GSM-7 → 2 segments; a single em dash in it makes
    // the whole message UCS-2 at 67 units/segment, which is 4.
    expect(smsSegmentInfo(body).segments).toBeLessThanOrEqual(2)
  })

  it('the three plain reminders are single-segment', () => {
    for (const key of ['event_sms_1day', 'event_sms_2hr', 'booking_sms_1day']) {
      expect(smsSegmentInfo(REMINDER_SMS[key]).segments).toBe(1)
    }
  })

  it('the birthday nudge is knowingly multi-segment, and the budget is told so', () => {
    // The emoji is a voice decision and stays. What must not happen is the
    // monthly marketing-SMS cap being charged one when the carrier sends three.
    const info = smsSegmentInfo(REMINDER_SMS.birthday_rebook_sms)
    expect(info.encoding).toBe('UCS-2')
    expect(info.segments).toBeGreaterThan(1)
  })

  it("an event title with an emoji makes its reminder multi-segment — data, not template", () => {
    // 'Bitchy Bingo 🎃' is a real, live event title. Documented so the cost is
    // understood rather than discovered on a bill.
    const body = smsEventReminder1Day({ firstName: 'Sarah', eventName: 'Bitchy Bingo 🎃', time: '7:00 PM' })
    expect(smsSegmentInfo(body).segments).toBeGreaterThan(1)
  })
})

describe('reminder email templates escape what the customer typed', () => {
  it('does not let a name break out of the HTML', async () => {
    const { partyThankYouHtml, birthdayRebookHtml, partyAdminUnpaidDayOfHtml } =
      await import('@/lib/emailTemplates')

    const hostile = '<script>alert(1)</script>'

    const thanks = partyThankYouHtml({
      customerName: hostile, bookingRef: 'HH-1', partyDate: 'Monday', childName: hostile,
    })
    expect(thanks).not.toContain('<script>')

    const birthday = birthdayRebookHtml({ customerName: hostile, childName: hostile, bookLink: 'https://x/book' })
    expect(birthday).not.toContain('<script>')

    // This one goes to the OWNER, so the customer-written value crosses a trust
    // boundary rather than being echoed back to its author.
    const admin = partyAdminUnpaidDayOfHtml({
      bookingRef: 'HH-1', customerName: hostile, customerPhone: '"><b>x',
      partyDate: 'Monday', balanceFormatted: '$250.00', adminUrl: 'https://x/admin',
    })
    expect(admin).not.toContain('<script>')
    expect(admin).not.toContain('"><b>x')
  })

  it('does not let an admin-written event title break out either', async () => {
    const { reminderEvent3DayHtml } = await import('@/lib/email-templates/reminders')
    const html = reminderEvent3DayHtml({
      customerName: 'Sarah',
      eventTitle: '<img src=x onerror=alert(1)>',
      eventDate: 'Monday', eventTime: '6:00 PM', location: 'Speonk',
    })
    expect(html).not.toContain('<img src=x')
  })
})
