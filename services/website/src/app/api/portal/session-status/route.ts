import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getSupabase } from '@/lib/supabase'
import { getPortalBookingRef } from '@/lib/portalAuth'
import { formatMoney } from '@/lib/partyPricing'

export async function GET(req: NextRequest) {
  const secret = process.env.PORTAL_LINK_SIGNING_SECRET || 'dev-secret'
  const cookieHeader = req.headers.get('cookie')
  const bookingRef = getPortalBookingRef(cookieHeader, secret)

  if (!bookingRef) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const sessionId = req.nextUrl.searchParams.get('session_id')
  if (!sessionId) {
    return NextResponse.json({ error: 'session_id required' }, { status: 400 })
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' })
  const session = await stripe.checkout.sessions.retrieve(sessionId)

  return NextResponse.json({
    status: session.status,
    payment_status: session.payment_status,
  })
}
