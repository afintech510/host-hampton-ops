/**
 * An in-memory fake of the slice of Supabase `renderEvite` talks to: five tables
 * (filters `eq` / `is` / `lt`, `select`, `update`, `maybeSingle`) and the storage
 * `upload`. It records every UPDATE and every upload, can inject an error on a
 * named call, and can run a hook just before an update to simulate another worker.
 *
 * It also fakes `contains` (array containment), `order`, `limit` and `insert` for the public-page tests.
 *
 * P06 adds, for the RSVP routes: `insert(...).select(cols).single()`, `update(...).select(cols)`
 * projecting the NAMED columns (a bare `.select()` / `.select('id')` still returns `{id}` only),
 * `in`, `single`, `select(cols, { count: 'exact', head: true })`, `rpc`, and per-table
 * `rowDefaults` / `generated` / `checks` standing in for the database's DEFAULTs and CHECK constraints.
 *
 * Deliberately faithful to the one thing the pipeline depends on: an UPDATE only
 * touches rows that match ALL its filters, and `.select('id')` returns exactly
 * the rows it touched (so "zero rows" is expressible).
 */

type Row = Record<string, unknown>
type Filter = { kind: 'eq' | 'is' | 'lt' | 'lte' | 'gt' | 'gte' | 'neq' | 'notnull' | 'contains' | 'in' | 'ilike'; col: string; val: unknown }
type DbError = { message: string; code?: string }
type Result = { data: unknown; error: DbError | null; count?: number | null }

export interface UpdateRecord {
  table: string
  patch: Row
  filters: Filter[]
  matched: number
}

export interface UploadRecord {
  bucket: string
  path: string
  bytes: number
  options: Record<string, unknown>
}

export interface FakeEviteDbOptions {
  tables: Record<string, Row[]>
  /** Column defaults applied to an INSERT (the database's DEFAULTs and generated columns), per table. */
  rowDefaults?: Record<string, (row: Row) => Row>
  /** GENERATED ALWAYS columns, recomputed after every INSERT and UPDATE (e.g. `child_count`). */
  generated?: Record<string, (row: Row) => Row>
  /** A CHECK stand-in per table: an error message for a row the database would refuse, else null. Runs on INSERT and UPDATE. */
  checks?: Record<string, (row: Row) => string | null>
  /**
   * UNIQUE indexes per table (P09): an INSERT that would repeat the values of `cols` fails with Postgres' own
   * `23505` and the index name in the message. `nullsNotDistinct` mirrors `NULLS NOT DISTINCT` (two NULLs collide).
   */
  uniques?: Record<string, Array<{ name: string; cols: string[]; nullsNotDistinct?: boolean }>>
  /** `supabase.rpc(name, args)` handlers. */
  rpcs?: Record<string, (args: Record<string, unknown>, tables: Record<string, Row[]>) => { data: unknown; error: DbError | null }>
}

export interface InjectedError {
  /** Table (or 'storage') and operation the error applies to. */
  table: string
  op: 'select' | 'update' | 'upload' | 'insert'
  /** Only when this returns true for the patch / path (default: always). */
  when?: (info: { patch?: Row; path?: string; filters?: Filter[] }) => boolean
  message?: string
  /** Fire this many times then stop (default: forever). */
  times?: number
}

/** A column name as PostgREST reads it: `metadata->>bounce_type` reaches into a jsonb column. */
function valueAt(row: Row, col: string): unknown {
  const at = col.indexOf('->>')
  if (at < 0) return row[col]
  const base = row[col.slice(0, at)]
  const key = col.slice(at + 3)
  if (base && typeof base === 'object' && !Array.isArray(base)) {
    const v = (base as Row)[key]
    return v === undefined || v === null ? null : String(v)
  }
  return null
}

/** A LIKE pattern as a case-insensitive regex (`%` any run, `_` any one character). */
function likeRegex(pattern: string): RegExp {
  const body = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')
  return new RegExp(`^${body}$`, 'i')
}

export function makeFakeEviteDb(opts: FakeEviteDbOptions) {
  const tables: Record<string, Row[]> = {}
  for (const [name, rows] of Object.entries(opts.tables)) tables[name] = rows.map((r) => ({ ...r }))

  const updates: UpdateRecord[] = []
  const uploads: UploadRecord[] = []
  const uploaded = new Map<string, Buffer>()
  const selects: Array<{ table: string; cols: string }> = []
  const inserts: Array<{ table: string; row: Row }> = []
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = []
  const errors: InjectedError[] = []
  const hooks: { beforeUpdate?: (info: { table: string; patch: Row; filters: Filter[] }, db: Record<string, Row[]>) => void } = {}

  const injected = (table: string, op: InjectedError['op'], info: { patch?: Row; path?: string; filters?: Filter[] }) => {
    for (const e of errors) {
      if (e.table !== table || e.op !== op) continue
      if (e.times !== undefined && e.times <= 0) continue
      if (e.when && !e.when(info)) continue
      if (e.times !== undefined) e.times -= 1
      return { message: e.message ?? `injected ${table} ${op} error` }
    }
    return null
  }

  const matches = (row: Row, filters: Filter[]) =>
    filters.every((f) => {
      const v = valueAt(row, f.col)
      if (f.kind === 'eq') return v === f.val
      if (f.kind === 'ilike') return typeof v === 'string' && typeof f.val === 'string' && likeRegex(f.val).test(v)
      if (f.kind === 'is') return f.val === null ? v === null || v === undefined : v === f.val
      if (f.kind === 'contains') return Array.isArray(v) && Array.isArray(f.val) && f.val.every((x) => v.includes(x))
      if (f.kind === 'in') return Array.isArray(f.val) && f.val.includes(v)
      if (f.kind === 'neq') return v !== f.val
      // `.not(col, 'is', null)` (P09b): the column has a value.
      if (f.kind === 'notnull') return v !== null && v !== undefined
      // The ordered comparisons (P09b adds lte / gt / gte): a NULL never compares, as in SQL.
      if (v === null || v === undefined) return false
      const cmp = (a: number | string, b: number | string) => (f.kind === 'lt' ? a < b : f.kind === 'lte' ? a <= b : f.kind === 'gt' ? a > b : a >= b)
      if (typeof v === 'number' && typeof f.val === 'number') return cmp(v, f.val)
      return typeof v === 'string' && typeof f.val === 'string' && cmp(v, f.val)
    })

  /** What `.select(cols)` hands back: the named columns, or `{id}` for a bare `.select()` (the legacy behaviour). */
  const project = (r: Row, cols: string[]): Row => {
    if (cols.length === 0) return { id: r.id }
    const o: Row = {}
    for (const c of cols) o[c] = r[c]
    return o
  }

  class Query implements PromiseLike<Result> {
    private op: 'select' | 'update' | 'insert' = 'select'
    private limitN: number | null = null
    private orderBy: { col: string; asc: boolean } | null = null
    private patch: Row = {}
    private filters: Filter[] = []
    private returning = false
    private returnCols: string[] = []
    private countHead = false
    constructor(private table: string) {}
    select(cols?: string, o?: { count?: string; head?: boolean }) {
      if (this.op === 'update' || this.op === 'insert') {
        this.returning = true
        this.returnCols = (cols ?? '')
          .split(',')
          .map((c) => c.trim())
          .filter((c) => c !== '')
      } else {
        selects.push({ table: this.table, cols: cols ?? '' })
        this.countHead = o?.head === true && o?.count === 'exact'
      }
      return this
    }
    update(patch: Row) {
      this.op = 'update'
      this.patch = patch
      return this
    }
    eq(col: string, val: unknown) {
      this.filters.push({ kind: 'eq', col, val })
      return this
    }
    is(col: string, val: unknown) {
      this.filters.push({ kind: 'is', col, val })
      return this
    }
    ilike(col: string, val: unknown) {
      this.filters.push({ kind: 'ilike', col, val })
      return this
    }
    in(col: string, val: unknown) {
      this.filters.push({ kind: 'in', col, val })
      return this
    }
    contains(col: string, val: unknown) {
      this.filters.push({ kind: 'contains', col, val })
      return this
    }
    limit(n: number) {
      this.limitN = n
      return this
    }
    order(col: string, o?: { ascending?: boolean }) {
      this.orderBy = { col, asc: o?.ascending !== false }
      return this
    }
    insert(row: Row) {
      this.op = 'insert'
      this.patch = row
      return this
    }
    lt(col: string, val: unknown) {
      this.filters.push({ kind: 'lt', col, val })
      return this
    }
    lte(col: string, val: unknown) {
      this.filters.push({ kind: 'lte', col, val })
      return this
    }
    gt(col: string, val: unknown) {
      this.filters.push({ kind: 'gt', col, val })
      return this
    }
    gte(col: string, val: unknown) {
      this.filters.push({ kind: 'gte', col, val })
      return this
    }
    neq(col: string, val: unknown) {
      this.filters.push({ kind: 'neq', col, val })
      return this
    }
    /** Only the form the cron uses: `.not(col, 'is', null)`. */
    not(col: string, op: string, val: unknown) {
      if (op !== 'is' || val !== null) throw new Error(`fakeEviteDb: .not(${col}, ${op}, ...) is not faked`)
      this.filters.push({ kind: 'notnull', col, val: null })
      return this
    }
    private run(): Result {
      const rows = tables[this.table] ?? []
      if (this.op === 'insert') {
        const err = injected(this.table, 'insert', { patch: this.patch })
        if (err) return { data: null, error: err }
        const base: Row = { ...(opts.rowDefaults?.[this.table]?.(this.patch) ?? {}), ...this.patch }
        const full: Row = { ...base, ...(opts.generated?.[this.table]?.(base) ?? {}) }
        const bad = opts.checks?.[this.table]?.(full)
        if (bad) return { data: null, error: { message: bad, code: '23514' } }
        for (const u of opts.uniques?.[this.table] ?? []) {
          const same = rows.some((r) =>
            u.cols.every((c) => {
              const a = r[c] ?? null
              const b = full[c] ?? null
              return a === b && (a !== null || u.nullsNotDistinct === true)
            }),
          )
          if (same) return { data: null, error: { message: `duplicate key value violates unique constraint "${u.name}"`, code: '23505' } }
        }
        inserts.push({ table: this.table, row: { ...this.patch } })
        ;(tables[this.table] ??= []).push(full)
        return { data: this.returning ? [project(full, this.returnCols)] : null, error: null }
      }
      if (this.op === 'select') {
        const err = injected(this.table, 'select', { filters: this.filters })
        if (err) return { data: null, error: err }
        let out = rows.filter((r) => matches(r, this.filters)).map((r) => ({ ...r }))
        if (this.countHead) return { data: null, error: null, count: out.length }
        if (this.orderBy) {
          const { col, asc } = this.orderBy
          out = out.sort((a, b) => (String(a[col] ?? '') < String(b[col] ?? '') ? -1 : 1) * (asc ? 1 : -1))
        }
        if (this.limitN !== null) out = out.slice(0, this.limitN)
        return { data: out, error: null }
      }
      hooks.beforeUpdate?.({ table: this.table, patch: this.patch, filters: this.filters }, tables)
      const err = injected(this.table, 'update', { patch: this.patch, filters: this.filters })
      if (err) {
        updates.push({ table: this.table, patch: this.patch, filters: this.filters, matched: -1 })
        return { data: null, error: err }
      }
      const hit = rows.filter((r) => matches(r, this.filters))
      const check = opts.checks?.[this.table]
      if (check) {
        for (const r of hit) {
          const bad = check({ ...r, ...this.patch })
          if (bad) {
            updates.push({ table: this.table, patch: this.patch, filters: this.filters, matched: -1 })
            return { data: null, error: { message: bad, code: '23514' } }
          }
        }
      }
      for (const r of hit) {
        Object.assign(r, this.patch)
        Object.assign(r, opts.generated?.[this.table]?.(r) ?? {})
      }
      updates.push({ table: this.table, patch: this.patch, filters: this.filters, matched: hit.length })
      return { data: this.returning ? hit.map((r) => project(r, this.returnCols)) : null, error: null }
    }
    maybeSingle() {
      const res = this.run()
      if (res.error) return Promise.resolve({ data: null, error: res.error })
      const list = res.data as Row[]
      return Promise.resolve({ data: list[0] ?? null, error: null })
    }
    single() {
      const res = this.run()
      if (res.error) return Promise.resolve({ data: null, error: res.error })
      const list = res.data as Row[]
      if (list.length !== 1) return Promise.resolve({ data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } })
      return Promise.resolve({ data: list[0], error: null })
    }
    then<A, B>(onF?: ((v: Result) => A | PromiseLike<A>) | null, onR?: ((r: unknown) => B | PromiseLike<B>) | null) {
      return Promise.resolve(this.run()).then(onF, onR)
    }
  }

  const supabase = {
    from: (table: string) => new Query(table),
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args })
      const fn = opts.rpcs?.[name]
      if (!fn) return { data: null, error: { message: `no such function: ${name}` } }
      return fn(args, tables)
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, body: Buffer, options: Record<string, unknown>) => {
          const err = injected('storage', 'upload', { path })
          if (err) return { data: null, error: err }
          const key = `${bucket}/${path}`
          if (uploaded.has(key) && !options.upsert) return { data: null, error: { message: 'The resource already exists' } }
          uploaded.set(key, Buffer.from(body))
          uploads.push({ bucket, path, bytes: body.length, options })
          return { data: { path }, error: null }
        },
      }),
    },
  }

  return { supabase: supabase as never, tables, updates, uploads, uploaded, selects, inserts, rpcCalls, errors, hooks }
}
