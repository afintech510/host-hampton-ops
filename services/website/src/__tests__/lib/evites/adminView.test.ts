import {
  ADMIN_CONTACT_PRESENCE_COLUMNS,
  ADMIN_EVITE_COLUMNS,
  ADMIN_REVEAL_COLUMNS,
  ADMIN_SEND_COLUMNS,
  STUCK_SENDING_MS,
  adminRsvpViews,
  inviteImageUrl,
  isTemplateSlug,
  isUuidLike,
  screenThemeText,
  storedOgUrl,
  summarizeRsvps,
  summarizeSends,
  type AdminRsvpRow,
} from '@/lib/evites/adminView'
import { adminHooks, notifyPartyCancelled } from '@/lib/evites/adminHooks'
import { ADMIN_RSVP_COLUMNS } from '@/lib/evites/views'

/** The pure half of the admin card (P08): allow-lists, headcount, ledger, theme screening, image URLs, the hook stub. */

const NOW = new Date('2026-11-01T15:00:00Z')

const rsvp = (over: Partial<AdminRsvpRow> = {}): AdminRsvpRow => ({
  id: '00000000-0000-4000-8000-000000000001',
  status: 'yes',
  revision: 1,
  parent_name: 'Pat',
  children: [{ first_name: 'Ava' }],
  child_count: 1,
  adult_count: 1,
  has_allergy: false,
  allergy_note: null,
  note_to_honoree: null,
  reminder_opt_out_at: null,
  club_opt_in_at: null,
  club_opted_out_at: null,
  allergy_purged_at: null,
  contacts_purged_at: null,
  created_at: '2026-10-20T12:00:00Z',
  updated_at: '2026-10-20T12:00:00Z',
  ...over,
})

describe('the allow-lists', () => {
  it('the evite list leaves out the render claim token; the send list leaves out the provider id', () => {
    expect(ADMIN_EVITE_COLUMNS as readonly string[]).not.toContain('render_claim')
    expect(ADMIN_EVITE_COLUMNS as readonly string[]).not.toContain('*')
    expect(ADMIN_SEND_COLUMNS as readonly string[]).not.toContain('provider_id')
    expect(ADMIN_SEND_COLUMNS).toEqual(expect.arrayContaining(['send_type', 'status', 'last_error', 'claimed_at']))
    expect(ADMIN_EVITE_COLUMNS).toEqual(expect.arrayContaining(['slug', 'previous_slugs', 'went_live_at', 'archived_at', 'render_error']))
  })

  it('raw contacts appear ONLY in the presence list and the reveal list, never in the card list', () => {
    const raw = ['reminder_email', 'reminder_phone_e164', 'club_email']
    for (const c of raw) expect(ADMIN_RSVP_COLUMNS as readonly string[]).not.toContain(c)
    expect(ADMIN_CONTACT_PRESENCE_COLUMNS).toEqual(['id', ...raw])
    expect(ADMIN_REVEAL_COLUMNS).toEqual(expect.arrayContaining(raw))
    for (const banned of ['edit_nonce', 'consent_ip', 'contact_id']) {
      for (const list of [ADMIN_RSVP_COLUMNS, ADMIN_CONTACT_PRESENCE_COLUMNS, ADMIN_REVEAL_COLUMNS] as Array<readonly string[]>) {
        expect(list).not.toContain(banned)
      }
    }
  })
})

describe('adminRsvpViews', () => {
  it('copies only the named columns and turns the contact columns into two booleans', () => {
    const row = { ...rsvp({ id: 'a' }), reminder_email: 'x@y.org', edit_nonce: 'AAAAAAAAAAAAAAAA', consent_ip: '1.2.3.4' } as unknown as AdminRsvpRow
    const [v] = adminRsvpViews(
      [row],
      [{ id: 'a', reminder_email: 'x@y.org', reminder_phone_e164: null, club_email: null }],
      ADMIN_RSVP_COLUMNS,
    )
    expect(Object.keys(v).sort()).toEqual([...ADMIN_RSVP_COLUMNS, 'hasReminderContact', 'hasClubEmail'].sort())
    expect(JSON.stringify(v)).not.toContain('x@y.org')
    expect(v.hasReminderContact).toBe(true)
    expect(v.hasClubEmail).toBe(false)
  })

  it('a blank string or a missing presence row is "no contact"', () => {
    const [a, b] = adminRsvpViews(
      [rsvp({ id: 'a' }), rsvp({ id: 'b' })],
      [{ id: 'a', reminder_email: '  ', reminder_phone_e164: null, club_email: '' }],
      ADMIN_RSVP_COLUMNS,
    )
    expect(a).toMatchObject({ hasReminderContact: false, hasClubEmail: false })
    expect(b).toMatchObject({ hasReminderContact: false, hasClubEmail: false })
  })
})

describe('summarizeRsvps', () => {
  const view = (o: Partial<AdminRsvpRow>, contact = false) => adminRsvpViews([rsvp(o)], contact ? [{ id: o.id ?? '00000000-0000-4000-8000-000000000001', reminder_email: 'a@b.co', reminder_phone_e164: null, club_email: null }] : [], ADMIN_RSVP_COLUMNS)[0]

  it('no RSVPs: zeroes, and no cap means never over', () => {
    expect(summarizeRsvps([], null)).toMatchObject({ yesCount: 0, noCount: 0, kidsYes: 0, adultsYes: 0, overCap: false, allergies: [], notes: [] })
  })

  it('counts kids from the children array, adults as a floor ("2+"), and only yes answers', () => {
    const rows = [
      view({ id: '1', children: [{ first_name: 'A' }, { first_name: 'B' }], adult_count: 2 }, true),
      view({ id: '2', children: [{ first_name: 'C' }], adult_count: 0 }),
      view({ id: '3', status: 'no', children: [], adult_count: 0 }),
    ]
    expect(summarizeRsvps(rows, 3)).toMatchObject({ yesCount: 2, noCount: 1, kidsYes: 3, adultsYes: 2, adultsPlus: true, overCap: false, withReminderContact: 1 })
    expect(summarizeRsvps(rows, 2).overCap).toBe(true)
  })

  it('notes to the birthday child are kept from declines too; blank notes are dropped', () => {
    const rows = [view({ id: '1', note_to_honoree: 'Happy birthday!' }), view({ id: '2', status: 'no', children: [], adult_count: 0, note_to_honoree: 'Sorry!' }), view({ id: '3', note_to_honoree: '   ' })]
    expect(summarizeRsvps(rows, null).notes).toEqual([
      { parent: 'Pat', note: 'Happy birthday!' },
      { parent: 'Pat', note: 'Sorry!' },
    ])
  })

  it('a flagged allergy with no note, a note with no flag, and a purged note', () => {
    const rows = [
      view({ id: '1', has_allergy: true }),
      view({ id: '2', has_allergy: false, allergy_note: 'tree nuts' }),
      view({ id: '3', has_allergy: true, allergy_purged_at: '2026-10-30T00:00:00Z' }),
    ]
    const { allergies } = summarizeRsvps(rows, null)
    expect(allergies.map((a) => [a.note, a.purged])).toEqual([[null, false], ['tree nuts', false], [null, true]])
  })
})

describe('summarizeSends', () => {
  const s = (o: Record<string, unknown>) => ({
    rsvp_id: null,
    send_type: 'lead_preview',
    channel: 'email',
    status: 'sent',
    attempts: 1,
    outcome: null,
    last_error: null,
    claimed_at: '2026-10-31T12:00:00Z',
    sent_at: '2026-10-31T12:00:05Z',
    ...o,
  }) as never

  it('groups by (type, channel) in spec order and counts each status', () => {
    const g = summarizeSends(
      [s({ send_type: 'day_before', claimed_at: '2026-11-13T20:00:00Z' }), s({ send_type: 'lead_preview' }), s({ send_type: 'lead_preview', status: 'skipped' }), s({ send_type: 'lead_preview', channel: 'sms' })],
      NOW,
    )
    expect(g.map((x) => `${x.sendType}/${x.channel}`)).toEqual(['lead_preview/email', 'lead_preview/sms', 'day_before/email'])
    expect(g[0].counts).toEqual({ sending: 0, sent: 1, failed: 0, skipped: 1 })
    expect(g[0].total).toBe(2)
  })

  it('"stuck" is every failed row, and a sending row only after 15 minutes', () => {
    const edge = new Date(NOW.getTime() - STUCK_SENDING_MS).toISOString()
    const justUnder = new Date(NOW.getTime() - STUCK_SENDING_MS + 1000).toISOString()
    const g = summarizeSends(
      [
        s({ send_type: 'new_rsvp', status: 'sending', claimed_at: justUnder }),
        s({ send_type: 'new_rsvp', status: 'sending', claimed_at: edge }), // exactly 15 min: not yet
        s({ send_type: 'new_rsvp', status: 'sending', claimed_at: new Date(NOW.getTime() - STUCK_SENDING_MS - 1000).toISOString() }),
        s({ send_type: 'new_rsvp', status: 'failed', last_error: 'x' }),
      ],
      NOW,
    )
    expect(g[0].stuckCount).toBe(2)
    expect(g[0].problems.map((p) => p.status).sort()).toEqual(['failed', 'sending'])
  })

  it('lists at most five problems but counts them all', () => {
    const rows = Array.from({ length: 8 }, (_, i) => s({ send_type: 'week_before', status: 'failed', rsvp_id: `r${i}` }))
    const [g] = summarizeSends(rows, NOW)
    expect(g.stuckCount).toBe(8)
    expect(g.problems).toHaveLength(5)
  })

  it('the latest row is the most recently CLAIMED, whatever order they arrive in', () => {
    const [g] = summarizeSends([s({ claimed_at: '2026-10-31T09:00:00Z' }), s({ claimed_at: '2026-10-31T15:00:00Z', status: 'failed' }), s({ claimed_at: '2026-10-31T12:00:00Z' })], NOW)
    expect(g.latest).toMatchObject({ claimedAt: '2026-10-31T15:00:00Z', status: 'failed' })
  })

  it('an empty ledger is an empty list', () => {
    expect(summarizeSends([], NOW)).toEqual([])
  })
})

describe('screenThemeText', () => {
  it.each([
    [null, null],
    [undefined, null],
    ['', null],
    ['   ', null],
    ['Glow', 'Glow'],
    ['  two   words ', 'two words'],
    ['TWELVE CHARS', 'TWELVE CHARS'],
  ])('%j -> %j', (input, value) => {
    expect(screenThemeText(input, 'monoton', 'theme_word')).toEqual({ ok: true, value })
  })

  it('refuses 13 characters, control characters, line separators, non-strings and undrawable characters', () => {
    const bad = ['THIRTEEN CHAR', 'a' + String.fromCharCode(10) + 'b', 'a' + String.fromCharCode(0x2028), 'a' + String.fromCharCode(0x85), 7, {}, ['x'], '\u{1F389}']
    for (const b of bad) expect(screenThemeText(b, 'monoton', 'theme_word').ok).toBe(false)
  })

  it('counts characters, not UTF-16 units (the CHECK is char_length)', () => {
    // 12 astral characters would be 24 units; they are refused for the font, not for the length.
    const r = screenThemeText('\u{1F389}'.repeat(12), 'bungee', 'theme_sub')
    expect(r.ok).toBe(false)
  })
})

describe('isTemplateSlug / isUuidLike', () => {
  it('only registry slugs', () => {
    expect(isTemplateSlug('glow')).toBe(true)
    expect(isTemplateSlug('plain')).toBe(true)
    expect(isTemplateSlug('swiftie')).toBe(false)
    expect(isTemplateSlug(undefined)).toBe(false)
    expect(isTemplateSlug('toString')).toBe(false)
  })
  it('uuid shape, and nothing that could carry a filter', () => {
    expect(isUuidLike('11111111-1111-4111-8111-111111111111')).toBe(true)
    for (const v of ['%', '1,2', 'x', '', null, 5, '11111111-1111-4111-8111-11111111111g']) expect(isUuidLike(v)).toBe(false)
  })
})

describe('image URLs', () => {
  const KEY = 'ab'.repeat(16)
  it('built from the stored names against SUPABASE_URL; null otherwise', () => {
    const ev = { image_key: KEY, invite_object: 'invite-v3-9f2c.jpg', og_object: 'og-v3-9f2c.jpg' }
    expect(inviteImageUrl(ev, 'https://p.supabase.co/')).toBe(`https://p.supabase.co/storage/v1/object/public/evites/${KEY}/invite-v3-9f2c.jpg`)
    expect(storedOgUrl(ev, 'https://p.supabase.co')).toBe(`https://p.supabase.co/storage/v1/object/public/evites/${KEY}/og-v3-9f2c.jpg`)
    expect(inviteImageUrl(ev, undefined)).toBeNull()
    expect(storedOgUrl(ev, '')).toBeNull()
    expect(inviteImageUrl({ ...ev, invite_object: null }, 'https://p.supabase.co')).toBeNull()
    expect(inviteImageUrl({ ...ev, invite_object: 'invite-v3-9f2c.png' }, 'https://p.supabase.co')).toBeNull()
    expect(storedOgUrl({ ...ev, image_key: 'short' }, 'https://p.supabase.co')).toBeNull()
  })
})

describe('adminHooks.notifyPartyCancelled (the P09 seam)', () => {
  const real = adminHooks.notifyPartyCancelled
  afterEach(() => {
    adminHooks.notifyPartyCancelled = real
    jest.restoreAllMocks()
  })

  it('the stub queues nothing and says why', async () => {
    expect(await notifyPartyCancelled({} as never, 'ev')).toEqual({ ok: true, queued: false, reason: 'not-built' })
  })

  it('swapping the property replaces the behaviour; a throw becomes {ok:false}', async () => {
    adminHooks.notifyPartyCancelled = async () => ({ ok: true, queued: true, count: 2 })
    expect(await notifyPartyCancelled({} as never, 'ev')).toEqual({ ok: true, queued: true, count: 2 })
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    adminHooks.notifyPartyCancelled = () => {
      throw new Error('boom')
    }
    expect(await notifyPartyCancelled({} as never, 'ev')).toEqual({ ok: false, queued: false, reason: 'hook-failed' })
  })
})
