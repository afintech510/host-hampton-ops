import { EVITE_BUCKET } from '@/lib/evites/render'
import { HOST_EVITE_COLUMNS, HOST_IMAGE_BUCKET, pickHostRsvp, storedImageUrl, summarizeRsvps, type HostRsvp } from '@/lib/evites/hostView'
import { EVITE_PAGE_COLUMNS, HOST_RSVP_COLUMNS } from '@/lib/evites/views'

/** The pure parts of the host view (P07): summary math, the RSVP picker, image URLs. */

const rsvp = (over: Partial<HostRsvp> = {}): HostRsvp => ({
  status: 'yes',
  parent_name: 'Pat Parent',
  children: [{ first_name: 'Ava' }],
  adult_count: 1,
  has_allergy: false,
  allergy_note: null,
  note_to_honoree: null,
  created_at: '2026-10-20T12:00:00Z',
  updated_at: '2026-10-20T12:00:00Z',
  ...over,
})

describe('the bucket literal', () => {
  it('is the one the renderer uploads to', () => {
    expect(HOST_IMAGE_BUCKET).toBe(EVITE_BUCKET)
  })
})

describe('the host’s evite columns', () => {
  it('are the public page’s plus the freshness hash - and nothing about renders in flight, calendars, consent or slug history', () => {
    expect([...HOST_EVITE_COLUMNS]).toEqual([...EVITE_PAGE_COLUMNS, 'render_inputs_hash'])
    for (const c of HOST_EVITE_COLUMNS) {
      expect(c).not.toMatch(/^(render_claim|render_claimed_at|render_error|render_version|previous_slugs|cal_|cancelled_notice_at|went_live_at|rendered_at|created_at|updated_at)/)
    }
  })
})

describe('summarizeRsvps', () => {
  it('sums kids over yes answers only, siblings included', () => {
    const s = summarizeRsvps(
      [
        rsvp({ children: [{ first_name: 'A' }, { first_name: 'B' }, { first_name: 'C' }] }),
        rsvp({ children: [{ first_name: 'D' }] }),
        rsvp({ status: 'no', children: [], adult_count: 0 }),
      ],
      12,
    )
    expect(s.kidsYes).toBe(4)
    expect(s.noCount).toBe(1)
    expect(s.cap).toBe(12)
  })

  it('counts "2+" as 2 and flags it', () => {
    expect(summarizeRsvps([rsvp({ adult_count: 2 }), rsvp({ adult_count: 2 }), rsvp({ adult_count: 0 })], null)).toMatchObject({ adultsYes: 4, adultsPlus: true })
    expect(summarizeRsvps([rsvp({ adult_count: 1 }), rsvp({ adult_count: 0 })], null)).toMatchObject({ adultsYes: 1, adultsPlus: false })
  })

  it('rolls up allergies from YES answers with has_allergy true only', () => {
    const s = summarizeRsvps(
      [
        rsvp({ parent_name: 'Ann', has_allergy: true, allergy_note: 'tree nuts', children: [{ first_name: 'Ava' }, { first_name: 'Ben' }] }),
        rsvp({ parent_name: 'Bo', has_allergy: false, allergy_note: 'ignored' }),
        rsvp({ parent_name: 'Cy', has_allergy: null }),
        rsvp({ parent_name: 'Di', status: 'no', children: [], adult_count: 0, has_allergy: true, allergy_note: 'x' }),
      ],
      null,
    )
    expect(s.allergies).toEqual([{ parent: 'Ann', children: ['Ava', 'Ben'], note: 'tree nuts' }])
  })

  it('an empty list is all zeros: the birthday child is not a guest', () => {
    expect(summarizeRsvps([], 10)).toEqual({ kidsYes: 0, adultsYes: 0, adultsPlus: false, noCount: 0, cap: 10, allergies: [] })
  })
})

describe('pickHostRsvp returns exactly HOST_RSVP_COLUMNS', () => {
  it('drops every other key the row carries', () => {
    const picked = pickHostRsvp({
      id: 'x',
      evite_id: 'y',
      status: 'yes',
      parent_name: 'Pat',
      children: [{ first_name: 'Ava', last_name: 'Secret' }],
      adult_count: 2,
      has_allergy: true,
      allergy_note: 'milk',
      note_to_honoree: 'hi',
      reminder_email: 'a@b.co',
      reminder_phone_e164: '+16315550100',
      club_email: 'c@d.co',
      consent_ip: '203.0.113.1',
      edit_nonce: 'n'.repeat(16),
      created_at: 'c',
      updated_at: 'u',
    })
    expect(Object.keys(picked).sort()).toEqual([...HOST_RSVP_COLUMNS].sort())
    expect(picked.children).toEqual([{ first_name: 'Ava' }]) // only the first name survives
    expect(JSON.stringify(picked)).not.toMatch(/a@b\.co|\+1631|c@d\.co|203\.0|Secret/)
  })

  it('tolerates a malformed row without throwing', () => {
    expect(pickHostRsvp({})).toMatchObject({ status: 'yes', parent_name: '', children: [], adult_count: 0, has_allergy: null })
    expect(pickHostRsvp({ children: 'nope', adult_count: 7, status: 'maybe' })).toMatchObject({ children: [], adult_count: 0, status: 'yes' })
  })
})

describe('storedImageUrl', () => {
  const key = 'ab'.repeat(16)
  const evite = { image_key: key, invite_object: 'invite-v3-9f2c.jpg', og_object: 'og-v3-9f2c.jpg' }

  it('builds the public storage URLs', () => {
    expect(storedImageUrl(evite, 'invite', 'https://p.supabase.co')).toBe(`https://p.supabase.co/storage/v1/object/public/evites/${key}/invite-v3-9f2c.jpg`)
    expect(storedImageUrl(evite, 'og', 'https://p.supabase.co/')).toBe(`https://p.supabase.co/storage/v1/object/public/evites/${key}/og-v3-9f2c.jpg`)
  })

  it('is null for anything missing or malformed', () => {
    expect(storedImageUrl(evite, 'invite', undefined)).toBeNull()
    expect(storedImageUrl(evite, 'invite', '  ')).toBeNull()
    expect(storedImageUrl({ ...evite, image_key: null }, 'invite', 'https://p.supabase.co')).toBeNull()
    expect(storedImageUrl({ ...evite, image_key: 'short' }, 'invite', 'https://p.supabase.co')).toBeNull()
    expect(storedImageUrl({ ...evite, invite_object: null }, 'invite', 'https://p.supabase.co')).toBeNull()
    expect(storedImageUrl({ ...evite, invite_object: 'og-v3-9f2c.jpg' }, 'invite', 'https://p.supabase.co')).toBeNull() // the wrong kind of object
    expect(storedImageUrl({ ...evite, og_object: 'invite-v3-9f2c.jpg' }, 'og', 'https://p.supabase.co')).toBeNull()
    expect(storedImageUrl({ ...evite, invite_object: '../x.jpg' }, 'invite', 'https://p.supabase.co')).toBeNull()
  })
})
