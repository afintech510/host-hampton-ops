/**
 * The projections are the privacy boundary. Every private field of every OTHER
 * member is seeded with a sentinel, and no projection may carry any of them
 * through `JSON.stringify` — the same bytes a route handler or an RSC payload
 * would send.
 */
import { meView, partyView, myPayRecords } from '@/lib/crew/view'
import { DEFAULT_SETTINGS as S } from '@/lib/crew/rules'
import type { CrewMemberRow, CrewPartyRow, CrewSlotRow } from '@/lib/crew/db'

const SENTINELS = {
  email: 'sentinel-other@example.invalid',
  phone: '+16315550199',
  notes: 'SENTINEL-ADMIN-NOTES',
  reason: 'SENTINEL-REASON-NOTE',
  partyNotes: 'SENTINEL-NOTES-FOR-CREW',
  address: 'SENTINEL 12 Private Lane',
  otherId: '00000000-0000-4000-8000-0000000000bb',
  paidNote: 'SENTINEL-PAID-NOTE',
}
const OTHER_PAY = 98_765
const OTHER_TIP = 87_654

function member(over: Partial<CrewMemberRow>): CrewMemberRow {
  return {
    id: 'm', first_name: 'X', last_name: null, email: null, phone: null, steps: 0, can_lead: false, is_owner: false,
    skills: [], status: 'active', needs_review: false, sms_opt_in: false, sms_opt_in_at: null, email_opt_in: true,
    admin_notes: null, job_application_id: null, joined_on: '2026-10-26', created_at: '', updated_at: '', ...over,
  }
}

function slot(over: Partial<CrewSlotRow>): CrewSlotRow {
  return {
    id: 's', party_id: 'p', role: 'crew', status: 'open', member_id: null, assigned_at: null, assigned_via: null,
    assigned_by: null, confirmed_at: null, covered_swap_id: null, pay_cents: null, step_at_pay: null, extra_cents: null,
    tip_cents: null, tip_topup_cents: null, paid_method: null, paid_note: null, paid_at: null, shift_started_at: null,
    shift_ended_at: null, hours_worked: null, created_at: '', updated_at: '', ...over,
  }
}

const viewer = member({ id: 'me', first_name: 'Sam', steps: 3, can_lead: false, email: 'me@example.invalid' })
const other = member({
  id: SENTINELS.otherId, first_name: 'Robin', steps: 7, can_lead: true, email: SENTINELS.email, phone: SENTINELS.phone,
  admin_notes: SENTINELS.notes,
})

function party(over: Partial<CrewPartyRow> = {}): CrewPartyRow {
  return {
    id: 'p', booking_id: 'b', party_kind: 'mobile_party', title: 'Glow Party', theme: 'Glow', starts_at: '2026-11-14T18:00:00Z',
    ends_at: '2026-11-14T21:00:00Z', guest_count: 14, location: SENTINELS.address, notes_for_crew: SENTINELS.partyNotes,
    slots_override: null, extra_flat_cents: 0, status: 'published', published_at: '2026-10-26T00:00:00Z',
    attendance_marked_at: null, cancelled_at: null, sync_flags: ['over_staffed'], created_at: '', updated_at: '', ...over,
  }
}

const otherSlot = slot({
  id: 's-lead', role: 'lead', status: 'completed', member_id: SENTINELS.otherId, confirmed_at: '2026-11-10T00:00:00Z',
  pay_cents: OTHER_PAY, tip_cents: OTHER_TIP, tip_topup_cents: 11, step_at_pay: 7, paid_note: SENTINELS.paidNote, paid_method: 'venmo',
})

function assertNoSentinel(obj: unknown) {
  const json = JSON.stringify(obj)
  for (const v of Object.values(SENTINELS)) expect(json).not.toContain(v)
  expect(json).not.toContain(String(OTHER_PAY))
  expect(json).not.toContain(String(OTHER_TIP))
  expect(json).not.toMatch(/"steps"|step_at_pay|admin_notes|reason|sync_flags|booking_id|assigned_by/)
}

describe('partyView', () => {
  const firstNames = new Map([[SENTINELS.otherId, 'Robin'], ['me', 'Sam']])

  it('an open party I am not on: no address, no notes, no teammate details', () => {
    const v = partyView({
      party: party(), slots: [otherSlot, slot({ id: 's1' }), slot({ id: 's2' })],
      viewer, firstNames, standbyMemberIds: new Set([SENTINELS.otherId]),
    }, S)!
    assertNoSentinel(v)
    expect(v.team).toEqual([{ firstName: 'Robin', role: 'lead', confirmed: true, isMe: false }])
    expect(v.location).toMatch(/Mobile party/)
    expect(v.notesForCrew).toBeNull()
    expect(v.iAmStandby).toBe(false)
    expect(v.openSpots.map(o => o.payCents)).toEqual([5850, 5850])   // MY rate, not theirs
  })

  it('a party I am on: the address and notes, still nothing private about the others', () => {
    const v = partyView({
      party: party({ party_kind: 'mobile_party', location: '1 Real St' }),
      slots: [otherSlot, slot({ id: 'mine', status: 'assigned', member_id: 'me', confirmed_at: null })],
      viewer, firstNames, standbyMemberIds: new Set(),
    }, S)!
    expect(v.location).toBe('1 Real St')
    expect(v.notesForCrew).toBe(SENTINELS.partyNotes)
    expect(v.mySlot).toEqual({ slotId: 'mine', role: 'crew', status: 'assigned', confirmed: false, payCents: 5850 })
    const json = JSON.stringify(v)
    for (const k of ['email', 'phone', 'notes', 'reason', 'otherId', 'paidNote'] as const) expect(json).not.toContain(SENTINELS[k])
    expect(json).not.toContain(String(OTHER_PAY))
  })

  it('a Lead spot is not claimable by a member who may not lead', () => {
    const v = partyView({
      party: party(), slots: [slot({ id: 'lead', role: 'lead' }), slot({ id: 'c' })],
      viewer, firstNames, standbyMemberIds: new Set(),
    }, S)!
    expect(v.openSpots).toEqual([
      { slotId: 'lead', role: 'lead', payCents: 7750, canClaim: false },
      { slotId: 'c', role: 'crew', payCents: 5850, canClaim: true },
    ])
  })

  it('the extra per person is in the pay I am shown', () => {
    const v = partyView({ party: party({ extra_flat_cents: 1000 }), slots: [slot({ id: 'c' })], viewer, firstNames, standbyMemberIds: new Set() }, S)!
    expect(v.openSpots[0].payCents).toBe(6850)
  })

  it('drafts are invisible, and so are finished parties I was not on', () => {
    expect(partyView({ party: party({ status: 'draft' }), slots: [], viewer, firstNames, standbyMemberIds: new Set() }, S)).toBeNull()
    expect(partyView({ party: party({ status: 'cancelled' }), slots: [], viewer, firstNames, standbyMemberIds: new Set() }, S)).toBeNull()
    expect(partyView({ party: party({ status: 'completed' }), slots: [otherSlot], viewer, firstNames, standbyMemberIds: new Set() }, S)).toBeNull()
  })

  it('cancelled slots are neither needed nor shown', () => {
    const v = partyView({ party: party(), slots: [slot({ id: 'x', status: 'cancelled' }), slot({ id: 'c' })], viewer, firstNames, standbyMemberIds: new Set() }, S)!
    expect(v.needed).toBe(1)
    expect(v.openSpots).toHaveLength(1)
  })
})

describe('meView', () => {
  it('my own rate in dollars, no step number anywhere', () => {
    const v = meView(member({ id: 'me', first_name: 'Sam', steps: 3, can_lead: true, admin_notes: SENTINELS.notes, needs_review: true }), S)
    expect(v.crewRateCents).toBe(5850)
    expect(v.leadRateCents).toBe(7750)
    expect(v.rateLine).toBe("You're at $58.50 a party ($77.50 leading). One more party makes it $61.00.")
    const json = JSON.stringify(v)
    expect(json).not.toContain(SENTINELS.notes)
    expect(json).not.toMatch(/"steps"|needs_review|admin_notes|is_owner|job_application/)
  })
  it('no Lead rate for a member who cannot lead', () => {
    expect(meView(member({ steps: 0 }), S).leadRateCents).toBeNull()
  })
})

describe('myPayRecords', () => {
  it('only my own completed slots — never another member’s pay', () => {
    const p = party({ status: 'completed' })
    const mine = slot({ id: 'mine', status: 'completed', member_id: 'me', pay_cents: 5850, tip_cents: 1200, tip_topup_cents: 800, paid_method: 'cash', paid_note: SENTINELS.paidNote })
    const out = myPayRecords('me', [{ slot: mine, party: p }, { slot: otherSlot, party: p }])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ payCents: 5850, tipCents: 1200, tipTopupCents: 800, paidMethod: 'cash' })
    const json = JSON.stringify(out)
    expect(json).not.toContain(String(OTHER_PAY))
    expect(json).not.toContain(SENTINELS.paidNote)  // the note is Allie's
    expect(json).not.toContain(SENTINELS.address)
  })
})
