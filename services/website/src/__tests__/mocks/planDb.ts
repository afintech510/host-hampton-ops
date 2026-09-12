/**
 * A Supabase fake for the pay path.
 *
 * The existing `mocks/supabase.ts` returns one canned result per table, which is
 * not enough here: `recordPlanPayment` reads `booking_payments` BEFORE the insert
 * and again AFTER it, and the whole point of those two reads is that they differ.
 * This fake takes a QUEUE per table and records every write, so a test can assert
 * what was actually sent to the database rather than only what came back.
 *
 * It is deliberately dumb about filters — it does not simulate `.eq()`. Tests
 * that care about which row was targeted assert on the recorded `filters`.
 */

export interface Result {
  data?: unknown
  error?: { message: string; code?: string } | null
}

export interface Write {
  table: string
  op: 'insert' | 'update'
  payload: unknown
  filters: [string, unknown][]
}

export interface PlanDb {
  from: (table: string) => unknown
  writes: Write[]
  /** How many times each table was queried at all. */
  reads: Record<string, number>
}

/**
 * `results` maps a table name to the sequence of results its queries resolve to.
 * The last entry repeats once the queue is exhausted, so a test only has to
 * specify the reads it cares about.
 */
export function makePlanDb(results: Record<string, Result[]>): PlanDb {
  const writes: Write[] = []
  const reads: Record<string, number> = {}
  const cursor: Record<string, number> = {}

  const next = (table: string): Result => {
    const queue = results[table]
    if (!queue || queue.length === 0) return { data: null, error: null }
    const i = cursor[table] ?? 0
    cursor[table] = i + 1
    return queue[Math.min(i, queue.length - 1)]
  }

  const from = (table: string) => {
    reads[table] = (reads[table] ?? 0) + 1
    let op: 'insert' | 'update' | null = null
    let payload: unknown = null
    const filters: [string, unknown][] = []

    const settle = () => {
      const r = next(table)
      if (op) writes.push({ table, op, payload, filters: [...filters] })
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null })
    }

    const chain: Record<string, unknown> = {
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => settle().then(res, rej),
      catch: (rej: (e: unknown) => unknown) => settle().catch(rej),
    }
    chain.select = () => chain
    chain.insert = (p: unknown) => {
      op = 'insert'
      payload = p
      return chain
    }
    chain.update = (p: unknown) => {
      op = 'update'
      payload = p
      return chain
    }
    chain.delete = () => chain
    for (const m of ['order', 'limit', 'maybeSingle', 'single', 'range']) {
      chain[m] = () => chain
    }
    for (const m of ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is']) {
      chain[m] = (col: string, val: unknown) => {
        filters.push([`${m}:${col}`, val])
        return chain
      }
    }
    return chain
  }

  return { from, writes, reads }
}

/** The rows a write of `table` received, in order. */
export function writesTo(db: PlanDb, table: string, op?: 'insert' | 'update'): Write[] {
  return db.writes.filter(w => w.table === table && (!op || w.op === op))
}
