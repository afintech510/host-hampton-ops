/**
 * lib/crew/db.ts: the compare-and-swap wrappers and the three-outcome reads.
 * The SQL functions themselves are proven against the live database by
 * scripts/crew/race-test.mjs; this proves the app hands them the right numbers.
 */
import { releaseSlot, dropUncovered, adminSetSteps, insertNotification, getMember, markAttendance } from '@/lib/crew/db'
import { DEFAULT_SETTINGS, type CrewSettings } from '@/lib/crew/rules'
import { findCrewMembersByEmail } from '@/lib/contactLookup'

type RpcCall = { fn: string; args: Record<string, any> }

function fakeDb(opts: {
  steps?: number[]                       // successive reads of crew_members.steps
  rpc?: (call: RpcCall, n: number) => { data?: any; error?: any }
  insertError?: any
  selectError?: any
  rows?: any[]
}) {
  const calls: RpcCall[] = []
  const filters: [string, string, unknown][] = []
  let reads = 0
  const sb: any = {
    rpc: async (fn: string, args: Record<string, any>) => {
      calls.push({ fn, args })
      return opts.rpc ? opts.rpc({ fn, args }, calls.length) : { data: 'ok', error: null }
    },
    from: (table: string) => {
      const chain: any = {
        select: () => chain,
        insert: () => chain,
        eq: (c: string, v: unknown) => { filters.push([table, c, v]); return chain },
        ilike: (c: string, v: unknown) => { filters.push([table, `ilike:${c}`, v]); return chain },
        maybeSingle: async () => {
          if (table === 'crew_members' && opts.steps) {
            const st = opts.steps[Math.min(reads++, opts.steps.length - 1)]
            return { data: { steps: st, is_owner: false }, error: null }
          }
          if (opts.insertError) return { data: null, error: opts.insertError }
          if (opts.selectError) return { data: null, error: opts.selectError }
          return { data: { id: 'n1' }, error: null }
        },
        then: (res: any) => res({ data: opts.rows ?? [], error: opts.selectError ?? null }),
      }
      return chain
    },
  }
  return { sb, calls, filters }
}

const start = new Date('2026-11-14T18:00:00Z')
const launched = (date: string | null): CrewSettings => ({ ...DEFAULT_SETTINGS, launch: { launchDate: date, graceDays: 60 } })

describe('releaseSlot', () => {
  const base = { slotId: 's', memberId: 'm', partyStartsAt: start, reason: 'sick' as const }

  it('7+ days out, after grace: an early release that costs one step', async () => {
    const { sb, calls } = fakeDb({ steps: [4], rpc: () => ({ data: 'released' }) })
    const r = await releaseSlot(sb, { ...base, now: new Date('2026-11-01T12:00:00Z'), settings: launched('2026-01-01') })
    expect(r).toEqual({ kind: 'ok', result: 'released' })
    expect(calls[0].fn).toBe('crew_release_slot')
    expect(calls[0].args).toMatchObject({ p_kind: 'early_release', p_expected_steps: 4, p_steps_after: 3, p_waived_grace: false })
  })

  it('in grace: recorded with the would-be value, not applied', async () => {
    const { sb, calls } = fakeDb({ steps: [4], rpc: () => ({ data: 'released' }) })
    await releaseSlot(sb, { ...base, now: new Date('2026-11-01T12:00:00Z'), settings: launched(null) })
    expect(calls[0].args).toMatchObject({ p_expected_steps: 4, p_steps_after: 4, p_waived_grace: true, p_meta: { would_be_steps: 3 } })
  })

  it('under 7 days: a cover request, no step change', async () => {
    const { sb, calls } = fakeDb({ steps: [4], rpc: () => ({ data: 'requested' }) })
    const r = await releaseSlot(sb, { ...base, now: new Date('2026-11-10T12:00:00Z'), settings: launched('2026-01-01') })
    expect(r).toEqual({ kind: 'ok', result: 'requested' })
    expect(calls[0].args).toMatchObject({ p_kind: 'late_cancel', p_expected_steps: 4, p_steps_after: 4 })
  })

  it('after the start: refused before any write', async () => {
    const { sb, calls } = fakeDb({ steps: [4] })
    expect(await releaseSlot(sb, { ...base, now: new Date('2026-11-14T18:30:00Z'), settings: DEFAULT_SETTINGS })).toEqual({ kind: 'ok', result: 'started' })
    expect(calls).toHaveLength(0)
  })

  it('stale: re-reads the steps and retries ONCE with the new value', async () => {
    const { sb, calls } = fakeDb({ steps: [4, 5], rpc: (_c, n) => ({ data: n === 1 ? 'stale' : 'released' }) })
    const r = await releaseSlot(sb, { ...base, now: new Date('2026-11-01T12:00:00Z'), settings: launched('2026-01-01') })
    expect(r).toEqual({ kind: 'ok', result: 'released' })
    expect(calls.map(c => [c.args.p_expected_steps, c.args.p_steps_after])).toEqual([[4, 3], [5, 4]])
  })

  it('stale twice: reports stale rather than looping', async () => {
    const { sb, calls } = fakeDb({ steps: [4, 5, 6], rpc: () => ({ data: 'stale' }) })
    const r = await releaseSlot(sb, { ...base, now: new Date('2026-11-01T12:00:00Z'), settings: launched('2026-01-01') })
    expect(r).toEqual({ kind: 'ok', result: 'stale' })
    expect(calls).toHaveLength(2)
  })

  it('an RPC error is an error, not a result', async () => {
    const { sb } = fakeDb({ steps: [4], rpc: () => ({ data: null, error: { message: 'boom' } }) })
    expect(await releaseSlot(sb, { ...base, now: new Date('2026-11-01T12:00:00Z'), settings: DEFAULT_SETTINGS })).toEqual({ kind: 'error', error: 'boom' })
  })
})

describe('dropUncovered', () => {
  it('resets to 0 after grace', async () => {
    const { sb, calls } = fakeDb({ steps: [6], rpc: () => ({ data: 'dropped' }) })
    await dropUncovered(sb, { swapId: 'w', memberId: 'm', now: new Date('2026-11-10T00:00:00Z'), settings: launched('2026-01-01') })
    expect(calls[0].args).toMatchObject({ p_expected_steps: 6, p_steps_after: 0, p_waived_grace: false })
  })
  it('inside grace, recorded and not applied', async () => {
    const { sb, calls } = fakeDb({ steps: [6], rpc: () => ({ data: 'dropped' }) })
    await dropUncovered(sb, { swapId: 'w', memberId: 'm', now: new Date('2026-11-10T00:00:00Z'), settings: launched('2026-11-01') })
    expect(calls[0].args).toMatchObject({ p_expected_steps: 6, p_steps_after: 6, p_waived_grace: true, p_meta: { would_be_steps: 0 } })
  })
})

describe('adminSetSteps', () => {
  it('passes the steps it read as the expected value', async () => {
    const { sb, calls } = fakeDb({ steps: [2], rpc: () => ({ data: 'set' }) })
    expect(await adminSetSteps(sb, { memberId: 'm', steps: 5, reason: 'starting step', actor: 'ADMIN' })).toEqual({ kind: 'ok', result: 'set' })
    expect(calls[0].args).toMatchObject({ p_expected_steps: 2, p_steps_after: 5, p_reason: 'starting step' })
  })
})

describe('markAttendance', () => {
  it('crew_stale is its own outcome, so the caller rebuilds instead of reporting a failure', async () => {
    const { sb } = fakeDb({ rpc: () => ({ data: null, error: { message: 'crew_stale' } }) })
    expect(await markAttendance(sb, 'p', [], 'ADMIN')).toEqual({ kind: 'stale' })
  })
  it('reads the summary', async () => {
    const { sb } = fakeDb({ rpc: () => ({ data: { marked: 3, voided: 1 } }) })
    expect(await markAttendance(sb, 'p', [], 'ADMIN')).toEqual({ kind: 'ok', marked: 3, voided: 1 })
  })
})

describe('insertNotification', () => {
  it('a 23505 on (dedupe_key, channel) is a duplicate, not a failure', async () => {
    const { sb } = fakeDb({ insertError: { code: '23505', message: 'dup' } })
    expect(await insertNotification(sb, { member_id: 'm', channel: 'sms', template: 't', dedupe_key: 'k' })).toEqual({ kind: 'duplicate' })
  })
  it('any other error is a failure', async () => {
    const { sb } = fakeDb({ insertError: { code: '42P01', message: 'no table' } })
    expect(await insertNotification(sb, { member_id: 'm', channel: 'sms', template: 't', dedupe_key: 'k' })).toEqual({ kind: 'failed', error: 'no table' })
  })
})

describe('reads have three outcomes', () => {
  it('an unreadable member is unavailable, not absent', async () => {
    const { sb } = fakeDb({ selectError: { message: 'timeout' } })
    expect(await getMember(sb, 'm')).toEqual({ kind: 'unavailable', error: 'timeout' })
  })
})

describe('findCrewMembersByEmail', () => {
  it('an exact match on the generated lowercase key, never a LIKE pattern', async () => {
    const { sb, filters } = fakeDb({ rows: [{ id: 'a', email: 'Sam@Example.com', status: 'active' }] })
    const r = await findCrewMembersByEmail(sb, '  SAM@example.COM ')
    expect(r).toMatchObject({ kind: 'found', primary: { id: 'a' } })
    expect(filters).toEqual([['crew_members', 'email_key', 'sam@example.com']])
  })
  it('re-compares: a row whose email does not match is not the answer', async () => {
    const { sb } = fakeDb({ rows: [{ id: 'a', email: 'samXexample@example.com', status: 'active' }] })
    expect(await findCrewMembersByEmail(sb, 'sam_example@example.com')).toEqual({ kind: 'absent' })
  })
  it('an implausible address reads nothing at all', async () => {
    const { sb, filters } = fakeDb({ rows: [] })
    expect(await findCrewMembersByEmail(sb, '%@gmail.com')).toEqual({ kind: 'absent' })
    expect(filters).toEqual([])
  })
  it('a failed read is unavailable', async () => {
    const { sb } = fakeDb({ selectError: { message: 'down' } })
    expect(await findCrewMembersByEmail(sb, 'sam@example.com')).toEqual({ kind: 'unavailable', error: 'down' })
  })
})
