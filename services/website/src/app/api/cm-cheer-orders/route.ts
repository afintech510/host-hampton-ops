import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isCmCheerAuthorized, cmCheerUnauthorized, CM_CHEER_ORDER_COLUMNS } from '@/lib/cmCheerAuth'
import { isFundraiserTeamSlug, resolveFundraiserTeam, screenTeacherName } from '@/lib/fundraiserTeams'
import { priceEsmPaperOrder } from '@/lib/fundraiserCatalog'
import { reconcileDeliveryItems, screenDelivery } from '@/lib/fundraiserDelivery'
import { screenCmCheerTotals, VALID_PAYMENT_METHODS } from '@/lib/cmCheerOrder'
import { boundedIntakeText } from '@/lib/publicIntake'
import { upsertContact } from '@/lib/contacts'

export const dynamic = 'force-dynamic'

/**
 * The CM Cheer / LI High order book.
 *
 * Auth: `lib/cmCheerAuth.ts` — one definition, fail-closed. This route used to
 * hold its own copy with a literal default password, and `CM_CHEER_PASSWORD` was
 * unset in production, so that literal WAS the credential over 21 real customers'
 * contact details. See the note in that module.
 *
 * Columns are an ALLOW-list rather than `select('*')`: a column added by the next
 * migration is private until somebody decides otherwise (the rule
 * `/api/portal/booking` and `/api/checkin/[token]` follow). `cost_cents` is still
 * withheld. `profit_cents` was too, as "Host Hampton's margin" — until Adam
 * pointed out that on a fundraiser it is the opposite: it is what the SCHOOL
 * nets after paying us. It is published now; see the note in `lib/cmCheerAuth.ts`.
 */
export async function GET(req: NextRequest) {
  if (!isCmCheerAuthorized(req)) return cmCheerUnauthorized()

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const paymentMethod = searchParams.get('payment_method')
  const team = searchParams.get('team')

  /**
   * `?team=` is how each organizer dashboard sees only its own fundraiser.
   *
   * An UNKNOWN team is refused rather than ignored, because a filter that is
   * silently dropped returns EVERY team's orders — which is the precise failure
   * this parameter exists to prevent, arriving as a success. A CM Cheer parent
   * volunteer mistyping the URL must not be handed the Sharks' customer list.
   *
   * Omitting it entirely still returns everything: that is Adam's own
   * cross-fundraiser view, and it is the behaviour this route had before there
   * was more than one team.
   */
  if (team !== null && !isFundraiserTeamSlug(team)) {
    return NextResponse.json({ error: 'Unknown fundraiser' }, { status: 400 })
  }

  const supabase = getSupabase()
  let query = supabase
    .from('cm_cheer_orders')
    .select(CM_CHEER_ORDER_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(500)

  if (team) query = query.eq('team', team)
  if (status) query = query.eq('status', status)
  if (paymentMethod) query = query.eq('payment_method', paymentMethod)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ orders: data || [] })
}

/**
 * Enter a PAPER order — the form the PTO hands out and takes back with cash.
 *
 * Same table and same order numbers as the online storefront, so the book, the
 * CSV and the "Items Sold" tile see one fundraiser, not two. Differences from the
 * public `POST /api/cm-cheer-order`, all deliberate:
 *
 *  - Authenticated (`isCmCheerAuthorized`), and the PRICES ARE THE SERVER'S: the
 *    client sends quantities only and `priceEsmPaperOrder` does the arithmetic.
 *    The public route has to audit a browser's own figures; this one never sees
 *    any.
 *  - Email and phone are optional. A paper form is often missing one, and a
 *    refused entry is a lost order. The columns are NOT NULL, so an absent value
 *    is stored as ''.
 *  - It can be recorded as already PAID — cash arrives stapled to the form.
 *  - It sends NO email: nobody is waiting on a confirmation, and an organizer
 *    keying a stack of forms must not fire a message per row. The row carries
 *    `status_note` saying it came from paper.
 *  - Only a team with a server catalogue can use it (the Sharks today). CM Cheer
 *    has none, so it is refused rather than priced from a guess.
 */
export async function POST(req: NextRequest) {
  if (!isCmCheerAuthorized(req)) return cmCheerUnauthorized()

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // No default here, unlike the public route: an entry that forgot its team
  // must not be filed under CM Cheer.
  if (typeof body.team !== 'string' || body.team === '') {
    return NextResponse.json({ error: 'team is required' }, { status: 400 })
  }
  const team = resolveFundraiserTeam(body.team)
  if (!team) return NextResponse.json({ error: 'Unknown fundraiser' }, { status: 400 })
  if (team.slug !== 'esm-sharks') {
    return NextResponse.json({ error: 'Paper-order entry is not set up for this fundraiser' }, { status: 400 })
  }

  const athleteName = boundedIntakeText(body.athleteName, 120)
  const parentName = boundedIntakeText(body.parentName, 120)
  if (!athleteName || !parentName) {
    return NextResponse.json({ error: `${team.personLabel}'s name and the parent's name are required` }, { status: 400 })
  }
  const teacher = screenTeacherName(team, body.teacherName)
  if (!teacher.ok) return NextResponse.json({ error: teacher.reason }, { status: 400 })

  const email = boundedIntakeText(body.email, 200) ?? ''
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'That email address does not look right' }, { status: 400 })
  }
  const phone = boundedIntakeText(body.phone, 40) ?? ''

  const paymentMethod = String(body.paymentMethod ?? '')
  if (!VALID_PAYMENT_METHODS.includes(paymentMethod)) {
    return NextResponse.json({ error: 'Invalid payment method' }, { status: 400 })
  }
  const status = body.markPaid === true ? 'paid' : 'pending_payment'

  const delivery = screenDelivery(body.deliveryMethod, body.deliveryAddress)
  if (!delivery.ok) return NextResponse.json({ error: delivery.reason }, { status: 400 })

  const priced = priceEsmPaperOrder(body.quantities)
  if (!priced.ok) return NextResponse.json({ error: priced.reason }, { status: 400 })

  // The delivery line is the server's too. Cost 0: the whole fee is the PTO's.
  const reconciled = reconcileDeliveryItems(priced.lines, delivery.method)
  const money = screenCmCheerTotals(
    (priced.totalCents + delivery.feeCents) / 100,
    priced.costCents / 100,
    (priced.totalCents + delivery.feeCents - priced.costCents) / 100,
    reconciled.items,
  )
  if (!money.ok) return NextResponse.json({ error: money.reason }, { status: 400 })

  const note = ['Entered by an organizer from a paper order form.', reconciled.note, money.note]
    .filter(Boolean)
    .join(' ')

  const supabase = getSupabase()
  const { data: order, error } = await supabase
    .from('cm_cheer_orders')
    .insert({
      order_ref: '', // trigger overwrites, reading `team` for the ESM- prefix
      team: team.slug,
      athlete_name: athleteName,
      teacher_name: teacher.teacherName,
      parent_name: parentName,
      email,
      phone,
      payment_method: paymentMethod,
      items: reconciled.items,
      delivery_method: delivery.method,
      delivery_address: delivery.address,
      delivery_fee_cents: delivery.feeCents,
      subtotal_cents: money.subtotalCents,
      cost_cents: money.costCents,
      profit_cents: money.profitCents,
      status,
      status_note: note,
      notes: boundedIntakeText(body.notes, 2000),
    })
    .select('id, order_ref')
    .single()

  if (error || !order) {
    console.error('cm-cheer-orders: paper order insert failed:', error)
    return NextResponse.json({ error: 'Failed to save order' }, { status: 500 })
  }

  // Only with an email: a contact row with none would be an empty string key.
  if (email) {
    await upsertContact({
      name: parentName,
      email,
      phone: phone || null,
      sourceDetail: `${team.slug}-fundraiser`,
      serviceInterests: ['fundraiser'],
      marketingConsent: false,
    }).catch(err => console.error('Contact upsert error (non-fatal):', err))
  }

  return NextResponse.json({ success: true, order_ref: order.order_ref, total_cents: money.subtotalCents })
}
