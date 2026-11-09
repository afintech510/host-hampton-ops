/**
 * The Leads "Refresh" button: the text catch-up (lib/leadsRefresh), the one-line account of it, the
 * "Upcoming" filter, and the tile / editor changes that shipped with it.
 */
import fs from 'fs'
import path from 'path'
import { refreshQuoTexts, type TextRefreshDeps } from '@/lib/leadsRefresh'
import { describeRefresh } from '@/app/admin/crew/_components/LeadsRefresh'
import { isUpcoming, upcomingFrom } from '@/lib/bookingWeeks'

const NOW = new Date('2026-11-09T15:00:00Z') // Monday, 10am ET

type Row = Record<string, any>

/** A supabase double for the three shapes the refresh uses: read bookings, read ids, insert a message. */
function world(opts: { bookings: Row[]; recorded?: string[]; insertError?: { code?: string; message: string } }) {
  const inserted: Row[] = []
  const recorded = new Set(opts.recorded ?? [])
  const sb: any = {
    from(table: string) {
      const q: any = {
        select: () => q, not: () => q, or: () => q, order: () => q, limit: () => q,
        in: (_col: string, ids: string[]) => {
          q._ids = ids
          return q
        },
        insert: (row: Row) => {
          q._insert = row
          return q
        },
        single: async () => {
          if (opts.insertError) return { data: null, error: opts.insertError }
          if (recorded.has(q._insert.external_id)) return { data: null, error: { code: '23505', message: 'duplicate' } }
          inserted.push(q._insert)
          recorded.add(q._insert.external_id)
          return { data: { id: `row-${inserted.length}` }, error: null }
        },
        then: (res: any) => {
          if (table === 'bookings') return res({ data: opts.bookings, error: null })
          return res({ data: (q._ids ?? []).filter((id: string) => recorded.has(id)).map((external_id: string) => ({ external_id })), error: null })
        },
      }
      return q
    },
  }
  return { sb, inserted }
}

const BOOKINGS = [
  { id: 'b1', contact_phone: '(631) 555-0100', created_at: '2026-11-01T00:00:00Z' },
  { id: 'b2', contact_phone: '631-555-0200', created_at: '2026-11-02T00:00:00Z' },
]

function deps(conversations: Array<{ id: string; participants: string[] }> | null, thread: (phone: string) => any): TextRefreshDeps & { read: string[] } {
  const read: string[] = []
  return {
    read,
    listConversations: async () => conversations && conversations.map(c => ({ ...c, lastActivityId: null })),
    fetchThread: async (phone: string) => {
      read.push(phone)
      return thread(phone)
    },
  }
}

const msg = (id: string, direction: 'in' | 'out', text: string, at = '2026-11-08T12:00:00Z') => ({ id, at, direction, text, hasMedia: false, status: null })

describe('refreshQuoTexts', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('records the texts it had not seen, in both directions, against the booking', async () => {
    const { sb, inserted } = world({ bookings: BOOKINGS })
    const d = deps([{ id: 'CN1', participants: ['+16315550100', '+16315559999'] }], () => ({
      kind: 'ok', messages: [msg('AC1', 'in', 'Can we move to 3?'), msg('AC2', 'out', 'Sure!', '2026-11-08T12:05:00Z')],
    }))
    const r = await refreshQuoTexts(sb, NOW, d)
    expect(r).toMatchObject({ checked: 1, newInbound: 1, newOutbound: 1, stops: 0 })
    expect(r.unavailable).toBeUndefined()
    expect(inserted.map(i => [i.external_id, i.direction, i.booking_id, i.status, i.sent_at])).toEqual([
      ['quo:AC1', 'in', 'b1', 'ignored', '2026-11-08T12:00:00Z'],
      ['quo:AC2', 'out', 'b1', 'ignored', '2026-11-08T12:05:00Z'],
    ])
  })

  it('skips a text the webhook already recorded (same quo:<id>)', async () => {
    const { sb, inserted } = world({ bookings: BOOKINGS, recorded: ['quo:AC1'] })
    const d = deps([{ id: 'CN1', participants: ['+16315550100'] }], () => ({ kind: 'ok', messages: [msg('AC1', 'in', 'hi'), msg('AC2', 'in', 'again')] }))
    const r = await refreshQuoTexts(sb, NOW, d)
    expect(r.newInbound).toBe(1)
    expect(inserted.map(i => i.external_id)).toEqual(['quo:AC2'])
  })

  it('reads only conversations with a lead or booking, not every thread in Quo', async () => {
    const { sb } = world({ bookings: BOOKINGS })
    const d = deps(
      [{ id: 'CN1', participants: ['+16315550200'] }, { id: 'CN2', participants: ['+19998887777'] }],
      () => ({ kind: 'ok', messages: [] }),
    )
    const r = await refreshQuoTexts(sb, NOW, d)
    expect(d.read).toEqual(['631-555-0200'])
    expect(r.checked).toBe(1)
  })

  it('counts a STOP but does not act on it', async () => {
    const { sb, inserted } = world({ bookings: BOOKINGS })
    const d = deps([{ id: 'CN1', participants: ['+16315550100'] }], () => ({ kind: 'ok', messages: [msg('AC1', 'in', 'STOP')] }))
    const r = await refreshQuoTexts(sb, NOW, d)
    expect(r.stops).toBe(1)
    expect(inserted).toHaveLength(1)
    expect(inserted[0].status).toBe('ignored')
  })

  it('never drafts: every row it writes is ignored, not new', async () => {
    const { sb, inserted } = world({ bookings: BOOKINGS })
    const d = deps([{ id: 'CN1', participants: ['+16315550100'] }], () => ({ kind: 'ok', messages: [msg('AC1', 'in', 'Hello?')] }))
    await refreshQuoTexts(sb, NOW, d)
    expect(inserted.every(i => i.status === 'ignored')).toBe(true)
  })

  it('says so when Quo cannot be read, rather than reporting "no new texts"', async () => {
    const { sb } = world({ bookings: BOOKINGS })
    const r = await refreshQuoTexts(sb, NOW, deps(null, () => ({ kind: 'ok', messages: [] })))
    expect(r.unavailable).toMatch(/Quo/)
    expect(r.newInbound + r.newOutbound).toBe(0)
  })

  it('says so when one conversation fails to read', async () => {
    const { sb } = world({ bookings: BOOKINGS })
    const d = deps([{ id: 'CN1', participants: ['+16315550100'] }, { id: 'CN2', participants: ['+16315550200'] }], p =>
      p.includes('0100') ? { kind: 'unavailable', reason: 'x' } : { kind: 'ok', messages: [msg('AC9', 'in', 'hi')] })
    const r = await refreshQuoTexts(sb, NOW, d)
    expect(r.checked).toBe(1)
    expect(r.newInbound).toBe(1)
    expect(r.unavailable).toMatch(/1 of 2/)
  })

  it('does not count a refused write as a new text', async () => {
    const { sb } = world({ bookings: BOOKINGS, insertError: { message: 'boom' } })
    const d = deps([{ id: 'CN1', participants: ['+16315550100'] }], () => ({ kind: 'ok', messages: [msg('AC1', 'in', 'hi')] }))
    const r = await refreshQuoTexts(sb, NOW, d)
    expect(r.newInbound).toBe(0)
    expect(r.unavailable).toBeTruthy()
  })

  it('leaves out a booking whose party has already happened', async () => {
    const { sb } = world({ bookings: [{ id: 'b9', contact_phone: '631-555-0300', party_date: '2026-10-01', created_at: '2026-09-01T00:00:00Z' }, ...BOOKINGS] })
    const d = deps([{ id: 'CN9', participants: ['+16315550300'] }], () => ({ kind: 'ok', messages: [] }))
    const r = await refreshQuoTexts(sb, NOW, d)
    expect(d.read).toEqual([])
    expect(r.checked).toBe(0)
  })

  it('ignores texts older than the window', async () => {
    const { sb, inserted } = world({ bookings: BOOKINGS })
    const d = deps([{ id: 'CN1', participants: ['+16315550100'] }], () => ({ kind: 'ok', messages: [msg('OLD', 'in', 'ancient', '2026-09-01T00:00:00Z')] }))
    await refreshQuoTexts(sb, NOW, d)
    expect(inserted).toHaveLength(0)
  })
})

describe('describeRefresh', () => {
  const quiet = { email: { status: 'ok' as const, scanned: 0, recorded: 0 }, texts: { checked: 3, newInbound: 0, newOutbound: 0, stops: 0 } }
  it('says nothing new plainly', () => {
    expect(describeRefresh(quiet)).toEqual({ text: 'No new email · no new texts.', warn: false })
  })
  it('counts what came in', () => {
    const r = describeRefresh({ email: { status: 'ok', recorded: 2 }, texts: { checked: 3, newInbound: 1, newOutbound: 2, stops: 0 } })
    expect(r.text).toBe('2 new emails · 1 new text from clients and 2 sent from Quo.')
    expect(r.warn).toBe(false)
  })
  it('never reports an unchecked half as "nothing new"', () => {
    const r = describeRefresh({ email: { status: 'unavailable', reason: 'Gmail is not connected.' }, texts: { checked: 0, newInbound: 0, newOutbound: 0, stops: 0, unavailable: 'Could not read the conversations in Quo.' } })
    expect(r.warn).toBe(true)
    expect(r.text).toMatch(/email not checked/i)
    expect(r.text).toMatch(/texts not checked/)
    expect(r.text).not.toMatch(/no new/i)
  })
  it('raises a STOP to a person', () => {
    const r = describeRefresh({ ...quiet, texts: { ...quiet.texts, newInbound: 1, stops: 1 } })
    expect(r.warn).toBe(true)
    expect(r.text).toMatch(/STOP/)
  })
})

describe('Upcoming (the Bookings "All" filter)', () => {
  it('starts today on a weekday, so this weekend and everything after shows', () => {
    expect(upcomingFrom('2026-11-09')).toBe('2026-11-09') // Monday
    expect(isUpcoming('2026-11-14', '2026-11-09')).toBe(true) // this Saturday
    expect(isUpcoming('2027-02-06', '2026-11-09')).toBe(true)
    expect(isUpcoming('2026-11-07', '2026-11-09')).toBe(false) // last Saturday
  })
  it('on a Sunday still shows the Saturday of the weekend you are in', () => {
    expect(upcomingFrom('2026-11-08')).toBe('2026-11-07')
    expect(isUpcoming('2026-11-07', '2026-11-08')).toBe(true)
    expect(isUpcoming('2026-11-06', '2026-11-08')).toBe(false)
  })
  it('keeps a booking with no date instead of hiding it', () => {
    expect(isUpcoming(null, '2026-11-09')).toBe(true)
  })
  it('reaches across a month boundary on a Sunday', () => {
    expect(upcomingFrom('2026-11-01')).toBe('2026-10-31')
  })
})

describe('the screens', () => {
  const SRC = path.join(process.cwd(), 'src')
  const read = (p: string) => fs.readFileSync(path.join(SRC, p), 'utf8')

  it('the All chip on Bookings is Upcoming, cut by isUpcoming, and the month chips still show whole months', () => {
    const page = read('app/admin/crew/bookings/page.tsx')
    expect(page).toMatch(/key: 'all', label: 'Upcoming', count: upcoming\.length/)
    expect(page).toMatch(/activeMonth === 'all' \? upcoming : byType\.filter\(t => passesDateFilter/)
  })

  it('Text in Quo and Call in Quo open the Quo app, not the website', () => {
    const b = read('app/admin/crew/_components/ContactButtons.tsx')
    expect(b).toMatch(/quoAppLink\('text', phone\)/)
    expect(b).toMatch(/quoAppLink\('call', phone\)/)
    expect(b).toContain('Text in Quo')
    expect(b).toContain('Call in Quo')
    // The website stays as the way out, behind a tap, not the first thing the button does.
    expect(b).toMatch(/Open the conversation on the web/)
    expect(b).not.toMatch(/onClick=\{\(\) => open\('quo'\)\}[\s\S]{0,80}Text in Quo/)
  })

  it('the staffing section is a short list with Manage staff expanding the controls in place', () => {
    const t = read('app/admin/crew/_components/BookingTile.tsx')
    expect(t).toMatch(/aria-expanded=\{managing\}/)
    expect(t).toMatch(/\{c && managing && <div className="mt-3"><CrewPartyEditor partyId=\{c\.partyId\} embedded/)
    expect(t).not.toContain('Crew coverage')
  })

  it('the party editor has no extra pay per person, and the embedded form drops the facts, standbys and removal', () => {
    const e = read('app/admin/crew/_components/CrewPartyEditor.tsx')
    expect(e).not.toMatch(/Extra pay|ExtraPay|extra_flat_cents/)
    expect(e).toMatch(/\{!embedded && <aside/)
    expect(e).toMatch(/\{!embedded && \(live \|\| \(p\.status === 'cancelled'/)
  })

  it('the Refresh route is admin only and calls the Gmail poll and the text catch-up', () => {
    const r = read('app/api/admin/leads/refresh/route.ts')
    expect(r).toMatch(/if \(!isAdminAuthorized\(req\)\) return unauthorizedResponse\(\)/)
    expect(r).toMatch(/import \{ GET as pollGmail \} from '@\/app\/api\/cron\/gmail-sync\/route'/)
    expect(r).toMatch(/refreshQuoTexts\(getSupabase\(\)\)/)
    // It reads and records; nothing in it sends.
    expect(r).not.toMatch(/sendSMS|sendEmail|sendMessage|fetch\(/)
  })
})
