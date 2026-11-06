/**
 * Accept Assignment: a spot the manager put someone on is accepted from a card that
 * shows the whole shift, in a dialog, and the text they get carries a link that
 * adds that shift to a phone calendar. The link is a signed token, so it needs no
 * login, and it dies with the spot.
 */
import fs from 'fs'
import path from 'path'
import { NextRequest } from 'next/server'
import { DEFAULT_SETTINGS, type CrewSettings } from '@/lib/crew/rules'
import {
  buildCrewIcs, CALENDAR_LINK_GRACE_DAYS, crewCalendarUrl, crewEventFor, crewGoogleUrl, parseCrewCalendarToken,
  signCrewCalendar, verifyCrewCalendar, withCalendar,
} from '@/lib/crew/calendar'
import { notifyAssigned } from '@/lib/crew/assigned'
import { loadBoard, loadViewerContext } from '@/lib/crew/board'
import { partyRefFor, type CrewSenders } from '@/lib/crew/notify'
import { templates } from '@/lib/crew/templates'
import { fakeCrewDb, type FakeCrewDb } from '../../helpers/fakeCrewDb'

const S: CrewSettings = DEFAULT_SETTINGS
const H = 3_600_000
const NOW = new Date('2026-11-02T15:00:00Z')
const iso = (ms: number) => new Date(ms).toISOString()

const SLOT = '11111111-2222-4333-8444-555555555555'
const OTHER_SLOT = '66666666-7777-4888-9999-000000000000'

const person = (id: string, over: Record<string, unknown> = {}) => ({
  id, first_name: id.toUpperCase(), last_name: null, email: `${id}@example.test`, phone: null, steps: 3, can_lead: false,
  is_owner: false, is_test: false, skills: [], status: 'active', needs_review: false, sms_opt_in: false, sms_opt_in_at: null,
  email_opt_in: true, admin_notes: null, job_application_id: null, joined_on: '2026-10-01', created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z', ...over,
})

function party(id: string, startDays: number, over: Record<string, unknown> = {}) {
  const starts_at = iso(NOW.getTime() + startDays * 24 * H)
  return {
    id, booking_id: `b-${id}`, party_kind: 'in_studio_theme', title: `Party ${id}`, theme: `Theme ${id}`, starts_at,
    ends_at: iso(new Date(starts_at).getTime() + 3 * H), guest_count: 12, location: '295 Montauk Hwy', notes_for_crew: null,
    slots_override: null, extra_flat_cents: 0, status: 'published', published_at: iso(NOW.getTime() - H), attendance_marked_at: null,
    cancelled_at: null, sync_flags: [], selection_mode: 'first_come', shift_starts_at: null, shift_ends_at: null, lead_starts_at: null,
    created_at: '2026-11-01T12:00:00Z', updated_at: '2026-11-01T12:00:00Z', ...over,
  }
}

const slot = (id: string, partyId: string, member: string | null, over: Record<string, unknown> = {}) => ({
  id, party_id: partyId, role: 'crew', status: member ? 'assigned' : 'open', member_id: member,
  assigned_at: member ? '2026-11-01T00:00:00Z' : null, assigned_via: member ? 'admin' : null, assigned_by: null,
  confirmed_at: null, covered_swap_id: null, created_at: '2026-10-20T00:00:00Z', ...over,
})

function world(slots: any[], parties: any[] = [party('p1', 10)], members: any[] = [person('a')]): FakeCrewDb {
  return fakeCrewDb({
    crew_members: [person('owner', { is_owner: true, email: null }), ...members],
    crew_parties: parties, crew_slots: slots,
    crew_party_responses: [], crew_pick_log: [], crew_standbys: [], crew_unavailability: [], crew_recurring_blocks: [],
    crew_swap_requests: [], crew_events: [], crew_notifications: [],
    crew_settings: [{ key: 'drops', value: { late_drop_days: 7, standby_window_hours: 2, unclaimed_warning_hours: 48 } }],
  })
}

const rows = (db: FakeCrewDb, t: string): any[] => (db.tables[t] ?? []) as any[]

// ── The token ───────────────────────────────────────────────────────────────

describe('the calendar token', () => {
  const end = new Date('2026-11-14T21:30:00Z')
  const token = signCrewCalendar(SLOT, 'member-a', end)

  it('names the spot, expires after the shift, and verifies for the person holding it', () => {
    const t = parseCrewCalendarToken(token)!
    expect(t.slotId).toBe(SLOT)
    expect(t.exp).toBe(Math.floor(end.getTime() / 1000) + CALENDAR_LINK_GRACE_DAYS * 86_400)
    expect(verifyCrewCalendar(token, { id: SLOT, member_id: 'member-a' }, NOW)).toBe(true)
  })

  it('stops working when the spot changes hands', () => {
    expect(verifyCrewCalendar(token, { id: SLOT, member_id: 'member-b' }, NOW)).toBe(false)
    expect(verifyCrewCalendar(token, { id: SLOT, member_id: null }, NOW)).toBe(false)
  })

  it('is tied to one spot', () => {
    expect(verifyCrewCalendar(token, { id: OTHER_SLOT, member_id: 'member-a' }, NOW)).toBe(false)
  })

  it('expires', () => {
    const after = new Date(end.getTime() + (CALENDAR_LINK_GRACE_DAYS * 24 + 1) * H)
    expect(verifyCrewCalendar(token, { id: SLOT, member_id: 'member-a' }, after)).toBe(false)
  })

  it('rejects tampering: a changed expiry, a changed signature, junk', () => {
    const [id, exp, sig] = token.split('.')
    const later = `${id}.${Number(exp) + 86_400 * 30}.${sig}`
    expect(verifyCrewCalendar(later, { id: SLOT, member_id: 'member-a' }, NOW)).toBe(false)
    const flipped = `${id}.${exp}.${sig.replace(/.$/, c => (c === '0' ? '1' : '0'))}`
    expect(verifyCrewCalendar(flipped, { id: SLOT, member_id: 'member-a' }, NOW)).toBe(false)
    for (const junk of ['', 'x', `${id}.${exp}`, `${id}.abc.${sig}`, `../${token}`]) {
      expect(parseCrewCalendarToken(junk)).toBeNull()
      expect(verifyCrewCalendar(junk, { id: SLOT, member_id: 'member-a' }, NOW)).toBe(false)
    }
  })

  it('builds a public link, with the format when asked', () => {
    expect(crewCalendarUrl(token)).toMatch(new RegExp(`^https://[^/]+/crew/cal/${token}$`))
    expect(crewCalendarUrl(token, 'ics')).toMatch(/\?format=ics$/)
  })
})

// ── The entry ───────────────────────────────────────────────────────────────

describe('the calendar entry is the SHIFT', () => {
  const p = party('p1', 10) as any
  const crew = crewEventFor(p, { id: SLOT, role: 'crew' }, S)
  const lead = crewEventFor(p, { id: SLOT, role: 'lead' }, S)

  it('runs from arrival to done, not the party hours', () => {
    expect(crew.startsAt.getTime()).toBe(new Date(p.starts_at).getTime() - S.shift.setupMinutes * 60_000)
    expect(crew.endsAt.getTime()).toBe(new Date(p.ends_at).getTime() + S.shift.cleanupMinutes * 60_000)
  })

  it('has the Party Lead arrive earlier, and says so in the title', () => {
    expect(lead.startsAt.getTime()).toBeLessThan(crew.startsAt.getTime())
    expect(lead.title).toMatch(/\(Party Lead\)$/)
    expect(crew.title).not.toMatch(/Party Lead/)
  })

  it('carries the address and one stable uid per spot', () => {
    expect(crew.location).toBe('295 Montauk Hwy')
    expect(crew.uid).toBe(`crew-${SLOT}@${new URL(crew.url).host}`)
  })

  it('renders a CRLF calendar file with the shift times and two reminders, nothing over 75 octets per line', () => {
    const ics = buildCrewIcs(crew, NOW)
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(ics).not.toMatch(/[^\r]\n/)
    expect(ics).toContain(`DTSTART:${crew.startsAt.toISOString().replace(/[-:]/g, '').replace('.000', '')}`)
    expect(ics).toContain(`DTEND:${crew.endsAt.toISOString().replace(/[-:]/g, '').replace('.000', '')}`)
    expect((ics.match(/BEGIN:VALARM/g) ?? []).length).toBe(2)
    for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75)
  })

  it('escapes commas, semicolons and newlines in the text', () => {
    const ics = buildCrewIcs({ ...crew, location: 'Suite 4, 1 Main St; rear', description: 'one\ntwo' }, NOW)
    expect(ics).toContain('LOCATION:Suite 4\\, 1 Main St\\; rear')
    expect(ics).toContain('one\\ntwo')
  })

  it('builds the Google link for the same instants', () => {
    const u = new URL(crewGoogleUrl(crew))
    expect(u.origin + u.pathname).toBe('https://calendar.google.com/calendar/render')
    expect(u.searchParams.get('action')).toBe('TEMPLATE')
    expect(u.searchParams.get('location')).toBe('295 Montauk Hwy')
    expect(u.searchParams.get('dates')).toMatch(/^\d{8}T\d{6}Z\/\d{8}T\d{6}Z$/)
  })

  it('withCalendar adds a link only when someone holds the spot', () => {
    const ref = partyRefFor(p, S, undefined, 'crew')
    expect(withCalendar(ref, p, { id: SLOT, role: 'crew', member_id: null }, S).calUrl).toBeUndefined()
    expect(withCalendar(ref, p, { id: SLOT, role: 'crew', member_id: 'm' }, S).calUrl).toContain('/crew/cal/')
  })
})

// ── The messages ────────────────────────────────────────────────────────────

describe('the assignment message', () => {
  const p = party('p1', 10) as any
  const ref = withCalendar(partyRefFor(p, S, undefined, 'crew'), p, { id: SLOT, role: 'crew', member_id: 'm' }, S)

  it('names the whole shift, says Accept Assignment, and carries the calendar link on every channel', () => {
    expect(ref.shiftLabel).toBeTruthy()
    expect(ref.shiftLabel).not.toBe(ref.timeLabel)
    const m = templates.assignedByManager(ref)
    for (const body of [m.sms, m.email.text, m.inApp]) {
      expect(body).toContain('Accept Assignment')
    }
    expect(m.sms).toContain(ref.shiftLabel)
    expect(m.sms).toContain(ref.calUrl!)
    expect(m.email.text).toContain(ref.calUrl!)
  })

  it('the confirmation request and the confirmation also carry it', () => {
    expect(templates.confirmRequest(ref, 'Friday').sms).toContain(ref.calUrl!)
    expect(templates.confirmed(ref).sms).toContain(ref.calUrl!)
  })

  it('without a link there is no empty "Add to your calendar" line', () => {
    const bare = { ...ref, calUrl: undefined }
    expect(templates.assignedByManager(bare).sms).not.toMatch(/calendar/i)
  })
})

describe('notifyAssigned', () => {
  const ENV = { ...process.env }
  beforeEach(() => { process.env = { ...ENV, CREW_ENABLED: 'true', CREW_SMS_ENABLED: 'false', CREW_ADMIN_EMAIL: 'alerts@example.test' } })
  afterAll(() => { process.env = ENV })
  const senders = (): CrewSenders => ({
    sms: jest.fn(async () => 'quo-1'), email: jest.fn(async () => ({ kind: 'sent' as const, providerId: 're-1' })),
  }) as any

  it('tells the person, once, with the shift and a calendar link', async () => {
    const db = world([slot(SLOT, 'p1', 'a')])
    const ctx = { sb: db.sb, now: NOW, senders: senders() }
    expect(await notifyAssigned(ctx, S, SLOT)).toBe('sent')
    const note = rows(db, 'crew_notifications').find(n => n.template === 'assigned' && n.channel === 'in_app')!
    expect(note).toBeTruthy()
    expect(JSON.stringify(note)).toContain('/crew/cal/')
    // The same assignment again sends nothing new.
    await notifyAssigned(ctx, S, SLOT)
    expect(rows(db, 'crew_notifications').filter(n => n.template === 'assigned' && n.channel === 'in_app')).toHaveLength(1)
  })

  it('does nothing for a spot nobody holds, and for a draft party', async () => {
    expect(await notifyAssigned({ sb: world([slot(SLOT, 'p1', null)]).sb, now: NOW, senders: senders() }, S, SLOT)).toBe('held')
    const draft = world([slot(SLOT, 'p1', 'a')], [party('p1', 10, { status: 'draft' })])
    expect(await notifyAssigned({ sb: draft.sb, now: NOW, senders: senders() }, S, SLOT)).toBe('held')
    expect(rows(draft, 'crew_notifications')).toHaveLength(0)
  })

  it('sends nothing while the crew app is off', async () => {
    process.env.CREW_ENABLED = 'false'
    const db = world([slot(SLOT, 'p1', 'a')])
    const t = senders()
    expect(await notifyAssigned({ sb: db.sb, now: NOW, senders: t }, S, SLOT)).toBe('held')
    expect(t.sms).not.toHaveBeenCalled()
    expect(t.email).not.toHaveBeenCalled()
  })
})

// ── The card ────────────────────────────────────────────────────────────────

describe('needsConfirm and the calendar link on the board', () => {
  async function board(db: FakeCrewDb) {
    const member = rows(db, 'crew_members').find(m => m.id === 'a')
    const ctx = await loadViewerContext(db.sb, member, S, NOW)
    if (ctx.kind !== 'ok') throw new Error('context')
    const b = await loadBoard(db.sb, ctx.data)
    if (b.kind !== 'ok') throw new Error('board')
    return b.data
  }

  it('a spot the manager assigned needs acceptance now, however far out the party is', async () => {
    const b = await board(world([slot(SLOT, 'p1', 'a', { assigned_via: 'admin' })]))
    expect(b).toHaveLength(1)
    expect(b[0].needsConfirm).toBe(true)
    expect(b[0].calUrl).toContain('/crew/cal/')
  })

  it('a spot I claimed myself waits for the confirmation request, as before', async () => {
    const b = await board(world([slot(SLOT, 'p1', 'a', { assigned_via: 'claim' })]))
    expect(b[0].needsConfirm).toBe(false)
  })

  it('once accepted it no longer asks, and still offers the calendar', async () => {
    const b = await board(world([slot(SLOT, 'p1', 'a', { assigned_via: 'admin', confirmed_at: '2026-11-02T12:00:00Z' })]))
    expect(b[0].needsConfirm).toBe(false)
    expect(b[0].calUrl).not.toBeNull()
  })

  it('someone who holds nothing gets no link, and the view carries the shift, not the party hours', async () => {
    const db = world([slot(SLOT, 'p1', null)])
    const b = await board(db)
    expect(b[0].calUrl).toBeNull()
    const p = rows(db, 'crew_parties')[0]
    expect(new Date(b[0].view.shiftStartsAt).getTime()).toBeLessThan(new Date(p.starts_at).getTime())
    expect(new Date(b[0].view.shiftEndsAt).getTime()).toBeGreaterThan(new Date(p.ends_at).getTime())
    expect(b[0].view.openSpots[0].shiftStartsAt).toBe(b[0].view.shiftStartsAt)
  })
})

// ── The calendar route ──────────────────────────────────────────────────────

describe('GET /crew/cal/[token]', () => {
  const ENV = { ...process.env }
  let db: FakeCrewDb
  beforeEach(() => {
    jest.resetModules()
    process.env = { ...ENV, CREW_ENABLED: 'true' }
    db = world([slot(SLOT, 'p1', 'a')])
  })
  afterAll(() => { process.env = ENV })

  async function call(token: string, query = '', ua = 'Mozilla/5.0 (Linux; Android 14)') {
    jest.doMock('@/lib/supabase', () => ({ getSupabase: () => db.sb }))
    const { GET } = await import('@/app/crew/cal/[token]/route')
    const req = new NextRequest(`https://example.test/crew/cal/${token}${query}`, { headers: { 'user-agent': ua } })
    return GET(req, { params: { token } })
  }
  const good = () => signCrewCalendar(SLOT, 'a', new Date(rows(db, 'crew_parties')[0].ends_at))

  it('hands an .ics to ?format=ics, and to an iPhone with no format', async () => {
    for (const [q, ua] of [['?format=ics', 'Mozilla/5.0 (Linux)'], ['', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)']] as const) {
      const res = await call(good(), q, ua)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch(/^text\/calendar/)
      expect(res.headers.get('cache-control')).toBe('no-store')
      const body = await res.text()
      expect(body).toContain('BEGIN:VEVENT')
      expect(body).toContain('295 Montauk Hwy')
    }
  })

  it('sends everyone else, and ?format=google, to Google Calendar', async () => {
    for (const q of ['', '?format=google']) {
      const res = await call(good(), q)
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toMatch(/^https:\/\/calendar\.google\.com\/calendar\/render\?/)
    }
  })

  it('answers every refusal with the same bare 404', async () => {
    const missing = await call(signCrewCalendar(OTHER_SLOT, 'a', new Date('2027-01-01T00:00:00Z')))
    const wrongHolder = await call(signCrewCalendar(SLOT, 'someone-else', new Date('2027-01-01T00:00:00Z')))
    const expired = await call(signCrewCalendar(SLOT, 'a', new Date('2026-01-01T00:00:00Z')))
    const junk = await call('nonsense')
    const bodies = []
    for (const res of [missing, wrongHolder, expired, junk]) {
      expect(res.status).toBe(404)
      bodies.push(await res.text())
    }
    expect(new Set(bodies).size).toBe(1)
  })

  it('refuses once the spot is no longer held, and for a cancelled party', async () => {
    const t = good()
    rows(db, 'crew_slots')[0].status = 'open'
    rows(db, 'crew_slots')[0].member_id = null
    expect((await call(t)).status).toBe(404)
    rows(db, 'crew_slots')[0].status = 'assigned'
    rows(db, 'crew_slots')[0].member_id = 'a'
    expect((await call(t, '?format=ics')).status).toBe(200)
    rows(db, 'crew_parties')[0].status = 'cancelled'
    expect((await call(t)).status).toBe(404)
  })

  it('does not exist while the crew app is closed', async () => {
    process.env = { ...ENV }
    delete process.env.CREW_ENABLED
    delete process.env.CREW_TEST_LOGIN
    delete process.env.CREW_ONBOARDING_ENABLED
    expect((await call(good())).status).toBe(404)
  })
})

// ── The screens ─────────────────────────────────────────────────────────────

describe('the screens', () => {
  const src = (f: string) => fs.readFileSync(path.join(__dirname, '../../../', f), 'utf8')

  it('the card shows the SHIFT and opens Accept Assignment, not a bare confirm button', () => {
    const card = src('app/crew/_components/PartyCard.tsx')
    expect(card).toContain('<AcceptAssignment')
    expect(card).not.toContain("I'll be there")
    expect(card).toMatch(/partyTimeLabel\(v\.shiftStartsAt, v\.shiftEndsAt\)/)
    expect(card).toMatch(/partyTimeLabel\(s\.shiftStartsAt, s\.shiftEndsAt\)/)
    // The party's own hours are no longer what the card tells someone they are committing to.
    expect(card).not.toMatch(/partyTimeLabel\(v\.startsAt, v\.endsAt\)/)
  })

  it('only the dialog\'s own confirm button accepts', () => {
    const c = src('app/crew/_components/AcceptAssignment.tsx')
    expect(c).toContain('Accept Assignment')
    expect(c).toContain('Yes, accept assignment')
    expect(c.match(/fetch\(/g) ?? []).toHaveLength(1)
    // The opening button must not post: it only opens the dialog.
    const opener = /<button[^>]*onClick=\{\(\) => \{[^}]*setOpen\(true\)[^}]*\}\}[^>]*>Accept Assignment<\/button>/.exec(c)
    expect(opener).not.toBeNull()
    expect(opener![0]).not.toContain('accept()')
    expect(c).toContain('?format=google')
    expect(c).toContain('?format=ics')
  })

  it('the home page lists assignments to accept as full cards', () => {
    const page = src('app/crew/page.tsx')
    expect(page).toContain('Accept your assignments')
    expect(page).not.toContain("I'll be there")
    expect(page).toMatch(/confirm\.map\(b => <PartyCard/)
  })

  it('the detail page offers the calendar to someone who holds a spot', () => {
    const page = src('app/crew/parties/[id]/page.tsx')
    expect(page).toContain('Add to your calendar')
    expect(page).toContain('b.calUrl')
  })
})
