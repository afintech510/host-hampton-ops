import { NextResponse } from 'next/server'
import { chatAvailability, turnstileSiteKey } from '@/lib/chat/config'

export const dynamic = 'force-dynamic'

/**
 * `GET /api/chat/config` — does the website chat exist right now, and what does
 * the browser need to open it?
 *
 * Public, reads no table, writes nothing. It exists because the root layout is
 * prerendered at BUILD time, when the runtime environment is not there: a layout
 * that read `PUBLIC_CHAT_ENABLED` would bake in "off" forever, and a NEXT_PUBLIC_
 * copy would need a rebuild and a second switch that can drift from the real one.
 * So the widget asks, once per tab, and the answer is always the server's.
 *
 * The Turnstile SITE key is public by design (it ships in the page that renders
 * the challenge); the secret never leaves the server. When the chat is off the
 * answer is `{ enabled: false }` with nothing else.
 */
export async function GET() {
  const available = chatAvailability()
  if (!available.ok) return NextResponse.json({ enabled: false }, { headers: { 'Cache-Control': 'no-store' } })
  return NextResponse.json(
    { enabled: true, turnstileSiteKey: turnstileSiteKey() },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
