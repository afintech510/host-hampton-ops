#!/usr/bin/env node
/**
 * Crew scheduling — production proof of migration 077's guarantees, on
 * THROWAWAY rows, cleaned up on every path. Spec: docs/specs/crew/CREW_SPEC.md.
 *
 *   SUPABASE_SERVICE_KEY=… node scripts/crew/race-test.mjs
 *
 * What it proves, against the real database:
 *   1. first claim wins: N members fire crew_claim_slot at ONE open spot at once
 *      → exactly one 'assigned';
 *   2. one member firing at TWO spots of one party at once → one 'assigned';
 *   3. a member who is not can_lead is refused the Lead spot by the function
 *      ('not_lead') AND by the trigger on a direct write;
 *   4. a stale compare-and-swap answers 'stale' and changes nothing;
 *   5. the owner (Allie) can be assigned as Lead by an admin, counts as
 *      staffed, and cannot be paid — the trigger refuses it;
 *   6. crew_mark_attendance writes the acceptance figures (step 3 crew $57.50,
 *      a $12 tip with an $8 top-up, steps 3 → 4) and leaves the owner unpaid
 *      with her steps unchanged.
 *
 * Throwaway rows are named `ZZ-RACE-<run>`; nothing carries an email or phone.
 * The script deletes them in dependency order and then COUNTS that they are
 * gone, because a cleanup that is not checked is a claim.
 */

const URL_BASE = (process.env.SUPABASE_URL || 'https://ychnlroczjhwimouecxz.supabase.co').replace(/\/+$/, '')
const KEY = process.env.SUPABASE_SERVICE_KEY
if (!KEY) { console.error('SUPABASE_SERVICE_KEY is required'); process.exit(2) }

const RUN = `ZZ-RACE-${Date.now().toString(36)}`
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

async function rest(method, path, body, prefer = 'return=representation') {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    method, headers: { ...H, Prefer: prefer }, body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: res.status, ok: res.ok, json }
}
const rpc = (fn, args) => rest('POST', `rpc/${fn}`, args)

const results = []
function check(name, pass, detail = '') {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

const created = { members: [], partyIds: [] }

async function cleanup() {
  for (const pid of created.partyIds) await rest('DELETE', `crew_events?party_id=eq.${pid}`, undefined, 'return=minimal')
  if (created.members.length) {
    await rest('DELETE', `crew_events?member_id=in.(${created.members.join(',')})`, undefined, 'return=minimal')
  }
  for (const pid of created.partyIds) await rest('DELETE', `crew_parties?id=eq.${pid}`, undefined, 'return=minimal')
  if (created.members.length) {
    await rest('DELETE', `crew_members?id=in.(${created.members.join(',')})`, undefined, 'return=minimal')
  }
  const m = await rest('GET', `crew_members?select=id&first_name=like.${encodeURIComponent(RUN)}*`)
  const p = await rest('GET', `crew_parties?select=id&title=like.${encodeURIComponent(RUN)}*`)
  const e = created.partyIds.length
    ? await rest('GET', `crew_events?select=id&party_id=in.(${created.partyIds.join(',')})`)
    : { json: [] }
  const left = (m.json?.length ?? -1) + (p.json?.length ?? -1) + (e.json?.length ?? -1)
  console.log(`cleanup: members left ${m.json?.length}, parties left ${p.json?.length}, events left ${e.json?.length}`)
  return left === 0
}

async function main() {
  // ── members ──
  const mk = (suffix, over = {}) => ({ first_name: `${RUN}-${suffix}`, steps: 3, can_lead: false, email_opt_in: false, ...over })
  const ins = await rest('POST', 'crew_members', [
    mk('A'), mk('B'), mk('C'), mk('D'), mk('E'), mk('LEAD', { can_lead: true }),
  ])
  if (!ins.ok) throw new Error(`member insert ${ins.status} ${JSON.stringify(ins.json)}`)
  for (const r of ins.json) created.members.push(r.id)
  const byName = Object.fromEntries(ins.json.map(r => [r.first_name.split('-').pop(), r]))
  const crewIds = ['A', 'B', 'C', 'D', 'E'].map(k => byName[k].id)

  const owner = await rest('GET', 'crew_members?select=id,steps,is_owner&is_owner=eq.true')
  check('exactly one owner row is seeded', owner.json?.length === 1)
  const ownerId = owner.json?.[0]?.id

  // ── party ──
  const start = new Date(Date.now() + 10 * 86400_000)
  const party = await rest('POST', 'crew_parties', {
    party_kind: 'manual', title: `${RUN} party`, starts_at: start.toISOString(),
    ends_at: new Date(start.getTime() + 3 * 3600_000).toISOString(), guest_count: 14,
    location: 'race-test throwaway', status: 'published', published_at: new Date().toISOString(),
  })
  if (!party.ok) throw new Error(`party insert ${party.status} ${JSON.stringify(party.json)}`)
  const partyId = party.json[0].id
  created.partyIds.push(partyId)

  const slots = await rest('POST', 'crew_slots', [
    { party_id: partyId, role: 'lead' }, { party_id: partyId, role: 'crew' },
    { party_id: partyId, role: 'crew' }, { party_id: partyId, role: 'crew' },
  ])
  if (!slots.ok) throw new Error(`slot insert ${slots.status} ${JSON.stringify(slots.json)}`)
  const [leadSlot, s1, s2, s3] = slots.json.map(r => r.id)

  const dupLead = await rest('POST', 'crew_slots', { party_id: partyId, role: 'lead' })
  check('a second live Lead spot on one party is refused', !dupLead.ok, `HTTP ${dupLead.status}`)

  // 1. first claim wins
  const race = await Promise.all(crewIds.map(id => rpc('crew_claim_slot', { p_slot_id: s1, p_member_id: id })))
  const assigned = race.filter(r => r.json === 'assigned').length
  check('five concurrent claims on one spot: exactly one wins', assigned === 1,
    race.map(r => r.json).join(','))
  const winner = crewIds[race.findIndex(r => r.json === 'assigned')]

  // 2. one member, two spots, at once
  const loser = crewIds.find(id => id !== winner)
  const both = await Promise.all([s2, s3].map(sid => rpc('crew_claim_slot', { p_slot_id: sid, p_member_id: loser })))
  check('one member claiming two spots of one party at once: one wins',
    both.filter(r => r.json === 'assigned').length === 1 && both.some(r => r.json === 'already_on_party'),
    both.map(r => r.json).join(','))

  // 3. the Lead rule, function and trigger
  const notLead = await rpc('crew_claim_slot', { p_slot_id: leadSlot, p_member_id: byName.A.id === winner ? byName.B.id : byName.A.id })
  check('a non-can_lead member is refused the Lead spot by crew_claim_slot', notLead.json === 'not_lead', String(notLead.json))
  const direct = await rest('PATCH', `crew_slots?id=eq.${leadSlot}`, { status: 'assigned', member_id: byName.C.id })
  check('…and by the trigger on a direct write', !direct.ok && /crew_lead_requires_can_lead/.test(JSON.stringify(direct.json)),
    `HTTP ${direct.status}`)

  // 5. the owner as Lead, by admin; and the owner cannot be paid
  const ownerLead = await rpc('crew_admin_assign', { p_slot_id: leadSlot, p_member_id: ownerId, p_actor: 'race-test' })
  check('Allie (owner) can be assigned as Lead by an admin', ownerLead.json === 'assigned', String(ownerLead.json))
  const ownerPay = await rest('PATCH', `crew_slots?id=eq.${leadSlot}`, { pay_cents: 7000 })
  check('…and the trigger refuses to pay her', !ownerPay.ok && /crew_owner_unpaid/.test(JSON.stringify(ownerPay.json)),
    `HTTP ${ownerPay.status}`)
  const staffed = await rest('GET', `crew_slots?select=id&party_id=eq.${partyId}&status=eq.assigned`)
  check('…and counts toward staffed', staffed.json?.length === 3, `${staffed.json?.length} assigned of 4`)

  // 4. a stale compare-and-swap
  const stale = await rpc('crew_admin_set_steps', { p_member_id: byName.LEAD.id, p_expected_steps: 2, p_steps_after: 5, p_reason: 'race-test', p_actor: 'race-test' })
  const leadNow = await rest('GET', `crew_members?select=steps&id=eq.${byName.LEAD.id}`)
  check('a stale compare-and-swap answers stale and changes nothing', stale.json === 'stale' && leadNow.json?.[0]?.steps === 3,
    `${stale.json}, steps ${leadNow.json?.[0]?.steps}`)

  // 6. attendance figures through the function (computed by rules.ts in the app; typed here as the spec's numbers)
  const att = await rpc('crew_mark_attendance', {
    p_party_id: partyId, p_actor: 'race-test',
    p_outcomes: [
      { slot_id: s1, outcome: 'worked', expected_steps: 3, base_steps: 3, steps_after: 4, waived_grace: false,
        pay_cents: 5750, step_at_pay: 3, extra_cents: 0, tip_cents: 1200, tip_topup_cents: 800, paid_method: 'cash' },
      { slot_id: leadSlot, outcome: 'worked', expected_steps: owner.json[0].steps, base_steps: owner.json[0].steps,
        steps_after: owner.json[0].steps + 1, waived_grace: false, pay_cents: 7000, tip_cents: 500, tip_topup_cents: 1500 },
    ],
  })
  check('crew_mark_attendance marks both', att.ok && att.json?.marked === 2, JSON.stringify(att.json))
  const paidSlot = await rest('GET', `crew_slots?select=status,pay_cents,step_at_pay,tip_cents,tip_topup_cents&id=eq.${s1}`)
  const w = await rest('GET', `crew_members?select=steps&id=eq.${winner}`)
  const ps = paidSlot.json?.[0] ?? {}
  check('step 3 crew paid $57.50, $12 tip + $8 top-up, steps 3 → 4',
    ps.status === 'completed' && ps.pay_cents === 5750 && ps.step_at_pay === 3 && ps.tip_cents === 1200 &&
    ps.tip_topup_cents === 800 && w.json?.[0]?.steps === 4, JSON.stringify(ps) + ` steps ${w.json?.[0]?.steps}`)
  const ownerSlot = await rest('GET', `crew_slots?select=status,pay_cents,tip_cents,tip_topup_cents&id=eq.${leadSlot}`)
  const ownerAfter = await rest('GET', `crew_members?select=steps&id=eq.${ownerId}`)
  const os = ownerSlot.json?.[0] ?? {}
  check('the owner worked, unpaid, steps unchanged even when the app asked otherwise',
    os.status === 'completed' && os.pay_cents == null && os.tip_cents == null && os.tip_topup_cents == null &&
    ownerAfter.json?.[0]?.steps === owner.json[0].steps, JSON.stringify(os))

  // a correction: worked → no_show appends a void and the next sequence number
  const fix = await rpc('crew_mark_attendance', {
    p_party_id: partyId, p_actor: 'race-test',
    p_outcomes: [{ slot_id: s1, outcome: 'no_show', expected_steps: 4, base_steps: 3, steps_after: 0, waived_grace: false }],
  })
  const evs = await rest('GET', `crew_events?select=type,attendance_seq,voids_event_id,step_before,step_after&slot_id=eq.${s1}&order=occurred_at.asc`)
  const types = (evs.json ?? []).map(e => `${e.type}${e.attendance_seq ? '#' + e.attendance_seq : ''}`).join(',')
  check('a correction appends a void and the next outcome, deleting nothing',
    fix.json?.voided === 1 && types === 'worked#1,admin_adjustment,no_show#2', types)

  const doubleSubmit = await rpc('crew_mark_attendance', {
    p_party_id: partyId, p_actor: 'race-test',
    p_outcomes: [{ slot_id: s1, outcome: 'no_show', expected_steps: 4, base_steps: 3, steps_after: 0, waived_grace: false }],
  })
  check('re-submitting the same correction with a stale read is refused (crew_stale)',
    !doubleSubmit.ok && /crew_stale/.test(JSON.stringify(doubleSubmit.json)), `HTTP ${doubleSubmit.status}`)
}

let ok = false
try {
  await main()
  ok = results.length > 0 && results.every(r => r.pass)
} catch (e) {
  console.error('ERROR', e.message)
} finally {
  const clean = await cleanup()
  console.log(`${results.filter(r => r.pass).length}/${results.length} passed; cleanup ${clean ? 'verified' : 'NOT verified'}`)
  process.exit(ok && clean ? 0 : 1)
}
