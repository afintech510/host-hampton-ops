/**
 * The SignWell webhook pipeline, once.
 *
 * Rule 11, in the form the brief flagged from the directory listing alone:
 * there were THREE SignWell webhook routes, each with its own open-coded copy
 * of "parse the envelope, decide if it's a completion, find the row, write the
 * timestamp". None of the three verified anything, and the three copies had
 * drifted — only the check-in one filtered on metadata.type, only the check-in
 * one read the booking before writing, and only the consent one had a fallback
 * that could silently no-op.
 *
 * Now: one orchestrator (`handleSignwellWebhook`) does envelope handling,
 * verification and the authoritative re-read; the per-document-type WRITERS
 * below do nothing but write. A new document type is a new entry in
 * SIGNWELL_WRITERS, not a fourth route with a fourth idea of what "signed"
 * means.
 *
 * SignWell registers hooks per callback URL and keys each hook's HMAC with that
 * hook's own id, so ONE hook pointed at /api/webhooks/signwell is the correct
 * configuration — hence one SIGNWELL_WEBHOOK_ID rather than three.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { fetchSignedPdfUrl } from '@/lib/signwell'
import { cancelCheckinReminders } from '@/lib/checkinReminders'
import { CHECKIN_DOC_TYPE } from '@/lib/checkinLink'
import { markReleaseSigned } from '@/lib/marketing/consent'
import {
  verifySignwellEvent,
  parseSignwellEvent,
  claimsCompletion,
  confirmCompletedAtSignwell,
  type ParsedSignwellEvent,
  type CompletionCheck,
} from '@/lib/signwellWebhook'

export const STUDIO_DOC_TYPE = 'studio_rental'
export const CONSENT_DOC_TYPE = 'consent_release'

type Confirmed = Extract<CompletionCheck, { kind: 'completed' }>

export interface SignwellWriteResult {
  status: number
  body: Record<string, unknown>
}

export type SignwellWriter = (
  parsed: ParsedSignwellEvent & { documentId: string },
  truth: Confirmed
) => Promise<SignwellWriteResult>

/* ------------------------------------------------------------------ writers */

/** Studio rental agreement → bookings.agreement_signed_at / agreement_pdf_url. */
export const writeStudioRentalSigned: SignwellWriter = async (parsed, truth) => {
  const supabase = getSupabase()
  const pdfUrl = await fetchSignedPdfUrl(parsed.documentId)
  if (!pdfUrl) console.warn('signwell[studio]: no completed PDF URL for', parsed.documentId)

  const update = {
    agreement_signed_at: new Date().toISOString(),
    agreement_pdf_url: pdfUrl,
  }

  // Two sequential `.eq()` rather than one `.or(...)`: an `.or()` filter is a
  // RAW PostgREST expression, so interpolating the body-supplied document id
  // would let a `,` or `)` rewrite the filter. Same family as the `.ilike('%')`
  // authorization hole link 14 found in the portal (rule 16).
  const { data: byDoc, error } = await supabase
    .from('bookings')
    .update(update)
    .eq('signwell_document_id', parsed.documentId)
    .select('booking_ref')
  if (error) {
    console.error('signwell[studio] update error:', error.message)
    return { status: 500, body: { error: 'update failed' } }
  }

  let rows = byDoc
  // Fall back to the booking_ref SIGNWELL reports — never the body's — which
  // covers the race where the document id had not been persisted yet.
  if ((rows?.length ?? 0) === 0 && truth.bookingRef) {
    const { data: byRef, error: refErr } = await supabase
      .from('bookings')
      .update(update)
      .eq('booking_ref', truth.bookingRef)
      .select('booking_ref')
    if (refErr) {
      console.error('signwell[studio] booking_ref fallback error:', refErr.message)
      return { status: 500, body: { error: 'update failed' } }
    }
    rows = byRef
  }

  const matched = rows?.length ?? 0
  if (matched === 0) {
    // Rule 14: a signature we cannot attribute is a liability we do not know we
    // hold. Six live June-2026 documents are in exactly this state.
    console.error(
      'signwell[studio]: SIGNED DOCUMENT WITH NO MATCHING BOOKING — document',
      parsed.documentId, 'booking_ref', truth.bookingRef ?? '(none)'
    )
    return { status: 200, body: { received: true, matched: 0, warning: 'no matching booking' } }
  }

  console.log('signwell[studio]: agreement signed for', rows!.map(r => r.booking_ref).join(','),
    '| pdf:', pdfUrl ? 'captured' : 'MISSING')
  return { status: 200, body: { received: true, matched } }
}

/** Check-in waiver → bookings.checkin_agreement_signed_at, completes check-in. */
export const writeCheckinSigned: SignwellWriter = async (parsed, truth) => {
  const supabase = getSupabase()
  const pdfUrl = await fetchSignedPdfUrl(parsed.documentId)
  if (!pdfUrl) console.warn('signwell[checkin]: no completed PDF URL for', parsed.documentId)

  // Rule 12: the lookup error is READ. A Supabase blip used to arrive here as
  // "no matching booking", which answered 200 and so told SignWell never to
  // redeliver — silently losing a real signature.
  const { data: booking, error: lookupErr } = await supabase
    .from('bookings')
    .select('id, booking_ref, checkin_status')
    .eq('checkin_signwell_document_id', parsed.documentId)
    .maybeSingle()

  if (lookupErr) {
    console.error('signwell[checkin]: booking lookup FAILED —', lookupErr.message)
    return { status: 503, body: { error: 'lookup failed, retry' } }
  }
  if (!booking) {
    console.error(
      'signwell[checkin]: SIGNED DOCUMENT WITH NO MATCHING BOOKING —',
      parsed.documentId, truth.bookingRef ?? '(no ref)'
    )
    return { status: 200, body: { received: true, matched: 0, warning: 'no matching booking' } }
  }

  const now = new Date().toISOString()
  const update: Record<string, unknown> = {
    checkin_agreement_signed_at: now,
    checkin_agreement_pdf_url: pdfUrl,
    updated_at: now,
  }

  // Signing is the last step, so this completes the check-in. Guard on
  // 'started' so a signature landing before the details form doesn't mark the
  // booking complete with no contact details captured.
  const completes = booking.checkin_status === 'started'
  if (completes) {
    update.checkin_status = 'complete'
    update.checkin_completed_at = now
  }

  const { data: updated, error } = await supabase
    .from('bookings')
    .update(update)
    .eq('id', booking.id)
    .select('id')
  if (error) {
    console.error('signwell[checkin] update error:', error.message)
    return { status: 500, body: { error: 'update failed' } }
  }
  if ((updated?.length ?? 0) === 0) {
    console.error('signwell[checkin]: update matched 0 rows for', booking.booking_ref)
    return { status: 500, body: { error: 'update matched nothing' } }
  }

  // Stop the 36hr / 6am texts — nobody should be nagged about something they
  // have already finished.
  if (completes) await cancelCheckinReminders(booking.booking_ref)

  console.log('signwell[checkin]: waiver signed for', booking.booking_ref,
    completes ? '(check-in complete)' : '', '| pdf:', pdfUrl ? 'captured' : 'MISSING')
  return { status: 200, body: { received: true, completed: completes } }
}

/** Consent release → consent_releases.status = 'signed' (opens the media gate). */
export const writeConsentSigned: SignwellWriter = async (parsed, truth) => {
  const supabase = getSupabase()

  const result = await markReleaseSigned(supabase, parsed.documentId, { actor: 'signwell_webhook' })
  if (result.kind === 'unavailable') {
    console.error('signwell[consent]: release update unavailable —', result.error)
    return { status: 503, body: { error: 'lookup failed, retry' } }
  }

  // Fall back to the release_id SIGNWELL reports, never the body's.
  if (result.kind === 'not-found' && truth.releaseId) {
    const { data: release, error: relErr } = await supabase
      .from('consent_releases')
      .select('signwell_document_id')
      .eq('id', truth.releaseId)
      .maybeSingle()
    if (relErr) {
      console.error('signwell[consent]: release_id lookup FAILED —', relErr.message)
      return { status: 503, body: { error: 'lookup failed, retry' } }
    }
    if (release?.signwell_document_id) {
      const second = await markReleaseSigned(supabase, release.signwell_document_id, {
        actor: 'signwell_webhook',
      })
      if (second.kind === 'unavailable') {
        console.error('signwell[consent]: release update unavailable —', second.error)
        return { status: 503, body: { error: 'update failed, retry' } }
      }
      return { status: 200, body: { received: true, signed: second.kind === 'signed' } }
    }
  }

  if (result.kind === 'not-found') {
    console.error(
      'signwell[consent]: SIGNED CONSENT RELEASE WITH NO MATCHING ROW —',
      parsed.documentId, truth.releaseId ?? '(no release id)'
    )
    return { status: 200, body: { received: true, signed: false, warning: 'no matching release' } }
  }

  return { status: 200, body: { received: true, signed: result.kind === 'signed' } }
}

export const SIGNWELL_WRITERS: Record<string, SignwellWriter> = {
  [STUDIO_DOC_TYPE]: writeStudioRentalSigned,
  [CHECKIN_DOC_TYPE]: writeCheckinSigned,
  [CONSENT_DOC_TYPE]: writeConsentSigned,
}

/* ------------------------------------------------------------- orchestrator */

export interface SignwellRouteOptions {
  /** Document types this endpoint will act on. '*' accepts every known type. */
  accept: string[] | '*'
  /**
   * Type to assume when the document carries no metadata.type. The June 2026
   * studio documents predate the convention. Only honoured if it is in `accept`.
   */
  defaultType?: string
  /** Short label for log lines. */
  label: string
}

/**
 * Envelope → verified → confirmed at SignWell → dispatched to a writer.
 *
 * The order matters and is the whole point:
 *   1. verify event.hash against SIGNWELL_WEBHOOK_ID — FAILS CLOSED, including
 *      when unconfigured. An unverified event marks a legal document signed.
 *   2. re-read the document from SignWell's own API. SignWell signs only
 *      "type@time", so the hash cannot vouch for the body; the authoritative
 *      status and metadata come from the API call, not the POST.
 *   3. only then write, via exactly one writer chosen by the AUTHORITATIVE type.
 */
export async function handleSignwellWebhook(
  req: NextRequest,
  opts: SignwellRouteOptions
): Promise<NextResponse> {
  try {
    const raw = await req.text()
    let payload: unknown
    try {
      payload = JSON.parse(raw)
    } catch {
      return NextResponse.json({ error: 'invalid json' }, { status: 400 })
    }

    const verdict = verifySignwellEvent(payload)
    if (!verdict.ok) {
      console.warn(`signwell[${opts.label}]: REFUSED unverified event —`, verdict.reason)
      return NextResponse.json(
        { error: 'signature verification failed', reason: verdict.reason },
        { status: verdict.reason === 'unconfigured' ? 503 : 401 }
      )
    }

    const parsed = parseSignwellEvent(payload)

    if (!claimsCompletion(parsed)) {
      return NextResponse.json({ received: true, ignored: parsed.eventType || 'non-completion' })
    }
    if (!parsed.documentId) {
      // Without a document id we cannot ask SignWell what actually happened,
      // and a body-supplied booking_ref alone is not evidence of anything.
      console.warn(`signwell[${opts.label}]: completion event with no document id — refusing`)
      return NextResponse.json({ received: true, ignored: 'no document id' })
    }

    const truth = await confirmCompletedAtSignwell(parsed.documentId)
    if (truth.kind === 'unavailable') {
      // Rule 3 / rule 12: could-not-decide is not decided-no. 5xx so SignWell
      // redelivers rather than us silently dropping a real signature.
      console.error(`signwell[${opts.label}]: could not confirm with SignWell —`, truth.error)
      return NextResponse.json({ error: 'upstream unavailable, retry' }, { status: 503 })
    }
    if (truth.kind === 'not-completed') {
      console.warn(
        `signwell[${opts.label}]: event claimed completion but SignWell says`,
        truth.status, 'for', parsed.documentId
      )
      return NextResponse.json({ received: true, ignored: 'not completed at SignWell' })
    }

    // The type is taken from SignWell's response, not the POST body, so a
    // forged envelope cannot steer a document into the wrong writer.
    const authoritativeType =
      typeof truth.metadata.type === 'string' && truth.metadata.type
        ? truth.metadata.type
        : opts.defaultType

    if (!authoritativeType) {
      console.warn(`signwell[${opts.label}]: document`, parsed.documentId, 'has no metadata.type`')
      return NextResponse.json({ received: true, ignored: 'no document type' })
    }
    if (opts.accept !== '*' && !opts.accept.includes(authoritativeType)) {
      return NextResponse.json({ received: true, ignored: 'other document type' })
    }

    const writer = SIGNWELL_WRITERS[authoritativeType]
    if (!writer) {
      // Rule 14: a completed document we have no handler for is not a no-op,
      // it is a signature nobody will ever look at. Say so where a human reads.
      console.error(
        `signwell[${opts.label}]: COMPLETED DOCUMENT WITH NO HANDLER — type`,
        authoritativeType, 'document', parsed.documentId
      )
      return NextResponse.json({ received: true, ignored: 'unhandled document type' })
    }

    const out = await writer({ ...parsed, documentId: parsed.documentId }, truth)
    return NextResponse.json(out.body, { status: out.status })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'signwell webhook failed'
    console.error(`signwell[${opts.label}] error:`, msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
