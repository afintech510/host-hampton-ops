import { makeFakeEviteDb } from './fakeEviteDb'
import { bookingRow, evitesRow, LINE_ITEM_ROWS, THEME_ROWS } from './eviteFixtures'
import { EVITE_ID, rsvpChecks, rsvpRow, uuid } from './rsvpFixtures'
import { loadSendContext } from '@/lib/evites/sendContext'
import { renderInputsHash } from '@/lib/evites/hash'

/**
 * Fixtures for the send path (P09a): Mia's Glow party, Saturday 14 Nov 2026 at 2 PM ET, booked
 * ($250 deposit), with the tables `loadSendContext`, the ledger and the suppression list read.
 *
 * `SEND_NOW` is two weeks before the party, so every send type is still inside its window.
 */

export { EVITE_ID, rsvpRow, uuid }
export const SEND_NOW = new Date('2026-11-01T15:00:00Z')
export const SLUG = 'mia-glow-7kq2'

type Row = Record<string, unknown>

export const SEND_UNIQUES = {
  evite_sends: [{ name: 'uniq_evite_send_once', cols: ['evite_id', 'rsvp_id', 'send_type', 'ref_version', 'channel'], nullsNotDistinct: true }],
}

export interface SendDbOptions {
  evite?: Row
  booking?: Row
  rsvps?: Row[]
  sends?: Row[]
  contacts?: Row[]
  interactions?: Row[]
  payments?: Row[]
}

export function sendRow(over: Row = {}): Row {
  return {
    id: uuid(),
    evite_id: EVITE_ID,
    rsvp_id: null,
    send_type: 'new_rsvp',
    ref_version: 1,
    channel: 'email',
    status: 'sending',
    attempts: 1,
    outcome: null,
    provider_id: null,
    last_error: null,
    claimed_at: SEND_NOW.toISOString(),
    sent_at: null,
    ...over,
  }
}

export function makeSendDb(o: SendDbOptions = {}) {
  return makeFakeEviteDb({
    tables: {
      evites: [evitesRow({ id: EVITE_ID, previous_slugs: [], cal_version: 0, cal_changed_at: null, went_live_at: null, cancelled_notice_at: null, created_at: '2026-10-01T12:05:00Z', ...o.evite })],
      bookings: [bookingRow(o.booking)],
      booking_payments: o.payments ?? [{ booking_id: 'bk-1', amount_cents: 25000, payment_type: 'deposit' }],
      booking_line_items: LINE_ITEM_ROWS,
      party_themes: THEME_ROWS,
      evite_rsvps: o.rsvps ?? [],
      evite_sends: o.sends ?? [],
      contacts: o.contacts ?? [],
      contact_interactions: o.interactions ?? [],
      portal_tokens: [],
    },
    rowDefaults: {
      evite_sends: () => ({ id: uuid(), outcome: null, provider_id: null, last_error: null, sent_at: null }),
      portal_tokens: () => ({ id: uuid() }),
    },
    generated: { evite_rsvps: (r) => ({ child_count: Array.isArray(r.children) ? r.children.length : 0 }) },
    checks: { evite_rsvps: rsvpChecks },
    uniques: SEND_UNIQUES,
  })
}

export type SendDb = ReturnType<typeof makeSendDb>

/** A guest RSVP that wants reminders. */
export const guestRsvp = (over: Row = {}): Row => rsvpRow({ id: uuid(), parent_name: 'Gina Guest', reminder_email: 'gina@example.com', children: [{ first_name: 'Ava' }], ...over })

/**
 * Give the invitation a render that is FRESH for what it says right now: the stored object
 * names and a `render_inputs_hash` equal to the hash of the facts the loader will build.
 */
export async function freshenRender(db: SendDb, now: Date = SEND_NOW): Promise<void> {
  const ev = db.tables.evites[0]
  Object.assign(ev, { image_key: '0123456789abcdef0123456789abcdef', invite_object: 'invite-v1-9f2c.jpg', og_object: 'og-v1-9f2c.jpg' })
  const read = await loadSendContext(db.supabase, EVITE_ID, null, now)
  if (read.kind !== 'ok') throw new Error(`fixture: cannot load context (${read.kind})`)
  ev.render_inputs_hash = renderInputsHash(read.ctx.facts)
}
