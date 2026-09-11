/**
 * Tests for lib/agent/extractPlanFields.ts — Phase 4 item 6.
 *
 * The extraction step is the only code in the agent that writes a customer's
 * own words onto a party plan, so the suite is weighted towards what it must
 * REFUSE to write: a field that was never missing, a date that is not a real
 * day, a headcount that is obviously a misread, and an instruction dressed up
 * as a field value. Getting one of those wrong makes the agent stop asking and
 * quote against something nobody agreed to.
 */

import {
  sanitizeExtracted,
  coerceTime,
  isExtractable,
  EXTRACTABLE_FIELDS,
  extractPlanFields,
  applyExtractedFields,
  type ExtractableField,
} from '@/lib/agent/extractPlanFields'

const ALL = EXTRACTABLE_FIELDS as readonly ExtractableField[]

describe('coerceTime', () => {
  it('accepts and pads a real 24-hour time', () => {
    expect(coerceTime('14:00')).toBe('14:00')
    expect(coerceTime('9:30')).toBe('09:30')
    expect(coerceTime(' 00:05 ')).toBe('00:05')
  })

  it('rejects times that are not times', () => {
    // 25:00 and 12:60 are the ones a model actually produces.
    for (const bad of ['25:00', '12:60', '2pm', '', '1400', null, 14]) {
      expect(coerceTime(bad as unknown)).toBeNull()
    }
  })
})

describe('isExtractable', () => {
  it('covers the gate fields extraction can fill', () => {
    expect(isExtractable('party_date')).toBe(true)
    expect(isExtractable('venue_address')).toBe(true)
    expect(isExtractable('rental_duration')).toBe(true)
  })

  it('never claims the contact handles', () => {
    // We already have whichever handle the reply arrived on. Reading the OTHER
    // one out of a message body is how a quote gets emailed to an address a
    // stranger typed into a form.
    expect(isExtractable('contact_email')).toBe(false)
    expect(isExtractable('contact_phone')).toBe(false)
  })
})

describe('sanitizeExtracted', () => {
  it('keeps the fields the message stated', () => {
    const { fields } = sanitizeExtracted(
      {
        contact_name: 'Jess Miller',
        party_date: '2026-03-14',
        party_time: '14:00',
        guest_count: 12,
        venue_address: '41 Montauk Hwy, Speonk NY',
      },
      ALL,
    )

    expect(fields).toEqual({
      contact_name: 'Jess Miller',
      party_date: '2026-03-14',
      party_time: '14:00',
      guest_count: 12,
      venue_address: '41 Montauk Hwy, Speonk NY',
    })
  })

  it('DROPS any field that was not in the allowed list', () => {
    // Rule 1, enforced in code rather than asked for in the prompt: a reply may
    // only fill a blank. It can never move a date Adam already set.
    const { fields } = sanitizeExtracted(
      { party_date: '2026-03-14', guest_count: 12, contact_name: 'Someone Else' },
      ['guest_count'],
    )
    expect(fields).toEqual({ guest_count: 12 })
  })

  it('rejects a date that is not a real calendar day', () => {
    // 2026-02-30 is what a model produces when it is guessing, and Date would
    // silently roll it into March.
    expect(sanitizeExtracted({ party_date: '2026-02-30' }, ALL).fields.party_date).toBeUndefined()
    expect(sanitizeExtracted({ party_date: 'next Saturday' }, ALL).fields.party_date).toBeUndefined()
    expect(sanitizeExtracted({ party_date: '3/14/2026' }, ALL).fields.party_date).toBeUndefined()
  })

  it('rejects an implausible guest count instead of storing it', () => {
    for (const n of [0, -3, 400, 12.5, 'twelve']) {
      expect(sanitizeExtracted({ guest_count: n }, ALL).fields.guest_count).toBeUndefined()
    }
    expect(sanitizeExtracted({ guest_count: 200 }, ALL).fields.guest_count).toBe(200)
  })

  it('keeps a vague date as text so the next draft can narrow it down', () => {
    const { fields, requestedDateText } = sanitizeExtracted(
      { requestedDateText: 'mid-March, ideally a Saturday' },
      ALL,
    )
    expect(fields.party_date).toBeUndefined()
    expect(requestedDateText).toBe('mid-March, ideally a Saturday')
  })

  it('does not keep the date text when the date was not being asked for', () => {
    const { requestedDateText } = sanitizeExtracted({ requestedDateText: 'mid-March' }, ['guest_count'])
    expect(requestedDateText).toBeNull()
  })

  it('ignores an injected instruction because there is no field to hold it', () => {
    const { fields } = sanitizeExtracted(
      {
        // Nothing in the schema takes money, status or a recipient — the
        // injection has nowhere to land.
        deposit_cents: 0,
        status: 'paid_in_full',
        send_to: 'attacker@example.com',
        guest_count: 8,
      } as Record<string, unknown>,
      ALL,
    )
    expect(fields).toEqual({ guest_count: 8 })
  })

  it('trims and caps free text rather than storing an essay', () => {
    const { fields } = sanitizeExtracted({ venue_address: '  ' + 'x'.repeat(400) + '  ' }, ALL)
    expect(fields.venue_address).toHaveLength(240)
  })
})

describe('extractPlanFields', () => {
  const supabase = { from: () => ({}) } as never
  const plan = { contact_name: null, party_date: null }

  it('does not call the model when nothing extractable is missing', async () => {
    const res = await extractPlanFields({
      supabase,
      plan,
      partyType: 'mobile_party',
      message: 'Saturday works!',
      // Only the handles are missing, and extraction may not fill those.
      missing: ['contact_email', 'contact_phone'],
    })

    expect(res).toMatchObject({ ok: true, fields: {}, costUsd: 0, model: 'none' })
  })

  it('does not call the model on an empty message', async () => {
    const res = await extractPlanFields({
      supabase,
      plan,
      partyType: 'mobile_party',
      message: '   ',
      missing: ['party_date'],
    })
    expect(res).toMatchObject({ ok: true, fields: {}, costUsd: 0 })
  })

  it('reports "could not decide" — not "found nothing" — with no API key', async () => {
    const key = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    try {
      const res = await extractPlanFields({
        supabase,
        plan,
        partyType: 'mobile_party',
        message: 'March 14th, 12 kids',
        missing: ['party_date', 'guest_count'],
      })
      // ok:false is load-bearing: the caller must not record a conclusion the
      // node never reached.
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.status).toBe(503)
    } finally {
      if (key) process.env.ANTHROPIC_API_KEY = key
    }
  })
})

describe('applyExtractedFields', () => {
  interface PlanRow {
    id: string
    party_date: string | null
    party_time: string | null
    guest_count_approx: number | null
    contact_name: string | null
    party_tags: Record<string, unknown> | null
  }

  /**
   * @param raced Simulate the guarded UPDATE matching no rows — i.e. somebody
   *   filled the field in between our read and our write. The real query says
   *   so by returning an empty `data` from `.select('id')`, not by erroring.
   */
  function makeSupabase(
    row: PlanRow | null,
    updateError: { message: string } | null = null,
    raced = false,
  ) {
    const updates: Record<string, unknown>[] = []
    /** Columns the write was guarded on, so a test can assert the guard exists. */
    const guards: string[] = []
    const from = jest.fn((table: string) => {
      const ops: string[] = []
      let patch: Record<string, unknown> | null = null
      const chain: Record<string, unknown> = {
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
          if (table === 'marketing_ledger') return Promise.resolve({ data: null, error: null }).then(res, rej)
          if (ops.includes('update')) {
            if (patch) updates.push(patch)
            // `applyExtractedFields` now reads the UPDATE's returned rows to tell
            // "I wrote it" from "somebody got there first".
            const data = updateError ? null : raced ? [] : [{ id: 'b1' }]
            return Promise.resolve({ data, error: updateError }).then(res, rej)
          }
          return Promise.resolve({ data: row, error: row ? null : { message: 'not found' } }).then(res, rej)
        },
      }
      for (const m of ['select', 'eq', 'limit', 'maybeSingle', 'single', 'insert']) {
        chain[m] = () => { ops.push(m); return chain }
      }
      chain.is = (col: string) => { ops.push('is'); if (ops.includes('update')) guards.push(col); return chain }
      chain.update = (p: Record<string, unknown>) => { ops.push('update'); patch = p; return chain }
      return chain
    })
    return { supabase: { from } as never, updates, guards }
  }

  const BLANK: PlanRow = {
    id: 'bk-1', party_date: null, party_time: null,
    guest_count_approx: null, contact_name: null, party_tags: {},
  }

  it('fills the blanks and reports exactly what it changed', async () => {
    const { supabase, updates } = makeSupabase(BLANK)

    const res = await applyExtractedFields({
      supabase,
      bookingId: 'bk-1',
      fields: { party_date: '2026-03-14', guest_count: 12, venue_address: '41 Montauk Hwy' },
    })

    expect(res.updated.sort()).toEqual(['guest_count', 'party_date', 'venue_address'])
    expect(updates[0]).toMatchObject({ party_date: '2026-03-14', guest_count_approx: 12 })
    // hasVenueAddress() looks the address up in party_tags by keyword, which is
    // why it has to land under exactly this key.
    expect((updates[0].party_tags as Record<string, unknown>).location_address).toBe('41 Montauk Hwy')
    // A date arriving is what starts the modification / guest-count clocks.
    expect(updates[0]).toHaveProperty('modification_cutoff')
    expect(updates[0]).toHaveProperty('guest_count_cutoff')
  })

  it('NEVER overwrites a value already on the plan', async () => {
    const { supabase, updates } = makeSupabase({
      ...BLANK,
      party_date: '2026-05-02',
      guest_count_approx: 20,
      contact_name: 'Jessica Miller',
      party_tags: { location_address: '1 Main St' },
    })

    const res = await applyExtractedFields({
      supabase,
      bookingId: 'bk-1',
      fields: {
        party_date: '2026-03-14',
        guest_count: 12,
        contact_name: 'Jess',
        venue_address: '41 Montauk Hwy',
      },
    })

    // Re-checked against the row as it is NOW, not against the copy the caller
    // read — Adam may have typed the date in while the model was thinking.
    expect(res.updated).toEqual([])
    expect(updates).toHaveLength(0)
  })

  it('stores a vague date only while the real date is still blank', async () => {
    const { supabase, updates } = makeSupabase(BLANK)
    await applyExtractedFields({
      supabase, bookingId: 'bk-1', fields: {}, requestedDateText: 'mid-March',
    })
    expect((updates[0].party_tags as Record<string, unknown>).requested_date_text).toBe('mid-March')

    const withDate = makeSupabase({ ...BLANK, party_date: '2026-03-14' })
    const res = await applyExtractedFields({
      supabase: withDate.supabase, bookingId: 'bk-1', fields: {}, requestedDateText: 'mid-March',
    })
    expect(res.updated).toEqual([])
  })

  it('writes nothing at all when there is nothing to write', async () => {
    const { supabase, updates } = makeSupabase(BLANK)
    const res = await applyExtractedFields({ supabase, bookingId: 'bk-1', fields: {} })
    expect(res.updated).toEqual([])
    expect(updates).toHaveLength(0)
  })

  it('reports an error rather than claiming an update it did not make', async () => {
    const { supabase } = makeSupabase(BLANK, { message: 'constraint violation' })
    const res = await applyExtractedFields({
      supabase, bookingId: 'bk-1', fields: { guest_count: 12 },
    })
    expect(res.updated).toEqual([])
    expect(res.error).toBe('constraint violation')
  })

  // The blank-check reads the row and the UPDATE writes it; between the two,
  // Adam can type the date into the admin form. Rule 1 says the human's value
  // wins, and before this the write was unconditional — it re-checked the copy
  // it had already read, which cannot see a change made after the read.
  it('guards the write on the columns it read as blank', async () => {
    const { supabase, guards } = makeSupabase(BLANK)
    await applyExtractedFields({
      supabase,
      bookingId: 'bk-1',
      fields: { party_date: '2026-03-14', guest_count: 12 },
    })
    expect(guards.sort()).toEqual(['guest_count_approx', 'party_date'])
  })

  it('writes nothing and says so when someone filled the field first', async () => {
    const { supabase } = makeSupabase(BLANK, null, true)
    const res = await applyExtractedFields({
      supabase, bookingId: 'bk-1', fields: { party_date: '2026-03-14' },
    })
    // A dropped extraction costs one more "what date works?"; a clobbered one
    // quotes against a day nobody agreed to.
    expect(res.updated).toEqual([])
    expect(res.error).toMatch(/changed while extracting/)
  })

  it('reports a missing plan instead of throwing', async () => {
    const { supabase } = makeSupabase(null)
    const res = await applyExtractedFields({
      supabase, bookingId: 'gone', fields: { guest_count: 12 },
    })
    expect(res.updated).toEqual([])
    expect(res.error).toBeTruthy()
  })
})
