/** Rows for the render tests: Mia's Glow party, booked, with every column `renderEvite` reads. */

export const NOW = new Date('2026-11-01T15:00:00Z')

export const evitesRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'ev-1',
  booking_id: 'bk-1',
  slug: 'mia-glow-7kq2',
  template_slug: 'glow',
  theme_word: null,
  theme_sub: null,
  host_contact_name: null,
  host_contact_phone: null,
  show_host_contact: true,
  host_note: null,
  gift_note: null,
  rsvp_deadline: null,
  render_version: 0,
  render_inputs_hash: null,
  image_key: null,
  invite_object: null,
  og_object: null,
  render_claim: null,
  render_claimed_at: null,
  render_error: null,
  archived_at: null,
  ...over,
})

export const bookingRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'bk-1',
  booking_ref: 'HH-TEST-1',
  status: 'deposit_paid',
  party_type: 'in_studio_theme',
  event_type: null,
  party_date: '2026-11-14', // a Saturday
  party_time: '14:00',
  package_type: 'Glow Party',
  guest_count_approx: 12,
  child_name: 'Mia',
  child_age: 7,
  contact_name: 'Pat Example',
  contact_email: 'pat@example.com',
  party_tags: { location_type: 'host_hampton' },
  quote_snapshot: null,
  created_at: '2026-10-01T12:00:00Z',
  ...over,
})

export const THEME_ROWS = [
  { id: 't1', name: 'Glow Party', slug: 'glow-party', pricing_item_id: 'pi-glow' },
  { id: 't2', name: 'Swiftie Party', slug: 'swiftie-party', pricing_item_id: 'pi-swift' },
]

export const LINE_ITEM_ROWS = [{ booking_id: 'bk-1', name: 'Glow Party', category: 'theme', pricing_item_id: 'pi-glow' }]

export const tablesFor = (over: { evite?: Record<string, unknown>; booking?: Record<string, unknown> } = {}) => ({
  evites: [evitesRow(over.evite)],
  bookings: [bookingRow(over.booking)],
  booking_payments: [{ booking_id: 'bk-1', amount_cents: 25000, payment_type: 'deposit' }],
  booking_line_items: LINE_ITEM_ROWS,
  party_themes: THEME_ROWS,
})
