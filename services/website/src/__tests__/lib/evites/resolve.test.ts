import { resolveEviteBySlug } from '@/lib/evites/resolve'
import { EVITE_PAGE_COLUMNS } from '@/lib/evites/views'
import { readSrc } from '../../helpers/sourceScan'
import { makeFakeEviteDb } from '../../helpers/fakeEviteDb'
import { bookingRow, evitesRow, LINE_ITEM_ROWS, NOW, THEME_ROWS } from '../../helpers/eviteFixtures'

/**
 * `resolveEviteBySlug` (spec §7.4): the one door from a slug to an invitation.
 * Every unavailable outcome is the SAME `notFound`; every read error THROWS.
 */

const saved = { pages: process.env.EVITES_PAGES, pilot: process.env.EVITES_PILOT_REFS }
beforeEach(() => {
  process.env.EVITES_PAGES = 'on'
  delete process.env.EVITES_PILOT_REFS
})
afterEach(() => {
  if (saved.pages === undefined) delete process.env.EVITES_PAGES
  else process.env.EVITES_PAGES = saved.pages
  if (saved.pilot === undefined) delete process.env.EVITES_PILOT_REFS
  else process.env.EVITES_PILOT_REFS = saved.pilot
})

const PAID = [{ booking_id: 'bk-1', amount_cents: 25000, payment_type: 'deposit' }]

function dbFor(over: { evite?: Record<string, unknown>; booking?: Record<string, unknown>; payments?: unknown[]; extraEvites?: Record<string, unknown>[] } = {}) {
  return makeFakeEviteDb({
    tables: {
      evites: [evitesRow({ previous_slugs: [], ...over.evite }), ...(over.extraEvites ?? [])],
      bookings: [bookingRow(over.booking)],
      booking_payments: (over.payments ?? PAID) as Record<string, unknown>[],
      booking_line_items: LINE_ITEM_ROWS,
      party_themes: THEME_ROWS,
    },
  })
}

const resolve = (db: ReturnType<typeof dbFor>, slug = 'mia-glow-7kq2') => resolveEviteBySlug(db.supabase, slug, { now: NOW })

describe('resolveEviteBySlug - ok', () => {
  it('a booked, timed party is live and carries the rows the page needs', async () => {
    const out = await resolve(dbFor())
    expect(out.kind).toBe('ok')
    if (out.kind !== 'ok') return
    expect(out.state).toBe('live')
    expect(out.evite.slug).toBe('mia-glow-7kq2')
    expect(out.booking.booking_ref).toBe('HH-TEST-1')
    expect(out.payments).toHaveLength(1)
    expect(out.lineItems.length).toBeGreaterThan(0)
    expect(out.partyThemes.length).toBeGreaterThan(0)
    expect(out.facts.honoreeDisplay).toBe('MIA')
    expect(out.facts.dateLine).toBe('Saturday, November 14 · 2–4 PM')
  })

  it('reads the evite through the page allow-list, never `*`, and never a render-in-flight column', async () => {
    const db = dbFor()
    await resolve(db)
    const evitesRead = db.selects.find((s) => s.table === 'evites')
    expect(evitesRead?.cols).toBe(EVITE_PAGE_COLUMNS.join(', '))
    for (const secret of ['render_claim', 'render_error', 'cal_inputs_hash', 'previous_slugs', 'cancelled_notice_at']) {
      expect(evitesRead?.cols).not.toContain(secret)
    }
    for (const s of db.selects) expect(s.cols).not.toBe('*')
  })

  it('an unpaid booking is a preview; a booked one with no parseable time needs a time; a past one is closed', async () => {
    const preview = await resolve(dbFor({ booking: { status: 'awaiting_deposit' }, payments: [] }))
    expect(preview.kind === 'ok' && preview.state).toBe('preview')
    if (preview.kind === 'ok') expect(preview.facts.dateLine).toBe('Pick your date')

    const needsTime = await resolve(dbFor({ booking: { party_time: 'Evening' } }))
    expect(needsTime.kind === 'ok' && needsTime.state).toBe('needs_time')

    const closed = await resolveEviteBySlug(dbFor().supabase, 'mia-glow-7kq2', { now: new Date('2026-11-20T12:00:00Z') })
    expect(closed.kind === 'ok' && closed.state).toBe('closed')
  })
})

describe('resolveEviteBySlug - every unavailable outcome is the SAME notFound', () => {
  const NOT_FOUND = { kind: 'notFound' }

  it('a string that is not a slug never touches the database', async () => {
    const db = dbFor()
    for (const bad of ['', 'x', 'MIA-GLOW-7KQ2', 'mia-glow-7kqu', '../etc/passwd', 'a'.repeat(60), 'mia glow 7kq2']) {
      expect(await resolve(db, bad)).toEqual(NOT_FOUND)
    }
    expect(db.selects).toHaveLength(0)
  })

  it('the pages flag OFF never touches the database', async () => {
    process.env.EVITES_PAGES = 'off'
    const db = dbFor()
    expect(await resolve(db)).toEqual(NOT_FOUND)
    expect(db.selects).toHaveLength(0)
  })

  it('unknown, archived, cancelled, lost and non-pilot all answer identically', async () => {
    const unknown = await resolve(dbFor(), 'zed-glow-7kq2')
    const archived = await resolve(dbFor({ evite: { archived_at: '2026-10-01T00:00:00Z' } }))
    const cancelled = await resolve(dbFor({ booking: { status: 'cancelled' } }))
    const lost = await resolve(dbFor({ booking: { status: 'lost' } }))
    process.env.EVITES_PAGES = 'pilot'
    process.env.EVITES_PILOT_REFS = 'HH-OTHER-9'
    const notPilot = await resolve(dbFor())
    for (const out of [unknown, archived, cancelled, lost, notPilot]) expect(out).toEqual(NOT_FOUND)
    // ...and the pilot booking itself IS served.
    process.env.EVITES_PILOT_REFS = 'hh-test-1'
    expect((await resolve(dbFor())).kind).toBe('ok')
  })
})

describe('resolveEviteBySlug - aliases (previous_slugs)', () => {
  const renamed = { slug: 'mia-glow-9zzz', previous_slugs: ['mia-glow-7kq2'] }

  it('an old slug redirects to the current one', async () => {
    const out = await resolve(dbFor({ evite: renamed }))
    expect(out).toEqual({ kind: 'redirect', slug: 'mia-glow-9zzz' })
  })

  it('the current slug is served directly, not redirected', async () => {
    const out = await resolve(dbFor({ evite: renamed }), 'mia-glow-9zzz')
    expect(out.kind).toBe('ok')
  })

  it('an alias of a party that is no longer visible is notFound, not a redirect that confirms the old slug was real', async () => {
    const cancelled = await resolve(dbFor({ evite: renamed, booking: { status: 'cancelled' } }))
    const archived = await resolve(dbFor({ evite: { ...renamed, archived_at: '2026-10-01T00:00:00Z' } }))
    expect(cancelled).toEqual({ kind: 'notFound' })
    expect(archived).toEqual({ kind: 'notFound' })
  })

  it('an exact slug wins over an alias held by someone else', async () => {
    const db = dbFor({
      extraEvites: [evitesRow({ id: 'ev-2', booking_id: 'bk-1', slug: 'zed-glow-3abc', previous_slugs: ['mia-glow-7kq2'] })],
    })
    const out = await resolve(db)
    expect(out.kind).toBe('ok')
    if (out.kind === 'ok') expect(out.evite.slug).toBe('mia-glow-7kq2')
  })

  it('an alias that points at something that is not a slug is notFound', async () => {
    const out = await resolve(dbFor({ evite: { slug: 'NOT A SLUG', previous_slugs: ['mia-glow-7kq2'] } }))
    expect(out).toEqual({ kind: 'notFound' })
  })
})

describe('resolveEviteBySlug - a read error THROWS (a 500, never a mis-stated 404 or preview)', () => {
  it.each([
    ['evites', 'evites'],
    ['bookings', 'bookings'],
    ['booking_payments', 'booking_payments'],
    ['booking_line_items', 'read failed'],
    ['party_themes', 'read failed'],
  ])('%s', async (table, needle) => {
    const db = dbFor()
    db.errors.push({ table, op: 'select' })
    await expect(resolve(db)).rejects.toThrow(needle)
  })

  it('the alias lookup', async () => {
    const db = dbFor()
    db.tables.evites = [] // the exact read finds nothing...
    db.errors.push({ table: 'evites', op: 'select', when: ({ filters }) => (filters ?? []).some((f) => f.kind === 'contains') })
    await expect(resolve(db)).rejects.toThrow('alias')
  })

  it('an empty payments table is NOT a failed one: no payments reads as preview', async () => {
    const out = await resolve(dbFor({ booking: { status: 'awaiting_deposit' }, payments: [] }))
    expect(out.kind === 'ok' && out.state).toBe('preview')
  })
})

describe('resolve.ts source rules', () => {
  const src = readSrc('lib', 'evites', 'resolve.ts')

  it('looks the alias up with .contains(), never a template literal in .or()', () => {
    expect(src).toMatch(/\.contains\(\s*'previous_slugs'\s*,\s*\[slug\]\s*\)/)
    expect(src).not.toMatch(/\.or\s*\(/)
  })

  it("has no select('*')", () => {
    expect(src).not.toMatch(/select\(\s*['"`]\*['"`]\s*\)/)
  })
})
