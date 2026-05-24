import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { generateEmailLoginCode, hashEmailLoginCode } from '@/lib/portalAuth'
import { emailAuthCodeHtml } from '@/lib/emailTemplates'

/**
 * Request a 6-digit email login code.
 * Always returns { ok: true } regardless of whether the email has bookings —
 * this avoids email-enumeration. The code is only sent if at least one
 * booking exists for that email (otherwise there's nothing to log into).
 *
 * Rate limit: max 3 codes per email per hour.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const rawEmail = (body.email as string | undefined)?.trim().toLowerCase()
    if (!rawEmail || !rawEmail.includes('@') || rawEmail.length < 5) {
      return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
    }

    const supabase = getSupabase()
    const secret = process.env.PORTAL_LINK_SIGNING_SECRET || 'dev-secret'

    // Rate limit: count requests in the last hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { count: recentCount } = await supabase
      .from('email_auth_codes')
      .select('id', { count: 'exact', head: true })
      .eq('email', rawEmail)
      .gte('created_at', oneHourAgo)

    if ((recentCount ?? 0) >= 3) {
      return NextResponse.json({ error: 'Too many sign-in attempts. Try again in an hour.' }, { status: 429 })
    }

    // Confirm there's at least one booking for this email — if not, return ok
    // anyway (to prevent email enumeration) but skip the send.
    const { data: anyBooking } = await supabase
      .from('bookings')
      .select('id')
      .eq('contact_email', rawEmail)
      .limit(1)
      .maybeSingle()

    if (!anyBooking) {
      // Stall briefly to make timing indistinguishable from the send path
      await new Promise(r => setTimeout(r, 250))
      return NextResponse.json({ ok: true })
    }

    // Generate + store the code
    const { code, expiresAt } = generateEmailLoginCode()
    const codeHash = hashEmailLoginCode(code, rawEmail, secret)
    await supabase.from('email_auth_codes').insert({
      email: rawEmail,
      code_hash: codeHash,
      expires_at: expiresAt.toISOString(),
    })

    // Send the email
    if (process.env.RESEND_API_KEY) {
      const { Resend } = await import('resend')
      const resend = new Resend(process.env.RESEND_API_KEY)
      const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
      await resend.emails.send({
        from,
        to: rawEmail,
        subject: `Your Host Hampton sign-in code: ${code}`,
        html: emailAuthCodeHtml({ code, expiresMinutes: 15 }),
      }).catch(err => console.error('Email auth send error:', err))
    } else {
      console.warn('Email auth: RESEND_API_KEY not set; code is', code)
    }

    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'request failed'
    console.error('email-auth/request error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
