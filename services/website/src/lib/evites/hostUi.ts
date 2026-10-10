/**
 * The host page's decisions that are not drawing or networking (spec §7.2), kept pure and
 * import-free so the client island and the node-only jest both use them.
 *
 * - `shareGate`        when the Share panel is live, and what to say when it is not
 * - `stateBanner`      the state banner's copy (spec §4)
 * - `smsHref`          the `sms:` fallback body, iOS vs everything else
 * - `kidsLine` ...     the headcount text ("11 of 10 kids")
 * - the form helpers   customise form <-> `PATCH` body, sending only what changed
 *
 * Nothing here imports another module: `formatHostPhone` / `isHostPhone` live here (and are
 * re-used by the server screen) precisely so the browser bundle does not pull in the server's
 * contact-lookup code through `screens.ts`.
 */

export type HostState = 'preview' | 'needs_time' | 'live' | 'closed'

// ---------------------------------------------------------------- the Share panel

export interface ShareGate {
  enabled: boolean
  /** Why it is not enabled (or null when it is). */
  message: string | null
}

export const UPDATING_MESSAGE = 'Updating your invitation…'

/**
 * Share is active ONLY when the party is live AND the picture on file matches the invitation
 * (spec §7.2), so the first text a host sends never carries a stale "Pick your date" card.
 * Every other state gets its own explanation, never a bare disabled button.
 */
export function shareGate(state: HostState, renderFresh: boolean): ShareGate {
  switch (state) {
    case 'live':
      return renderFresh ? { enabled: true, message: null } : { enabled: false, message: UPDATING_MESSAGE }
    case 'preview':
      return { enabled: false, message: 'You can share your invitation as soon as your party is booked.' }
    case 'needs_time':
      return { enabled: false, message: 'You can share your invitation as soon as your party’s start time is set.' }
    case 'closed':
      return { enabled: false, message: 'This party has happened, so there is nothing left to share.' }
  }
}

export type BannerTone = 'preview' | 'soon' | 'live' | 'updating' | 'done'

export interface StateBanner {
  tone: BannerTone
  title: string
  body: string
}

/** Spec §4's four visible states, in the host's voice. */
export function stateBanner(state: HostState, renderFresh: boolean): StateBanner {
  switch (state) {
    case 'preview':
      return {
        tone: 'preview',
        title: 'Preview',
        body: 'This is how your invitation will look. Guests can RSVP, and you can share it, once your party is booked.',
      }
    case 'needs_time':
      return {
        tone: 'soon',
        title: 'Time coming soon',
        body: 'Your party is booked, but we still need the start time. Guests will see “Time coming soon” until it is set, and sharing opens then.',
      }
    case 'live':
      return renderFresh
        ? { tone: 'live', title: 'Your invitation is live', body: 'Share it with your guests below. RSVPs show up here as they come in.' }
        : { tone: 'updating', title: UPDATING_MESSAGE, body: 'We are redrawing the picture with your latest details. Sharing turns back on in a moment.' }
    case 'closed':
      return { tone: 'done', title: 'This party has happened \u{1F389}', body: 'Here is who answered. Thank you for celebrating with us!' }
  }
}

/** iPhone and iPad: the two platforms whose Messages wants `sms:&body=`. */
export function isIosUserAgent(ua: string | null | undefined): boolean {
  return typeof ua === 'string' && /iPhone|iPad/.test(ua)
}

/** The text a share carries: the sentence, a space, the link. */
export function shareMessage(text: string, url: string): string {
  return `${text} ${url}`
}

/** `sms:&body=` on iOS, `sms:?body=` elsewhere (spec §7.2). The body is percent-encoded. */
export function smsHref(ios: boolean, body: string): string {
  return `sms:${ios ? '&' : '?'}body=${encodeURIComponent(body)}`
}

/** Poll every 30 s; every 5 s while a render the host just asked for is in flight. */
export function pollIntervalMs(state: HostState, renderFresh: boolean): number {
  return state === 'live' && !renderFresh ? 5_000 : 30_000
}

// ---------------------------------------------------------------- the headcount

/** '11 of 10 kids', '4 of 12 kids', or '4 kids' when the booking has no guest count. */
export function kidsLine(kidsYes: number, cap: number | null): string {
  if (cap === null) return `${kidsYes} ${kidsYes === 1 ? 'kid' : 'kids'}`
  return `${kidsYes} of ${cap} kids`
}

export function overCap(kidsYes: number, cap: number | null): boolean {
  return cap !== null && kidsYes > cap
}

/** '3 adults', '5+ adults' (the "+" when any answer said "2+"), '1 adult'. */
export function adultsLine(adultsYes: number, adultsPlus: boolean): string {
  return `${adultsYes}${adultsPlus ? '+' : ''} ${adultsYes === 1 && !adultsPlus ? 'adult' : 'adults'}`
}

/** One answer's adult count: the stored 2 means "2+". */
export function adultLabel(adultCount: 0 | 1 | 2): string {
  return adultCount === 0 ? 'no adults staying' : adultCount === 1 ? '1 adult' : '2+ adults'
}

// ---------------------------------------------------------------- phone

const HOST_PHONE = /^[2-9][0-9]{2}-[0-9]{3}-[0-9]{4}$/

/** Exactly `NNN-NNN-NNNN`, first digit 2-9: the only spelling the server (and the table) accepts. */
export function isHostPhone(v: unknown): v is string {
  return typeof v === 'string' && HOST_PHONE.test(v)
}

/**
 * The form's courtesy: '(631) 555-1234', '631.555.1234', '+1 631 555 1234' become '631-555-1234'.
 * Anything with a letter or other symbol, or that is not ten (or 1+ten) digits, is returned
 * UNCHANGED, so the server's strict screen rejects exactly what the person typed.
 */
export function formatHostPhone(raw: string): string {
  const s = raw.trim()
  if (!/^[+\d\s().-]+$/.test(s)) return s
  let d = s.replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1)
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : s
}

// ---------------------------------------------------------------- the customise form

/** Every field as the input holds it: text, never null. */
export interface HostFormState {
  hostNote: string
  giftNote: string
  rsvpDeadline: string
  showHostContact: boolean
  hostContactName: string
  hostContactPhone: string
}

export interface HostCustomizeValues {
  host_note: string | null
  gift_note: string | null
  rsvp_deadline: string | null
  show_host_contact: boolean
  host_contact_name: string | null
  host_contact_phone: string | null
}

export function formFromCustomize(c: HostCustomizeValues): HostFormState {
  return {
    hostNote: c.host_note ?? '',
    giftNote: c.gift_note ?? '',
    rsvpDeadline: c.rsvp_deadline ?? '',
    showHostContact: c.show_host_contact,
    hostContactName: c.host_contact_name ?? '',
    hostContactPhone: c.host_contact_phone ?? '',
  }
}

/**
 * The `PATCH` body: ONLY the fields whose value differs from what is stored, with '' sent as
 * null. An untouched field is never re-sent, so an old RSVP-by date that has since passed
 * cannot make an unrelated edit fail. Empty object = nothing to save.
 */
export function patchFromForm(form: HostFormState, stored: HostCustomizeValues): Record<string, string | boolean | null> {
  const patch: Record<string, string | boolean | null> = {}
  const text = (v: string) => (v.trim() === '' ? null : v.trim())
  if (text(form.hostNote) !== stored.host_note) patch.host_note = text(form.hostNote)
  if (text(form.giftNote) !== stored.gift_note) patch.gift_note = text(form.giftNote)
  if (text(form.rsvpDeadline) !== stored.rsvp_deadline) patch.rsvp_deadline = text(form.rsvpDeadline)
  if (form.showHostContact !== stored.show_host_contact) patch.show_host_contact = form.showHostContact
  if (text(form.hostContactName) !== stored.host_contact_name) patch.host_contact_name = text(form.hostContactName)
  const phone = text(form.hostContactPhone)
  const phoneOut = phone === null ? null : formatHostPhone(phone)
  if (phoneOut !== stored.host_contact_phone) patch.host_contact_phone = phoneOut
  return patch
}
