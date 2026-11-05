// spend.mjs - the spend guard. Nothing calls a paid model without passing through here.
//
//   * DRY-RUN IS THE DEFAULT. A command prints its plan and estimated cost and exits unless it
//     is given --yes.
//   * A per-invocation ceiling (--max-usd, default 1.00): the plan's total estimate must fit.
//   * A per-day ceiling (IMAGE_TOOLS_DAILY_USD_CAP, default 5.00), summed from the ledger by UTC
//     date, so a loop that is re-run all afternoon still stops.
//   * An UNREADABLE ledger stops the run. "Could not read what I spent" is not "I spent nothing";
//     the same rule the booking agent's daily budget follows.
//   * The ledger records ESTIMATES (the API returns no price). Reconcile against the Replicate
//     billing dashboard, which is the only source of truth.
//
// The ledger is JSON lines under audit_scratch/image-tools/ (gitignored). It holds the model,
// the estimate, the prediction id and a short prompt preview. Never a key, never a data URI.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { outRoot } from './env.mjs'

export const DEFAULT_MAX_USD = 1.0
export const DEFAULT_DAILY_CAP_USD = 5.0

export function ledgerPath() {
  return join(outRoot(), 'ledger.jsonl')
}

export function dailyCap() {
  const raw = process.env.IMAGE_TOOLS_DAILY_USD_CAP
  if (raw === undefined || raw === '') return DEFAULT_DAILY_CAP_USD
  const n = Number(raw)
  // An unusable override falls back to the default; it never means "no cap".
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DAILY_CAP_USD
}

/** All ledger rows. Throws if the file exists but cannot be parsed. */
export function readLedger() {
  const file = ledgerPath()
  if (!existsSync(file)) return []
  const rows = []
  for (const [i, line] of readFileSync(file, 'utf8').split(/\r?\n/).entries()) {
    if (!line.trim()) continue
    try {
      rows.push(JSON.parse(line))
    } catch {
      throw new Error(`ledger ${file} line ${i + 1} is not valid JSON - refusing to guess what was spent`)
    }
  }
  return rows
}

const utcDay = (d = new Date()) => d.toISOString().slice(0, 10)

export function spentToday(rows = readLedger()) {
  const today = utcDay()
  return rows.filter((r) => r.day === today && r.ok !== false).reduce((s, r) => s + (Number(r.usd) || 0), 0)
}

/**
 * Decide whether a plan may run.
 * @param {{usd:number}[]} calls   the planned calls, each with its estimate
 * @param {{maxUsd?:number}} opts
 * @returns {{ok:boolean, total:number, today:number, cap:number, reasons:string[]}}
 */
export function checkBudget(calls, { maxUsd = DEFAULT_MAX_USD } = {}) {
  const total = calls.reduce((s, c) => s + c.usd, 0)
  const reasons = []
  let today = 0
  try {
    today = spentToday()
  } catch (e) {
    reasons.push(e.message)
  }
  const cap = dailyCap()
  if (total > maxUsd + 1e-9) {
    reasons.push(`plan estimate $${total.toFixed(2)} exceeds --max-usd $${maxUsd.toFixed(2)}`)
  }
  if (today + total > cap + 1e-9) {
    reasons.push(`plan $${total.toFixed(2)} + already spent today $${today.toFixed(2)} exceeds the daily cap $${cap.toFixed(2)}`)
  }
  return { ok: reasons.length === 0, total, today, cap, reasons }
}

/** Append one row. Called AFTER a call, with ok:false for a failure (which may still have billed;
 *  a failed row is excluded from the day's total only because Replicate does not bill failures). */
export function record(row) {
  mkdirSync(outRoot(), { recursive: true })
  const full = { ts: new Date().toISOString(), day: utcDay(), ...row }
  appendFileSync(ledgerPath(), JSON.stringify(full) + '\n')
  return full
}
