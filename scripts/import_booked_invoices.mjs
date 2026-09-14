#!/usr/bin/env node
/**
 * Import the BOOKED local invoices into the system.
 *
 * `invoices/` holds 20 hand-built HTML quotes for parties that were sold
 * entirely outside the app — mobile parties and studio rentals, quoted in a file
 * and paid by Venmo. None of them is in `bookings`, so none appears in the
 * Parties tab, the Booked tab, the Financials tab or any reminder. The money is
 * real and the paperwork is real; only the database is missing.
 *
 * ── What "booked" means here, and why the list is short ───────────────────
 *
 * Adam asked for the BOOKED ones only. The invoice file is not evidence of
 * payment — several of them print "Deposit Paid" as part of a template, and the
 * parser cannot tell that from a receipt. So every payment below is backed by a
 * **Venmo receipt in Gmail**, quoted by date and amount in `receipts`. An
 * invoice with no receipt is not imported, and where a deposit is missing a
 * receipt the payment is simply not written (see Katie Graham) rather than
 * inferred from the arithmetic.
 *
 * ── The triage, for all twenty (completed 2026-09-14) ────────────────────
 *
 * The FIRST pass of this script checked Venmo only and parked seven invoices as
 * "unconfirmed". That was wrong, and the fix is that these files share a
 * vocabulary which is the reliable signal:
 *
 *   "Deposit Paid" / "was received on <date>"   → money landed
 *   "Deposit to Book" / "Required to Book"      → a quote nobody has paid
 *   "Reserve Your Date" + a Pay button          → same
 *
 * BOOKED: aimee, katie, nikki, dina, jessica-mobile, blair (the six below);
 *   alexandra (PAID IN FULL, $4,400, both charges already in the Stripe ledger
 *   and attached to no booking — the largest single orphan found);
 *   anne ($400, invoice-asserted only); holly (security deposit received 8/31);
 *   holloway + kristin-sparks (already in `bookings`).
 * NOT BOOKED: maggie, samantha, mollie, dune-deck (+options), and the
 *   natalie / sophia security deposits — all still asking for the deposit.
 *   lindsey says it outright: "the original date (8/28) has passed without a
 *   deposit".
 * NEITHER: kristen-mobile-party-2026-10-24 is an AMENDMENT, not a new customer —
 *   `kgraboski@gmail.com` + 631-960-6713 match HH-2026-2926 exactly, and the
 *   invoice converts that booking from in-studio Glow Party to a mobile party at
 *   $1,690. Check the email before creating a second row.
 *
 * The four added after the first pass were applied by hand rather than through
 * this script, because Alexandra's and Jessica's money was ALREADY in
 * `financial_transactions` as `stripe-pl-<pi>` rows. `record_payment` would have
 * written a second ledger row: its covering-row guard matches on
 * `reference LIKE %booking_ref%` plus an exact amount, and a pay-link reference
 * carries the payment-intent id while the ledger amount is GROSS of the 3% card
 * fee. It cannot fire. Those payments were inserted straight into
 * `booking_payments` with the ledger left alone.
 *
 * Two invoices are deliberately absent even though money exists:
 *   * `anne-kpop-party-2026-07-19` — the file records $400 paid; no Venmo or
 *     Stripe receipt matches it, and Stripe reads are unavailable (the
 *     `rk_live_…` key on file has no read permission on any endpoint).
 *   * `dune-deck-disco-party-2026-09-05` — a $500 deposit "to book", never
 *     confirmed, and its invoice number collides with Aimee's.
 *
 * ── Invoice numbers are preserved on purpose ──────────────────────────────
 *
 * `invoice_number_seq` was parked so its first issue is `444124-000116`,
 * continuing the run in `invoices/` rather than starting a second series (see
 * lib/invoiceNumber.ts). Passing each file's own number through means these
 * rows keep their paperwork identity AND `ensureInvoiceNumber` will not burn a
 * fresh number the first time somebody opens one.
 *
 * ── Safety ───────────────────────────────────────────────────────────────
 *
 * * `sendEmail: false` on every create. These parties are in the past or already
 *   deposited; mailing six customers a fresh "Your Party Plan" quote would be
 *   the loudest possible bug.
 * * Idempotent: refuses to create a row whose `invoice_number` is already in
 *   `bookings`. Re-running does nothing.
 * * `--dry-run` (default) prints the plan and writes nothing. Pass `--apply`.
 *
 * Usage, from the repo root:
 *   node scripts/import_booked_invoices.mjs --base http://172.18.0.3:3002 --token "$ADMIN_PASSWORD"
 *   node scripts/import_booked_invoices.mjs --base ... --token ... --apply
 */

const args = process.argv.slice(2)
function arg(name, fallback = null) {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const BASE = arg('base', 'http://127.0.0.1:3002').replace(/\/$/, '')
const TOKEN = arg('token')
const APPLY = args.includes('--apply')

if (!TOKEN) {
  console.error('Missing --token (the shared ADMIN_PASSWORD).')
  process.exit(1)
}

const HEADERS = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }

/**
 * The six. `totalCents` is the invoice's own Total line. `receipts` are Gmail
 * Venmo notifications — date, amount and the payer's memo, so each row can be
 * traced back to the mail that proves it.
 */
const INVOICES = [
  {
    file: 'aimee-mermaidparty-2026-08-22.html',
    invoiceNumber: '444124-000101',
    contactName: 'Aimee Ved',
    contactEmail: 'aimeeeved@gmail.com',
    contactPhone: '9175585534',
    childName: 'Bella',
    partyDate: '2026-08-22',
    partyTime: '14:30',
    guestCount: 20,
    packageType: 'Mermaid Pool Party',
    partyType: 'mobile_party',
    eventType: 'mobile party',
    locationAddress: '4 Long Springs Rd, Southampton, NY',
    totalCents: 250000,
    receipts: [
      { amountCents: 25000, paidAt: '2026-08-05', type: 'deposit', memo: "Bella's 6th Bday!" },
      { amountCents: 225000, paidAt: '2026-08-21', type: 'final', memo: 'Aimee - Mermaid Pool Party 8.22' },
    ],
  },
  {
    file: 'katie-mobile-spa-party-2026-08-15.html',
    invoiceNumber: '444124-000099',
    contactName: 'Katie Graham',
    contactEmail: 'katherine.kriegman@gmail.com',
    contactPhone: '9085911855',
    partyDate: '2026-08-15',
    partyTime: '10:30',
    guestCount: 20,
    packageType: 'Mobile Spa Party',
    partyType: 'mobile_party',
    eventType: 'mobile party',
    locationAddress: '138 Merchants Path, Sagaponack, NY 11962',
    totalCents: 127000,
    // The $250 deposit has NO receipt in Gmail — the arithmetic implies it
    // ($1,270 − $1,020) and arithmetic is not a receipt. Left unwritten so the
    // row shows a real $250 gap somebody can resolve, rather than a tidy
    // paid-in-full that nothing supports. The $150 on 2026-08-15 was a tip, not
    // party revenue, and is not imported either.
    receipts: [
      { amountCents: 102000, paidAt: '2026-08-14', type: 'partial', memo: 'Katie Graham Balance - Spa Party 8/15' },
    ],
    notes: 'Imported from invoices/katie-mobile-spa-party-2026-08-15.html. $250 deposit implied by the invoice but no Venmo/Stripe receipt found — confirm before chasing the balance.',
  },
  {
    file: 'nikki-mobile-spa-party-2026-08-29.html',
    invoiceNumber: '444124-000104',
    contactName: 'Nikki Bloom',
    contactEmail: 'nikki.m.bloom@gmail.com',
    partyDate: '2026-08-29',
    // `bookings_scheduled_fields_check` requires BOTH date and time on anything
    // past `quoted`, so every imported row carries the time off its invoice.
    partyTime: '17:00',
    guestCount: 15,
    packageType: 'Mobile Spa Party',
    partyType: 'mobile_party',
    eventType: 'mobile party',
    totalCents: 85000,
    receipts: [
      { amountCents: 25000, paidAt: '2026-08-20', type: 'deposit', memo: 'Nikki Bloom Deposit - Spa Party 8/29' },
      { amountCents: 60000, paidAt: '2026-08-29', type: 'final', memo: 'Nikki Balance - Spa Party 8/29' },
    ],
  },
  {
    file: 'dina-mobile-party-2026-08-08.html',
    invoiceNumber: '444124-000098',
    contactName: 'Dina Suta',
    contactEmail: 'sleepingbabiesthrive@gmail.com',
    contactPhone: '9544449626',
    childName: 'Mila',
    partyDate: '2026-08-08',
    partyTime: '17:00',
    guestCount: 15,
    packageType: 'Mobile Party — Sand Art, Hair Tinsel, Glitter Tattoos',
    partyType: 'mobile_party',
    eventType: 'mobile party',
    locationAddress: 'Quogue Beach Club, 130 Dune Rd, Quogue, NY 11959',
    totalCents: 67500,
    receipts: [
      { amountCents: 35000, paidAt: '2026-07-19', type: 'deposit', memo: 'Aug 8 Quogue Beach Club Mila Bday' },
      { amountCents: 32500, paidAt: '2026-08-09', type: 'final', memo: '2nd half of payment' },
    ],
  },
  {
    file: 'jessica-mobile-party-2026-09-13.html',
    invoiceNumber: '444124-000115',
    contactName: 'Jessica Von Hagn',
    contactEmail: 'jessica.vonhagn@gmail.com',
    contactPhone: '5162428585',
    partyDate: '2026-09-13',
    partyTime: '12:00',
    guestCount: 15,
    packageType: 'Mobile Party',
    partyType: 'mobile_party',
    eventType: 'mobile party',
    totalCents: 140000,
    receipts: [
      { amountCents: 25000, paidAt: '2026-09-03', type: 'deposit', memo: 'Jessica - Mobile Party 9/13 Deposit' },
    ],
  },
  {
    file: 'blair-mobile-party-2026-10-03.html',
    invoiceNumber: '444124-000111',
    contactName: 'Blair Lichter',
    contactEmail: 'bap116@gmail.com',
    contactPhone: '5166809211',
    partyDate: '2026-10-03',
    partyTime: '15:00',
    guestCount: 10,
    packageType: 'Mobile Party — Loveshack Fancy Theme',
    partyType: 'mobile_party',
    eventType: 'mobile party',
    locationAddress: 'Westhampton, NY (address TBC)',
    totalCents: 135000,
    receipts: [
      { amountCents: 25000, paidAt: '2026-09-04', type: 'deposit', memo: 'Blair - Mobile Party 10/3 Deposit' },
    ],
  },
]

async function api(path, init) {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: HEADERS })
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = { raw: text.slice(0, 300) } }
  if (!res.ok) throw new Error(`${init?.method || 'GET'} ${path} → ${res.status}: ${JSON.stringify(body)}`)
  return body
}

/**
 * Which invoice numbers are already on a booking. Read through the Booked
 * endpoint's own source of truth rather than a fresh query, so "already
 * imported" means the same thing here as it does on the screen.
 */
async function existingInvoiceNumbers() {
  const { parties } = await api('/api/admin/booked')
  const nums = new Set()
  for (const p of parties) if (p.invoice_number) nums.add(p.invoice_number)
  return nums
}

async function main() {
  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} against ${BASE}\n`)

  const taken = await existingInvoiceNumbers()

  for (const inv of INVOICES) {
    const paid = inv.receipts.reduce((s, r) => s + r.amountCents, 0)
    const owed = Math.max(0, inv.totalCents - paid)
    const money = `total $${(inv.totalCents / 100).toFixed(2)} · paid $${(paid / 100).toFixed(2)} · owed $${(owed / 100).toFixed(2)}`

    if (taken.has(inv.invoiceNumber)) {
      console.log(`SKIP   ${inv.invoiceNumber} ${inv.contactName} — already in bookings`)
      continue
    }

    if (!APPLY) {
      console.log(`CREATE ${inv.invoiceNumber} ${inv.contactName.padEnd(20)} ${inv.partyDate}  ${money}`)
      for (const r of inv.receipts) {
        console.log(`         + venmo $${(r.amountCents / 100).toFixed(2)} on ${r.paidAt} — ${r.memo}`)
      }
      continue
    }

    // One line item carrying the invoice's own total. The planner's itemised
    // breakdown is in the HTML file and is not re-keyed here: re-typing twenty
    // stations by hand is how a $1,350 flat rate becomes $1,349.
    const created = await api('/api/admin/parties/create', {
      method: 'POST',
      body: JSON.stringify({
        contactName: inv.contactName,
        contactEmail: inv.contactEmail,
        contactPhone: inv.contactPhone,
        childName: inv.childName,
        partyDate: inv.partyDate,
        partyTime: inv.partyTime,
        guestCount: inv.guestCount,
        packageType: inv.packageType,
        partyType: inv.partyType,
        eventType: inv.eventType,
        source: 'local_invoice_import',
        invoiceNumber: inv.invoiceNumber,
        locationAddress: inv.locationAddress,
        // Never mail these. See the header.
        sendEmail: false,
        notes: inv.notes || `Imported from invoices/${inv.file}. Quoted and paid outside the system.`,
        lineItems: [{
          name: inv.packageType || 'Mobile Party',
          category: 'theme',
          quantity: 1,
          unit_price_cents: inv.totalCents,
          price_type: 'flat',
          guest_multiplied: false,
        }],
      }),
    })

    console.log(`CREATED ${created.bookingRef}  ${inv.contactName}  (${inv.invoiceNumber})`)

    for (const r of inv.receipts) {
      const res = await api(`/api/admin/parties/${created.bookingId}`, {
        method: 'POST',
        body: JSON.stringify({
          action: 'record_payment',
          amount_cents: r.amountCents,
          payment_method: 'venmo',
          payment_type: r.type,
          notes: `Venmo ${r.paidAt} — "${r.memo}". Backfilled from the Gmail receipt during the 2026-09-14 invoice import.`,
        }),
      })
      console.log(`         + $${(r.amountCents / 100).toFixed(2)} ${r.paidAt} → ${res.message}`)
    }

    // `create` lands every row `awaiting_deposit`, and `record_payment` only
    // promotes a booking when the balance reaches zero. A party with a $250
    // deposit on it is therefore left reading "Awaiting Deposit" — the one thing
    // the row demonstrably is not.
    const paid = inv.receipts.reduce((s, r) => s + r.amountCents, 0)
    if (paid > 0 && paid < inv.totalCents) {
      await api(`/api/admin/parties/${created.bookingId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'deposit_paid' }),
      })
      console.log('         → status: deposit_paid')
    }
  }

  // NOTE ON DATES: `record_payment` takes no `paid_at`, so every row above lands
  // dated today and eleven payments spanning July–September would all report as
  // September revenue. Each note quotes its receipt date, and that is what the
  // re-dating statement in the 2026-09-14 session read to correct both
  // `booking_payments.paid_at` and the joined `financial_transactions.date`.
  // If this script is ever extended, give `record_payment` a `paid_at` instead.

  if (!APPLY) console.log('\nNothing was written. Re-run with --apply.')
}

main().catch(err => { console.error(err.message); process.exit(1) })
