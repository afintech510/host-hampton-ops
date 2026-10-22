/**
 * POST /api/troop/[troop]/snack — a family claims a snack date.
 *
 * The claim IS the row: `troop_snack_claims` is keyed by the schedule item, so
 * two families pressing "Sign up" for the same Thursday is a 23505 for the second
 * one and a 409 telling them to pick another date — no read-then-write window.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { guardRate, intakeRule } from '@/lib/rateLimit'
import { troopConfig, troopToday, screenSnackClaim } from '@/lib/troop'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { troop: string } }) {
  const limited = guardRate(req, intakeRule('troop-snack'))
  if (limited) return limited

  const cfg = troopConfig(params.troop)
  if (!cfg) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  // Honeypot: a field no person can see. The bot is told it worked.
  if (typeof body.website === 'string' && body.website.trim() !== '') return NextResponse.json({ success: true })

  const screened = screenSnackClaim(body)
  if (!screened.ok) return NextResponse.json({ error: screened.error }, { status: 400 })
  const claim = screened.value

  const supabase = getSupabase()
  const { data: slot, error: slotErr } = await supabase
    .from('troop_schedule')
    .select('id, event_date, needs_snack')
    .eq('id', claim.schedule_id)
    .eq('troop', cfg.number)
    .maybeSingle()
  if (slotErr) {
    console.error('troop snack: schedule read failed —', slotErr.code, slotErr.message)
    return NextResponse.json({ error: "Couldn't save your sign-up. Please try again." }, { status: 503 })
  }
  if (!slot || !slot.needs_snack || slot.event_date < troopToday()) {
    return NextResponse.json({ error: 'That date is no longer open for snacks.' }, { status: 409 })
  }

  const { error } = await supabase.from('troop_snack_claims').insert({ ...claim, troop: cfg.number })
  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Sorry, another family just took this date. Please pick another.' }, { status: 409 })
    }
    console.error('troop snack: insert failed —', error.code, error.message)
    return NextResponse.json({ error: "Couldn't save your sign-up. Please try again." }, { status: 503 })
  }

  return NextResponse.json({ success: true })
}
