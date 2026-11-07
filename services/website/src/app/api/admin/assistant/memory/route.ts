import { NextRequest, NextResponse } from 'next/server'
import { adminActorId, isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { featureEnabled } from '@/tenant'
import { getSupabase } from '@/lib/supabase'
import { loadMemories, screenMemoryText, MAX_MEMORIES_PER_SCOPE, MEMORY_SCOPES, type MemoryScope } from '@/lib/assistant/memory'

export const dynamic = 'force-dynamic'

/**
 * /api/admin/assistant/memory - the assistant's saved preferences (migration 091).
 *
 *   GET                       the business rules and THIS admin's personal ones
 *   POST   { scope, text }    save one
 *   PATCH  { id, text }       reword one
 *   DELETE { id }             forget one
 *
 * Admin only. The assistant never calls this itself: its "Remember" and "Forget"
 * cards replay it after a person presses Confirm, and the Memory panel calls it
 * from a person's own click. Every write re-screens the sentence (a preference, not
 * a permission - lib/assistant/memory.ts), enforces the cap, and reads its result.
 *
 * A PERSONAL memory is visible and editable only by its owner. A BUSINESS memory is
 * shared, so any admin may add, reword or remove one.
 */
const UNIQUE_VIOLATION = '23505'

/** The feature switch. The admin check itself stays IN each handler, where the admin-surface tripwire can see it. */
function featureOff(): NextResponse | null {
  if (!featureEnabled('managerAssistant')) {
    return NextResponse.json({ error: 'The Manager assistant is not enabled on this site.' }, { status: 404 })
  }
  return null
}

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const blocked = featureOff()
  if (blocked) return blocked
  const loaded = await loadMemories(getSupabase(), adminActorId(req))
  if (loaded.kind !== 'ok') return NextResponse.json({ error: 'Could not read the saved preferences.' }, { status: 503 })
  return NextResponse.json({ personal: loaded.personal, business: loaded.business })
}

export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const blocked = featureOff()
  if (blocked) return blocked
  const body = (await req.json().catch(() => null)) as { scope?: unknown; text?: unknown } | null
  const scope = body?.scope as MemoryScope
  if (!MEMORY_SCOPES.includes(scope)) return NextResponse.json({ ok: false, error: 'scope must be personal or business' }, { status: 400 })
  const screened = screenMemoryText(body?.text)
  if (!screened.ok) return NextResponse.json({ ok: false, error: screened.reason }, { status: 422 })

  const actor = adminActorId(req)
  const sb = getSupabase()
  const owner = scope === 'personal' ? actor : null

  // The cap, read before the insert. Two clicks racing past it by one is harmless;
  // an unreadable count is not "zero", so it refuses.
  let count = sb.from('assistant_memories').select('id', { count: 'exact', head: true }).eq('scope', scope)
  if (owner) count = count.eq('owner', owner)
  const counted = await count
  if (counted.error) return NextResponse.json({ ok: false, error: 'Could not check how many are saved - nothing was saved.' }, { status: 503 })
  if ((counted.count ?? 0) >= MAX_MEMORIES_PER_SCOPE) {
    return NextResponse.json(
      { ok: false, error: `You already have ${MAX_MEMORIES_PER_SCOPE} ${scope} preferences saved. Forget one first.` },
      { status: 409 },
    )
  }

  const { data, error } = await sb
    .from('assistant_memories')
    .insert({ scope, owner, body: screened.text, created_by: actor })
    .select('id')
  if (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
      return NextResponse.json({ ok: false, error: 'That is already saved.' }, { status: 409 })
    }
    console.error('assistant memory: insert failed:', error.message)
    return NextResponse.json({ ok: false, error: 'Could not save that.' }, { status: 500 })
  }
  if (!Array.isArray(data) || data.length === 0) return NextResponse.json({ ok: false, error: 'Could not save that.' }, { status: 500 })
  return NextResponse.json({ ok: true, id: (data[0] as { id: string }).id, scope, text: screened.text })
}

/** The row to change or remove, if THIS admin may touch it. */
async function ownedRow(sb: ReturnType<typeof getSupabase>, id: string, actor: string) {
  const { data, error } = await sb.from('assistant_memories').select('id, scope, owner, body').eq('id', id).maybeSingle()
  if (error) return { kind: 'unavailable' as const }
  const row = data as { id: string; scope: MemoryScope; owner: string | null; body: string } | null
  // Someone else's personal memory is "not found", not "forbidden": it is not theirs to know about.
  if (!row || (row.scope === 'personal' && row.owner !== actor)) return { kind: 'absent' as const }
  return { kind: 'ok' as const, row }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function PATCH(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const blocked = featureOff()
  if (blocked) return blocked
  const body = (await req.json().catch(() => null)) as { id?: unknown; text?: unknown } | null
  const id = typeof body?.id === 'string' && UUID.test(body.id) ? body.id : ''
  if (!id) return NextResponse.json({ ok: false, error: 'id is required' }, { status: 400 })
  const screened = screenMemoryText(body?.text)
  if (!screened.ok) return NextResponse.json({ ok: false, error: screened.reason }, { status: 422 })

  const sb = getSupabase()
  const own = await ownedRow(sb, id, adminActorId(req))
  if (own.kind === 'unavailable') return NextResponse.json({ ok: false, error: 'Could not read that preference.' }, { status: 503 })
  if (own.kind === 'absent') return NextResponse.json({ ok: false, error: 'No such saved preference.' }, { status: 404 })

  const { data, error } = await sb
    .from('assistant_memories')
    .update({ body: screened.text, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id')
  if (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) return NextResponse.json({ ok: false, error: 'That is already saved.' }, { status: 409 })
    return NextResponse.json({ ok: false, error: 'Could not change that.' }, { status: 500 })
  }
  if (!Array.isArray(data) || data.length === 0) return NextResponse.json({ ok: false, error: 'Could not change that.' }, { status: 500 })
  return NextResponse.json({ ok: true, id, text: screened.text })
}

export async function DELETE(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const blocked = featureOff()
  if (blocked) return blocked
  const body = (await req.json().catch(() => null)) as { id?: unknown } | null
  const id = typeof body?.id === 'string' && UUID.test(body.id) ? body.id : ''
  if (!id) return NextResponse.json({ ok: false, error: 'id is required' }, { status: 400 })

  const sb = getSupabase()
  const own = await ownedRow(sb, id, adminActorId(req))
  if (own.kind === 'unavailable') return NextResponse.json({ ok: false, error: 'Could not read that preference.' }, { status: 503 })
  if (own.kind === 'absent') return NextResponse.json({ ok: false, error: 'No such saved preference.' }, { status: 404 })

  const { error } = await sb.from('assistant_memories').delete().eq('id', id)
  if (error) return NextResponse.json({ ok: false, error: 'Could not forget that.' }, { status: 500 })
  return NextResponse.json({ ok: true, id, text: own.row.body })
}
