/**
 * Special staffing alerts (a Party Helper, a face painter, a character visit), the compact
 * Leads / Bookings tops, and the roster's "PARTY CREW" wordmark.
 */
import fs from 'fs'
import path from 'path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { decomment } from '../helpers/sourceScan'

import { kindOfLine, specialStaffingOf, loadSpecialStaffing } from '@/lib/crew/specialStaffing'
import VarsityTitle from '@/app/admin/crew/_components/VarsityTitle'
import { CrewFrame } from '@/app/admin/crew/_components/adminCrew'
import PartyFilters from '@/app/admin/crew/_components/PartyFilters'

const read = (rel: string) => decomment(fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8'))

describe('which lines need a particular person', () => {
  it('finds a Party Helper, a face painter and a character visit', () => {
    expect(kindOfLine({ name: 'Party Helper', category: 'service-add-on' })).toBe('party_helper')
    expect(kindOfLine({ name: 'Party Helper (per hour)', category: 'service-add-on' })).toBe('party_helper')
    expect(kindOfLine({ name: 'Party Helper 1–5 PM + Full Clean-up & Garbage Disposal', category: 'service-add-on' })).toBe('party_helper')
    expect(kindOfLine({ name: 'Face Painter', category: 'entertainment-add-on' })).toBe('face_painter')
    expect(kindOfLine({ name: 'face painting', category: null })).toBe('face_painter')
    expect(kindOfLine({ name: 'Character Visit', category: 'add-on' })).toBe('character')
    expect(kindOfLine({ name: 'DJ for two hours', category: 'entertainment-add-on' })).toBe('entertainment')
  })

  it('does not mistake a theme, a craft or an ordinary service for one', () => {
    for (const l of [
      { name: 'Princess Party', category: 'theme' },
      { name: 'Canvas Painting (1st premium — included)', category: 'activity-add-on' },
      { name: 'Garbage Service', category: 'service-add-on' },
      { name: 'Full Clean-up Service', category: 'service-add-on' },
      { name: 'Studio Rental — Weekend 4 hrs', category: 'rental' },
      { name: 'Party Helper', category: 'rental' },
    ]) {
      expect(kindOfLine(l)).toBeNull()
    }
  })

  it('lists what was bought, helper first, skips quoted-not-charged lines, and carries no price', () => {
    const lines = [
      { name: 'Face Painter', category: 'entertainment-add-on', quantity: 1, unit_price_cents: 32_500 },
      { name: 'Party Helper', category: 'service-add-on', quantity: 2 },
      { name: 'Character Visit', category: 'add-on', quantity: 1, is_optional: true },
      { name: 'Balloon Arch', category: 'decor-add-on', quantity: 1 },
    ]
    const s = specialStaffingOf(lines as never)
    expect(s.map(x => [x.kind, x.label, x.quantity, x.crewSpot])).toEqual([
      ['party_helper', 'Party Helper', 2, true],
      ['face_painter', 'Face Painter', 1, false],
    ])
    expect(JSON.stringify(s)).not.toMatch(/32500|price|cents/i)
    expect(s[1].action).toMatch(/no spot/)
    expect(specialStaffingOf([])).toEqual([])
  })

  it('an unreadable line-item table is null ("could not check"), never an empty list', async () => {
    const db = (error: unknown, data: unknown[] = []) => ({ from: () => ({ select: () => ({ eq: async () => ({ data, error }) }) }) }) as never
    expect(await loadSpecialStaffing(db({ message: 'down' }), 'b1')).toBeNull()
    expect(await loadSpecialStaffing(db(null, [{ name: 'Face Painter', category: 'entertainment-add-on', quantity: 1 }]), 'b1')).toHaveLength(1)
    expect(await loadSpecialStaffing(db(null), null)).toEqual([])
  })
})

describe('where the alert shows', () => {
  it('the party-staff page gets it from the detail route and raises an alert above the spots', () => {
    const route = read('app/api/admin/crew/parties/[id]/route.ts')
    expect(route).toMatch(/loadSpecialStaffing\(sb, r\.data\.booking\?\.id\)/)
    expect(route).toMatch(/NextResponse\.json\(\{ \.\.\.r\.data, pick, special,/)
    const page = read('app/admin/crew/_components/CrewPartyEditor.tsx')
    expect(page).toMatch(/<SpecialStaffingAlert special=\{d\.special\} staffed=\{d\.staffed\} needed=\{d\.needed\} \/>/)
    expect(page).toMatch(/role="alert"/)
    // It says when it could not check, rather than staying silent.
    expect(page).toMatch(/special === null/)
  })

  it('an opened booking tile shows it inside its Staffing block', () => {
    const tile = read('app/admin/crew/_components/BookingTile.tsx')
    expect(tile).toMatch(/specialStaffingOf\(detail\.data\.card\.addOns/)
    expect(tile).toMatch(/<Staffing tile=\{tile\} special=\{special\}/)
    expect(tile).toContain('Special staffing')
  })

  it('reads names, categories and quantities only - no prices', () => {
    const lib = read('lib/crew/specialStaffing.ts')
    expect(lib).toMatch(/select\('name, category, quantity, is_optional'\)/)
    expect(lib.match(/\.(insert|update|upsert|delete)\s*\(/g)).toBeNull()
  })
})

describe('the tops of Leads and Bookings are compact', () => {
  const noop = () => undefined
  const filters = renderToStaticMarkup(
    createElement(PartyFilters, {
      types: [], onTypes: noop, months: [{ key: '2026-11', label: 'Nov', count: 1 }], month: '2026-11', onMonth: noop, dayCounts: { '2026-11-07': 1 }, day: null, onDay: noop, weekend: [], onWeekend: noop,
    } as never),
  )

  it('small pull buttons, tight gaps, and no caption line under the dates', () => {
    expect(filters).toMatch(/class="[^"]*\bh-8\b[^"]*"/)
    expect(filters).not.toMatch(/min-h-\[40px\]/)
    expect(filters).toMatch(/gap-1\.5/)
    expect(filters).not.toContain('whole month')
  })

  it('the screens drop their big heading and sub line (the tab already says where you are)', () => {
    const frame = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(CrewFrame, { title: 'Bookings', ...props } as never, createElement('i')))
    const compact = frame({ compact: true })
    expect(compact).toContain('sr-only')
    expect(compact).not.toContain('text-3xl')
    expect(compact).toContain('py-3')
    expect(frame({})).toContain('text-3xl')
    for (const p of ['leads', 'bookings', 'payments']) expect(read(`app/admin/crew/${p}/page.tsx`)).toMatch(/<CrewFrame[\s\S]{0,200}compact/)
  })
})

describe('the roster title', () => {
  it('says PARTY CREW in the staff app\'s varsity lettering, with the ring, and has no sub heading', () => {
    const h = renderToStaticMarkup(createElement(VarsityTitle, null, 'Party Crew'))
    expect(h).toContain('Party Crew')
    expect(h).toMatch(/text-transform:uppercase/)
    expect(h).toContain('--crew-font-varsity')
    expect(h.match(/0 #[0-9a-f]{6}/gi)!.length).toBe(16)
    const page = read('app/admin/crew/members/page.tsx')
    expect(page).toMatch(/<CrewFrame active="\/admin\/crew\/members" title="Party Crew" wordmark>/)
    expect(page).not.toContain('Who is on the crew')
    expect(page).not.toContain('Crew roster')
    // The face is the staff app's own, loaded for these pages.
    expect(read('app/admin/crew/layout.tsx')).toMatch(/localFont\(\{ src: '[^']*Graduate-latin-400\.woff2'[^}]*variable: '--crew-font-varsity'/)
    expect(read('app/crew/layout.tsx')).toMatch(/localFont\(\{ src: '[^']*Graduate-latin-400\.woff2'[^}]*variable: '--crew-font-varsity'/)
  })
})
