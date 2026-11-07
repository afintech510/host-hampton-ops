import type { getSupabase } from '@/lib/supabase'
import { loadPlanInvoice } from '@/lib/planInvoice'
import { billedTotalCents, type BilledItem } from '@/lib/planBalance'
import { bookingStage, etToday, PAYMENT_LABELS, paymentStatus, STAGE_LABELS } from '@/lib/bookingStatus'
import { PARTY_TYPE_LABELS } from '@/lib/pipelineStages'
import { CANONICAL_ORIGIN } from '@/lib/publicOrigin'
import { clock12 } from './timeFormat'
import { dollars } from './dollars'

/**
 * The party card the Manager assistant shows whenever a conversation is about one
 * party: everything about it on one card, laid out the way the manager reads it.
 *
 *   <Child>'s Party
 *   Contact name / phone / email
 *   When · Type · Child · Guests · Status
 *   Theme · Activities · Add-ons · Food · Desserts · Extra guests
 *   Total · Paid · Owed · Tip
 *
 * It is a SNAPSHOT of the party at the moment it was read (`asOf` says when), built
 * from the same invoice the customer's page and the Parties tab use, so its money
 * cannot disagree with them. It is display only: no sign-in link, no token, nothing
 * that writes. The phone and email are shown in full because this is the admin's own
 * screen (the model is never handed them by this path - it gets the same masked
 * data it always did).
 */

type Supa = ReturnType<typeof getSupabase>

export interface PartyCardLine {
  name: string
  quantity: number
  /** Display text, e.g. "Glow Party ($950.00)" or "Bagel Platter ×2 ($60.00)". */
  text: string
  amountCents: number
  optional: boolean
}

export interface PartyCardData {
  ref: string
  bookingId: string
  title: string
  adminUrl: string
  asOf: string
  contact: { name: string | null; phone: string | null; email: string | null }
  /** "Thu, Dec 24 · 12:00 PM", or null when no date is set. */
  when: string | null
  type: string
  child: { name: string | null; age: number | null }
  guests: number | null
  /** "Quote sent, awaiting deposit". */
  status: string
  theme: PartyCardLine[]
  activities: PartyCardLine[]
  addOns: PartyCardLine[]
  food: PartyCardLine[]
  desserts: PartyCardLine[]
  discounts: PartyCardLine[]
  extraGuests: { count: number; text: string; amountCents: number } | null
  totalCents: number
  paidCents: number
  owedCents: number
  tipCents: number
}

export { dollars }

/** Which row of the card a line item belongs on, by its `category`. */
const THEME = ['theme', 'package', 'studio-rental-rate', 'rental']
const ACTIVITIES = ['activity-add-on', 'activity-standard', 'station']
const FOOD = ['food-add-on', 'beverage-add-on']
const DESSERTS = ['dessert-add-on']
const DISCOUNTS = ['discount']
// Everything else that is billed (decor, services, entertainment, extras, custom) is an add-on.

const EXTRA_GUESTS = /^(additional|extra) guests?$/i

type ItemRow = {
  name: string
  category: string | null
  quantity: number
  unit_price_cents: number
  guest_multiplied: boolean
  is_optional: boolean | null
}

function dayLabel(ymd: string | null, now: Date): string | null {
  if (!ymd) return null
  // Noon-anchored so the weekday never slips with the server's time zone.
  const d = new Date(`${ymd}T12:00:00`)
  if (Number.isNaN(d.getTime())) return ymd
  const sameYear = d.getFullYear() === now.getFullYear()
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' as const }) })
}

/** A party made in the last two weeks is "New"; after that a priced one is a "Quote sent" that is still waiting. */
const NEW_FOR_DAYS = 14

function statusText(
  stage: keyof typeof STAGE_LABELS,
  payment: keyof typeof PAYMENT_LABELS,
  createdAt: string | null,
  now: Date,
): string {
  const ageDays = createdAt ? (now.getTime() - new Date(createdAt).getTime()) / 86_400_000 : Infinity
  const isNew = ageDays <= NEW_FOR_DAYS
  const base = stage === 'quoted' && isNew ? 'New' : STAGE_LABELS[stage]
  if (stage === 'inquiry' || stage === 'quoted') {
    return payment === 'unpaid' ? `${base}, awaiting deposit` : `${base}, ${PAYMENT_LABELS[payment].toLowerCase()}`
  }
  if (stage === 'cancelled' || stage === 'lost') return base
  return `${base}, ${PAYMENT_LABELS[payment].toLowerCase()}`
}

export async function loadPartyCard(
  sb: Supa,
  ref: string,
  now: Date = new Date(),
): Promise<{ kind: 'ok'; card: PartyCardData } | { kind: 'absent' } | { kind: 'unavailable' }> {
  const loaded = await loadPlanInvoice(ref, sb)
  if (!loaded.ok) return loaded.notFound ? { kind: 'absent' } : { kind: 'unavailable' }
  const inv = loaded.invoice
  const b = inv.booking

  const [items, tips] = await Promise.all([
    sb.from('booking_line_items').select('name, category, quantity, unit_price_cents, guest_multiplied, is_optional').eq('booking_id', b.id).order('sort_order', { ascending: true }),
    sb.from('booking_payments').select('tip_cents').eq('booking_id', b.id),
  ])
  if (items.error || tips.error) return { kind: 'unavailable' }

  const guests = inv.guestCount ?? b.guest_count_approx
  const rows = (items.data ?? []) as unknown as ItemRow[]
  const line = (r: ItemRow): PartyCardLine => {
    const amountCents = billedTotalCents([r as unknown as BilledItem], guests)
    const qty = Number(r.quantity) || 1
    const label = `${r.name}${qty > 1 ? ` ×${qty}` : ''}`
    return { name: r.name, quantity: qty, amountCents, optional: !!r.is_optional, text: `${label} (${dollars(amountCents)})${r.is_optional ? ' - optional' : ''}` }
  }

  const card: Omit<PartyCardData, 'ref' | 'bookingId' | 'title' | 'adminUrl' | 'asOf' | 'contact' | 'when' | 'type' | 'child' | 'guests' | 'status' | 'totalCents' | 'paidCents' | 'owedCents' | 'tipCents'> = {
    theme: [], activities: [], addOns: [], food: [], desserts: [], discounts: [], extraGuests: null,
  }
  let extraCount = 0
  let extraCents = 0
  for (const r of rows) {
    const cat = r.category ?? ''
    if (EXTRA_GUESTS.test(r.name.trim())) {
      extraCount += Number(r.quantity) || 0
      extraCents += billedTotalCents([r as unknown as BilledItem], guests)
      continue
    }
    const l = line(r)
    if (THEME.includes(cat)) card.theme.push(l)
    else if (ACTIVITIES.includes(cat)) card.activities.push(l)
    else if (FOOD.includes(cat)) card.food.push(l)
    else if (DESSERTS.includes(cat)) card.desserts.push(l)
    else if (DISCOUNTS.includes(cat)) card.discounts.push(l)
    else card.addOns.push(l)
  }
  if (extraCount > 0 || extraCents !== 0) {
    card.extraGuests = { count: extraCount, amountCents: extraCents, text: `${extraCount} (${dollars(extraCents)})` }
  }

  const paid = inv.paidCents
  const stage = bookingStage({ status: b.status, paidCents: paid, partyDate: b.party_date, today: etToday(now) })
  const pay = paymentStatus({ totalCents: inv.totalCents, paidCents: paid, depositCents: b.deposit_amount })
  const child = (b.child_name ?? '').trim()
  const tip = ((tips.data ?? []) as Array<{ tip_cents: number | null }>).reduce((s, t) => s + (Number(t.tip_cents) || 0), 0)
  const date = dayLabel(b.party_date, now)
  const time = clock12(b.party_time)

  return {
    kind: 'ok',
    card: {
      ref: b.booking_ref,
      bookingId: b.id,
      title: child ? (/s$/i.test(child) ? `${child}' Party` : `${child}'s Party`) : `Party for ${b.contact_name ?? b.booking_ref}`,
      adminUrl: `${CANONICAL_ORIGIN}/admin?tab=parties&party=${b.id}`,
      asOf: now.toISOString(),
      contact: { name: b.contact_name, phone: b.contact_phone, email: b.contact_email },
      when: date ? `${date}${time ? ` · ${time}` : ''}` : null,
      type: PARTY_TYPE_LABELS[b.party_type || 'unknown'] ?? 'Unknown',
      child: { name: child || null, age: b.child_age },
      guests,
      status: statusText(stage, pay, b.created_at, now),
      ...card,
      totalCents: inv.totalCents,
      paidCents: paid,
      owedCents: inv.outstandingCents,
      tipCents: tip,
    },
  }
}
