/**
 * Crew work that is not a party (Clean Floor, Drop-off Event, Balloon Decor,
 * Party Setup, Retail Shift), a mobile party's town, the half-hour shift of work,
 * and the pieces of the crew chrome Adam specified (logo + CREW wordmark, emoji
 * tabs, no pricing/help lines on Availability).
 */
import fs from 'fs'
import path from 'path'
import { DEFAULT_SETTINGS, shiftWindow, staffingShortfall } from '@/lib/crew/rules'
import { createManualParty } from '@/lib/crew/adminActions'
import { rolesFor, rolesToAdd } from '@/lib/crew/sync'
import { WORK_KINDS, WORK_TYPES, isWorkKind, kindHasLead, workTypeOf } from '@/lib/crew/workTypes'
import { mobileCityOf } from '@/lib/crew/view'
import { foodLines, adminAboutFromRow } from '@/lib/crew/partyDetails'
import { fakeCrewDb } from '../../helpers/fakeCrewDb'

const SRC = path.join(process.cwd(), 'src')
const read = (...p: string[]) => fs.readFileSync(path.join(SRC, ...p), 'utf8')
const S = DEFAULT_SETTINGS
const NOW = new Date('2026-10-27T12:00:00Z')
const ACTOR = 'admin:allie@example.test'

describe('the work types', () => {
  it('are the five Adam named, each with a distinct kind, a label, an emoji, and sane defaults', () => {
    expect(WORK_TYPES.map(t => t.label)).toEqual(['Clean Floor', 'Drop-off Event', 'Balloon Decor', 'Party Setup', 'Retail Shift'])
    expect(new Set(WORK_TYPES.map(t => t.kind)).size).toBe(5)
    for (const t of WORK_TYPES) {
      expect(t.emoji.length).toBeGreaterThan(0)
      expect(t.defaultSpots).toBeGreaterThanOrEqual(1)
      expect(t.defaultEnd > t.defaultStart).toBe(true)
      expect(isWorkKind(t.kind)).toBe(true)
      expect(workTypeOf(t.kind)).toBe(t)
    }
    expect(isWorkKind('manual')).toBe(false)
    expect(isWorkKind('studio_rental')).toBe(false)
    expect(isWorkKind('__proto__')).toBe(false)
  })

  it('migration 089 allows exactly the kinds the code has', () => {
    const sql = fs.readFileSync(path.join(process.cwd(), '..', '..', 'starting_plan', 'migration_089_crew_work_kinds.sql'), 'utf8')
    const check = sql.slice(sql.indexOf('ADD CONSTRAINT crew_parties_kind_check'), sql.indexOf('COMMIT'))
    const kinds = Array.from(check.matchAll(/'([a-z_]+)'/g)).map(m => m[1]).sort()
    expect(kinds).toEqual(['in_studio_theme', 'mobile_party', 'studio_rental', 'manual', ...WORK_KINDS].sort())
  })

  it('has no Party Lead: parties do, a rental and all work do not', () => {
    for (const k of ['in_studio_theme', 'mobile_party', 'manual']) expect(kindHasLead(k)).toBe(true)
    for (const k of ['studio_rental', ...WORK_KINDS]) expect(kindHasLead(k)).toBe(false)
    for (const k of WORK_KINDS) {
      expect(rolesFor(k, 3)).toEqual(['crew', 'crew', 'crew'])
      expect(rolesToAdd([], 2, k)).toEqual(['crew', 'crew'])
    }
    expect(rolesFor('manual', 3)).toEqual(['lead', 'crew', 'crew'])
  })

  it('is never "short a Lead"', () => {
    const slots = [{ role: 'crew', status: 'open', member_id: null }, { role: 'crew', status: 'open', member_id: null }] as never
    expect(staffingShortfall({ party_kind: 'clean_floor' } as never, slots)).toEqual({ crewShort: 2, leadShort: false })
    expect(staffingShortfall({ party_kind: 'manual' } as never, slots)).toMatchObject({ leadShort: true })
  })
})

describe('Allie adds work by hand', () => {
  const world = () => fakeCrewDb({ crew_parties: [], crew_slots: [], crew_members: [] })
  const base = { date: '2026-11-21', start: '09:00', end: '11:00' }

  it('creates a draft of the kind with that many crew spots and no Lead, in the studio unless she says otherwise', async () => {
    const db = world()
    const r = await createManualParty(db.sb, { ...base, kind: 'balloon_decor', spots: 2 }, ACTOR, S, NOW)
    if (!r.ok) throw new Error(r.error)
    const p = db.tables.crew_parties.find(x => x.id === r.id)!
    expect(p).toMatchObject({
      status: 'draft', party_kind: 'balloon_decor', booking_id: null, title: 'Balloon Decor', guest_count: null, slots_override: 2,
      starts_at: '2026-11-21T14:00:00.000Z', ends_at: '2026-11-21T16:00:00.000Z',
    })
    expect(p.location).toMatch(/Montauk|Speonk/)
    expect(db.tables.crew_slots.filter(s => s.party_id === r.id).map(s => s.role)).toEqual(['crew', 'crew'])
  })

  it('takes the type\'s own count, and her title and place when she gives them', async () => {
    const db = world()
    const r = await createManualParty(db.sb, { ...base, kind: 'retail_shift', title: 'Saturday shop', location: 'Pop-up, Main St' }, ACTOR, S, NOW)
    if (!r.ok) throw new Error(r.error)
    expect(db.tables.crew_parties.find(x => x.id === r.id)).toMatchObject({ title: 'Saturday shop', location: 'Pop-up, Main St', slots_override: 1 })
    expect(db.tables.crew_slots).toHaveLength(1)
  })

  it('refuses an unknown kind, a bad number of spots, and a time that has passed', async () => {
    const db = world()
    expect((await createManualParty(db.sb, { ...base, kind: 'mowing' }, ACTOR, S, NOW)).ok).toBe(false)
    expect((await createManualParty(db.sb, { ...base, kind: '__proto__' }, ACTOR, S, NOW)).ok).toBe(false)
    for (const spots of [0, 11, 1.5, '2', -1]) {
      expect((await createManualParty(db.sb, { ...base, kind: 'clean_floor', spots }, ACTOR, S, NOW)).ok).toBe(false)
    }
    expect((await createManualParty(db.sb, { ...base, date: '2026-10-01', kind: 'clean_floor' }, ACTOR, S, NOW)).ok).toBe(false)
    expect(db.tables.crew_parties).toHaveLength(0)
  })

  it('a party by hand is unchanged: the kids formula and a Lead', async () => {
    const db = world()
    const r = await createManualParty(db.sb, { ...base, title: 'Pop-up', guest_count: 14, location: 'Market' }, ACTOR, S, NOW)
    if (!r.ok) throw new Error(r.error)
    expect(db.tables.crew_parties.find(x => x.id === r.id)).toMatchObject({ party_kind: 'manual', slots_override: null })
    expect(db.tables.crew_slots.filter(s => s.party_id === r.id).map(s => s.role).sort()).toEqual(['crew', 'crew', 'crew', 'lead'])
  })
})

describe('the shift of work is the whole time, with no set-up or clean-up added', () => {
  const win = { starts_at: '2026-11-21T14:00:00.000Z', ends_at: '2026-11-21T16:00:00.000Z' }
  it('work: exactly start to end', () => {
    const w = shiftWindow({ ...win, party_kind: 'clean_floor' }, 'crew', S)
    expect(w.startsAt.toISOString()).toBe(win.starts_at)
    expect(w.endsAt.toISOString()).toBe(win.ends_at)
  })
  it('a party still gets its 30 minutes either side; an override still wins for work', () => {
    const p = shiftWindow({ ...win, party_kind: 'manual' }, 'crew', S)
    expect(p.startsAt.getTime()).toBe(Date.parse(win.starts_at) - 30 * 60_000)
    expect(p.endsAt.getTime()).toBe(Date.parse(win.ends_at) + 30 * 60_000)
    const o = shiftWindow({ ...win, party_kind: 'retail_shift', shift_starts_at: '2026-11-21T13:30:00.000Z' }, 'crew', S)
    expect(o.startsAt.toISOString()).toBe('2026-11-21T13:30:00.000Z')
  })
})

describe('a mobile party shows its town before anyone commits, and never the street', () => {
  const m = (location: string, party_kind = 'mobile_party') => ({ party_kind, location }) as never
  it('reads the town from the address', () => {
    expect(mobileCityOf(m('12 Main St, Westhampton Beach, NY 11978'))).toBe('Westhampton Beach')
    expect(mobileCityOf(m('45 Dune Rd, Quogue NY 11959'))).toBe('Quogue')
  })
  it('says nothing rather than guess', () => {
    expect(mobileCityOf(m('Mobile party: address to be confirmed'))).toBeNull()
    expect(mobileCityOf(m('1 Ocean Blvd'))).toBeNull()
    expect(mobileCityOf(m('295 Montauk Hwy, Speonk, NY 11972', 'in_studio_theme'))).toBeNull()
  })
})

describe('the manager reads first names, the age and the food, never a surname', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'b', booking_ref: 'HH-PTY-AAAAA', status: 'approved', party_type: 'in_studio_theme', child_name: 'Ava Rossi', child_age: 7, contact_name: 'Maria Rossi',
    sel_pizza_or_bagels: 'bagels', sel_cupcake_flavor: 'chocolate', sel_add_mobile_cupcakes: null, ...over,
  })
  it('first names and the age', () => {
    expect(adminAboutFromRow(row())).toEqual({ child: 'Ava', childAge: 7, parent: 'Maria', food: 'Bagels', cupcake: 'Chocolate' })
    expect(JSON.stringify(adminAboutFromRow(row()))).not.toMatch(/Rossi|HH-PTY/)
  })
  it('marks the planner\'s starting values, because an untouched control saves them', () => {
    expect(foodLines('in_studio_theme', 'pizza', 'vanilla')).toEqual({ food: 'Pizza (default)', cupcake: 'Vanilla (default)' })
  })
  it('a mobile party has cupcakes only if the host added them; a rental has neither', () => {
    expect(foodLines('mobile_party', 'pizza', 'vanilla', null)).toEqual({ food: null, cupcake: null })
    expect(foodLines('mobile_party', 'pizza', 'chocolate', 'true')).toEqual({ food: null, cupcake: 'Chocolate' })
    expect(foodLines('studio_rental', 'pizza', 'vanilla')).toEqual({ food: null, cupcake: null })
    expect(adminAboutFromRow(row({ party_type: 'studio_rental' }))).toMatchObject({ child: null, childAge: null, food: null, cupcake: null })
  })
  it('no age is shown when none was given', () => {
    expect(adminAboutFromRow(row({ child_age: null })).childAge).toBeNull()
    expect(adminAboutFromRow(row({ child_age: 0 })).childAge).toBeNull()
  })
})

describe('the crew chrome', () => {
  it('has "Party Crew" - no logo - at the top centre of every signed-in and sign-in screen, from one component', () => {
    const brand = read('app', 'crew', '_components', 'CrewBrand.tsx')
    expect(brand).not.toMatch(/TENANT\.brand\.logo|next\/image|<Image/)
    expect(brand).toMatch(/className="crew-wordmark"[^>]*>Party Crew</)
    expect(brand).toMatch(/aria-label="Party Crew"/)
    // Centred: the header is a three-column grid and the brand sits in the middle one.
    const layout = read('app', 'crew', 'layout.tsx')
    expect(layout).toMatch(/\.crew-top\{display:grid;grid-template-columns:1fr auto 1fr/)
    expect(layout).toMatch(/\.crew-brandmark\{grid-column:2;justify-self:center/)
    expect(layout).toMatch(/title: \{ absolute: 'Party Crew' \}/)
    for (const f of [['_components', 'CrewTop.tsx'], ['login', 'page.tsx'], ['onboarding', 'page.tsx'], ['profile', 'page.tsx']]) {
      const src = read('app', 'crew', ...f)
      expect(src).toMatch(/<CrewBrand/)
      expect(src).not.toMatch(/crew-brand"/)
    }
  })

  it('the wordmark is varsity lettering, navy core with a dusty-blue border, in the tenant\'s own two colours', () => {
    const layout = read('app', 'crew', 'layout.tsx')
    expect(layout).toMatch(/localFont\(\{ src: '[^']*Graduate-latin-400\.woff2'/)
    expect(layout).toMatch(/\.crew-wordmark\{[^}]*text-transform:uppercase[^}]*color:var\(--c-brand-navy\)[^}]*text-shadow:/)
    expect(layout).toMatch(/--c-brand-navy': TENANT\.brand\.colors\.navy/)
    expect(layout).toMatch(/--c-brand-blue': TENANT\.brand\.colors\.blue/)
  })

  it('the bottom tabs carry the emoji Adam chose: 🥳 Parties · 🗓️ Availability · 🪪 Profile', () => {
    const nav = read('app', 'crew', '_components', 'CrewNav.tsx')
    expect(nav).toMatch(/emoji: '🥳', Icon: \w+, label: 'Parties'/)
    expect(nav).toMatch(/emoji: '🗓️', Icon: \w+, label: 'Availability'/)
    expect(nav).toMatch(/emoji: '🪪', Icon: \w+, label: 'Profile'/)
    expect(nav).not.toMatch(/label: 'Work'/)
  })

  it('Availability says nothing about "can\'t make it" under the form', () => {
    const page = read('app', 'crew', 'availability', 'page.tsx')
    expect(page).not.toMatch(/Already on a party/)
    expect(page).not.toMatch(/Can&apos;t make it/)
  })
})
