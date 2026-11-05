import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { guardRate, plannerRule } from '@/lib/rateLimit'
import { requireCrewMember } from '@/lib/crew/auth'
import {
  agreementIsSigned, readOwnProfile, saveProfile, saveProfileEdit, screenProfileEdit, screenProfileInput,
} from '@/lib/crew/profile'

export const dynamic = 'force-dynamic'

/**
 * Save the member's own profile.
 *
 *   before the agreement is signed: every field (names, birthday, address,
 *     emergency contact) goes through `screenProfileInput` — 18 or older;
 *   after: only `screenProfileEdit`'s fields. A signed legal name and birthday
 *     are what the agreement names, so they are not editable here.
 */
export async function PUT(req: NextRequest) {
  const limited = guardRate(req, plannerRule('crew/me'))
  if (limited) return limited
  const gate = await requireCrewMember(req, 'onboarding')
  if (!gate.ok) return gate.response
  const member = gate.member

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const sb = getSupabase()
  const read = await readOwnProfile(sb, member.id)
  if (read.kind !== 'ok') return NextResponse.json({ error: 'Try again in a moment.' }, { status: 503 })

  if (agreementIsSigned(read.data)) {
    const edit = screenProfileEdit(body as Record<string, unknown>)
    if (!edit.ok) return NextResponse.json({ error: edit.error }, { status: 400 })
    const saved = await saveProfileEdit(sb, member.id, edit.value)
    if (saved.kind !== 'ok') return NextResponse.json({ error: 'Try again in a moment.' }, { status: 503 })
    return NextResponse.json({ ok: true })
  }

  const full = screenProfileInput(body as Record<string, unknown>)
  if (!full.ok) return NextResponse.json({ error: full.error }, { status: 400 })
  const saved = await saveProfile(sb, member.id, full.value)
  if (saved.kind !== 'ok') {
    console.error('crew/me/profile: save failed:', saved.error)
    return NextResponse.json({ error: 'Try again in a moment.' }, { status: 503 })
  }
  return NextResponse.json({ ok: true })
}
