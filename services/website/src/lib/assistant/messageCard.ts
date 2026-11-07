import type { getSupabase } from '@/lib/supabase'
import {
  checkPlaceholders, clientLinkLabel, defaultEmailBody, defaultEmailSubject, defaultSmsBody,
  type ClientLinkKind,
} from '@/lib/clientLinks'
import { PHOTOS_EMAIL_SUBJECT, PHOTOS_EMAIL_SUBJECT_INTRODUCED, photosEmailText, photosSmsText } from '@/lib/photoSets'
import { threadHasIntroduced } from './threadIntro'
import { TENANT } from '@/tenant'
import { checkSmsQuietHours } from '@/lib/quietHours'
import { phoneHasExplicitStop } from '@/lib/phoneStop'
import { linkSendApproves } from '@/lib/linkApproval'
import {
  displayWithLinks, firstNameOf, maskEmail, maskPhone, screenOutboundText, smsFacts,
  type Authored, type SmsFacts,
} from './outboundText'

/**
 * The card for a message the assistant proposes to send: what exactly will go
 * out, to whom, by which channel, and whether the server would refuse it right
 * now. Built from ONE function for both the model's proposal and a manager's
 * hand edit, so the card cannot show one thing while the send does another.
 *
 * The wording is BOUND into the signed proposal (`input.smsBody` …): the Confirm
 * click sends the text that was on screen, and a changed text is a new card with
 * a new token. `execute.ts` runs the same screens again before it sends.
 *
 * Reads only. Nothing here writes, mints a link or sends.
 */

type Supa = ReturnType<typeof getSupabase>

export interface CardBooking {
  id: string
  booking_ref: string
  status: string | null
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  child_name?: string | null
  event_type?: string | null
  party_type?: string | null
  party_date?: string | null
}

export interface PreviewChannel {
  channel: 'email' | 'sms'
  /** Masked address — a card shows who it goes to, not their number. */
  to: string
  subject?: string
  /** The text with `{link}` placeholders: what the edit boxes hold and what is signed. */
  template: string
  /** The same text as the recipient reads it, links shown as labelled markers. */
  display: string
  sms?: SmsFacts
  editable: boolean
  notes: string[]
}

export interface MessagePreview {
  recipient: string
  channels: PreviewChannel[]
  /** `blocked` = the dashboard route would refuse a channel right now. */
  level: 'ok' | 'warn' | 'blocked'
  status: string[]
}

export interface MessageEdits {
  smsBody?: string
  emailSubject?: string
  emailBody?: string
}

export type BuiltCard =
  | { ok: false; error: string }
  | { ok: true; input: Record<string, unknown>; title: string; details: string[]; preview: MessagePreview }

const LINK_PLACEHOLDERS = ['invite', 'rsvps', 'planner', 'invoice', 'portal'] as const

function linkLabels(kinds: readonly ClientLinkKind[], b: CardBooking): Record<string, string> {
  const labels: Record<string, string> = {}
  for (const k of kinds) labels[k] = clientLinkLabel(k, b)
  if (kinds.includes('invite')) labels.rsvps = 'Invitation page'
  return labels
}

/** Would the dashboard route refuse a text right now? The same two checks, read-only. */
async function textStatus(supabase: Supa, phone: string, now: Date): Promise<{ level: 'ok' | 'warn' | 'blocked'; lines: string[] }> {
  const lines: string[] = []
  let level: 'ok' | 'warn' | 'blocked' = 'ok'
  const quiet = checkSmsQuietHours(now)
  if (quiet.kind !== 'open') {
    level = 'blocked'
    lines.push('Texts only go out 8am–9pm Eastern. It is outside that now, so a text would be refused — confirm after 8am.')
    return { level, lines }
  }
  lines.push('Inside the 8am–9pm text window.')
  const stop = await phoneHasExplicitStop(supabase, phone)
  if (stop === 'stopped') {
    level = 'blocked'
    lines.push('This number has a STOP (opt-out) on file — a text would be refused.')
  } else if (stop === 'unavailable') {
    level = 'warn'
    lines.push('Could not check this number for a STOP right now. The send will check again and refuse if unsure.')
  } else {
    lines.push('No STOP on file for this number.')
  }
  return { level, lines }
}

function worst(a: 'ok' | 'warn' | 'blocked', b: 'ok' | 'warn' | 'blocked'): 'ok' | 'warn' | 'blocked' {
  const order = { ok: 0, warn: 1, blocked: 2 } as const
  return order[a] >= order[b] ? a : b
}

/* ── client links ─────────────────────────────────────────────────────── */

export async function buildClientLinksCard(
  supabase: Supa,
  b: CardBooking,
  opts: {
    kinds: readonly ClientLinkKind[]
    email: boolean
    sms: boolean
    edits?: MessageEdits
    /** Who wrote the fields in `edits`. */
    authored?: Authored
    now?: Date
    /** Skip the lookup: the thread has (true) or has not (false) already introduced us. */
    introduced?: boolean
  },
): Promise<BuiltCard> {
  const { kinds, email, sms } = opts
  // The intro and the sign-off are for the FIRST message in a thread only.
  const introduced = opts.introduced ?? (await threadHasIntroduced(supabase, b).catch(() => null)) === true
  const wording = { introduced }
  const edits = opts.edits ?? {}
  const authored: Authored = opts.authored ?? 'default'
  const allowed: readonly string[] = LINK_PLACEHOLDERS
  const notes: Record<string, string[]> = {}

  let smsBody = ''
  let emailSubject = ''
  let emailBody = ''
  if (sms) {
    const r = screenOutboundText(edits.smsBody ?? defaultSmsBody(b, kinds, wording), {
      channel: 'sms', authored: edits.smsBody !== undefined ? authored : 'default', allowedPlaceholders: allowed,
    })
    if (!r.ok) return { ok: false, error: `Text not changed: ${r.reason}` }
    const problems = checkPlaceholders(r.text, kinds, 'text')
    if (problems.length) return { ok: false, error: problems.join(' ') }
    smsBody = r.text
    notes.sms = r.notes
  }
  if (email) {
    const s = screenOutboundText(edits.emailSubject ?? defaultEmailSubject(b, kinds), {
      channel: 'subject', authored: edits.emailSubject !== undefined ? authored : 'default', allowedPlaceholders: [],
    })
    if (!s.ok) return { ok: false, error: `Email subject not changed: ${s.reason}` }
    const r = screenOutboundText(edits.emailBody ?? defaultEmailBody(b, kinds, wording), {
      channel: 'email', authored: edits.emailBody !== undefined ? authored : 'default', allowedPlaceholders: allowed,
    })
    if (!r.ok) return { ok: false, error: `Email not changed: ${r.reason}` }
    const problems = checkPlaceholders(r.text, kinds, 'email')
    if (problems.length) return { ok: false, error: problems.join(' ') }
    emailSubject = s.text
    emailBody = r.text
    notes.email = r.notes
  }

  const labels = linkLabels(kinds, b)
  const channels: PreviewChannel[] = []
  if (email) {
    channels.push({
      channel: 'email', to: maskEmail(b.contact_email), subject: emailSubject, template: emailBody,
      display: displayWithLinks(emailBody, labels), editable: true, notes: notes.email ?? [],
    })
  }
  if (sms) {
    channels.push({
      channel: 'sms', to: maskPhone(b.contact_phone), template: smsBody,
      display: displayWithLinks(smsBody, labels), sms: smsFacts(smsBody, b.booking_ref), editable: true, notes: notes.sms ?? [],
    })
  }

  const status: string[] = []
  let level: 'ok' | 'warn' | 'blocked' = 'ok'
  if (sms && b.contact_phone) {
    const t = await textStatus(supabase, b.contact_phone, opts.now ?? new Date())
    level = worst(level, t.level)
    status.push(...t.lines)
  }
  if (kinds.includes('invite')) {
    const { data, error } = await supabase.from('evites').select('slug, archived_at').eq('booking_id', b.id).maybeSingle()
    if (error) {
      level = worst(level, 'warn')
      status.push('Could not check the invitation. The send will check again.')
    } else if (!data) {
      level = worst(level, 'blocked')
      status.push('This party has no invitation yet, so the send would be refused — create it in the Invitation card first.')
    } else if ((data as { archived_at: string | null }).archived_at) {
      level = worst(level, 'blocked')
      status.push('The invitation is archived, so its link would not work and the send would be refused.')
    }
  }

  if (introduced && (sms || email)) {
    status.push(`${TENANT.people.customerSignoff} already introduced herself in this thread, so this message has no intro, sign-off or business name.`)
  }

  // Sending a booking link is the check-and-go-ahead: it approves a waiting party.
  if (linkSendApproves(b.status, kinds)) {
    status.push('Sending this approves the party (it is waiting for a date check). The client gets no separate confirmation email.')
  }

  const sms0 = channels.find(c => c.channel === 'sms')?.sms
  if (sms0 && sms0.segments > 2) {
    level = worst(level, 'warn')
    status.push(`The text is about ${sms0.segments} segments${sms0.cause ? ` (${sms0.cause} makes it longer)` : ''}. Ask me to shorten it if you like.`)
  }

  const labelList = kinds.map(k => clientLinkLabel(k, b))
  const via = [email && 'email', sms && 'text'].filter(Boolean).join(' + ')
  const input: Record<string, unknown> = {
    bookingId: b.id, bookingRef: b.booking_ref, links: [...kinds], email, sms,
    ...(email ? { emailSubject, emailBody } : {}),
    ...(sms ? { smsBody } : {}),
  }
  return {
    ok: true,
    input,
    title: `Send ${labelList.join(' + ')} to ${firstNameOf(b.contact_name) === 'there' ? b.booking_ref : firstNameOf(b.contact_name)}`,
    details: [
      `Party: ${b.booking_ref}${b.party_date ? ` on ${b.party_date}` : ''}`,
      `Links: ${labelList.join(', ')} — by ${via}`,
      authored === 'default' ? 'Standard wording.' : authored === 'model' ? 'Reworded by the assistant — read it below.' : 'Reworded by you — read it below.',
    ],
    preview: { recipient: firstNameOf(b.contact_name), channels, level, status },
  }
}

/* ── photos ───────────────────────────────────────────────────────────── */

export async function buildPhotosCard(
  supabase: Supa,
  b: CardBooking,
  opts: {
    photos: { id: string; url: string; alt: string }[]
    email: boolean
    sms: boolean
    edits?: MessageEdits
    authored?: Authored
    now?: Date
    introduced?: boolean
  },
): Promise<BuiltCard> {
  const { photos, email, sms } = opts
  const introduced = opts.introduced ?? (await threadHasIntroduced(supabase, b).catch(() => null)) === true
  const authored: Authored = opts.authored ?? 'default'
  const notes: string[] = []
  let smsBody = ''
  if (sms) {
    // `{photos}` is the link to the photo page; the default text is the same
    // function the route uses, given the placeholder where the URL goes.
    const r = screenOutboundText(opts.edits?.smsBody ?? photosSmsText(b.contact_name, '{photos}', photos.length, introduced), {
      channel: 'sms', authored: opts.edits?.smsBody !== undefined ? authored : 'default', allowedPlaceholders: ['photos'],
    })
    if (!r.ok) return { ok: false, error: `Text not changed: ${r.reason}` }
    if (!/\{photos\}/.test(r.text)) {
      return { ok: false, error: 'The text needs {photos} so the link to the photo page is in it.' }
    }
    smsBody = r.text
    notes.push(...r.notes)
  }

  const labels = { photos: 'Photo page' }
  const channels: PreviewChannel[] = []
  if (email) {
    const text = photosEmailText(b.contact_name, photos as never, '{photos}', introduced)
    channels.push({
      channel: 'email', to: maskEmail(b.contact_email), subject: introduced ? PHOTOS_EMAIL_SUBJECT_INTRODUCED : PHOTOS_EMAIL_SUBJECT, template: text,
      display: `${displayWithLinks(text, labels)}\n(The email shows the photos inline.)`, editable: false,
      notes: ['The email wording is fixed — only the text can be reworded.'],
    })
  }
  if (sms) {
    channels.push({
      channel: 'sms', to: maskPhone(b.contact_phone), template: smsBody, display: displayWithLinks(smsBody, labels),
      sms: smsFacts(smsBody, b.booking_ref), editable: true, notes,
    })
  }

  const status: string[] = []
  let level: 'ok' | 'warn' | 'blocked' = 'ok'
  if (sms && b.contact_phone) {
    const t = await textStatus(supabase, b.contact_phone, opts.now ?? new Date())
    level = worst(level, t.level)
    status.push(...t.lines)
  }
  const sms0 = channels.find(c => c.channel === 'sms')?.sms
  if (sms0 && sms0.segments > 2) {
    level = worst(level, 'warn')
    status.push(`The text is about ${sms0.segments} segments${sms0.cause ? ` (${sms0.cause} makes it longer)` : ''}.`)
  }

  if (introduced) {
    status.push(`${TENANT.people.customerSignoff} already introduced herself in this thread, so this message has no intro, sign-off or business name.`)
  }

  const via = [email && 'email', sms && 'text'].filter(Boolean).join(' + ')
  const input: Record<string, unknown> = {
    bookingId: b.id, bookingRef: b.booking_ref, photoIds: photos.map(p => p.id), email, sms, introduced,
    ...(sms ? { smsBody } : {}),
  }
  return {
    ok: true,
    input,
    title: `Send ${photos.length} photo${photos.length === 1 ? '' : 's'} to ${firstNameOf(b.contact_name) === 'there' ? b.booking_ref : firstNameOf(b.contact_name)}`,
    details: [
      `Party: ${b.booking_ref}${b.party_date ? ` on ${b.party_date}` : ''}`,
      `Photos: ${photos.length} — by ${via}. A text is a link, never a picture message.`,
      authored === 'default' ? 'Standard wording.' : authored === 'model' ? 'Reworded by the assistant — read it below.' : 'Reworded by you — read it below.',
    ],
    preview: { recipient: firstNameOf(b.contact_name), channels, level, status },
  }
}
