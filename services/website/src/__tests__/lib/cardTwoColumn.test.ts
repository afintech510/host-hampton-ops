/**
 * The opened Lead and Booking cards are two columns at every width, to keep them short on a phone:
 * who on the left, the party on the right (right-justified), three contact buttons on one row.
 */
import fs from 'fs'
import path from 'path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import BookingDetails from '@/app/admin/crew/_components/BookingDetails'
import { CARD_GRID, CardField } from '@/app/admin/crew/_components/PartyTile'

const SRC = path.join(__dirname, '..', '..')
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8')

const party: any = {
  ref: 'HH-PTY-QAK5Z', bookingId: 'b1', title: "Killian's Party", adminUrl: '', asOf: '2026-11-08T22:00:00Z',
  contact: { name: 'Maggie Malinowski', phone: '5165280651', email: 'maggs017@gmail.com' },
  when: 'Sat, Nov 7 · 12:00 PM', type: 'In-Studio Theme', child: { name: 'Killian', age: 7 }, guests: 10,
  status: 'Completed, paid in full', totalCents: 120000, paidCents: 120000, owedCents: 0, tipCents: 0,
  theme: [{ text: 'Glow Party ($950.00)' }], activities: [], addOns: [{ text: 'Photobooth ($119.00)' }],
  food: [{ text: 'Large Cheese Pizza ($25.00)' }], desserts: [], discounts: [], extraGuests: null,
}

const html = (venue: string | null = null, notes: string | null = null) =>
  renderToStaticMarkup(createElement(BookingDetails, { party, venue, adminNotes: notes, contactActions: createElement('div', null, 'BUTTONS') }))

describe('CardField / CARD_GRID', () => {
  it('right-justifies a field on request and is two columns at every width', () => {
    expect(CARD_GRID).toMatch(/\bgrid-cols-2\b/)
    expect(CARD_GRID).not.toMatch(/sm:grid-cols-1|\bgrid-cols-1\b/)
    const out = renderToStaticMarkup(createElement('dl', null, createElement(CardField, { label: 'Ref', right: true }, 'X'), createElement(CardField, { label: 'Host' }, 'Y')))
    expect(out).toMatch(/<div class="min-w-0 text-right"><dt[^>]*>Ref<\/dt>/)
    expect(out).toMatch(/<div class="min-w-0 "><dt[^>]*>Host<\/dt>/)
  })
})

describe('an opened booking card', () => {
  it('puts the reference, date, type, guests and venue on the right, who on the left', () => {
    const out = html('1 Main St, Speonk')
    const rightLabels = Array.from(out.matchAll(/<div class="min-w-0 text-right"><dt[^>]*>([^<]+)<\/dt>/g)).map(m => m[1])
    expect(rightLabels).toEqual(['Booking reference', 'Date &amp; time', 'Party type', 'Guests', 'Venue'])
    const leftLabels = Array.from(out.matchAll(/<div class="min-w-0 "><dt[^>]*>([^<]+)<\/dt>/g)).map(m => m[1])
    expect(leftLabels.slice(0, 5)).toEqual(['Host', 'Phone', 'Email', 'Celebrating', 'Booking status'])
  })

  it('has no Contact / Party details headings, and the buttons come right after the fields', () => {
    const out = html()
    expect(out).not.toMatch(/>Contact<\/h3>|>Party details<\/h3>/)
    expect(out.indexOf('Booking status')).toBeLessThan(out.indexOf('BUTTONS'))
    expect(out.indexOf('BUTTONS')).toBeLessThan(out.indexOf('Party plan'))
  })

  it('keeps every piece of data the single-column card showed', () => {
    const out = html('1 Main St, Speonk', 'Allergy: nuts')
    for (const s of ['Maggie Malinowski', 'HH-PTY-QAK5Z', '5165280651', 'maggs017@gmail.com', 'Sat, Nov 7 · 12:00 PM', 'In-Studio Theme',
      'Killian', 'Completed, paid in full', '1 Main St, Speonk', 'Glow Party ($950.00)', 'Photobooth ($119.00)', 'Large Cheese Pizza ($25.00)',
      'Total', 'Paid', 'Balance', 'Updated', 'Internal notes', 'Allergy: nuts']) {
      expect(out).toContain(s)
    }
  })

  it('lays the party plan and the payment summary out in columns', () => {
    const out = html()
    expect(out).toMatch(/<dl class="grid grid-cols-2[^"]*"><div class="min-w-0 "><dt[^>]*>Theme \/ package/)
    expect(out).toMatch(/grid-cols-3[^"]*"><div class="min-w-0 "><dt[^>]*>Total/)
  })
})

describe('the wiring', () => {
  it('the lead card uses the same grid, with the right-hand column right-justified', () => {
    const l = read('app/admin/crew/leads/page.tsx')
    expect(l).toMatch(/<dl className=\{`mb-3 \$\{CARD_GRID\}`\}>/)
    for (const label of ['Booking reference', 'Party type', 'Package', 'Payments received']) {
      expect(l).toMatch(new RegExp(`<CardField label="${label}" right>`))
    }
    expect(l).not.toContain('<CardSection title="Party details">')
    expect(l).not.toContain('sm:grid-cols-2')
  })

  it('the three contact buttons share one row', () => {
    const c = read('app/admin/crew/_components/ContactButtons.tsx')
    expect(c).toMatch(/<div className="flex gap-1\.5">/)
    expect(c.match(/className=\{BTN\}/g)?.length).toBe(3)
  })

  it('staff on a booking are two across', () => {
    expect(read('app/admin/crew/_components/BookingTile.tsx')).toMatch(/<ul className="grid grid-cols-2 gap-x-4/)
  })
})
