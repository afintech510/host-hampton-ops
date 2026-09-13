/**
 * Building a PostgREST filter expression out of a value somebody else chose.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `.or()` does not take parameters. It takes a RAW filter expression, and
 * PostgREST parses it: a comma starts a new disjunct, `)` closes the group, `.`
 * separates column from operator from value, and inside an `ilike` value `%`
 * and `_` are LIKE wildcards. So interpolating anything into one is the same
 * family as `.ilike('contact_email', cookieEmail)` as an authorization filter —
 * the value gets to rewrite the query (AGENTS.md §11, link 15's own patch).
 *
 * Four call sites were doing it on 2026-09-12, and one of them was **public**:
 *
 *   - `/api/admin/contacts`     search box  → four columns
 *   - `/api/admin/financials`   search box  → three columns
 *   - `/api/admin/gift-cards`   search box  → five columns
 *   - `/api/pricing`            `?event_type=` — no auth at all, and the value
 *     went into `event_types.cs.{…}`, where a `}` or a `,` ends the array
 *     literal and starts a new disjunct.
 *
 * The structural characters are REMOVED rather than escaped. These are search
 * terms typed into a box and enum-ish identifiers from a query string; none of
 * them is worth a character class that has to be exactly right forever.
 */

/** Characters that mean something to the PostgREST filter parser or to LIKE. */
const STRUCTURAL = /[,()%_*\\.:"'{}[\]<>=!]/g

/**
 * A search term reduced to something that can only ever be a value.
 * Returns `''` when nothing usable is left, which callers must treat as
 * "match nothing" and never as "no filter".
 */
export function safeFilterValue(term: unknown, maxLength = 80): string {
  return String(term ?? '')
    .replace(STRUCTURAL, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

/**
 * `col.ilike.*term*` across `columns`, joined for `.or()`.
 *
 * When the term reduces to nothing, the filter is `id.is.null` — which matches
 * NOTHING. Returning an empty string here would drop the filter entirely and
 * hand back the unfiltered table, which is the failure direction.
 */
export function orIlikeFilter(columns: string[], term: unknown): string {
  const safe = safeFilterValue(term)
  if (!safe || columns.length === 0) return 'id.is.null'
  return columns.map(col => `${col}.ilike.*${safe}*`).join(',')
}

/**
 * `col.cs.{value}` OR `col.is.null` — "this array column contains `value`, or
 * the row is universal". `/api/pricing` builds this from a **public,
 * unauthenticated** `?event_type=`, where a `}` ends the array literal and a
 * `,` starts a new disjunct.
 *
 * Returns `null` when the value reduces to nothing, so the caller must decide
 * explicitly what that means rather than dropping the filter and returning the
 * whole table.
 *
 * It lives here rather than being interpolated at the call site so that
 * "no template literal is ever passed to `.or()`" can stay an ABSOLUTE rule
 * with no exemptions — an exemption is what let link 13's and link 14's
 * tripwires excuse a whole file.
 */
export function arrayContainsOrNullFilter(column: string, value: unknown): string | null {
  const safe = safeFilterValue(value, 60)
  if (!safe) return null
  return `${column}.cs.{${safe}},${column}.is.null`
}
