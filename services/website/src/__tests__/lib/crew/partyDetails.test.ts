/**
 * What the crew read about a party they are working (lib/crew/partyDetails.ts):
 * first names only, the food and activities that were actually booked, and
 * nothing a customer's booking holds that a crew member has no use for. The
 * wiring (only a member ON the party gets it) is read off disk.
 */
import fs from 'fs'
import path from 'path'
import { buildCrewPartyDetails, CREW_DETAIL_COLUMNS } from '@/lib/crew/partyDetails'
import { defaultShift, DEFAULT_SETTINGS } from '@/lib/crew/rules'
import { partyView } from '@/lib/crew/view'

const row = (over: Record<string, unknown> = {}) => ({
  party_type: 'in_studio_theme', package_type: 'Glow Party', child_name: 'Ava Rossi', child_age: 7, contact_name: 'Maria Rossi',
  party_tags: {}, sel_theme_name: 'Glow Party', sel_pizza_or_bagels: 'bagels', sel_cupcake_flavor: 'chocolate', sel_add_mobile_cupcakes: null, ...over,
})
const line = (name: string, category: string, is_optional = false) => ({ name, category, is_optional })

describe('buildCrewPartyDetails', () => {
  it('gives first names only, the age, the theme, food and booked activities', () => {
    const d = buildCrewPartyDetails(row(), [
      line('Slime Station', 'activity-add-on'), line('Glitter Tattoos', 'activity-standard'), line('Hair Tinsel', 'activity-premium'),
      line('Juice Boxes', 'beverage-add-on'),
    ])
    expect(d.child).toBe('Ava, turning 7')
    expect(d.parent).toBe('Maria')
    expect(d.theme).toBe('Glow Party')
    expect(d.food[0]).toMatch(/bagel/i)
    expect(d.food[0]).toMatch(/chocolate/i)
    expect(d.food).toContain('Juice Boxes')
    expect(d.activities).toEqual(['Slime Station', 'Glitter Tattoos', 'Hair Tinsel'])
    expect(JSON.stringify(d)).not.toMatch(/Rossi/)
  })

  it('leaves out quoted-but-not-booked (optional) items and duplicates', () => {
    const d = buildCrewPartyDetails(row(), [line('Perfume Making', 'activity-add-on', true), line('Slime', 'activity-add-on'), line('Slime', 'activity-add-on')])
    expect(d.activities).toEqual(['Slime'])
  })

  it('a mobile party is served cupcakes only if the host added them', () => {
    expect(buildCrewPartyDetails(row({ party_type: 'mobile_party' }), []).food).toEqual([])
    const withCupcakes = buildCrewPartyDetails(row({ party_type: 'mobile_party', sel_add_mobile_cupcakes: 'true' }), [])
    expect(withCupcakes.food).toHaveLength(1)
    expect(withCupcakes.food[0]).toMatch(/cupcake/i)
  })

  it('a studio rental is a room rental: no child line, no pizza and cupcake from us, only its booked food add-ons', () => {
    const d = buildCrewPartyDetails(row({ party_type: 'studio_rental' }), [line('Coffee Bar', 'food-add-on'), line('Garbage Service', 'service-add-on')])
    expect(d.child).toBeNull()
    expect(d.food).toEqual(['Coffee Bar'])
  })

  it('missing names are null, not "undefined"', () => {
    const d = buildCrewPartyDetails(row({ child_name: null, contact_name: '  ', sel_theme_name: null, package_type: null }), [])
    expect(d.child).toBeNull()
    expect(d.parent).toBeNull()
    expect(d.theme).toBeNull()
  })
})

describe('the allow-list', () => {
  it('names no contact detail, note or money column', () => {
    const cols = CREW_DETAIL_COLUMNS
    for (const banned of ['contact_email', 'contact_phone', 'notes', 'admin_notes', 'total_cents', 'balance', 'deposit', 'stripe', 'portal_token', 'quote_snapshot,', 'select *', '*']) {
      expect(cols).not.toContain(banned)
    }
    // The snapshot is only ever read one scalar key at a time.
    expect(cols.match(/quote_snapshot/g)!.every((_, i, a) => i < a.length)).toBe(true)
    expect(cols.split(',').filter(c => c.includes('quote_snapshot')).every(c => /quote_snapshot->>\w+/.test(c))).toBe(true)
  })
})

describe('the shift', () => {
  const party = { id: 'p', title: 'T', theme: null, party_kind: 'in_studio_theme', starts_at: '2026-11-08T15:00:00.000Z', ends_at: '2026-11-08T18:00:00.000Z',
    guest_count: 10, location: 'x', notes_for_crew: null, status: 'published' } as never
  it('runs from the setup time before the party to the clean-up time after it', () => {
    const v = partyView({ party, slots: [], viewer: { id: 'm', steps: 0, can_lead: false }, firstNames: new Map(), standbyMemberIds: new Set() }, DEFAULT_SETTINGS)!
    expect(new Date(v.shiftStartsAt).toISOString()).toBe('2026-11-08T14:30:00.000Z')
    expect(new Date(v.shiftEndsAt).toISOString()).toBe('2026-11-08T18:30:00.000Z')
    const s = defaultShift({ startsAt: new Date('2026-11-08T15:00:00Z'), endsAt: new Date('2026-11-08T18:00:00Z') }, DEFAULT_SETTINGS)
    expect(s.startedAt.toISOString()).toBe(v.shiftStartsAt)
  })
})

describe('who gets it', () => {
  const SRC = path.join(process.cwd(), 'src')
  const page = fs.readFileSync(path.join(SRC, 'app', 'crew', 'parties', '[id]', 'page.tsx'), 'utf8').replace(/\r\n/g, '\n')

  it('only the party page reads it, and only for a member who has a spot on that party', () => {
    expect(page).toMatch(/if \(v\.mySlot && bookingId\) \{\n\s+const d = await loadCrewPartyDetails\(sb, bookingId\)/)
    const users: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (/\.tsx?$/.test(e.name) && /loadCrewPartyDetails\(/.test(fs.readFileSync(p, 'utf8')) && !p.endsWith('partyDetails.ts')) users.push(path.relative(SRC, p).split(path.sep).join('/'))
      }
    }
    walk(path.join(SRC, 'app'))
    walk(path.join(SRC, 'lib'))
    expect(users).toEqual(['app/crew/parties/[id]/page.tsx'])
  })
})
