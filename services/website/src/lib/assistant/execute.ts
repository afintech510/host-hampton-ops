import { NextRequest } from 'next/server'
import { CANONICAL_ORIGIN } from '@/lib/publicOrigin'
import { defaultEmailBody, defaultEmailSubject, defaultSmsBody, type ClientLinkKind } from '@/lib/clientLinks'
import { getSupabase } from '@/lib/supabase'
import { POST as createPartyRoute } from '@/app/api/admin/parties/create/route'
import { POST as partyActionRoute } from '@/app/api/admin/parties/[id]/route'
import { POST as planPayLinkRoute } from '@/app/api/plan/[ref]/pay-link/route'
import type { Proposal } from './proposals'

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

function replayRequest(original: NextRequest, path: string, body: unknown): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' })
  for (const h of FORWARDED) {
    const v = original.headers.get(h)
    if (v) headers.set(h, v)
  }
  // The replay targets the canonical origin; the host header above is the
  // original request's, which is what publicOrigin() resolves links from.
  return new NextRequest(new URL(path, CANONICAL_ORIGIN), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

export interface ExecuteResult {
  ok: boolean
  /** Shown to the manager and appended to the conversation. */
  message: string
  /** Links the manager may want to open. Never a sign-in link. */
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
      }
      // The standard wording is built from the booking as it is NOW, at confirm
      // time, not as it was when the card was drawn.
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
          ? { emailSubject: defaultEmailSubject(b, input.links), emailBody: defaultEmailBody(b, input.links) }
          : {}),
        ...(input.sms ? { smsBody: defaultSmsBody(b, input.links) } : {}),
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
      return { ok: true, status: res.status, message: `Sent to ${input.bookingRef} by ${sentVia}.${failures}` }
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

    default:
      return { ok: false, status: 400, message: 'Unknown action.' }
  }
}
