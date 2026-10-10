import { HOST_PATCH_KEYS, screenHostPatch, type HostPatchContext } from '@/lib/evites/hostScreens'

/** The host's PATCH allow-list and screens (spec §7.2, §13). Today is Sun 1 Nov 2026 (ET); the party is Sat 14 Nov. */

const CTX: HostPatchContext = { today: '2026-11-01', partyDate: '2026-11-14', current: { rsvp_deadline: null } }
const ok = (body: unknown, ctx: HostPatchContext = CTX) => {
  const r = screenHostPatch(body, ctx)
  if (!r.ok) throw new Error(`expected ok, got ${r.field}: ${r.message}`)
  return r.columns
}
const refused = (body: unknown, ctx: HostPatchContext = CTX) => {
  const r = screenHostPatch(body, ctx)
  if (r.ok) throw new Error(`expected a refusal, got ${JSON.stringify(r.columns)}`)
  return r
}

describe('the allow-list is exactly six keys', () => {
  it('names them', () => {
    expect([...HOST_PATCH_KEYS]).toEqual(['host_note', 'gift_note', 'rsvp_deadline', 'show_host_contact', 'host_contact_name', 'host_contact_phone'])
  })

  it.each(['id', 'evite_id', 'booking_id', 'slug', 'previous_slugs', 'template_slug', 'theme_word', 'theme_sub', 'render_version', 'render_inputs_hash', 'image_key', 'invite_object', 'og_object', 'archived_at', 'went_live_at', 'edit_nonce', 'hostNote', '__proto__x'])(
    'an unknown field (%s) is refused by name, never ignored',
    (k) => {
      const r = refused({ host_note: 'fine', [k]: 'x' })
      expect(r.field).toBe(k)
    },
  )

  it('an unknown field next to a valid one refuses the whole patch', () => {
    expect(screenHostPatch({ host_note: 'fine', slug: 'mia-glow-aaaa' }, CTX).ok).toBe(false)
  })

  it.each([null, undefined, 'x', 5, [], [{ host_note: 'a' }]])('a non-object body (%p) is refused', (b) => {
    expect(refused(b).field).toBe('body')
  })

  it('an empty object is "nothing to update"', () => {
    expect(refused({}).message).toMatch(/Nothing to update/)
  })

  it('a key set to undefined counts as absent', () => {
    expect(refused({ host_note: undefined }).field).toBe('body')
  })
})

describe('the two notes', () => {
  it.each(['host_note', 'gift_note'] as const)('%s: 140 characters pass, 141 do not, empty is NULL', (k) => {
    expect(ok({ [k]: 'a'.repeat(140) })[k]).toBe('a'.repeat(140))
    expect(refused({ [k]: 'a'.repeat(141) }).field).toBe(k)
    expect(ok({ [k]: '' })[k]).toBeNull()
    expect(ok({ [k]: '   ' })[k]).toBeNull()
    expect(ok({ [k]: null })[k]).toBeNull()
  })

  it.each(['host_note', 'gift_note'] as const)('%s: a non-string is refused', (k) => {
    for (const v of [5, true, {}, []]) expect(refused({ [k]: v }).field).toBe(k)
  })

  it('control and bidi characters are stripped; length counts characters, not UTF-16 units', () => {
    expect(ok({ host_note: 'Hi‮ there​' }).host_note).toBe('Hi there')
    expect(ok({ host_note: '\u{1F389}'.repeat(140) }).host_note).toBe('\u{1F389}'.repeat(140))
    expect(refused({ host_note: '\u{1F389}'.repeat(141) }).field).toBe('host_note')
  })
})

describe('rsvp_deadline: today ... party date, inclusive; display only', () => {
  it('today and the party date are both in range', () => {
    expect(ok({ rsvp_deadline: '2026-11-01' }).rsvp_deadline).toBe('2026-11-01')
    expect(ok({ rsvp_deadline: '2026-11-14' }).rsvp_deadline).toBe('2026-11-14')
    expect(ok({ rsvp_deadline: '2026-11-08' }).rsvp_deadline).toBe('2026-11-08')
  })

  it('yesterday and the day after the party are out of range', () => {
    expect(refused({ rsvp_deadline: '2026-10-31' }).field).toBe('rsvp_deadline')
    expect(refused({ rsvp_deadline: '2026-11-15' }).field).toBe('rsvp_deadline')
  })

  it('null and empty clear it', () => {
    expect(ok({ rsvp_deadline: null }).rsvp_deadline).toBeNull()
    expect(ok({ rsvp_deadline: '' }).rsvp_deadline).toBeNull()
  })

  it.each(['tomorrow', '11/08/2026', '2026-11-8', '2026-02-30', '2026-13-01', '2026-11-08T00:00:00Z', ' 2026-11-08', 20261108, true, {}])('%p is not a date', (v) => {
    expect(refused({ rsvp_deadline: v }).field).toBe('rsvp_deadline')
  })

  it('a booking with no party date has no upper bound, only "not in the past"', () => {
    const noDate = { ...CTX, partyDate: null }
    expect(ok({ rsvp_deadline: '2027-06-01' }, noDate).rsvp_deadline).toBe('2027-06-01')
    expect(refused({ rsvp_deadline: '2026-10-31' }, noDate).field).toBe('rsvp_deadline')
  })

  it('a stored deadline that has since passed is accepted unchanged, so an unrelated edit is not blocked by it', () => {
    const stale = { ...CTX, current: { rsvp_deadline: '2026-10-20' } }
    expect(ok({ rsvp_deadline: '2026-10-20', host_note: 'x' }, stale)).toEqual({ rsvp_deadline: '2026-10-20', host_note: 'x' })
    // ...but a DIFFERENT past date is still refused.
    expect(refused({ rsvp_deadline: '2026-10-21' }, stale).field).toBe('rsvp_deadline')
  })
})

describe('show_host_contact', () => {
  it('only a real boolean', () => {
    expect(ok({ show_host_contact: false }).show_host_contact).toBe(false)
    expect(ok({ show_host_contact: true }).show_host_contact).toBe(true)
    for (const v of ['false', 'true', 0, 1, null, {}]) expect(refused({ show_host_contact: v }).field).toBe('show_host_contact')
  })
})

describe('host_contact_name: 1-40 characters, empty is the studio default', () => {
  it('40 pass, 41 do not, empty / null are NULL', () => {
    expect(ok({ host_contact_name: 'a'.repeat(40) }).host_contact_name).toBe('a'.repeat(40))
    expect(refused({ host_contact_name: 'a'.repeat(41) }).field).toBe('host_contact_name')
    expect(ok({ host_contact_name: '' }).host_contact_name).toBeNull()
    expect(ok({ host_contact_name: '   ' }).host_contact_name).toBeNull()
    expect(ok({ host_contact_name: null }).host_contact_name).toBeNull()
  })
  it('is collapsed to one line and trimmed; a non-string is refused', () => {
    expect(ok({ host_contact_name: '  Pat \n Parent  ' }).host_contact_name).toBe('Pat Parent')
    for (const v of [5, true, {}, []]) expect(refused({ host_contact_name: v }).field).toBe('host_contact_name')
  })
})

describe('host_contact_phone: PRINTED INTO A PUBLIC IMAGE, so exactly NNN-NNN-NNNN, first digit 2-9', () => {
  it('accepts the one spelling', () => {
    expect(ok({ host_contact_phone: '631-555-0123' }).host_contact_phone).toBe('631-555-0123')
    expect(ok({ host_contact_phone: '212-555-0100' }).host_contact_phone).toBe('212-555-0100')
  })

  it('empty and null mean "the studio line"', () => {
    expect(ok({ host_contact_phone: '' }).host_contact_phone).toBeNull()
    expect(ok({ host_contact_phone: null }).host_contact_phone).toBeNull()
  })

  it.each([
    '(631) 555-0123',
    '631 555 0123',
    '631.555.0123',
    '6315550123',
    '+1 631-555-0123',
    '1-631-555-0123',
    '131-555-0123',
    '031-555-0123',
    '631-555-012',
    '631-555-01234',
    '631-555-012a',
    'abc-def-ghij',
    '631-555-0123 x5',
    '631-555-0123\n',
    ' 631-555-0123',
    '631-555-0123; call me for a deal',
    'https://evil.example.com',
    '<b>631-555-0123</b>',
    'call Allie',
    5551234567,
    true,
    {},
  ])('refuses %p', (v) => {
    expect(refused({ host_contact_phone: v }).field).toBe('host_contact_phone')
  })
})

describe('a combined patch returns only the keys that were sent', () => {
  it('writes nothing it was not asked to', () => {
    expect(ok({ host_note: 'Hello', show_host_contact: false })).toEqual({ host_note: 'Hello', show_host_contact: false })
  })
})
