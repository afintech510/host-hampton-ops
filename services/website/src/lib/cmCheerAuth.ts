/**
 * The credential on the CM Cheer / LI High order book.
 *
 * ── WHAT WAS LIVE ──
 *
 * `/api/cm-cheer-orders` (GET, `select('*')`) and `/api/cm-cheer-orders/[id]`
 * (PATCH, sets `status` to `paid`/`cancelled`) each carried their own copy of:
 *
 *     const CM_PASSWORD = process.env.CM_CHEER_PASSWORD || 'cmcheer2026'
 *     return auth === `Bearer ${CM_PASSWORD}`
 *
 * Measured on 2026-09-13: **`CM_CHEER_PASSWORD` is not set in the container.**
 * So the fallback was not a fallback, it was the production credential — a
 * literal string in the repository, over `cm_cheer_orders`, which holds **21 real
 * orders (15 of them `paid`)** with each customer's athlete name, parent name,
 * email and phone number. One `curl -H 'Authorization: Bearer …'` read all of it,
 * and the PATCH beside it could mark any order paid or cancel it.
 *
 * Three separate defects, and the third is the one that made the other two
 * matter: a default credential in source; the same check written twice (rule 11 —
 * "is this an admin" was already answered in five places, four of them wrong);
 * and no fail-closed guard, which is exactly what `isAdminAuthorized` documents
 * in a comment four files away (rule 8, for the thirteenth time in this chain).
 *
 * ── WHAT IT IS NOW ──
 *
 * One definition. **Fails closed when `CM_CHEER_PASSWORD` is unset**, and also
 * accepts Adam's ordinary admin credential (`ADMIN_PASSWORD` bearer or a signed
 * `hh_admin` cookie) so the order book is reachable from an admin session without
 * a second secret having to be remembered.
 *
 * Note the shape of the comparison: `expected` is checked for emptiness BEFORE it
 * is compared, because `undefined !== undefined` is false and that is how an
 * unset credential becomes a passing check (link 18 found four admin routes like
 * that; link 19 found seven cron ones).
 */

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { isAdminAuthorized } from '@/lib/adminAuth'

/** Columns the order book is allowed to hand out. */
export const CM_CHEER_ORDER_COLUMNS = [
  'id',
  'order_ref',
  'team',
  'athlete_name',
  'parent_name',
  'email',
  'phone',
  'payment_method',
  'items',
  'subtotal_cents',
  /**
   * Delivery is DELIBERATELY on this list, unlike `cost_cents` / `profit_cents`.
   *
   * The rule the route documents is that a column added by a migration stays
   * private until somebody decides otherwise, and this is that decision: where
   * an order is going is the organizer's job to act on — the delivery run is
   * theirs to drive — and the $7 is the PTO's money, not Host Hampton's margin.
   * Withholding it would leave the dashboard unable to answer the one new
   * question the feature creates.
   */
  'delivery_method',
  'delivery_address',
  'delivery_fee_cents',
  'status',
  'status_note',
  'notes',
  'created_at',
  'updated_at',
].join(', ')

export function isCmCheerAuthorized(req: NextRequest): boolean {
  // Adam's own credential always works.
  if (isAdminAuthorized(req)) return true

  const expected = process.env.CM_CHEER_PASSWORD
  // FAIL CLOSED. Without this, an unset variable makes the comparison below
  // `'Bearer undefined' === 'Bearer undefined'` for a caller who guesses it, and
  // there is no value of the header that should ever open an unconfigured door.
  if (!expected) {
    console.error('cm-cheer: CM_CHEER_PASSWORD is not set — refusing every request to the order book')
    return false
  }

  const auth = req.headers.get('authorization')
  if (!auth) return false
  return auth === `Bearer ${expected}`
}

export function cmCheerUnauthorized(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
