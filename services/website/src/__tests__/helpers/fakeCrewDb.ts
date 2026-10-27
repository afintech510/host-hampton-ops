/**
 * A small in-memory PostgREST stand-in for the crew tables and the booking
 * tables the reconcile reads. It refuses what Postgres refuses where the code
 * under test depends on it:
 *
 *   - `uq_crew_parties_booking`: a second crew party for one booking is 23505;
 *   - `crew_set_updated_at`: every UPDATE moves `updated_at`, so a
 *     compare-and-swap on it really does lose the second time;
 *   - `uq_crew_slots_one_lead`: two live Lead spots on one party is 23505.
 *
 * Column lists are ignored (rows come back whole); seed aliased columns in the
 * shape the code reads them.
 */

type Row = Record<string, any>
type Filter = (r: Row) => boolean

let seq = 0
const nextId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`
let clock = Date.parse('2026-10-27T12:00:00Z')
const tick = () => new Date((clock += 1000)).toISOString()

export interface FakeCrewDb {
  sb: any
  tables: Record<string, Row[]>
  rpcCalls: { fn: string; args: Record<string, any> }[]
  failOn: Set<string>
}

export function fakeCrewDb(seed: Record<string, Row[]> = {}, opts: { rpc?: (fn: string, args: any, db: FakeCrewDb) => any } = {}): FakeCrewDb {
  const tables: Record<string, Row[]> = {}
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map(r => ({ ...r }))
  const t = (name: string) => (tables[name] ??= [])
  const db: FakeCrewDb = { sb: null, tables, rpcCalls: [], failOn: new Set() }

  function uniqueViolation(table: string, row: Row, ignoreId?: string): boolean {
    if (table === 'crew_parties' && row.booking_id) {
      return t(table).some(r => r.id !== ignoreId && r.booking_id === row.booking_id)
    }
    if (table === 'crew_slots' && row.role === 'lead' && row.status !== 'cancelled') {
      return t(table).some(r => r.id !== ignoreId && r.party_id === row.party_id && r.role === 'lead' && r.status !== 'cancelled')
    }
    if (table === 'crew_notifications') {
      return t(table).some(r => r.id !== ignoreId && r.dedupe_key === row.dedupe_key && r.channel === row.channel)
    }
    return false
  }

  function query(table: string) {
    const filters: Filter[] = []
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select'
    let payload: Row | Row[] | null = null
    let limitN: number | null = null
    let returning = false

    const run = (): { data: any; error: any } => {
      if (db.failOn.has(`${op}:${table}`)) return { data: null, error: { message: `forced ${op} failure on ${table}` } }
      const match = (r: Row) => filters.every(f => f(r))
      if (op === 'select') {
        let rows = t(table).filter(match).map(r => ({ ...r }))
        if (limitN != null) rows = rows.slice(0, limitN)
        return { data: rows, error: null }
      }
      if (op === 'insert') {
        const list = Array.isArray(payload) ? payload : [payload as Row]
        const made: Row[] = []
        for (const p of list) {
          const now = tick()
          const row: Row = { id: nextId(), created_at: now, updated_at: now, ...defaultsFor(table), ...p }
          if (uniqueViolation(table, row)) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }
          made.push(row)
        }
        t(table).push(...made)
        return { data: made.map(r => ({ ...r })), error: null }
      }
      if (op === 'update') {
        const hit = t(table).filter(match)
        for (const r of hit) {
          const next = { ...r, ...(payload as Row), updated_at: tick() }
          if (uniqueViolation(table, next, r.id)) return { data: null, error: { code: '23505', message: 'duplicate key' } }
          Object.assign(r, next)
        }
        return { data: hit.map(r => ({ ...r })), error: null }
      }
      const keep = t(table).filter(r => !match(r))
      const gone = t(table).filter(match)
      tables[table] = keep
      return { data: gone, error: null }
    }

    const chain: any = {
      select: () => { if (op !== 'select') returning = true; return chain },
      insert: (p: Row | Row[]) => { op = 'insert'; payload = p; return chain },
      update: (p: Row) => { op = 'update'; payload = p; return chain },
      delete: () => { op = 'delete'; return chain },
      eq: (c: string, v: unknown) => { filters.push(r => r[c] === v); return chain },
      neq: (c: string, v: unknown) => { filters.push(r => r[c] !== v); return chain },
      not: (c: string, op: string, v: unknown) => {
        if (op !== 'is') throw new Error(`fakeCrewDb: not(${op}) unsupported`)
        filters.push(r => (r[c] ?? null) !== v)
        return chain
      },
      is: (c: string, v: unknown) => { filters.push(r => (r[c] ?? null) === v); return chain },
      in: (c: string, vs: unknown[]) => { filters.push(r => vs.includes(r[c])); return chain },
      gte: (c: string, v: any) => { filters.push(r => r[c] != null && r[c] >= v); return chain },
      lte: (c: string, v: any) => { filters.push(r => r[c] != null && r[c] <= v); return chain },
      lt: (c: string, v: any) => { filters.push(r => r[c] != null && r[c] < v); return chain },
      gt: (c: string, v: any) => { filters.push(r => r[c] != null && r[c] > v); return chain },
      ilike: (c: string, pat: string) => {
        const re = new RegExp('^' + pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i')
        filters.push(r => typeof r[c] === 'string' && re.test(r[c]))
        return chain
      },
      order: () => chain,
      limit: (n: number) => { limitN = n; return chain },
      maybeSingle: async () => {
        const r = run()
        if (r.error) return r
        const rows = r.data as Row[]
        return { data: rows[0] ?? null, error: null }
      },
      single: async () => {
        const r = run()
        if (r.error) return r
        const rows = r.data as Row[]
        return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: 'not one row' } }
      },
      then: (res: any, rej?: any) => {
        try {
          const r = run()
          return Promise.resolve(op === 'select' || returning ? r : { data: null, error: r.error }).then(res, rej)
        } catch (e) {
          return Promise.reject(e).then(res, rej)
        }
      },
    }
    return chain
  }

  db.sb = {
    from: (table: string) => query(table),
    rpc: async (fn: string, args: Record<string, any>) => {
      db.rpcCalls.push({ fn, args })
      if (opts.rpc) return opts.rpc(fn, args, db)
      return { data: null, error: { message: `no rpc ${fn}` } }
    },
  }
  return db
}

function defaultsFor(table: string): Row {
  switch (table) {
    case 'crew_parties':
      return { party_kind: 'manual', status: 'draft', slots_override: null, extra_flat_cents: 0, sync_flags: [], notes_for_crew: null, published_at: null, cancelled_at: null, attendance_marked_at: null }
    case 'crew_slots':
      return { role: 'crew', status: 'open', member_id: null, assigned_at: null, assigned_via: null, assigned_by: null, confirmed_at: null, covered_swap_id: null }
    case 'crew_notifications':
      return { status: 'queued' }
    default:
      return {}
  }
}

/**
 * `crew_admin_assign` as migration 077 writes it: the same refusals in the
 * same order, and the owner is confirmed on assignment (she is never asked).
 */
export function fakeAdminAssign(fn: string, args: any, db: FakeCrewDb) {
  if (fn !== 'crew_admin_assign') return { data: null, error: { message: `no rpc ${fn}` } }
  const m = (db.tables.crew_members ?? []).find(r => r.id === args.p_member_id)
  if (!m || m.status !== 'active') return { data: 'inactive', error: null }
  const slot = (db.tables.crew_slots ?? []).find(r => r.id === args.p_slot_id)
  if (!slot || slot.status !== 'open') return { data: 'unavailable', error: null }
  const party = (db.tables.crew_parties ?? []).find(r => r.id === slot.party_id)
  if (!party || party.status === 'cancelled' || party.status === 'completed') return { data: 'party_closed', error: null }
  if (slot.role === 'lead' && !(m.can_lead || m.is_owner)) return { data: 'not_lead', error: null }
  if ((db.tables.crew_slots ?? []).some(r => r.party_id === slot.party_id && r.member_id === m.id && ['assigned', 'completed', 'no_show'].includes(r.status))) {
    return { data: 'already_on_party', error: null }
  }
  Object.assign(slot, {
    status: 'assigned', member_id: m.id, assigned_at: new Date().toISOString(), assigned_via: 'admin',
    assigned_by: args.p_actor, covered_swap_id: null, confirmed_at: m.is_owner ? new Date().toISOString() : null,
  })
  return { data: 'assigned', error: null }
}
