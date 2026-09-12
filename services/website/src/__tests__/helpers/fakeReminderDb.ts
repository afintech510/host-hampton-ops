/**
 * A fake Supabase that models the DATABASE, not the happy path.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT HAD TO BE THIS AND NOT A jest.fn(). The reminder engine shipped with a
 * green suite and had, five months later, never written a single row. Every
 * insert was rejected by Postgres — `reference_id` was `uuid` and the code wrote
 * booking refs — and the mock the tests used was:
 *
 *     c.insert = jest.fn(() => Promise.resolve({ error: null }))
 *
 * which accepts anything. It modelled no column type, no CHECK constraint, no
 * unique index and no collation, so it could not possibly disagree with the
 * code. That is hard-won rule 8 in its third form: a test that passes is not
 * behaviour the database agrees with.
 *
 * So this store carries the constraints as they really are in production,
 * copied from `information_schema` / `pg_constraint` / `pg_indexes` on
 * 2026-09-12, and it is configurable so a regression test can pin the *old*
 * schema and prove the old code would have been rejected by it.
 *
 * Modelled:
 *   - column TYPES, with uuid rejecting a non-uuid (SQLSTATE 22P02)
 *   - CHECK constraints (SQLSTATE 23514)
 *   - the partial unique index (SQLSTATE 23505)
 *   - `.eq()` on text being case-SENSITIVE, and `.ilike()` being
 *     case-insensitive with `_` and `%` as wildcards — the distinction that hid
 *     the unsubscribe bug in `docs/phase-4-campaign-automation.md` §11.1
 *   - `update … where` returning ONLY the rows it really updated, which is what
 *     makes the claim in `lib/reminderQueue.ts` a claim and not a wish
 */

export interface PgError {
  code: string
  message: string
}

type Row = Record<string, any>

export type ColumnType = 'uuid' | 'text' | 'timestamptz' | 'int' | 'bool'

export interface TableSpec {
  columns: Record<string, ColumnType>
  checks?: { name: string; column: string; allowed: string[] }[]
  /** Unique index over these columns, optionally only over rows passing `where`. */
  uniques?: { name: string; columns: string[]; where?: (r: Row) => boolean }[]
  defaults?: Record<string, any>
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The live `scheduled_reminders` shape AFTER migration 044. Pass
 * `{ legacyUuidReferenceId: true }` to `makeFakeDb` for the shape that was live
 * from the phase shipping until 2026-09-12.
 */
export function scheduledRemindersSpec(opts: { legacyUuidReferenceId?: boolean } = {}): TableSpec {
  return {
    columns: {
      id: 'uuid',
      contact_id: 'uuid',
      reminder_type: 'text',
      reference_type: 'text',
      reference_id: opts.legacyUuidReferenceId ? 'uuid' : 'text',
      scheduled_for: 'timestamptz',
      status: 'text',
      sent_at: 'timestamptz',
      channel: 'text',
      created_at: 'timestamptz',
      attempts: 'int',
      last_outcome: 'text',
      last_error: 'text',
      claimed_at: 'timestamptz',
    },
    defaults: { status: 'pending', attempts: 0 },
    checks: [
      {
        name: 'scheduled_reminders_channel_check',
        column: 'channel',
        allowed: ['email', 'sms'],
      },
      {
        name: 'scheduled_reminders_reference_type_check',
        column: 'reference_type',
        // Migration 044. Before it: ['event_ticket', 'booking'] — which is why
        // every event reminder was answered 23514.
        allowed: opts.legacyUuidReferenceId ? ['event_ticket', 'booking'] : ['event', 'booking'],
      },
      {
        name: 'scheduled_reminders_status_check',
        column: 'status',
        allowed: opts.legacyUuidReferenceId
          ? ['pending', 'sent', 'failed', 'cancelled']
          : ['pending', 'sending', 'sent', 'failed', 'cancelled'],
      },
      {
        name: 'scheduled_reminders_reminder_type_check',
        column: 'reminder_type',
        allowed: [
          'event_email_3day', 'event_email_dayof', 'event_sms_1day', 'event_sms_2hr',
          'booking_email_7day', 'booking_email_1day', 'booking_sms_1day',
          'party_balance_t2', 'party_balance_t1', 'party_admin_unpaid_dayof',
          'party_thank_you_t1', 'review_request_sms',
          'birthday_rebook_email', 'birthday_rebook_sms',
          'checkin_link_36hr', 'checkin_link_dayof',
        ],
      },
    ],
    uniques: opts.legacyUuidReferenceId
      ? [
          {
            name: 'uniq_birthday_rebook_reminder',
            columns: ['contact_id', 'reminder_type', 'reference_id'],
            where: r => ['birthday_rebook_email', 'birthday_rebook_sms'].includes(r.reminder_type),
          },
          {
            name: 'uniq_checkin_link_reminder',
            columns: ['contact_id', 'reminder_type', 'reference_id'],
            where: r => ['checkin_link_36hr', 'checkin_link_dayof'].includes(r.reminder_type),
          },
        ]
      : [
          {
            name: 'uniq_scheduled_reminder_once',
            columns: ['contact_id', 'reminder_type', 'reference_id'],
            where: r => r.status !== 'cancelled',
          },
        ],
  }
}

/** PostgREST's `ilike` pattern → RegExp. `_` is ONE char, `%` is any run. */
function likeToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp('^' + escaped.replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i')
}

let seq = 0
function newUuid(): string {
  seq++
  const h = seq.toString(16).padStart(12, '0')
  return `00000000-0000-4000-8000-${h}`
}

export interface FakeDb {
  supabase: any
  tables: Record<string, Row[]>
  /** Every insert that was REFUSED, with the SQLSTATE. The thing the old mock could not show. */
  refusals: { table: string; error: PgError; row: Row }[]
  /** Force the next read on a table to fail, to exercise rule 12. */
  failReads: (table: string, error?: PgError) => void
  /** Force the next insert on a table to fail — a write blip is not a read blip. */
  failWrites: (table: string, error?: PgError) => void
}

export function makeFakeDb(
  specs: Record<string, TableSpec>,
  seed: Record<string, Row[]> = {}
): FakeDb {
  const tables: Record<string, Row[]> = {}
  for (const t of Object.keys({ ...specs, ...seed })) tables[t] = [...(seed[t] ?? [])]
  const refusals: FakeDb['refusals'] = []
  const readFailures: Record<string, PgError> = {}
  const writeFailures: Record<string, PgError> = {}

  function typeError(table: string, column: string, type: ColumnType, value: any): PgError | null {
    if (value === null || value === undefined) return null
    if (type === 'uuid' && !UUID_RE.test(String(value))) {
      return { code: '22P02', message: `invalid input syntax for type uuid: "${value}"` }
    }
    if (type === 'int' && !Number.isInteger(Number(value))) {
      return { code: '22P02', message: `invalid input syntax for type integer: "${value}"` }
    }
    void table, column
    return null
  }

  function validate(table: string, row: Row): PgError | null {
    const spec = specs[table]
    if (!spec) return null

    for (const [col, value] of Object.entries(row)) {
      const type = spec.columns[col]
      if (!type) return { code: '42703', message: `column "${col}" of relation "${table}" does not exist` }
      const te = typeError(table, col, type, value)
      if (te) return te
    }

    for (const chk of spec.checks ?? []) {
      const v = row[chk.column]
      if (v === undefined || v === null) continue
      if (!chk.allowed.includes(String(v))) {
        return {
          code: '23514',
          message: `new row for relation "${table}" violates check constraint "${chk.name}"`,
        }
      }
    }

    for (const uq of spec.uniques ?? []) {
      if (uq.where && !uq.where(row)) continue
      const clash = tables[table].some(
        existing =>
          (!uq.where || uq.where(existing)) &&
          uq.columns.every(c => existing[c] === row[c])
      )
      if (clash) {
        return {
          code: '23505',
          message: `duplicate key value violates unique constraint "${uq.name}"`,
        }
      }
    }

    return null
  }

  function buildQuery(table: string) {
    const preds: ((r: Row) => boolean)[] = []
    let limit: number | null = null
    let orderKey: string | null = null
    let orderAsc = true

    const q: any = {
      select(_cols?: string) { return q },
      // Case-SENSITIVE, exactly like Postgres on a text column.
      eq(k: string, v: any) { preds.push(r => r[k] === v); return q },
      neq(k: string, v: any) { preds.push(r => r[k] !== v); return q },
      ilike(k: string, pattern: string) {
        const re = likeToRegExp(pattern)
        preds.push(r => re.test(String(r[k] ?? '')))
        return q
      },
      in(k: string, vals: any[]) { preds.push(r => vals.includes(r[k])); return q },
      /**
       * `.is(col, null)` — NULL is not a value `.eq()` can match, in PostgREST
       * or in Postgres. `undefined` counts as NULL here because a row inserted
       * without a nullable column simply has no property for it.
       */
      is(k: string, v: any) {
        if (v === null) preds.push(r => r[k] === null || r[k] === undefined)
        else preds.push(r => r[k] === v)
        return q
      },
      lte(k: string, v: any) { preds.push(r => String(r[k]) <= String(v)); return q },
      gte(k: string, v: any) { preds.push(r => String(r[k]) >= String(v)); return q },
      not(k: string, op: string, v: any) {
        if (op === 'is' && v === null) preds.push(r => r[k] !== null && r[k] !== undefined)
        else if (op === 'in') {
          const vals = String(v).replace(/^\(|\)$/g, '').split(',').map(s => s.trim())
          preds.push(r => !vals.includes(String(r[k])))
        }
        return q
      },
      order(k: string, o?: { ascending?: boolean }) { orderKey = k; orderAsc = o?.ascending !== false; return q },
      limit(n: number) { limit = n; return q },
      rows(): { data: Row[] | null; error: PgError | null } {
        if (readFailures[table]) {
          const error = readFailures[table]
          delete readFailures[table]
          return { data: null, error }
        }
        let out = tables[table].filter(r => preds.every(p => p(r)))
        if (orderKey) {
          const k = orderKey
          out = [...out].sort((a, b) =>
            (orderAsc ? 1 : -1) * String(a[k] ?? '').localeCompare(String(b[k] ?? ''))
          )
        }
        if (limit !== null) out = out.slice(0, limit)
        return { data: out.map(r => ({ ...r })), error: null }
      },
      maybeSingle() {
        const { data, error } = q.rows()
        if (error) return Promise.resolve({ data: null, error })
        return Promise.resolve({ data: data!.length ? data![0] : null, error: null })
      },
      single() {
        const { data, error } = q.rows()
        if (error) return Promise.resolve({ data: null, error })
        if (!data!.length) {
          return Promise.resolve({ data: null, error: { code: 'PGRST116', message: 'no rows returned' } })
        }
        return Promise.resolve({ data: data![0], error: null })
      },
      then(res: any, rej: any) {
        const { data, error } = q.rows()
        return Promise.resolve({ data, error }).then(res, rej)
      },
    }
    return q
  }

  function from(table: string): any {
    if (!tables[table]) tables[table] = []

    return {
      select: (cols?: string) => buildQuery(table).select(cols),

      insert(rows: Row | Row[]) {
        if (writeFailures[table]) {
          const error = writeFailures[table]
          delete writeFailures[table]
          refusals.push({ table, error, row: Array.isArray(rows) ? rows[0] : rows })
          return makeThenable({ data: null, error })
        }
        const list = Array.isArray(rows) ? rows : [rows]
        const spec = specs[table]
        const staged: Row[] = []
        for (const raw of list) {
          // `created_at` is supplied only when the table really HAS one. Not
          // every table names its timestamp that way — `variant_assignments`
          // has `assigned_at` and `variant_events` has `occurred_at` — and
          // injecting a column the spec does not declare made this store answer
          // 42703 on a row Postgres accepts, which is a fake that disagrees
          // with the database in the opposite direction from the one that cost
          // five months. A fake is only useful while it is right both ways.
          const hasCreatedAt = !spec || 'created_at' in spec.columns
          const row: Row = {
            id: newUuid(),
            ...(hasCreatedAt ? { created_at: new Date().toISOString() } : {}),
            ...(spec?.defaults ?? {}),
            ...raw,
          }
          const err = validate(table, row)
          if (err) {
            refusals.push({ table, error: err, row })
            // A single statement: one bad row loses the whole batch, as in PG.
            return makeThenable({ data: null, error: err })
          }
          staged.push(row)
        }
        tables[table].push(...staged)
        return makeThenable({ data: staged.map(r => ({ ...r })), error: null })
      },

      update(payload: Row) {
        const preds: ((r: Row) => boolean)[] = []
        const u: any = {
          eq(k: string, v: any) { preds.push(r => r[k] === v); return u },
          in(k: string, vals: any[]) { preds.push(r => vals.includes(r[k])); return u },
          neq(k: string, v: any) { preds.push(r => r[k] !== v); return u },
          apply() {
            const hit = tables[table].filter(r => preds.every(p => p(r)))
            for (const r of hit) Object.assign(r, payload)
            return hit.map(r => ({ ...r }))
          },
          // `.select()` after an update returns the rows that were REALLY
          // updated — zero of them when another writer got there first, which is
          // the whole basis of the claim.
          select(_cols?: string) {
            const updated = u.apply()
            return makeThenable({ data: updated, error: null })
          },
          then(res: any, rej: any) {
            const updated = u.apply()
            return Promise.resolve({ data: updated, error: null }).then(res, rej)
          },
        }
        return u
      },
    }
  }

  function makeThenable(result: { data: any; error: PgError | null }) {
    return {
      select: () => makeThenable(result),
      single: () => Promise.resolve({ data: Array.isArray(result.data) ? result.data[0] ?? null : result.data, error: result.error }),
      maybeSingle: () => Promise.resolve({ data: Array.isArray(result.data) ? result.data[0] ?? null : result.data, error: result.error }),
      then: (res: any, rej: any) => Promise.resolve(result).then(res, rej),
    }
  }

  return {
    supabase: { from },
    tables,
    refusals,
    failReads(table: string, error: PgError = { code: '57014', message: 'canceling statement due to statement timeout' }) {
      readFailures[table] = error
    },
    failWrites(table: string, error: PgError = { code: '57014', message: 'canceling statement due to statement timeout' }) {
      writeFailures[table] = error
    },
  }
}
