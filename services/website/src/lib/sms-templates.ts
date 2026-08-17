/**
 * SMS templates for Host Hampton.
 *
 * All functions return plain text strings.
 * Transactional messages (reminders) include opt-out instruction per TCPA/CTIA.
 * Marketing messages always end with "Reply STOP to opt out".
 *
 * Target: 160 chars per segment where possible (1 segment = 160 GSM-7 chars).
 * Multi-segment messages are clearly noted.
 */

/* ── Transactional — Event Reminders ─────────────────────────── */

export interface SmsEventReminder1DayParams {
  firstName: string
  eventName: string
  time: string
}

/**
 * Event reminder sent 1 day before. ~156 chars with short inputs.
 */
export function smsEventReminder1Day(params: SmsEventReminder1DayParams): string {
  const { firstName, eventName, time } = params
  return `Hi ${firstName}! Reminder: ${eventName} is tomorrow at ${time}. Host Hampton, 295 Montauk Hwy, Speonk. Reply STOP to opt out`
}

export interface SmsEventReminder2HrParams {
  firstName: string
  eventName: string
}

/**
 * Event reminder sent 2 hours before. ~110 chars.
 */
export function smsEventReminder2Hr(params: SmsEventReminder2HrParams): string {
  const { firstName, eventName } = params
  return `See you soon at Host Hampton, ${firstName}! ${eventName} starts in 2 hours. 295 Montauk Hwy, Speonk. Reply STOP to opt out`
}

/* ── Transactional — Booking Reminders ───────────────────────── */

export interface SmsBookingReminder1DayParams {
  firstName: string
  partyTime: string
}

/**
 * Party booking reminder sent 1 day before. ~134 chars.
 */
export function smsBookingReminder1Day(params: SmsBookingReminder1DayParams): string {
  const { firstName, partyTime } = params
  return `Hi ${firstName}! Your party is tomorrow at ${partyTime} at Host Hampton! Can't wait to celebrate with you. Reply STOP to opt out`
}

/* ── Marketing — Parties ─────────────────────────────────────── */

/**
 * Generic party marketing blast. ~155 chars.
 */
export function smsMarketingParty(): string {
  return `Planning a party? Host Hampton in Speonk has themed birthday parties, decor & a dedicated coordinator. Book online: hosthampton.com/party-packages Reply STOP to opt out`
}

/* ── Marketing — Events ──────────────────────────────────────── */

export interface SmsMarketingEventParams {
  eventName: string
  date: string
}

/**
 * Event promo text. ~160 chars with short inputs; may be 2 segments for long event names.
 */
export function smsMarketingEvent(params: SmsMarketingEventParams): string {
  const { eventName, date } = params
  return `Join us! ${eventName} at Host Hampton on ${date} in Speonk. Spots fill fast — grab yours: hosthampton.com/events Reply STOP to opt out`
}

/* ── Marketing — Permanent Jewelry ──────────────────────────── */

/**
 * Jewelry promo text. ~152 chars.
 */
export function smsMarketingJewelry(): string {
  return `Permanent jewelry at Host Hampton! Welded-on bracelets & anklets — no clasp, no fuss. Starting at $38. Book: hosthampton.com/permanent-jewelry Reply STOP to opt out`
}

/* ── Marketing — Flash Sale ──────────────────────────────────── */

export interface SmsFlashSaleParams {
  offerText: string
  deadline: string
  link: string
}

/**
 * Flash sale alert. Length varies with offer text; may exceed 1 segment.
 */
export function smsFlashSale(params: SmsFlashSaleParams): string {
  const { offerText, deadline, link } = params
  return `FLASH SALE! Host Hampton: ${offerText}. Offer ends ${deadline}. Book now: ${link} Reply STOP to opt out`
}

/* ── Marketing — Birthday Rebooking ─────────────────────────── */

export interface SmsBirthdayRebookParams {
  firstName: string
  childName?: string | null
  nextAge?: number | null
}

/**
 * Birthday rebooking nudge (~10 months after last party). Promotional, so
 * sms_opt_in=true only and STOP language required. ~150 chars with short
 * inputs; may reach 2 segments for long names.
 */
export function smsBirthdayRebook(params: SmsBirthdayRebookParams): string {
  const { firstName, childName, nextAge } = params
  const who = childName ? `${childName}'s` : `your little one's`
  const age = nextAge != null ? ` ${nextAge}th` : ''
  return `Hi ${firstName}! ${who}${age} birthday is coming up 🎉 Our party dates fill fast — book with Host Hampton: hosthampton.com/book Reply STOP to opt out`
}

/* ── Transactional — Post-Event Review Request ─────────────── */

export interface SmsReviewRequestParams {
  firstName: string
  reviewUrl?: string
}

const DEFAULT_REVIEW_URL = 'https://search.google.com/local/writereview?placeid=ChIJv3k3iqn36IkRfD0Mkz2QWj4'

/**
 * Review request sent 24 hours after an event or booking. ~180 chars (2 segments).
 * Pass `reviewUrl` (e.g. from `lib/marketing/reviewLink.ts`) to send a UTM-tagged
 * link; falls back to the bare placeid link if omitted.
 */
export function smsReviewRequest(params: SmsReviewRequestParams): string {
  const { firstName, reviewUrl = DEFAULT_REVIEW_URL } = params
  return `Hi ${firstName}! Hope you had an amazing time at Host Hampton! We'd love your feedback: ${reviewUrl} Reply STOP to opt out`
}
