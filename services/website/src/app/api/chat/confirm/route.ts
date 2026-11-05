import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { guardRate, intakeRule } from '@/lib/rateLimit'
import { originAllowed } from '@/lib/evites/rsvpHttp'
import { chatAvailability, turnstileConfigured } from '@/lib/chat/config'
import { loadSession, verifySessionToken } from '@/lib/chat/session'
import { confirmBooking } from '@/lib/chat/confirm'

export const dynamic = 'force-dynamic'

/**
 * `POST /api/chat/confirm` — the visitor tapped "Book it & see my invoice".
 *
 * The ONLY door through which the chat creates a booking. Public, because the
 * credential is the pair it carries: a session token (signed; names a row) and a
 * booking card (signed by the server, bound to that session, expiring, single
 * use). Everything it does is in lib/chat/confirm.ts, which REPLAYS the party
 * planner's own save route rather than writing a booking itself.
 *
 * Rate limit: `intakeRule` — a retry and a corrected tap, not a conversation.
 */
export async function POST(req: NextRequest) {
  if (!chatAvailability().ok) return NextResponse.json({ error: 'The chat is not available right now.' }, { status: 404 })

  const limited = guardRate(req, intakeRule('chat/confirm'))
  if (limited) return limited

  if (!originAllowed(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { sessionToken?: unknown; cardToken?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }

  const id = verifySessionToken(body?.sessionToken)
  if (!id) return NextResponse.json({ error: 'This chat has ended. Please start a new one.' }, { status: 401 })

  const supabase = getSupabase()
  const loaded = await loadSession(supabase, id)
  if (loaded.kind === 'unavailable') {
    console.error('chat/confirm: session unreadable:', loaded.error)
    return NextResponse.json({ error: 'Something went wrong on our side. Please try again, or text us.' }, { status: 503 })
  }
  if (loaded.kind === 'missing') return NextResponse.json({ error: 'This chat has ended. Please start a new one.' }, { status: 410 })

  if (!loaded.session.verified && turnstileConfigured()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const result = await confirmBooking({ supabase, req, session: loaded.session, cardToken: body.cardToken })
  if (!result.ok) {
    return NextResponse.json({ error: result.message, reason: result.reason }, { status: result.status })
  }

  const res = NextResponse.json({
    ok: true,
    bookingRef: result.bookingRef,
    invoiceUrl: result.invoiceUrl,
    emailedTo: result.emailedTo,
    emailSent: result.emailSent,
    total: result.total,
    deposit: result.deposit,
  })
  // The planner route binds this browser to the plan it just made; pass that through
  // so the invoice opens without a sign-in step.
  if (result.setCookie) res.headers.set('Set-Cookie', result.setCookie)
  return res
}
