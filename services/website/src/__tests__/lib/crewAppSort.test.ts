/**
 * Sorting Leads and Bookings, the lead's Mark lost / Add payment buttons, and the
 * heading row that carries the Sort button.
 */
import fs from 'fs'
import path from 'path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { decomment } from '../helpers/sourceScan'

import { LEAD_SORTS, BOOKING_SORTS, sortLeads, sortBookings } from '@/lib/crewAppSort'
import { dollarsToCents, paymentBody, PAY_METHODS } from '@/app/admin/crew/_components/LeadActions'
import { ADMIN_PAYMENT_METHODS } from '@/lib/adminMoney'
import SortMenu from '@/app/admin/crew/_components/SortMenu'
import { CrewFrame } from '@/app/admin/crew/_components/adminCrew'

const read = (rel: string) => decomment(fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8'))

const lead = (id: string, over: Record<string, unknown>) => ({ id, lastContactAt: '2026-11-01T00:00:00Z', partyDate: null, totalCents: null, ...over }) as { id: string; lastContactAt: string; partyDate: string | null; totalCents: number | null }
const leads = [
  lead('old', { lastContactAt: '2026-10-01T00:00:00Z', partyDate: '2026-12-20', totalCents: 50_000 }),
  lead('new', { lastContactAt: '2026-11-05T00:00:00Z', partyDate: '2026-11-20', totalCents: 150_000 }),
  lead('mid', { lastContactAt: '2026-11-02T00:00:00Z', partyDate: null, totalCents: 0 }),
  lead('nodate', { lastContactAt: '2026-10-15T00:00:00Z', partyDate: null, totalCents: null }),
  lead('cheap', { lastContactAt: '2026-10-20T00:00:00Z', partyDate: '2027-01-05', totalCents: 20_000 }),
]
const ids = (rows: { id: string }[]) => rows.map(r => r.id)

describe('lead sorting', () => {
  it('offers the six orders asked for, most recent contact first', () => {
    expect(LEAD_SORTS.map(o => o.key)).toEqual(['contact_desc', 'contact_asc', 'event_asc', 'event_desc', 'value_desc', 'value_asc'])
    expect(LEAD_SORTS[0].label).toBe('Most recent contact')
  })

  it('most recent contact, and its reverse', () => {
    expect(ids(sortLeads(leads, 'contact_desc'))).toEqual(['new', 'mid', 'cheap', 'nodate', 'old'])
    expect(ids(sortLeads(leads, 'contact_asc'))).toEqual(['old', 'nodate', 'cheap', 'mid', 'new'])
  })

  it('event date earliest / latest, with the undated always at the bottom', () => {
    expect(ids(sortLeads(leads, 'event_asc'))).toEqual(['new', 'old', 'cheap', 'mid', 'nodate'])
    expect(ids(sortLeads(leads, 'event_desc'))).toEqual(['cheap', 'old', 'new', 'mid', 'nodate'])
  })

  it('value high to low / low to high, with the unpriced (null or $0) always at the bottom', () => {
    expect(ids(sortLeads(leads, 'value_desc'))).toEqual(['new', 'old', 'cheap', 'mid', 'nodate'])
    expect(ids(sortLeads(leads, 'value_asc'))).toEqual(['cheap', 'old', 'new', 'mid', 'nodate'])
  })

  it('never drops or duplicates a row and leaves the input alone', () => {
    const copy = [...leads]
    for (const o of LEAD_SORTS) expect(ids(sortLeads(leads, o.key)).sort()).toEqual(ids(leads).sort())
    expect(leads).toEqual(copy)
  })
})

describe('booking sorting', () => {
  const b = (ref: string, date: string | null, time: string | null, totalCents: number) => ({ ref, partyDate: date, partyTime: time, totalCents })
  const rows = [b('c', '2026-11-20', '2:00 PM', 50_000), b('a', '2026-11-05', '1:00 PM', 200_000), b('b', '2026-11-20', '12:00 PM', 50_000), b('z', null, null, 999_999)]
  const refs = (r: { ref: string }[]) => r.map(x => x.ref)

  it('offers date and value, each both ways', () => {
    expect(BOOKING_SORTS.map(o => o.key)).toEqual(['date_asc', 'date_desc', 'value_desc', 'value_asc'])
  })

  it('by date, soonest or latest first, ties broken by time then reference, undated last', () => {
    expect(refs(sortBookings(rows, 'date_asc'))).toEqual(['a', 'b', 'c', 'z'])
    expect(refs(sortBookings(rows, 'date_desc'))).toEqual(['c', 'b', 'a', 'z'])
  })

  it('by value, ties falling back to the soonest date', () => {
    expect(refs(sortBookings(rows, 'value_desc'))).toEqual(['z', 'a', 'b', 'c'])
    expect(refs(sortBookings(rows, 'value_asc'))).toEqual(['b', 'c', 'a', 'z'])
  })
})

describe('the sort button', () => {
  it('is a labelled "Sort" button in a small pill', () => {
    const h = renderToStaticMarkup(createElement(SortMenu, { options: LEAD_SORTS, value: 'contact_desc', onChange: () => undefined } as never))
    expect(h).toContain('aria-label="Sort"')
    expect(h).toContain('</svg> Sort</button>')
    expect(h).toContain('aria-haspopup="listbox"')
    expect(h).not.toContain('listbox"') // closed until pressed: the list is not rendered
  })

  it('the heading and the Sort button share one row, heading left and button right', () => {
    const h = renderToStaticMarkup(createElement(CrewFrame, { title: 'Leads', compact: true, actions: createElement('i', { id: 'sort' }) } as never, createElement('b')))
    expect(h).toMatch(/<h1[^>]*>Leads<\/h1><i id="sort">/)
    expect(h).toContain('justify-between')
    expect(h).not.toContain('sr-only')
    // Without controls the compact top keeps no visible heading (Payments).
    expect(renderToStaticMarkup(createElement(CrewFrame, { title: 'Payments', compact: true } as never, createElement('b')))).toContain('sr-only')
  })

  it('Leads and Bookings show the heading and Sort, with no sub line under the heading', () => {
    for (const [p, label] of [['leads', 'LEAD_SORTS'], ['bookings', 'BOOKING_SORTS']] as const) {
      const s = read(`app/admin/crew/${p}/page.tsx`)
      expect(s).toMatch(new RegExp(`<CrewFrame[\\s\\S]{0,200}compact[\\s\\S]{0,120}actions=\\{<SortMenu options=\\{${label}\\}`))
      expect(s).not.toMatch(/<CrewFrame[^>]*\bsub=/)
      expect(s).not.toContain('refreshing')
    }
    expect(read('app/admin/crew/leads/page.tsx')).toMatch(/sortLeads\(/)
    expect(read('app/admin/crew/bookings/page.tsx')).toMatch(/sortBookings\(/)
  })
})

describe('Add payment on a lead', () => {
  it('reads dollars the way people type them, and refuses anything else', () => {
    expect(dollarsToCents('250')).toBe(25_000)
    expect(dollarsToCents('$1,250.50')).toBe(125_050)
    expect(dollarsToCents('99.9')).toBe(9_990)
    for (const bad of ['', '0', '-5', 'abc', '12.345', '1e3', '$', '100000000']) expect(dollarsToCents(bad)).toBeNull()
  })

  it('offers cash, Zelle, GoDaddy and other, and every one maps to a method the payments table accepts', () => {
    expect(PAY_METHODS.map(m => m.label)).toEqual(['Cash', 'Zelle', 'GoDaddy', 'Other'])
    for (const m of PAY_METHODS) expect(ADMIN_PAYMENT_METHODS).toContain(m.method)
  })

  it('GoDaddy is a card payment noted as the GoDaddy terminal; no receipt unless asked', () => {
    const gd = paymentBody({ cents: 25_000, method: 'godaddy', type: 'deposit', note: 'Held the date', receipt: false })
    expect(gd).toEqual({ action: 'record_payment', amount_cents: 25_000, payment_method: 'card', payment_type: 'deposit', notes: 'GoDaddy card terminal - Held the date', send_receipt: false })
    const cash = paymentBody({ cents: 5_000, method: 'cash', type: 'partial', note: '', receipt: true })
    expect(cash).toEqual({ action: 'record_payment', amount_cents: 5_000, payment_method: 'cash', payment_type: 'partial', send_receipt: true })
  })

  it('both buttons confirm first, use the dashboard actions, and refresh every screen', () => {
    const s = read('app/admin/crew/_components/LeadActions.tsx')
    expect(s).toContain('Mark lead lost')
    expect(s).toContain('Add payment')
    expect(s).toMatch(/window\.confirm\(`Mark \$\{name\} as lost/)
    expect(s).toMatch(/window\.confirm\(`Record /)
    expect(s).toMatch(/action: 'mark_lost'/)
    expect(s).toMatch(/refreshAll\(\)/)
    // The only two writes it can make are the Parties tab's own actions.
    expect(Array.from(s.matchAll(/action: '([a-z_]+)'/g)).map(m => m[1]).sort()).toEqual(['mark_lost', 'record_payment'])
    expect(read('app/admin/crew/leads/page.tsx')).toMatch(/<LeadActions bookingId=\{lead\.id\} name=\{lead\.name\} \/>/)
  })
})
