import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isCmCheerAuthorized, cmCheerUnauthorized } from '@/lib/cmCheerAuth'
import { boundedIntakeText } from '@/lib/publicIntake'

export const dynamic = 'force-dynamic'

const VALID_STATUSES = ['pending_payment', 'paid', 'cancelled'] as const

/**
 * Mark a CM Cheer order paid / cancelled, or annotate it.
 *
 * Auth: `lib/cmCheerAuth.ts` — one definition, fail-closed. This route carried
 * its own copy of the check with a literal default password while
 * `CM_CHEER_PASSWORD` was unset, which meant anyone holding a string printed in
 * the repository could mark any of 21 real orders paid. See that module.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isCmCheerAuthorized(req)) return cmCheerUnauthorized()

  const body = await req.json()
  const { status, status_note, notes } = body as {
    status?: unknown
    status_note?: unknown
    notes?: unknown
  }

  const supabase = getSupabase()
  const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (notes !== undefined) updatePayload.notes = boundedIntakeText(notes, 2000)

  if (status !== undefined || notes === undefined) {
    if (typeof status !== 'string' || !(VALID_STATUSES as readonly string[]).includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    updatePayload.status = status
    updatePayload.status_note = boundedIntakeText(status_note, 500)
  }

  // `.select()` so a nonexistent id cannot be answered `{ success: true }` — the
  // shape that told the admin Contacts tab it had saved a contact that does not
  // exist (rule 10's expensive half).
  const { data, error } = await supabase
    .from('cm_cheer_orders')
    .update(updatePayload)
    .eq('id', params.id)
    .select('id, order_ref, status, notes')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data || data.length !== 1) {
    return NextResponse.json({ error: 'No such order' }, { status: 404 })
  }

  return NextResponse.json({ success: true, order: data[0] })
}
