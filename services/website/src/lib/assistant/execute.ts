import { NextRequest } from 'next/server'
import { CANONICAL_ORIGIN } from '@/lib/publicOrigin'
import { defaultEmailBody, defaultEmailSubject, defaultSmsBody, type ClientLinkKind } from '@/lib/clientLinks'
import { getSupabase } from '@/lib/supabase'
import { POST as createPartyRoute } from '@/app/api/admin/parties/create/route'
import { POST as partyActionRoute, PATCH as partyPatchRoute } from '@/app/api/admin/parties/[id]/route'
import { POST as planPayLinkRoute } from '@/app/api/plan/[ref]/pay-link/route'
import { POST as enrolSequenceRoute } from '@/app/api/admin/sequences/enroll/route'
import type { Proposal } from './proposals'
import { screenOutboundText } from './outboundText'

/**
 * Carry out a CONFIRMED proposal by replaying the admin API call the dashboard
 * itself makes, on the confirming admin's own credentials.
 *
 * Why replay rather than call lib functions directly: the create, send and
 * pay-link logic lives inside those route handlers, together with the guards
 * that make it safe (quiet hours, STOP lists, cancelled-booking refusals,
 * placeholder checks, the pay-link caps, the audit actor). Re-implementing any
 * of that here would be a second copy of a money or messaging path — the shape
 * this codebase has paid for repeatedly. Replaying means the assistant can only
 * ever do what the Parties tab can do, exactly as the Parties tab does it.
 *
 * The forwarded headers are the confirming request's own `cookie` /
 * `authorization` and its same-site signals, so `isAdminAuthorized` and
 * `adminActorId` see the same human who pressed Confirm.
 */

const FORWARDED = ['cookie', 'authorization', 'sec-fetch-site', 'origin', 'host', 'cf-connecting-ip', 'x-forwarded-for', 'x-real-ip', 'user-agent']

function replayRequest(original: NextRequest, path: string, body: unknown, method: 'POST' | 'PATCH' = 'POST'): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' })
  for (const h of FORWARDED) {
    const v = original.headers.get(h)
    if (v) headers.set(h, v)
  }
  // The replay targets the canonical origin; the host header above is the
  // original request's, which is what publicOrigin() resolves links from.
  return new NextRequest(new URL(path, CANONICAL_ORIGIN), {
    method,
    headers,
    body: JSON.stringify(body),
  })
}

export interface ExecuteResult {
  ok: boolean
  /** Shown to the manager and appended to the conversation. */
  message: string
  /**
   * Links the manager may want to open. Never a sign-in link — except the one the
   * manager explicitly asked a `party_link` card for. The confirm route returns it
   * to that browser and does not write it into the saved conversation.
   */
  links?: { label: string; url: string }[]
  /** HTTP-ish status from the replayed route, for logging. */
  status: number
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>
  } catch {
    return {}
  }
}

export async function executeProposal(original: NextRequest, proposal: Proposal): Promise<ExecuteResult> {
  switch (proposal.kind) {
    case 'create_party': {
      const res = await createPartyRoute(replayRequest(original, '/api/admin/parties/create', proposal.input))
      const json = await readJson(res)
      if (!res.ok || json.ok !== true) {
        return { ok: false, status: res.status, message: `Not created: ${String(json.error ?? `HTTP ${res.status}`)}` }
      }
      return {
        ok: true,
        status: res.status,
        message: `Created ${String(json.bookingRef)}.`,
        links: [
          ...(typeof json.adminUrl === 'string' ? [{ label: 'Open in admin', url: json.adminUrl }] : []),
          ...(typeof json.builderUrl === 'string' ? [{ label: 'Open the planner', url: json.builderUrl }] : []),
        ],
      }
    }

    case 'send_client_links': {
      const input = proposal.input as {
        bookingId: string
        bookingRef: string
        links: ClientLinkKind[]
        email: boolean
        sms: boolean
        emailSubject?: string
        emailBody?: string
        smsBody?: string
      }
      // A card drawn with its wording BOUND (every card since the preview
      // landed) sends exactly that wording, after the screens run again at this
      // last gate. A card minted before that carries none, and falls through to
      // the standard wording built from the booking as it is NOW.
      const bound = boundWording(input, ['sms', 'emailSubject', 'emailBody'], input.links.map(String))
      if (!bound.ok) return { ok: false, status: 422, message: `Not sent: ${bound.reason}` }
      const { data: b, error } = await getSupabase()
        .from('bookings')
        .select('contact_name, child_name, event_type, party_type, booking_ref')
        .eq('id', input.bookingId)
        .maybeSingle()
      if (error) return { ok: false, status: 503, message: 'Could not read the booking — nothing was sent. Try again.' }
      if (!b) return { ok: false, status: 404, message: 'That booking no longer exists — nothing was sent.' }

      const body = {
        action: 'send_client_links',
        confirm: true,
        links: input.links,
        email: input.email,
        sms: input.sms,
        ...(input.email
          ? {
              emailSubject: bound.text.emailSubject ?? defaultEmailSubject(b, input.links),
              emailBody: bound.text.emailBody ?? defaultEmailBody(b, input.links),
            }
          : {}),
        ...(input.sms ? { smsBody: bound.text.sms ?? defaultSmsBody(b, input.links) } : {}),
      }
      const res = await partyActionRoute(
        replayRequest(original, `/api/admin/parties/${encodeURIComponent(input.bookingId)}`, body),
        { params: Promise.resolve({ id: input.bookingId }) },
      )
      const json = await readJson(res)
      if (!res.ok || json.ok === false) {
        return { ok: false, status: res.status, message: `Not sent: ${String(json.error ?? `HTTP ${res.status}`)}` }
      }
      const sentVia = Array.isArray(json.sentVia) ? (json.sentVia as string[]).join(' and ') : 'the chosen channel'
      const failures = Array.isArray(json.failures) && json.failures.length ? ` Problems: ${(json.failures as string[]).join(' ')}` : ''
      const approved = json.approved === true ? ' The party is now Approved.' : ''
      const approvalFailed = json.approvalFailed === true ? ' The send went out but the party could NOT be marked Approved - approve it in the Parties tab.' : ''
      return { ok: true, status: res.status, message: `Sent to ${input.bookingRef} by ${sentVia}.${approved}${approvalFailed}${failures}` }
    }

    case 'create_pay_link': {
      const input = proposal.input as { bookingRef: string; purpose: 'deposit' | 'balance' }
      const res = await planPayLinkRoute(
        replayRequest(original, `/api/plan/${encodeURIComponent(input.bookingRef)}/pay-link`, { purpose: input.purpose }),
        { params: Promise.resolve({ ref: input.bookingRef }) },
      )
      const json = await readJson(res)
      if (!res.ok || json.ok !== true || typeof json.payUrl !== 'string') {
        return { ok: false, status: res.status, message: `No link made: ${String(json.error ?? `HTTP ${res.status}`)}` }
      }
      const charge = Number(json.chargeCents)
      return {
        ok: true,
        status: res.status,
        message: `Payment link ready for ${input.bookingRef}${Number.isFinite(charge) ? ` — charges $${(charge / 100).toFixed(2)}` : ''}. Not sent to the client.`,
        links: [{ label: 'Payment link', url: json.payUrl }],
      }
    }

    case 'update_party': {
      const input = proposal.input as { bookingId: string; bookingRef: string; updates: Record<string, unknown> }
      // The dashboard's own PATCH: it logs the change, moves the calendar event
      // and the check-in reminders, and re-prices per-guest lines on a new
      // guest count. The updates were screened to a closed field list when the
      // card was drawn (status and money are not on it).
      const res = await partyPatchRoute(
        replayRequest(original, `/api/admin/parties/${encodeURIComponent(input.bookingId)}`, onlyAllowedUpdates(input.updates), 'PATCH'),
        { params: Promise.resolve({ id: input.bookingId }) },
      )
      const json = await readJson(res)
      if (!res.ok || json.ok !== true) return refused('Not updated', res, json)
      return {
        ok: true,
        status: res.status,
        message: `Updated ${input.bookingRef}.${typeof json.warning === 'string' ? ` ${json.warning}` : ''}${totalsNote(json)}`,
      }
    }

    case 'add_line_item': {
      const input = proposal.input as {
        bookingId: string
        bookingRef: string
        name: string
        category: string
        quantity: number
        unit_price_cents: number
        guest_multiplied: boolean
      }
      const { res, json } = await replayPartyAction(original, input.bookingId, {
        action: 'add_line_item',
        name: input.name,
        category: input.category,
        quantity: input.quantity,
        unit_price_cents: input.unit_price_cents,
        guest_multiplied: input.guest_multiplied,
      })
      if (!res.ok || json.ok !== true) return refused('Not added', res, json)
      return { ok: true, status: res.status, message: `Added ${input.name} to ${input.bookingRef}.${warningNote(json)}${totalsNote(json)}` }
    }

    case 'remove_line_item': {
      const input = proposal.input as { bookingId: string; bookingRef: string; lineItemId: string }
      const { res, json } = await replayPartyAction(original, input.bookingId, {
        action: 'remove_line_item',
        line_item_id: input.lineItemId,
      })
      if (!res.ok || json.ok !== true) return refused('Not removed', res, json)
      return { ok: true, status: res.status, message: `Removed the line from ${input.bookingRef}.${warningNote(json)}${totalsNote(json)}` }
    }

    case 'record_payment': {
      const input = proposal.input as {
        bookingId: string
        bookingRef: string
        amount_cents: number
        payment_method: string
        payment_type: string
        notes?: string
        send_receipt: boolean
      }
      // `send_receipt` is carried as the card showed it (false unless the
      // manager asked for a receipt). `force_ledger` is never sent: the books'
      // own "already covered by a card payment" decline stands.
      const { res, json } = await replayPartyAction(original, input.bookingId, {
        action: 'record_payment',
        amount_cents: input.amount_cents,
        payment_method: input.payment_method,
        payment_type: input.payment_type,
        notes: input.notes,
        send_receipt: input.send_receipt === true,
      })
      if (!res.ok || json.ok !== true) return refused('Not recorded', res, json)
      return {
        ok: true,
        status: res.status,
        message: typeof json.message === 'string' ? `${input.bookingRef}: ${json.message}` : `Payment recorded on ${input.bookingRef}.`,
      }
    }

    case 'cancel_party': {
      const input = proposal.input as { bookingId: string; bookingRef: string }
      const { res, json } = await replayPartyAction(original, input.bookingId, { action: 'cancel' })
      if (!res.ok || json.ok !== true) return refused('Not cancelled', res, json)
      return { ok: true, status: res.status, message: `Cancelled ${input.bookingRef}. Nothing was refunded or sent to the client.` }
    }

    case 'mark_lost': {
      const input = proposal.input as { bookingId: string; bookingRef: string }
      const { res, json } = await replayPartyAction(original, input.bookingId, { action: 'mark_lost' })
      if (!res.ok || json.ok !== true) return refused('Not changed', res, json)
      return { ok: true, status: res.status, message: `Marked ${input.bookingRef} as lost. Nothing was sent to the client.` }
    }

    case 'send_photos': {
      const input = proposal.input as { bookingId: string; bookingRef: string; photoIds: string[]; email: boolean; sms: boolean; smsBody?: string }
      const bound = boundWording(input, ['sms'], ['photos'])
      if (!bound.ok) return { ok: false, status: 422, message: `Not sent: ${bound.reason}` }
      // The exact ids the manager saw on the card. The route re-resolves them
      // through findPhotos and refuses if any is no longer approved.
      const { res, json } = await replayPartyAction(original, input.bookingId, {
        action: 'send_photos',
        confirm: true,
        photoIds: input.photoIds,
        email: input.email,
        sms: input.sms,
        ...(input.sms && bound.text.sms ? { smsBody: bound.text.sms } : {}),
      })
      if (!res.ok || json.ok !== true) return refused('Not sent', res, json)
      const sentVia = Array.isArray(json.sentVia) ? (json.sentVia as string[]).join(' and ') : 'the chosen channel'
      const failures = Array.isArray(json.failures) && json.failures.length ? ` Problems: ${(json.failures as string[]).join(' ')}` : ''
      return { ok: true, status: res.status, message: `Sent ${String(json.count ?? input.photoIds.length)} photo(s) to ${input.bookingRef} by ${sentVia}.${failures}` }
    }

    case 'approve_party': {
      const input = proposal.input as { bookingId: string; bookingRef: string; sendEmail?: boolean }
      // The dashboard's own Approve action. It refuses a cancelled or lost party
      // itself, writes the status before it emails, and logs a deliberate no-email
      // approval. `send_email: false` is sent ONLY when the card said so.
      const { res, json } = await replayPartyAction(original, input.bookingId, {
        action: 'approve',
        ...(input.sendEmail === false ? { send_email: false } : {}),
      })
      if (!res.ok || json.ok !== true) return refused('Not approved', res, json)
      const how =
        json.emailSkippedByAdmin === true
          ? 'The client was not emailed (as you asked).'
          : json.emailed === false
            ? 'But the confirmation email did NOT go out - check the email address and tell the client yourself.'
            : 'The client was emailed the confirmation.'
      return { ok: true, status: res.status, message: `Approved ${input.bookingRef}. ${how}` }
    }

    case 'reopen_party': {
      const input = proposal.input as { bookingId: string; bookingRef: string }
      const { res, json } = await replayPartyAction(original, input.bookingId, { action: 'reopen' })
      if (!res.ok || json.ok !== true) return refused('Not reopened', res, json)
      return { ok: true, status: res.status, message: `Reopened ${input.bookingRef} as ${String(json.status ?? 'open')}. Nothing was sent to the client.` }
    }

    case 'party_link': {
      const input = proposal.input as { bookingId: string; bookingRef: string; destination: 'invoice' | 'planner' | 'portal' }
      // The dashboard's own "Copy Invoice Link" / "Copy Portal Link": mint only,
      // deliver nothing. `portal` is the route's default destination.
      const { res, json } = await replayPartyAction(original, input.bookingId, {
        action: 'generate_portal_url',
        ...(input.destination === 'portal' ? {} : { destination: input.destination }),
      })
      if (!res.ok || json.ok !== true || typeof json.portalUrl !== 'string') return refused('No link made', res, json)
      const label = { invoice: 'Invoice', planner: 'Party planner', portal: 'Booking portal' }[input.destination]
      return {
        ok: true,
        status: res.status,
        message: `${label} link ready for ${input.bookingRef}. Not sent to the client.`,
        links: [{ label: `${label} link`, url: json.portalUrl }],
      }
    }

    case 'enrol_sequence': {
      const input = proposal.input as { bookingId: string; bookingRef: string; sequenceId: string; sequenceName?: string }
      // The route re-checks stage, consent, the sequence and duplicates itself,
      // and writes ONE enrollment row. It sends nothing.
      const res = await enrolSequenceRoute(
        replayRequest(original, '/api/admin/sequences/enroll', { bookingId: input.bookingId, sequenceId: input.sequenceId }),
      )
      const json = await readJson(res)
      if (!res.ok || json.ok !== true) return refused('Not enrolled', res, json)
      return {
        ok: true,
        status: res.status,
        message: `Enrolled ${input.bookingRef} in "${String(json.sequence ?? input.sequenceName ?? 'the sequence')}". Nothing was sent.`,
      }
    }

    default:
      return { ok: false, status: 400, message: 'Unknown action.' }
  }
}

/**
 * The bound wording of a message card, screened AGAIN at the last gate.
 *
 * Between the moment the card was drawn and the click, nothing may have
 * changed what is about to go to a customer — but the card's token is the only
 * thing proving that, so the same screens the card used run on the exact bytes
 * about to be sent (money redirects, links that are not ours, the owner's name,
 * a placeholder that is not ours, a text with no STOP line). A refusal here is a
 * 4xx, so the claim is released and nothing was sent.
 *
 * The screen is run as `default`-authored so it does not rewrite anything: if it
 * would change a byte, the bound text was not the screened text, and that is a
 * refusal rather than a quiet substitution.
 */
function boundWording(
  input: { smsBody?: string; emailSubject?: string; emailBody?: string },
  fields: ('sms' | 'emailSubject' | 'emailBody')[],
  linkKinds: string[],
): { ok: true; text: { sms?: string; emailSubject?: string; emailBody?: string } } | { ok: false; reason: string } {
  const allowed = linkKinds.includes('photos') ? ['photos'] : ['invite', 'rsvps', 'planner', 'invoice', 'portal']
  const out: { sms?: string; emailSubject?: string; emailBody?: string } = {}
  const spec: Array<['sms' | 'emailSubject' | 'emailBody', string | undefined, 'sms' | 'email' | 'subject']> = [
    ['sms', input.smsBody, 'sms'],
    ['emailSubject', input.emailSubject, 'subject'],
    ['emailBody', input.emailBody, 'email'],
  ]
  for (const [field, value, channel] of spec) {
    if (!fields.includes(field) || value === undefined) continue
    const r = screenOutboundText(value, { channel, authored: 'default', allowedPlaceholders: allowed })
    if (!r.ok) return { ok: false, reason: r.reason }
    if (r.text !== value) return { ok: false, reason: 'The wording on the card changed after it was drawn — ask for a fresh card.' }
    out[field] = r.text
  }
  return { ok: true, text: out }
}

/** POST an action to the dashboard's party route, on the confirming admin's credentials. */
async function replayPartyAction(original: NextRequest, bookingId: string, body: Record<string, unknown>) {
  const res = await partyActionRoute(
    replayRequest(original, `/api/admin/parties/${encodeURIComponent(bookingId)}`, body),
    { params: Promise.resolve({ id: bookingId }) },
  )
  return { res, json: await readJson(res) }
}

/**
 * The columns a chat-proposed edit may ever touch. The card was already built
 * from this list; filtering again here means a status or a total can never ride
 * through on `update_party` even if a future proposal builder forgets.
 */
export const CHAT_EDITABLE_COLUMNS = [
  'party_date', 'party_time', 'guest_count_approx', 'child_name', 'child_age', 'package_type',
  'contact_name', 'contact_email', 'contact_phone', 'party_type', 'admin_notes',
] as const

function onlyAllowedUpdates(updates: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of CHAT_EDITABLE_COLUMNS) if (updates && updates[k] !== undefined) out[k] = updates[k]
  return out
}

function refused(prefix: string, res: Response, json: Record<string, unknown>): ExecuteResult {
  return { ok: false, status: res.status, message: `${prefix}: ${String(json.error ?? `HTTP ${res.status}`)}` }
}

const dollars = (cents: unknown) => `$${((Number(cents) || 0) / 100).toFixed(2)}`
const warningNote = (json: Record<string, unknown>) => (typeof json.warning === 'string' ? ` ${json.warning}` : '')
const totalsNote = (json: Record<string, unknown>) =>
  json.totalCents !== undefined && Number.isFinite(Number(json.totalCents)) ? ` Invoice total is now ${dollars(json.totalCents)}.` : ''
