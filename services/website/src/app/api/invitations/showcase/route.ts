import { NextRequest, NextResponse } from 'next/server'
import { guardRate, MINUTE_MS, type RateLimitRule } from '@/lib/rateLimit'
import { screenShowcaseInput, showcaseCards } from '@/lib/evites/showcase'

/**
 * POST /api/invitations/showcase  { name, age, date, time } -> { cards }
 *
 * The `/invitations` page redraws every design as the visitor types. A POST body
 * rather than a query string on purpose: a child's name, age and party date in
 * the URL would land in Google Analytics' page_view and in the nginx access log.
 *
 * Public, reads no table, writes nothing, sends nothing: the only cost is the
 * text fitting, so the limit is about load, not abuse. The page debounces at
 * ~350 ms, so one visitor filling in four fields makes a dozen or two calls;
 * 120 per caller per 10 minutes leaves room to play with it, and the route
 * ceiling (the half a forged `CF-Connecting-IP` cannot move) bounds a script.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const showcaseRule: RateLimitRule = { route: 'invitation-showcase', perCaller: 120, perRoute: 3000, windowMs: 10 * MINUTE_MS }

export async function POST(req: NextRequest) {
  const limited = guardRate(req, showcaseRule)
  if (limited) return limited

  const body = await req.json().catch(() => null)
  const input = screenShowcaseInput(body)
  try {
    return NextResponse.json({ cards: showcaseCards(input) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('invitations/showcase: could not draw the designs:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not draw the invitations' }, { status: 500 })
  }
}
