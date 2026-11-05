import { NextRequest, NextResponse } from 'next/server'
import { adminActorId, isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { featureEnabled } from '@/tenant'
import { getSupabase } from '@/lib/supabase'
import { contextKey, screenContext } from '@/lib/assistant/context'
import { deleteThread, expireStaleCards, readThread, recordCardDismissed } from '@/lib/assistant/threads'

export const dynamic = 'force-dynamic'

/**
 * The saved conversation behind the drawer / full-screen view.
 *
 *   GET    ?page=&booking_ref=   → { lines }   the thread for THIS admin and context
 *   DELETE ?page=&booking_ref=   → { ok }      "New chat"
 *   POST   { context, dismiss: { id } } → { ok }   a card was dismissed (title read from the stored card)
 *
 * Keyed by the caller's own actor, so one admin can never read or clear
 * another's. Pending cards past their 30-minute token are returned as `expired`:
 * a stale card is re-asked, never offered.
 */
function contextFrom(params: URLSearchParams) {
  return screenContext({ page: params.get('page'), booking_ref: params.get('booking_ref') })
}

function featureGate(): NextResponse | null {
  if (!featureEnabled('managerAssistant')) {
    return NextResponse.json({ error: 'The Manager assistant is not enabled on this site.' }, { status: 404 })
  }
  return null
}

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const refused = featureGate()
  if (refused) return refused
  const ctx = contextFrom(req.nextUrl.searchParams)
  const read = await readThread(getSupabase(), adminActorId(req), contextKey(ctx))
  if (read.kind !== 'ok') return NextResponse.json({ error: 'Could not load this conversation.' }, { status: 503 })
  return NextResponse.json({ lines: expireStaleCards(read.thread?.lines ?? []) })
}

export async function DELETE(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const refused = featureGate()
  if (refused) return refused
  const ctx = contextFrom(req.nextUrl.searchParams)
  const ok = await deleteThread(getSupabase(), adminActorId(req), contextKey(ctx))
  if (!ok) return NextResponse.json({ error: 'Could not clear this conversation.' }, { status: 503 })
  return NextResponse.json({ ok: true })
}

export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const refused = featureGate()
  if (refused) return refused
  const body = (await req.json().catch(() => null)) as { context?: unknown; dismiss?: { id?: unknown } } | null
  const id = typeof body?.dismiss?.id === 'string' ? body.dismiss.id.slice(0, 80) : ''
  if (!id) return NextResponse.json({ error: 'Nothing to record.' }, { status: 400 })
  const ctx = screenContext(body?.context)
  await recordCardDismissed(getSupabase(), adminActorId(req), contextKey(ctx), ctx.bookingRef, id)
  return NextResponse.json({ ok: true })
}
