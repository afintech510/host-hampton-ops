/**
 * An in-memory fake of the slice of Supabase `renderEvite` talks to: five tables
 * (filters `eq` / `is` / `lt`, `select`, `update`, `maybeSingle`) and the storage
 * `upload`. It records every UPDATE and every upload, can inject an error on a
 * named call, and can run a hook just before an update to simulate another worker.
 *
 * It also fakes `contains` (array containment), `order`, `limit` and `insert` for the public-page tests.
 *
 * Deliberately faithful to the one thing the pipeline depends on: an UPDATE only
 * touches rows that match ALL its filters, and `.select('id')` returns exactly
 * the rows it touched (so "zero rows" is expressible).
 */

type Row = Record<string, unknown>
type Filter = { kind: 'eq' | 'is' | 'lt' | 'contains'; col: string; val: unknown }

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

export function makeFakeEviteDb(opts: FakeEviteDbOptions) {
  const tables: Record<string, Row[]> = {}
  for (const [name, rows] of Object.entries(opts.tables)) tables[name] = rows.map((r) => ({ ...r }))

  const updates: UpdateRecord[] = []
  const uploads: UploadRecord[] = []
  const uploaded = new Map<string, Buffer>()
  const selects: Array<{ table: string; cols: string }> = []
  const inserts: Array<{ table: string; row: Row }> = []
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
      const v = row[f.col]
      if (f.kind === 'eq') return v === f.val
      if (f.kind === 'is') return f.val === null ? v === null || v === undefined : v === f.val
      if (f.kind === 'contains') return Array.isArray(v) && Array.isArray(f.val) && f.val.every((x) => v.includes(x))
      return typeof v === 'string' && typeof f.val === 'string' && v < f.val
    })

  class Query implements PromiseLike<{ data: unknown; error: { message: string } | null }> {
    private op: 'select' | 'update' | 'insert' = 'select'
    private limitN: number | null = null
    private orderBy: { col: string; asc: boolean } | null = null
    private patch: Row = {}
    private filters: Filter[] = []
    private returning = false
    constructor(private table: string) {}
    select(cols?: string) {
      if (this.op === 'update') this.returning = true
      else selects.push({ table: this.table, cols: cols ?? '' })
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
    private run(): { data: unknown; error: { message: string } | null } {
      const rows = tables[this.table] ?? []
      if (this.op === 'insert') {
        const err = injected(this.table, 'insert', { patch: this.patch })
        if (err) return { data: null, error: err }
        inserts.push({ table: this.table, row: { ...this.patch } })
        ;(tables[this.table] ??= []).push({ ...this.patch })
        return { data: null, error: null }
      }
      if (this.op === 'select') {
        const err = injected(this.table, 'select', { filters: this.filters })
        if (err) return { data: null, error: err }
        let out = rows.filter((r) => matches(r, this.filters)).map((r) => ({ ...r }))
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
      for (const r of hit) Object.assign(r, this.patch)
      updates.push({ table: this.table, patch: this.patch, filters: this.filters, matched: hit.length })
      return { data: this.returning ? hit.map((r) => ({ id: r.id })) : null, error: null }
    }
    maybeSingle() {
      const res = this.run()
      if (res.error) return Promise.resolve({ data: null, error: res.error })
      const list = res.data as Row[]
      return Promise.resolve({ data: list[0] ?? null, error: null })
    }
    then<A, B>(onF?: ((v: { data: unknown; error: { message: string } | null }) => A | PromiseLike<A>) | null, onR?: ((r: unknown) => B | PromiseLike<B>) | null) {
      return Promise.resolve(this.run()).then(onF, onR)
    }
  }

  const supabase = {
    from: (table: string) => new Query(table),
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

  return { supabase: supabase as never, tables, updates, uploads, uploaded, selects, inserts, errors, hooks }
}
