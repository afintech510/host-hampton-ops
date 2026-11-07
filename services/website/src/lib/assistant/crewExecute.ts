import { NextRequest } from 'next/server'
import { CANONICAL_ORIGIN } from '@/lib/publicOrigin'
import { POST as createCrewPartyRoute } from '@/app/api/admin/crew/parties/route'
import { PATCH as crewPartyPatchRoute } from '@/app/api/admin/crew/parties/[id]/route'
import { POST as crewSyncRoute } from '@/app/api/admin/crew/sync/route'
import { POST as crewPicksRoute } from '@/app/api/admin/crew/picks/route'
import type { Proposal } from './proposals'
import type { ExecuteResult } from './execute'

/**
 * Carry out a confirmed crew card by replaying the Crew page's own admin route,
 * on the confirming admin's credentials (see execute.ts for why replay).
 *
 * Nothing here talks to the crew tables, sends a message or touches pay: the
 * routes do the work and keep every guard they have (a held spot cannot be
 * removed, a conflict needs `force`, a start after the party's start is refused).
 * `force` is only ever sent when the card the manager confirmed SHOWED the
 * conflict.
 */

type Replay = (original: NextRequest, path: string, body: unknown, method?: 'POST' | 'PATCH' | 'DELETE') => NextRequest

const partyUrl = (id: string) => `${CANONICAL_ORIGIN}/admin/crew/parties/${id}`

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const j = await res.json()
    return j && typeof j === 'object' ? (j as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export const CREW_PROPOSAL_KINDS = ['crew_task', 'crew_import', 'crew_publish', 'crew_staff', 'crew_shift', 'crew_spots', 'crew_notes', 'crew_picks'] as const

export async function executeCrewProposal(original: NextRequest, proposal: Proposal, replay: Replay): Promise<ExecuteResult> {
  const input = proposal.input as Record<string, unknown>
  const patch = async (partyId: string, body: Record<string, unknown>) => {
    const res = await crewPartyPatchRoute(replay(original, `/api/admin/crew/parties/${encodeURIComponent(partyId)}`, body, 'PATCH'), {
      params: { id: partyId },
    })
    return { res, json: await readJson(res) }
  }
  const refused = (what: string, res: Response, json: Record<string, unknown>): ExecuteResult => {
    const warn = Array.isArray(json.warnings) && json.warnings.length ? ` (${(json.warnings as unknown[]).map(String).join(' ')})` : ''
    return { ok: false, status: res.status, message: `${what}: ${String(json.error ?? `HTTP ${res.status}`)}${warn}` }
  }
  const link = (partyId: string) => [{ label: 'Open the crew party', url: partyUrl(partyId) }]

  switch (proposal.kind) {
    case 'crew_task': {
      const res = await createCrewPartyRoute(replay(original, '/api/admin/crew/parties', input))
      const json = await readJson(res)
      if (!res.ok || json.ok !== true || typeof json.id !== 'string') return refused('Not created', res, json)
      return {
        ok: true,
        status: res.status,
        message: `Created "${String(input.title)}" as a draft. Publish it when you are ready; nobody has been told.`,
        links: link(json.id),
      }
    }

    case 'crew_import': {
      const ref = typeof input.bookingRef === 'string' ? input.bookingRef : null
      const url = `/api/admin/crew/sync${ref ? `?booking=${encodeURIComponent(ref)}` : ''}`
      const res = await crewSyncRoute(replay(original, url, {}))
      const json = await readJson(res)
      const s = (json.summary ?? {}) as Record<string, unknown>
      if (!res.ok && res.status !== 207) return refused('Not imported', res, json)
      const errors = Array.isArray(s.errors) ? (s.errors as unknown[]) : []
      return {
        ok: errors.length === 0,
        status: res.status,
        message:
          `Imported: ${Number(s.created) || 0} new draft${Number(s.created) === 1 ? '' : 's'}, ${Number(s.updated) || 0} updated, ${Number(s.cancelled) || 0} cancelled` +
          (Number(s.alreadyThere) ? `, ${Number(s.alreadyThere)} were already there` : '') +
          (errors.length ? `. Problems: ${errors.slice(0, 3).map(String).join('; ')}` : '. New parties are drafts; publish each when ready.'),
        links: [{ label: 'Open the crew schedule', url: `${CANONICAL_ORIGIN}/admin/crew` }],
      }
    }

    case 'crew_publish': {
      const partyId = String(input.partyId)
      const action = input.action === 'unpublish' ? 'unpublish' : 'publish'
      const { res, json } = await patch(partyId, { action })
      if (!res.ok || json.ok !== true) return refused(action === 'publish' ? 'Not published' : 'Not unpublished', res, json)
      return {
        ok: true,
        status: res.status,
        message: action === 'publish' ? `"${String(input.title)}" is published: crew can see it now.` : `"${String(input.title)}" is back to draft.`,
        links: link(partyId),
      }
    }

    case 'crew_staff': {
      const partyId = String(input.partyId)
      const assign = input.action === 'assign'
      const { res, json } = await patch(
        partyId,
        assign
          ? { action: 'assign', slotId: input.slotId, memberId: input.memberId, ...(input.force === true ? { force: true } : {}) }
          : { action: 'unassign', slotId: input.slotId },
      )
      if (!res.ok || json.ok !== true) return refused(assign ? 'Not assigned' : 'Not removed', res, json)
      return {
        ok: true,
        status: res.status,
        message: assign
          ? `${String(input.memberName)} is on "${String(input.title)}".`
          : `${String(input.memberName)} is off "${String(input.title)}"; the spot is open again.`,
        links: link(partyId),
      }
    }

    case 'crew_shift': {
      const partyId = String(input.partyId)
      const body: Record<string, unknown> = { action: 'shift' }
      for (const k of ['crew_start', 'end', 'lead_start']) if (k in input) body[k] = input[k]
      const { res, json } = await patch(partyId, body)
      if (!res.ok || json.ok !== true) return refused('Shift not changed', res, json)
      return { ok: true, status: res.status, message: `Shift times updated for "${String(input.title)}".`, links: link(partyId) }
    }

    case 'crew_spots': {
      const partyId = String(input.partyId)
      const action = input.action
      const body =
        action === 'add' ? { action: 'add_spot' } : action === 'remove' ? { action: 'remove_spot', slotId: input.slotId } : { action: 'set_count', value: input.total }
      const { res, json } = await patch(partyId, body)
      if (!res.ok || json.ok !== true) return refused('Spots not changed', res, json)
      return { ok: true, status: res.status, message: `Spots updated for "${String(input.title)}".`, links: link(partyId) }
    }

    case 'crew_notes': {
      const partyId = String(input.partyId)
      const { res, json } = await patch(partyId, { action: 'fields', notes_for_crew: String(input.notes ?? '') })
      if (!res.ok || json.ok !== true) return refused('Notes not saved', res, json)
      return { ok: true, status: res.status, message: `Crew notes saved for "${String(input.title)}".`, links: link(partyId) }
    }

    case 'crew_picks': {
      const res = await crewPicksRoute(replay(original, '/api/admin/crew/picks', { action: 'approve_all' }))
      const json = await readJson(res)
      if (!res.ok || json.ok !== true) return refused('Picks not approved', res, json)
      const held = Array.isArray(json.held) ? (json.held as unknown[]) : []
      return {
        ok: true,
        status: res.status,
        message:
          `Approved ${Number(json.approved) || 0} across ${Number(json.parties) || 0} part${Number(json.parties) === 1 ? 'y' : 'ies'}; ${Number(json.standby) || 0} on standby.` +
          (held.length ? ` Held back: ${held.slice(0, 3).map(String).join(' ')}` : ''),
        links: [{ label: 'Open the crew schedule', url: `${CANONICAL_ORIGIN}/admin/crew` }],
      }
    }

    default:
      return { ok: false, status: 400, message: 'Unknown action.' }
  }
}
