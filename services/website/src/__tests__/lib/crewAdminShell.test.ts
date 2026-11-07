/**
 * The crew-management app's shell: a sticky top menu (sparkle, Dashboard, Leads,
 * Bookings, Staff, hamburger), no link back to the main admin, the Leads cards ordered by
 * most recent contact, and the staff-facing app's "Party Crew" header.
 */
import fs from 'fs'
import path from 'path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { decomment } from '../helpers/sourceScan'

let mockPath = '/admin/crew/leads'
jest.mock('next/navigation', () => ({ usePathname: () => mockPath }))
jest.mock('@/components/admin/MemoryPanel', () => ({ __esModule: true, default: () => null }))

import CrewAdminBar, { sectionOf } from '@/app/admin/crew/_components/CrewAdminBar'
import { loadLeadCards } from '@/lib/leadCards'
import { agoLabel } from '@/lib/agoLabel'
import { GET as leadsGet } from '@/app/api/admin/leads/route'
import { NextRequest } from 'next/server'

const read = (rel: string) => decomment(fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8'))

describe('the top menu', () => {
  const html = (p: string) => {
    mockPath = p
    return renderToStaticMarkup(createElement(CrewAdminBar))
  }

  it('is, in order: sparkle, Dashboard, Leads, Bookings, Staff, then the hamburger on the right', () => {
    const h = html('/admin/crew/leads')
    const order = ['aria-label="Open the AI assistant"', '>Dashboard<', '>Leads<', '>Bookings<', '>Staff<', 'aria-label="Menu"']
    const at = order.map(s => h.indexOf(s))
    expect(at.every(i => i > -1)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    expect(h).toContain('✨')
  })

  it('is stuck to the top', () => {
    expect(html('/admin/crew')).toMatch(/<header class="sticky top-0 /)
  })

  it('has no way back to the main admin', () => {
    const h = html('/admin/crew')
    expect(h).not.toMatch(/href="\/admin"/)
    expect(h).not.toMatch(/← Admin|Back to admin/i)
    expect(read('app/admin/crew/_components/adminCrew.tsx')).not.toMatch(/href="\/admin"/)
  })

  it('marks the section you are in', () => {
    expect(html('/admin/crew/dashboard')).toMatch(/aria-current="page"[^>]*>Dashboard</)
    expect(html('/admin/crew/leads')).toMatch(/aria-current="page"[^>]*>Leads</)
    expect(html('/admin/crew/bookings')).toMatch(/aria-current="page"[^>]*>Bookings</)
    // Staff is the roster; the party-staff page belongs to it.
    expect(html('/admin/crew/members')).toMatch(/aria-current="page"[^>]*>Staff</)
    expect(html('/admin/crew/parties/abc')).toMatch(/aria-current="page"[^>]*>Staff</)
    // The schedule and Settings live in the hamburger, so no tab is "current" on them.
    expect(html('/admin/crew')).not.toMatch(/aria-current="page"/)
    expect(html('/admin/crew/rules')).not.toMatch(/aria-current="page"/)
  })

  it('maps paths to sections', () => {
    expect(sectionOf('/admin/crew/dashboard')).toBe('dashboard')
    expect(sectionOf('/admin/crew/leads')).toBe('leads')
    expect(sectionOf('/admin/crew/bookings')).toBe('bookings')
    expect(sectionOf('/admin/crew/rules')).toBe('settings')
    expect(sectionOf('/admin/crew/members')).toBe('staff')
    expect(sectionOf('/admin/crew/parties/abc')).toBe('staff')
    expect(sectionOf('/admin/crew')).toBe('schedule')
    expect(sectionOf('/admin/crew/')).toBe('schedule')
    expect(sectionOf(null)).toBe('dashboard')
  })

  it('puts the Staff schedule, Settings and Memories in the hamburger, and opens the assistant by event', () => {
    const s = read('app/admin/crew/_components/CrewAdminBar.tsx')
    expect(s).toMatch(/href="\/admin\/crew"[\s\S]{0,260}Staff schedule/)
    expect(s).toMatch(/href="\/admin\/crew\/rules"[\s\S]{0,260}Settings/)
    // The Staff tab goes to the roster, not the schedule.
    expect(s).toMatch(/href: '\/admin\/crew\/members', label: 'Staff'/)
    expect(s).toMatch(/Memories/)
    expect(s).toMatch(/new CustomEvent\('hh:assistant-open'\)/)
    expect(s).toMatch(/<MemoryPanel \/>/)
  })

  it('every crew-management page uses the one frame, and the menu lives in the shell so it never remounts', () => {
    for (const p of ['page.tsx', 'members/page.tsx', 'rules/page.tsx', 'leads/page.tsx', 'bookings/page.tsx', 'dashboard/page.tsx', 'parties/[id]/page.tsx']) {
      expect({ p, frame: /<CrewFrame/.test(read(`app/admin/crew/${p}`)) }).toEqual({ p, frame: true })
    }
    expect(read('app/admin/crew/_components/CrewAdminShell.tsx')).toMatch(/<CrewAdminBar \/>/)
    expect(read('app/admin/crew/_components/adminCrew.tsx')).not.toMatch(/<CrewAdminBar/)
    expect(read('app/admin/crew/layout.tsx')).toMatch(/<CrewAdminShell>\{children\}<\/CrewAdminShell>/)
  })

  it('tabs are client-side links over warmed data, so a tab change waits for nothing', () => {
    const bar = read('app/admin/crew/_components/CrewAdminBar.tsx')
    expect(bar).toMatch(/<Link key=\{i\.key\} href=\{i\.href\} prefetch/)
    expect(bar).not.toMatch(/<a key=/)
    const shell = read('app/admin/crew/_components/CrewAdminShell.tsx')
    for (const path of ['crew-app/dashboard', 'crew-app/bookings', 'api/admin/leads', 'crew/members']) expect(shell).toContain(path)
    expect(shell).toMatch(/warm\(WARM_PATHS\)/)
    expect(shell).toMatch(/router\.prefetch\(r\)/)
    for (const route of ['dashboard', 'leads', 'bookings', 'members']) expect(shell).toContain(`'/admin/crew/${route}'`)
    // The pages read through the cache, not a private fetch.
    for (const p of ['dashboard', 'leads', 'bookings', 'members']) expect(read(`app/admin/crew/${p}/page.tsx`)).toMatch(/useAdminData/)
  })

  it('the assistant drawer opens on the event, and the floating button steps aside on these pages', () => {
    const d = read('components/admin/AssistantDrawer.tsx')
    expect(d).toMatch(/addEventListener\('hh:assistant-open'/)
    expect(d).toMatch(/!pathname\.startsWith\('\/admin\/crew'\)/)
    // A button that opens it for a party passes the booking, and the generic one passes none (the general chat).
    expect(d).toMatch(/setAnnouncedRef\(typeof d\.bookingRef === 'string' && d\.bookingRef \? d\.bookingRef : null\)/)
  })
})

describe('the Leads cards', () => {
  type Row = Record<string, unknown>
  const NOW = new Date('2026-11-07T17:00:00Z')
  const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()
  const base = (id: string, over: Row): Row => ({
    id, booking_ref: `HH-PTY-${id.toUpperCase()}`, status: 'lead', contact_id: `c-${id}`, contact_name: `Person ${id}`, contact_email: `${id}@example.com`,
    contact_phone: '6315550000', party_type: 'in_studio_theme', event_type: 'birthday', party_date: '2026-12-12', party_time: '14:00',
    guest_count_approx: 10, child_name: 'Kid', child_age: 6, package_type: null, total_cents: 0, created_at: hoursAgo(200), ...over,
  })
  const tables = (): Record<string, Row[]> => ({
    bookings: [
      base('old', { created_at: hoursAgo(300) }),
      base('quiet', { created_at: hoursAgo(100) }),
      base('hot', { created_at: hoursAgo(90) }),
      base('booked', { status: 'deposit_paid' }),
      base('over', { party_date: '2026-10-01' }),
      base('lost', { status: 'lost' }),
    ],
    booking_payments: [{ booking_id: 'booked', amount_cents: 25000, payment_type: 'deposit' }],
    ingested_messages: [
      { booking_id: 'old', direction: 'in', source: 'website_form', body: 'First ask  from\n old', sent_at: null, created_at: hoursAgo(290) },
      { booking_id: 'old', direction: 'out', source: 'gmail', body: 'reply', sent_at: null, created_at: hoursAgo(1) }, // we wrote most recently
      { booking_id: 'hot', direction: 'in', source: 'quo', body: 'Still open on the 12th?', sent_at: hoursAgo(0.5), created_at: hoursAgo(0.5) },
      { booking_id: 'quiet', direction: 'in', source: 'website_form', body: 'hello', sent_at: null, created_at: hoursAgo(99) },
    ],
    inquiry_drafts: [], booking_modifications: [], contact_interactions: [],
  })
  function fake(t: Record<string, Row[]>) {
    return {
      from: (name: string) => {
        let rows = [...(t[name] ?? [])]
        const q: Record<string, unknown> = {}
        q.select = () => q
        q.eq = (c: string, v: unknown) => ((rows = rows.filter(r => r[c] === v)), q)
        q.in = (c: string, vs: unknown[]) => ((rows = rows.filter(r => vs.includes(r[c]))), q)
        q.gte = (c: string, v: string) => ((rows = rows.filter(r => String(r[c]) >= v)), q)
        q.or = () => q
        q.order = (c: string, o?: { ascending?: boolean }) => {
          rows.sort((a, b) => (String(a[c]) < String(b[c]) ? -1 : 1) * (o?.ascending === false ? -1 : 1))
          return q
        }
        q.limit = (n: number) => ((rows = rows.slice(0, n)), q)
        q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res)
        return q
      },
    } as never
  }

  it('lists only open leads, the one in touch most recently first', async () => {
    const r = await loadLeadCards(fake(tables()), NOW)
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    // hot (they wrote 30 min ago) > old (we replied an hour ago) > quiet (they wrote 99 hours ago)
    expect(r.leads.map(l => l.id)).toEqual(['hot', 'old', 'quiet'])
    // not the booked one, the one whose date has passed, or the lost one
    expect(r.leads.some(l => ['booked', 'over', 'lost'].includes(l.id))).toBe(false)
  })

  it('says who spoke last, what they wrote, and the party time on a 12-hour clock', async () => {
    const r = await loadLeadCards(fake(tables()), NOW)
    if (r.kind !== 'ok') throw new Error('unavailable')
    const hot = r.leads.find(l => l.id === 'hot')!
    const old = r.leads.find(l => l.id === 'old')!
    expect(hot.lastFrom).toBe('them')
    expect(hot.waitingOnUs).toBe(true)
    expect(hot.lastTheirs!.text).toBe('Still open on the 12th?')
    expect(hot.partyTime).toBe('2:00 PM')
    expect(old.lastFrom).toBe('us')
    expect(old.waitingOnUs).toBe(false)
    expect(old.lastTheirs!.text).toBe('First ask from old') // whitespace folded
    expect(hot.stage).toBe('inquiry')
  })

  it('a lead nobody has written to or from falls back to when they first asked', async () => {
    const t = tables()
    t.bookings = [base('fresh', { created_at: hoursAgo(5) })]
    t.ingested_messages = []
    const r = await loadLeadCards(fake(t), NOW)
    if (r.kind !== 'ok') throw new Error('unavailable')
    expect(r.leads[0].lastFrom).toBeNull()
    expect(r.leads[0].lastContactAt).toBe(hoursAgo(5))
  })

  it('the route is admin only', async () => {
    process.env.ADMIN_PASSWORD = 'shell-test-admin'
    const res = await leadsGet(new NextRequest('https://www.example.com/api/admin/leads'))
    expect(res.status).toBe(401)
  })

  it('formats how long ago', () => {
    const t = Date.parse('2026-11-07T17:00:00Z')
    expect(agoLabel('2026-11-07T17:00:00Z', t)).toBe('just now')
    expect(agoLabel('2026-11-07T16:25:00Z', t)).toBe('35 min ago')
    expect(agoLabel('2026-11-07T15:00:00Z', t)).toBe('2 hours ago')
    expect(agoLabel('2026-11-06T16:00:00Z', t)).toBe('1 day ago')
  })

  it('the tile offers copy / view invoice, open planner and the AI, and writes nothing itself', () => {
    expect(read('app/admin/crew/leads/page.tsx')).toMatch(/<PartyActions bookingId=\{lead\.id\} bookingRef=\{lead\.ref\} \/>/)
    const s = read('app/admin/crew/_components/PartyActions.tsx')
    for (const label of ['Copy invoice link', 'View invoice', 'Open planner', 'Ask the AI to edit']) expect(s).toContain(label)
    expect(s).toMatch(/hh:assistant-open/)
    // The only POST it makes is the Parties tab's own "make me a link" action.
    expect(Array.from(s.matchAll(/action: '([a-z_]+)'/g)).map(m => m[1])).toEqual(['generate_portal_url'])
    expect(read('lib/leadCards.ts').match(/\.(insert|update|upsert|delete)\s*\(/g)).toBeNull()
  })
})

describe('the staff-facing crew app header', () => {
  it('says "Party Crew" in the same varsity lettering, with no logo, centred', () => {
    const brand = read('app/crew/_components/CrewBrand.tsx')
    expect(brand).toMatch(/className="crew-wordmark"[^>]*>Party Crew</)
    expect(brand).not.toMatch(/<Image|TENANT\.brand\.logo/)
    const layout = read('app/crew/layout.tsx')
    expect(layout).toMatch(/\.crew-top\{display:grid;grid-template-columns:1fr auto 1fr/)
    expect(layout).toMatch(/\.crew-brandmark\{grid-column:2;justify-self:center/)
    // Same face as before: the wordmark rule is untouched.
    expect(layout).toMatch(/\.crew-wordmark\{font-family:var\(--crew-font-varsity\)/)
  })
})
