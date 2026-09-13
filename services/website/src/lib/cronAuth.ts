import type { NextRequest } from 'next/server'

/**
 * "Is this caller the scheduler?" — asked once, here.
 *
 * It was asked FOURTEEN times before 2026-09-13, once per file under
 * `src/app/api/cron/**`, in two different spellings:
 *
 *   seven routes   return !!process.env.CRON_SECRET && secret === process.env.CRON_SECRET
 *   seven routes   return secret === process.env.CRON_SECRET
 *
 * `agent-distill`'s own comment explains why the first half exists — *"without
 * it an unset secret makes the route world-callable to anyone who sends no
 * header at all"* — and sat four files away from seven copies that do not have
 * it. That is hard-won rule 11's sharpest form and link 18 found the identical
 * shape on the admin surface: a concept defined more than once is a concept
 * nothing is checking.
 *
 * Measured, rather than reasoned about (see `cronSurface.test.ts` R2 and
 * `scripts/attack-cron-tripwire.js`): with `CRON_SECRET` unset the guardless
 * form is **not** currently bypassable, because `Headers.get()` and
 * `URLSearchParams.get()` both return `null` for an absent value and
 * `null === undefined` is false. It is one refactor away from being bypassable
 * — a `?? ''`, a default, a caller that passes a plain object — and the routes
 * behind it lock real customers' bookings, text real customers and mail 944
 * people. The guard is cheap and the failure is not.
 *
 * Both transports are accepted because cron-job.org is configured with both
 * across the existing jobs: the `x-cron-secret` header and `?secret=`.
 */
export function isCronAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET
  // An unset CRON_SECRET must not make "send nothing" a valid credential.
  if (!expected) return false

  const secret = req.headers.get('x-cron-secret') || req.nextUrl.searchParams.get('secret')
  return secret === expected
}
