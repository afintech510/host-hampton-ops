import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { upsertContact } from '@/lib/contacts'
import { studioRentalInviteHtml } from '@/lib/emailTemplates'
import { publicOrigin } from '@/lib/publicOrigin'

/**
 * Admin: add a customer and email them the studio-rental onboarding link.
 * POST /api/admin/studio-rental/invite  { name, email, phone? }
 * Auth: Bearer ADMIN_PASSWORD
 */
export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  try {
    const body = await req.json()
    const name = (body.name as string || '').trim()
    const email = (body.email as string || '').trim()
    const phone = (body.phone as string || '').trim()

    if (!name || !/.+@.+\..+/.test(email)) {
      return NextResponse.json({ error: 'A name and valid email are required' }, { status: 400 })
    }

    // Build the onboarding link from the request host (falls back to prod).
    const origin = publicOrigin(req)
    const studioUrl = `${origin}/studio-rental`

    // Upsert the contact (non-fatal if the CRM write fails).
    await upsertContact({
      name,
      email,
      phone: phone || undefined,
      sourceDetail: 'Studio rental invite (admin)',
      serviceInterests: ['room_rental'],
      marketingConsent: false,
    }).catch(err => console.error('Invite upsertContact error (non-fatal):', err))

    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ error: 'Email is not configured (RESEND_API_KEY missing)' }, { status: 500 })
    }

    const { Resend } = await import('resend')
    const resend = new Resend(process.env.RESEND_API_KEY)
    const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'

    const { error } = await resend.emails.send({
      from,
      to: email,
      subject: 'Reserve our studio — Host Hampton',
      html: studioRentalInviteHtml({ customerName: name, studioUrl }),
    })

    if (error) {
      const msg = error instanceof Error ? error.message : JSON.stringify(error)
      console.error('Studio rental invite email error:', msg)
      return NextResponse.json({ error: `Email failed: ${msg}` }, { status: 502 })
    }

    return NextResponse.json({ ok: true, sentTo: email, studioUrl })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Invite failed'
    console.error('Studio rental invite error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
