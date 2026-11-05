import { NextRequest, NextResponse } from 'next/server'
import { adminActorId, isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { featureEnabled } from '@/tenant'
import { getSupabase } from '@/lib/supabase'
import { findPhotos, MAX_PHOTOS_PER_REQUEST } from '@/lib/media'
import { screenLinkKinds } from '@/lib/clientLinks'
import { mintProposal, verifyProposal } from '@/lib/assistant/proposals'
import { supersedeProposal } from '@/lib/assistant/usedProposals'
import { buildClientLinksCard, buildPhotosCard, type BuiltCard, type CardBooking, type MessageEdits } from '@/lib/assistant/messageCard'
import { contextKey, screenContext } from '@/lib/assistant/context'
import { readThread, writeThread } from '@/lib/assistant/threads'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/assistant/revise — the manager edited a message card by hand.
 *
 * Body: `{ token, smsBody?, emailSubject?, emailBody?, context? }`. The token is
 * the card being edited (verified for THIS admin, like a confirm). The new
 * wording goes through exactly the screens the model's rewording goes through
 * (lib/assistant/outboundText.ts), and what comes back is a NEW card with a NEW
 * signed token that binds the new wording: the old card is spent first-class
 * (same single-use table) so only one version of the message can ever be sent.
 *
 * Nothing is sent here. A refused edit returns the reason and leaves the
 * original card exactly as it was.
 */
const COLUMNS = 'id, booking_ref, status, contact_name, contact_email, contact_phone, child_name, event_type, party_type, party_date'

export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  if (!featureEnabled('managerAssistant')) {
    return NextResponse.json({ error: 'The Manager assistant is not enabled on this site.' }, { status: 404 })
  }

  const body = (await req.json().catch(() => null)) as {
    token?: unknown; smsBody?: unknown; emailSubject?: unknown; emailBody?: unknown; context?: unknown
  } | null
  const actor = adminActorId(req)
  const verified = verifyProposal(body?.token, actor)
  if (!verified.ok) {
    return NextResponse.json({ ok: false, error: 'That card is not valid any more — ask the assistant again.' }, { status: 400 })
  }
  const old = verified.proposal
  if (old.kind !== 'send_client_links' && old.kind !== 'send_photos') {
    return NextResponse.json({ ok: false, error: 'Only a message can be reworded.' }, { status: 400 })
  }

  const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
  const given: MessageEdits = { smsBody: str(body?.smsBody), emailSubject: str(body?.emailSubject), emailBody: str(body?.emailBody) }
  if (given.smsBody === undefined && given.emailSubject === undefined && given.emailBody === undefined) {
    return NextResponse.json({ ok: false, error: 'Nothing to change.' }, { status: 400 })
  }

  const supabase = getSupabase()
  const input = old.input as {
    bookingId: string; links?: string[]; photoIds?: string[]; email: boolean; sms: boolean
    smsBody?: string; emailSubject?: string; emailBody?: string
  }
  const { data, error } = await supabase.from('bookings').select(COLUMNS).eq('id', input.bookingId).maybeSingle()
  if (error) return NextResponse.json({ ok: false, error: 'Could not read the booking — try again.' }, { status: 503 })
  const b = data as unknown as CardBooking | null
  if (!b) return NextResponse.json({ ok: false, error: 'That booking no longer exists.' }, { status: 404 })
  if (b.status === 'cancelled' || b.status === 'lost') {
    return NextResponse.json({ ok: false, error: `This booking is ${b.status} — nothing can be sent.` }, { status: 409 })
  }

  // The fields not touched keep what the card already said.
  const edits: MessageEdits = {
    smsBody: given.smsBody ?? input.smsBody,
    emailSubject: given.emailSubject ?? input.emailSubject,
    emailBody: given.emailBody ?? input.emailBody,
  }

  let built: BuiltCard
  let photos: { id: string; url: string; alt: string }[] | undefined
  if (old.kind === 'send_client_links') {
    built = await buildClientLinksCard(supabase, b, {
      kinds: screenLinkKinds(input.links), email: input.email, sms: input.sms, edits, authored: 'manual',
    })
  } else {
    const found = await findPhotos(supabase, { ids: input.photoIds ?? [], limit: MAX_PHOTOS_PER_REQUEST })
    if (found.kind !== 'ok') return NextResponse.json({ ok: false, error: 'Could not read the photo library — try again.' }, { status: 503 })
    photos = found.data.map(p => ({ id: p.id, url: p.url, alt: p.alt }))
    if (photos.length === 0) return NextResponse.json({ ok: false, error: 'Those photos are no longer approved to send.' }, { status: 409 })
    built = await buildPhotosCard(supabase, b, { photos, email: input.email, sms: input.sms, edits: { smsBody: edits.smsBody }, authored: 'manual' })
  }
  // A refused edit leaves the original card untouched and still confirmable.
  if (!built.ok) return NextResponse.json({ ok: false, error: built.error }, { status: 422 })

  const retired = await supersedeProposal(supabase, old.id, actor)
  if (retired === 'already_used') {
    return NextResponse.json({ ok: false, error: 'That card was already sent or replaced — ask for a fresh one.' }, { status: 409 })
  }
  if (retired === 'unavailable') {
    return NextResponse.json({ ok: false, error: 'Could not retire the old card, so nothing was changed. Try again.' }, { status: 503 })
  }

  const minted = mintProposal({
    kind: old.kind, input: built.input, title: built.title, details: built.details, actor, ...(photos ? { photos } : {}),
  })
  const card = {
    id: minted.proposal.id,
    title: minted.proposal.title,
    details: minted.proposal.details,
    token: minted.token,
    kind: minted.proposal.kind,
    expiresAt: minted.proposal.expiresAt,
    ...(photos ? { photos } : {}),
    message: built.preview,
    state: 'pending' as const,
  }

  // Swap the card in place in the saved thread, and tell the model what the
  // manager wrote so a later "make it shorter" starts from the current text.
  const ctx = screenContext(body?.context)
  const key = contextKey(ctx)
  const read = await readThread(supabase, actor, key)
  if (read.kind === 'ok' && read.thread) {
    const lines = read.thread.lines.map(l =>
      l.cards ? { ...l, cards: l.cards.map(c => (c.id === old.id ? card : c)) } : l,
    )
    const sent = built.preview.channels.map(c => `${c.channel}: ${c.subject ? `${c.subject} / ` : ''}${c.template}`).join(' | ')
    const messages = [
      ...read.thread.messages,
      { role: 'user', content: `[Manager edited the message on "${old.title}" by hand. The card (proposal_id ${minted.proposal.id}) now reads: ${sent}]` },
    ]
    await writeThread(supabase, actor, key, ctx.bookingRef, messages, lines)
  }

  console.log(`assistant: ${actor} reworded ${old.kind} ${old.id} → ${minted.proposal.id}`)
  return NextResponse.json({ ok: true, card, replaced: old.id })
}
