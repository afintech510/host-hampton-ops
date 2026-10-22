/**
 * POST /api/troop/[troop]/join — a parent opts in to troop updates from the
 * "Get updates" tab on /troop2514 (migration 076).
 *
 * One `troop_families` row with the consent sentence they ticked. Signing up
 * again with the same email (any capitals) UPDATES that row — the unique key is
 * the database's own lowercase of the address, so this route never filters an
 * email column. A troop parent is not a lead: no contact, list, sequence or
 * agent is touched.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { guardRate, intakeRule } from '@/lib/rateLimit'
import { troopConfig, screenFamilySignup } from '@/lib/troop'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { troop: string } }) {
  const limited = guardRate(req, intakeRule('troop-join'))
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

  if (typeof body.website === 'string' && body.website.trim() !== '') return NextResponse.json({ success: true })

  const screened = screenFamilySignup(body, cfg.name)
  if (!screened.ok) return NextResponse.json({ error: screened.error }, { status: 400 })

  const { error } = await getSupabase()
    .from('troop_families')
    .upsert(
      { ...screened.value, troop: cfg.number, consented_at: new Date().toISOString() },
      { onConflict: 'troop,email_key' },
    )
  if (error) {
    console.error('troop join: upsert failed —', error.code, error.message)
    return NextResponse.json({ error: "Couldn't sign you up. Please try again in a minute." }, { status: 503 })
  }

  return NextResponse.json({ success: true })
}
