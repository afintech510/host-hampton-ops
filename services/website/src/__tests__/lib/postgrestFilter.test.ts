/**
 * `lib/postgrestFilter.ts` — the one place a value becomes part of a PostgREST
 * filter expression.
 *
 * Four call sites interpolated straight into `.or()` on 2026-09-12, one of them
 * **public and unauthenticated** (`/api/pricing?event_type=`). `.or()` does not
 * take parameters; it takes an expression PostgREST parses.
 */

import { safeFilterValue, orIlikeFilter, arrayContainsOrNullFilter } from '@/lib/postgrestFilter'

describe('safeFilterValue', () => {
  it('keeps ordinary text', () => {
    expect(safeFilterValue('Jane Smith')).toBe('Jane Smith')
    // A hyphen is not structural to PostgREST or to LIKE, so a phone number
    // typed into the search box still searches for itself.
    expect(safeFilterValue('631-555')).toBe('631-555')
    expect(safeFilterValue('kids-party')).toBe('kids-party')
  })

  it('removes every character the filter parser or LIKE reads as structure', () => {
    for (const ch of [',', '(', ')', '%', '_', '*', '\\', '.', ':', '"', "'", '{', '}', '[', ']', '<', '>', '=', '!']) {
      expect(safeFilterValue(`a${ch}b`)).toBe('a b')
    }
  })

  it('bounds the length', () => {
    expect(safeFilterValue('x'.repeat(500)).length).toBe(80)
    expect(safeFilterValue('x'.repeat(500), 10).length).toBe(10)
  })

  it('answers empty for a value made only of structure', () => {
    for (const t of ['', '   ', ',,,', '%%%', '()', '{}', null, undefined, 12.5]) {
      expect(safeFilterValue(t as unknown)).toBe(t === 12.5 ? '12 5' : '')
    }
  })
})

describe('orIlikeFilter', () => {
  it('builds one disjunct per column', () => {
    expect(orIlikeFilter(['a', 'b'], 'x')).toBe('a.ilike.*x*,b.ilike.*x*')
  })

  it('a comma in the term cannot add a disjunct', () => {
    expect(orIlikeFilter(['a'], 'x,b.eq.y').split(',')).toHaveLength(1)
    expect(orIlikeFilter(['a'], 'x,b.eq.y')).not.toContain('b.eq.y')
  })

  it('a `)` cannot close the group', () => {
    expect(orIlikeFilter(['a'], 'x)')).not.toContain(')')
  })

  it('matches NOTHING rather than everything when the term reduces to nothing', () => {
    expect(orIlikeFilter(['a'], '%')).toBe('id.is.null')
    expect(orIlikeFilter([], 'x')).toBe('id.is.null')
  })
})

describe('arrayContainsOrNullFilter', () => {
  it('builds the contains-or-universal pair', () => {
    expect(arrayContainsOrNullFilter('event_types', 'kids-party')).toBe(
      'event_types.cs.{kids-party},event_types.is.null'
    )
  })

  it('a `}` cannot end the array literal early', () => {
    const f = arrayContainsOrNullFilter('event_types', 'a},is_active.eq.false')
    expect(f).toBe('event_types.cs.{a is active eq false},event_types.is.null')
  })

  it('returns null — not an empty filter — when nothing usable is left', () => {
    // The caller then has to decide what that means. Dropping the filter and
    // returning the whole catalogue is the failure direction.
    expect(arrayContainsOrNullFilter('event_types', '{}')).toBeNull()
    expect(arrayContainsOrNullFilter('event_types', '')).toBeNull()
  })
})
