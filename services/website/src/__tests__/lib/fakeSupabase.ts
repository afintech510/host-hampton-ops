/**
 * A small in-memory stand-in for the PostgREST client, good enough to drive
 * lib/sequences/processor.ts honestly.
 *
 * It is here rather than as another `buildChain` because the thing under test is
 * a CONCURRENCY guarantee, and a mock that returns a fixed value for every query
 * cannot express one. This store enforces the real unique index on
 * `email_sequence_sends (enrollment_id, step_number)` and returns a real 23505,
 * so "two ticks cannot both send step 1" is actually exercised rather than
 * asserted about.
 */

type Row = Record<string, any>

export interface FakeStore {
  [table: string]: Row[]
}

export interface UniqueIndex {
  table: string
  columns: string[]
}

export class FakeSupabase {
  store: FakeStore
  uniques: UniqueIndex[]
  /** Force the next read on this table to fail, to exercise the third outcome. */
  failNext: Record<string, string | null> = {}
  calls: { table: string; op: string }[] = []

  constructor(store: FakeStore, uniques: UniqueIndex[] = []) {
    this.store = store
    this.uniques = uniques
  }

  from(table: string) {
    return new Builder(this, table)
  }

  rows(table: string): Row[] {
    if (!this.store[table]) this.store[table] = []
    return this.store[table]
  }
}

type Filter = { op: 'eq' | 'neq' | 'in' | 'gte' | 'lte'; col: string; val: any }

class Builder {
  private db: FakeSupabase
  private table: string
  private mode: 'select' | 'insert' | 'update' = 'select'
  private payload: Row | Row[] | null = null
  private filters: Filter[] = []
  private selected = false
  private orderCol: string | null = null
  private limitN: number | null = null
  private wantSingle = false
  private wantMaybe = false

  constructor(db: FakeSupabase, table: string) {
    this.db = db
    this.table = table
  }

  select(_cols?: string) {
    if (this.mode === 'select') this.mode = 'select'
    this.selected = true
    return this
  }
  insert(payload: Row | Row[]) {
    this.mode = 'insert'
    this.payload = payload
    this.selected = false
    return this
  }
  update(payload: Row) {
    this.mode = 'update'
    this.payload = payload
    this.selected = false
    return this
  }
  eq(col: string, val: any) { this.filters.push({ op: 'eq', col, val }); return this }
  neq(col: string, val: any) { this.filters.push({ op: 'neq', col, val }); return this }
  in(col: string, val: any[]) { this.filters.push({ op: 'in', col, val }); return this }
  gte(col: string, val: any) { this.filters.push({ op: 'gte', col, val }); return this }
  lte(col: string, val: any) { this.filters.push({ op: 'lte', col, val }); return this }
  order(col: string) { this.orderCol = col; return this }
  limit(n: number) { this.limitN = n; return this }
  is(col: string, val: any) { this.filters.push({ op: 'eq', col, val }); return this }
  single() { this.wantSingle = true; return this }
  maybeSingle() { this.wantMaybe = true; return this }

  private matches(row: Row): boolean {
    return this.filters.every(f => {
      const v = row[f.col]
      if (f.op === 'eq') return v === f.val
      if (f.op === 'neq') return v !== f.val
      if (f.op === 'in') return (f.val as any[]).includes(v)
      if (f.op === 'gte') return v >= f.val
      if (f.op === 'lte') return v <= f.val
      return true
    })
  }

  private run(): { data: any; error: any } {
    this.db.calls.push({ table: this.table, op: this.mode })

    const forced = this.db.failNext[this.table]
    if (forced) {
      this.db.failNext[this.table] = null
      return { data: null, error: { code: 'XX000', message: forced } }
    }

    const rows = this.db.rows(this.table)

    if (this.mode === 'insert') {
      const toInsert = Array.isArray(this.payload) ? this.payload : [this.payload as Row]
      for (const candidate of toInsert) {
        for (const u of this.db.uniques) {
          if (u.table !== this.table) continue
          const clash = rows.some(r => u.columns.every(c => r[c] === candidate[c]))
          if (clash) {
            return {
              data: null,
              error: {
                code: '23505',
                message: `duplicate key value violates unique constraint on (${u.columns.join(', ')})`,
              },
            }
          }
        }
      }
      const created = toInsert.map((r, i) => ({ id: `${this.table}-${rows.length + i + 1}`, ...r }))
      rows.push(...created)
      if (this.wantSingle || this.wantMaybe) return { data: created[0], error: null }
      return { data: this.selected ? created : null, error: null }
    }

    if (this.mode === 'update') {
      const hits = rows.filter(r => this.matches(r))
      for (const r of hits) Object.assign(r, this.payload)
      if (this.wantSingle || this.wantMaybe) return { data: hits[0] ?? null, error: null }
      return { data: this.selected ? hits : null, error: null }
    }

    let hits = rows.filter(r => this.matches(r))
    if (this.orderCol) hits = [...hits].sort((a, b) => String(a[this.orderCol!]).localeCompare(String(b[this.orderCol!])))
    if (this.limitN != null) hits = hits.slice(0, this.limitN)
    if (this.wantSingle) {
      if (hits.length !== 1) return { data: null, error: { code: 'PGRST116', message: 'no rows' } }
      return { data: hits[0], error: null }
    }
    if (this.wantMaybe) return { data: hits[0] ?? null, error: null }
    return { data: hits, error: null }
  }

  then(resolve: (v: any) => any, reject?: (e: any) => any) {
    return Promise.resolve(this.run()).then(resolve, reject)
  }
}

export function makeSupabase(store: FakeStore, uniques: UniqueIndex[] = []): any {
  return new FakeSupabase(store, uniques)
}

/** The one unique index the sequencer's whole idempotency rests on. */
export const SEQUENCE_SEND_UNIQUE: UniqueIndex = {
  table: 'email_sequence_sends',
  columns: ['enrollment_id', 'step_number'],
}
