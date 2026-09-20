/**
 * `/plan/[ref]/summary` — the DB-rendered invoice (Phase 5 item 1).
 *
 * Reproduces `invoices/_template.html` section for section, from the plan in
 * Supabase rather than from a hand-built HTML file. The template's own comments
 * fix the order and it is kept exactly: locked header with the services bar,
 * client/event grid, featured + line items, Total and Balance Due, the deposit
 * callout OUTSIDE the totals block, What's Included (studio only),
 * good-to-know/policies per party type, the payment block, Services & Add-Ons,
 * the mobile menu appendix (mobile only), locked footer.
 *
 * ── Access ─────────────────────────────────────────────────────────────────
 *
 * Token-gated exactly like the customer portal: the `hh_portal` cookie must name
 * THIS booking ref. A customer arrives through the usual magic link
 * (`/api/portal/auth?ref=…&token=…&redirect=/plan/<ref>/summary`), which is why
 * that redirect target had to be allowed — see the route, where it is matched
 * against the ref being authenticated rather than added to the static allowlist,
 * so it cannot become an open redirect.
 *
 * Admin viewing IS native as of migration 038 — this is the thing this comment
 * used to say it was waiting for. The fix plan §11.1 named (`admin_users` and a
 * real per-person session) shipped, and the session is a signed HttpOnly cookie
 * rather than a Bearer header in `localStorage`, which is exactly the difference
 * that matters here: a server component can read a cookie. So an admin session
 * opens any plan directly, with a banner saying so, and nobody has to go through
 * the customer's portal link to look at an invoice.
 *
 * The admin cookie is NOT scoped to a ref, unlike the customer's, because an
 * admin is entitled to every plan. That asymmetry is the whole of the access
 * rule here and is worth not "tidying" later.
 *
 * ── Taking money (Phase 5 items 2-4, added) ────────────────────────────────
 *
 * This comment used to say the page took no money and sent nothing, and that
 * `PayPanel` was absent because a page that charged a card without recording the
 * payment would be worse than a page that only renders. That condition is now
 * met: lib/planPayment.ts records what the webhook confirms, so the panel is
 * here.
 *
 * The shape of it matters. This page computes every figure with
 * `loadPlanInvoice()` — the same call that renders the document — and hands the
 * client component pre-formatted STRINGS plus a `purpose`. No amount travels
 * from the browser to the server, so the printed invoice and the card charge
 * cannot disagree and neither can be edited by whoever is looking at the page.
 *
 * PDF is still option (a) from plan §17: the link plus inline HTML, no
 * attachment, no puppeteer. The `@media print` rules make "Save as PDF" produce
 * the same document, and everything added here is `no-print`.
 */

import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getSupabase } from '@/lib/supabase'
import { canEditPlanInBuilder, isQuoteStage, loadPlanInvoice, money, type PlanInvoice } from '@/lib/planInvoice'
import { ensureInvoiceNumber } from '@/lib/invoiceNumber'
import { planAccess } from '@/lib/planAccess'
import { quoteFor, purposeAcceptsTip } from '@/lib/planPayLinks'
import { isUnpricedPlan } from '@/lib/planBalance'
import {
  RECOMMENDED_TIP_RATE,
  TIP_PRESET_PERCENTS,
  tipCentsForPercent,
  recommendedTipCents,
} from '@/lib/partyPricing'
import { PayPanel, PlanShareBar, PrintButton, AdminCustomCharge, type PayOption } from './PayPanel'
import './invoice.css'

export const dynamic = 'force-dynamic'

/** The locked services bar. Order, emoji and copy are fixed by SKILL.md. */
const SERVICES: [string, string][] = [
  ["🎉 Children's Theme Parties", '/kids-party-menu'],
  ['🎨 Mobile Craft Parties', '/mobile-party'],
  ['🏠 Party Studio Rental', '/studio-rental'],
  ['💎 Permanent Jewelry', '/permanent-jewelry'],
  ['🧢 Trucker Hat Bar', '/trucker-hat-bar'],
  ['✨ Custom Activations', '/custom-accessories'],
  ['🎗️ Fundraisers', '/fundraiser'],
]

/**
 * The seeded policy copy uses `**bold**` because it lives in a text column and
 * SKILL.md writes it that way. Rendered as real elements rather than injected as
 * HTML — the copy is Adam's, but `dangerouslySetInnerHTML` on a DB column is a
 * standing invitation, and an editable table is exactly the wrong place to open
 * one.
 */
function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean)
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>,
      )}
    </>
  )
}

function InvoiceBody({
  invoice,
  ref_,
  payOptions,
  isAdminView,
}: {
  invoice: PlanInvoice
  ref_: string
  payOptions: PayOption[]
  isAdminView: boolean
}) {
  const { booking, content, partyType } = invoice
  // What we should actually ask this customer for right now: the deposit while
  // one is owed, otherwise whatever is left. It used to be the full deposit
  // unconditionally, so a plan that had paid its deposit — or paid everything —
  // still invited a second $250 by Venmo.
  const askCents = invoice.depositOwedCents > 0 ? invoice.depositOwedCents : invoice.outstandingCents
  const settled = askCents <= 0 && invoice.totalCents > 0
  // No priced items yet, so the deposit on offer is the flat one that holds the
  // date rather than a share of a total. The prose below has to say that, because
  // "it comes off your total" is meaningless when there is no total on the page.
  const unpriced = isUnpricedPlan(invoice.totalCents)
  // Drives BOTH the Balance Due row and the prose that refers to it — a block
  // removed without its sentence leaves "the Balance Due above" pointing at
  // nothing, which is how a document ends up describing a figure it no longer
  // prints.
  const quoteStage = isQuoteStage(booking, invoice.paidCents)
  // "Mobile Party Quotation" → "Mobile Party", and then the package line only
  // if it is not that same string again. See the Event Details block below.
  const docLabel = invoice.docTitle.replace(/ (Quotation|Invoice)$/, '')
  const normalise = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
  const packageLine =
    booking.package_type && normalise(booking.package_type) !== normalise(docLabel)
      ? booking.package_type
      : null
  // The single source for "is a tip on offer at all" — the prose and the jar
  // are two halves of one thing and must never disagree about whether it exists.
  const tipOffered = payOptions.some(o => o.tip)
  const venmoAmount = (askCents / 100).toFixed(2)
  const venmoNote = `${(booking.contact_name || 'Party').split(' ')[0]} — ${
    partyType === 'studio_rental' ? 'Studio Rental' : 'Party'
  }${booking.party_date ? ` ${booking.party_date.slice(5).replace('-', '/')}` : ''}`

  return (
    <div className="page">
      {/* ============ LOCKED HEADER ============ */}
      <div className="header">
        <div className="header-top">
          <div className="brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="logo" src="/images/host-hampton-logo.png" alt="Host Hampton" />
          </div>
          <div className="invoice-meta">
            <h2>{invoice.docTitle}</h2>
            {invoice.invoiceNumber && (
              <p className="field">
                Invoice # <strong>{invoice.invoiceNumber}</strong>
              </p>
            )}
            <p className="field">
              Date Issued <strong>{invoice.dateIssued}</strong>
            </p>
          </div>
        </div>
        <ul className="services-bar">
          {SERVICES.map(([label, href]) => (
            <li key={href}>
              <a href={`https://www.hosthampton.com${href}`} target="_blank" rel="noopener">
                {label}
              </a>
            </li>
          ))}
        </ul>
      </div>

      <div className="body">
        {/* ============ CLIENT / EVENT ============ */}
        <div className="details-grid">
          <div className="detail-box">
            <h3>Client</h3>
            <p>
              <strong>{booking.contact_name || 'Your party'}</strong>
              {booking.contact_email && (
                <>
                  <br />
                  {booking.contact_email}
                </>
              )}
              {booking.contact_phone && (
                <>
                  <br />
                  {booking.contact_phone}
                </>
              )}
            </p>
          </div>
          <div className="detail-box">
            <h3>Event Details</h3>
            <p>
              <strong>{docLabel}</strong>
              {/*
                The package only earns a line when it SAYS something the heading
                did not. `package_type` is free text and is very often just the
                product name again — a mobile party quote printed "Mobile Party"
                twice, once bold and once not, which reads as a rendering fault
                rather than a detail. Compared loosely (case, spacing) because
                the two strings come from different places: one from the
                party-type label map, one typed by whoever took the booking.
              */}
              {packageLine && (
                <>
                  <br />
                  {packageLine}
                </>
              )}
              <br />
              {invoice.eventDateTime || 'Date to be confirmed'}
              {invoice.guestCount != null && (
                <>
                  <br />
                  {invoice.guestCount} guests
                </>
              )}
              {invoice.venueAddress && (
                <>
                  <br />
                  <span className="detail-label">Party address:</span> {invoice.venueAddress}
                </>
              )}
            </p>
          </div>
        </div>

        {/* ============ INVOICE / LINE ITEMS ============ */}
        <div className="invoice-section">
          <h2>Invoice</h2>

          {invoice.lineItems.length === 0 ? (
            <p className="section-sub">
              We&rsquo;re still putting your quote together — the line items will appear here as soon as
              we&rsquo;ve confirmed the details with you.
              {invoice.depositOwedCents > 0 && (
                <>
                  {' '}
                  You don&rsquo;t have to wait for it:{' '}
                  <strong>{money(invoice.depositOwedCents)}</strong> holds your date now
                  {invoice.depositIsSeparate
                    ? ', and is refunded after your rental.'
                    : ', and it comes off your total once we’ve built the plan together.'}
                </>
              )}
            </p>
          ) : (
            <div className="line-items">
              {invoice.lineItems.map((item, i) => (
                <div key={i} className={item.isFeatured ? 'line-item featured-item' : 'line-item'}>
                  <div className="line-item-left">
                    <div className="line-item-name">
                      {item.name}
                      {item.isOptional && <span className="optional-tag">Optional</span>}
                    </div>
                    {item.description && <div className="line-item-desc">{item.description}</div>}
                  </div>
                  <div className="line-item-amount">{money(item.amountCents)}</div>
                </div>
              ))}
            </div>
          )}

          {/* TOTALS. The deposit is NOT a row here — see the callout below. */}
          <div className="totals-section">
            <div className="totals-row grand-total">
              <span className="label">Total</span>
              <span className="amount">{money(invoice.totalCents)}</span>
            </div>
            {/*
              PAID TO DATE. Without it the document jumps from Total $925.00 to
              Balance Due $625.00 with nothing to explain the gap, which reads as
              an arithmetic error — the one error a client always catches. It is
              also the only place the invoice acknowledges money the customer has
              already sent; /my-booking has always shown a payment history and
              this page showed none.

              Rendered only when something has actually been credited, so a fresh
              quote is unchanged.
            */}
            {invoice.paidCents > 0 && (
              <div className="totals-row">
                <span className="label">Paid to date</span>
                <span className="amount">&minus;{money(invoice.paidCents)}</span>
              </div>
            )}
            {/*
              Balance Due is an INVOICE line, not a quote line. While this is
              still a quote the page shows the Total and the deposit callout
              below it and stops there — see `isQuoteStage`. Once a deposit has
              landed the document becomes the booking record and the balance
              comes back, because that is the point at which a customer has a
              real outstanding figure they need stated.
            */}
            {!quoteStage && (
              <div className="totals-row balance">
                <div>
                  <span className="label">Balance Due</span>
                  {content.balanceNote && <div className="balance-note">{content.balanceNote}</div>}
                </div>
                <span className="amount">{money(invoice.balanceDueCents)}</span>
              </div>
            )}
          </div>

          {/*
            DEPOSIT CALLOUT — outside totals-section on purpose.

            The figure is what is STILL OWED on the deposit, so that
            `deposit owed + Balance Due === everything outstanding` on every
            product whose deposit comes off the total. It used to print the full
            deposit unconditionally, which on a plan that had already paid one
            asked for it a second time.

            Gated on `depositOwedCents` ALONE, so a settled deposit removes the
            block rather than restyling it. It previously rendered on any plan
            with a deposit and swapped the amount for the word "Paid" — but the
            label and note beside it are a demand ("Reservation Deposit —
            Required to Book", "Due now to reserve the date"), and no value in
            the amount column makes a demand read as a receipt. Owner ruling
            2026-09-19 on HH-PTY-F47YW: once it is paid, it should not be shown.
            What she has paid is now a totals row instead.

            `depositOwedCents`, not `depositCents`: on an unpriced plan the
            latter is 0 and this callout is the only place the page names the
            deposit the pay button is about to charge.
          */}
          {invoice.depositOwedCents > 0 && (
            <div className="deposit-callout">
              <div>
                <div className="label">{content.depositLabel}</div>
                <div className="deposit-note">{content.depositNote}</div>
              </div>
              <div className="amount">{money(invoice.depositOwedCents)}</div>
            </div>
          )}
        </div>

        {/* ============ WHAT'S INCLUDED — studio only ============ */}
        {content.whatsIncluded.length > 0 && (
          <div className="invoice-section">
            <h2>What&rsquo;s Included</h2>
            <p className="section-sub">Your rental includes the following at no extra charge:</p>
            <ul className="included-list">
              {content.whatsIncluded.map((li, i) => (
                <li key={i}>{li}</li>
              ))}
            </ul>
          </div>
        )}

        {/* ============ POLICIES / SECURITY HOLD ============

            The "Good to know:" paragraph was removed from the template on
            Adam's instruction, 2026-09-20. What stays is deliberate: the
            refundable-hold sentence is a MONEY disclosure (a real card
            authorisation the customer would otherwise meet unannounced), and
            the policy list is terms, not blurb. `content.goodToKnow` is still
            loaded and still overridable per party type in `plan_content` — it
            is simply no longer rendered here, so turning it back on is one
            block, not a data migration.
        */}
        {(invoice.securityHoldCents != null || content.policies.length > 0) && (
          <div className="goodtoknow">
            {invoice.securityHoldCents != null && (
              <>
                A refundable {money(invoice.securityHoldCents)} card hold is authorized before your
                rental and released afterwards once the space is confirmed in good condition &mdash;
                it is not a charge, and it is separate from the deposit above, which does come off
                your total.
              </>
            )}
            {content.policies.length > 0 && (
              <ul className="policy-list" style={{ marginTop: 10 }}>
                {content.policies.map((p, i) => (
                  <li key={i}>
                    <RichText text={p} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* ============ PAID IN FULL ============ */}
        {settled && (
          <div className="pay-section invoice-section" style={{ textAlign: 'center' }}>
            <h2>Paid in Full</h2>
            <p className="section-sub">
              Thank you &mdash; there is nothing outstanding on this {partyType === 'studio_rental' ? 'rental' : 'party'}.
              We can&rsquo;t wait to celebrate with you!
            </p>
            <Link className="action" href={`/my-booking?ref=${encodeURIComponent(ref_)}`}>
              View your booking
            </Link>
            {isAdminView && <AdminCustomCharge ref_={ref_} />}
          </div>
        )}

        {/* ============ LOCKED PAYMENT SECTION ============ */}
        {!settled && askCents > 0 && (
          <div className="pay-section invoice-section" style={{ textAlign: 'center' }}>
            <h2>Reserve Your Date</h2>
            <p className="section-sub">
              A <strong>{money(invoice.depositOwedCents > 0 ? invoice.depositOwedCents : askCents)}</strong>{' '}
              {invoice.depositOwedCents > 0
                ? unpriced
                  ? `${content.depositLabel.split(' — ')[0].toLowerCase()} holds your date. Pay it now and we'll build the plan together afterwards.`
                  : `${content.depositLabel.split(' — ')[0].toLowerCase()} is required to book. It comes off your total${
                      quoteStage ? '' : ' — the Balance Due above is what is left after it'
                    }.`
                : 'payment is outstanding on this plan.'}{' '}
              A 3% processing fee applies to card payments; Venmo and Zelle avoid it.
            </p>
            {/*
              Stated in the DOCUMENT, not only in the interactive jar, because
              the invoice is printed and emailed as often as it is clicked — and
              a customer paying by Venmo never sees the jar at all.
              Gated on the jar's own presence rather than on a rule of its own.
              It was `depositOwedCents <= 0` for one deploy, which read well as a
              sentence ("a gratuity belongs with the final payment") and was
              wrong in practice: on a fresh quote the deposit IS owed, so the
              page printed the tip buttons under "Pay in full" with no prose
              above them explaining what they were. Caught by reading the live
              document rather than the diff.
            */}
            {tipOffered && (
              <p className="section-sub tip-prose">
                <strong>Tipping is optional.</strong> If your party team looked after you, the
                customary thank-you is <strong>{Math.round(RECOMMENDED_TIP_RATE * 100)}%</strong> of
                your total ({money(recommendedTipCents(invoice.totalCents))}). That amount is
                pre-filled on the card payment below and can be changed or removed, or you can hand
                it to the team on the day.
              </p>
            )}
            {/*
              The pay buttons post a `purpose`, never an amount — see PayPanel's
              header. When there is nothing left to charge (paid in full) the
              panel renders nothing, and the fallback below keeps the printed
              document pointing somewhere sensible.
            */}
            {payOptions.length > 0 ? (
              <PayPanel ref_={ref_} options={payOptions} />
            ) : (
              <Link className="action" href={`/my-booking?ref=${encodeURIComponent(ref_)}`}>
                View your booking
              </Link>
            )}
            {isAdminView && <AdminCustomCharge ref_={ref_} />}
            {/*
              The Venmo half, as a BUTTON rather than a bare handle.

              It is the cheaper option for the customer — the card path adds 3%
              — and it used to be a plain navy "@hosthampton" link sitting under
              a filled pill, so the page pushed hardest on the costlier one. Same
              pill as PayPanel's card button, in Venmo blue, so the two read as
              two ways to pay. See `.venmo-button` for the colour and the print
              rule that flattens it back to text on paper.

              The handle keeps its own line: it is what tells the customer WHO
              they are about to pay, which a label reading "with Venmo" does not.
            */}
            <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid rgba(174,182,194,0.2)' }}>
              <p className="section-sub" style={{ marginBottom: 12 }}>
                Prefer Venmo? No card fee.
              </p>
              <a
                className="venmo-button"
                href={`https://venmo.com/hosthampton?txn=pay&amount=${venmoAmount}&note=${encodeURIComponent(venmoNote)}`}
                target="_blank"
                rel="noopener"
              >
                Pay {money(askCents)} with Venmo
              </a>
              <div className="section-sub" style={{ marginTop: 10, marginBottom: 0 }}>
                Goes to <strong>@hosthampton</strong> &mdash; please include &ldquo;{venmoNote}&rdquo; in the
                note.
              </div>
            </div>
          </div>
        )}

        {/* ============ MOBILE MENU APPENDIX — mobile only, no prices ============ */}
        {invoice.mobileStations.length > 0 && (
          <div className="invoice-section">
            <h2>Full Mobile Party Menu</h2>
            <p className="section-sub">Everything we can bring to you &mdash; ask us to add any of these.</p>
            <div className="menu-grid">
              {invoice.mobileStations.map(s => (
                <div className="menu-chip" key={s.name}>
                  {s.emoji ? `${s.emoji} ` : ''}
                  {s.name}
                </div>
              ))}
            </div>
            <p className="section-sub" style={{ marginTop: 14, marginBottom: 0 }}>
              Don&rsquo;t see your idea? Ask us &mdash; we love custom requests! See the full menu anytime at{' '}
              <a
                href="https://www.hosthampton.com/mobile-party"
                target="_blank"
                rel="noopener"
                style={{ color: 'var(--navy)', fontWeight: 600 }}
              >
                hosthampton.com/mobile-party
              </a>
              .
            </p>
          </div>
        )}
      </div>

      {/* ============ LOCKED FOOTER ============ */}
      <div className="footer">
        <strong>Thank you for choosing Host Hampton!</strong>
        <br />
        <a
          href="https://www.google.com/maps/dir/?api=1&destination=295+Montauk+Hwy%2C+Speonk%2C+NY+11972"
          target="_blank"
          rel="noopener"
        >
          295 Montauk Hwy, Speonk, NY 11972
        </a>
        &nbsp;|&nbsp;
        <a href="sms:+16319989325">(631) 998-9325</a>
        &nbsp;|&nbsp;
        <a href="mailto:info@hosthampton.com">info@hosthampton.com</a>
        &nbsp;|&nbsp;
        <a href="https://www.hosthampton.com" target="_blank" rel="noopener">
          hosthampton.com
        </a>
      </div>
    </div>
  )
}

/**
 * "We could not load this", which is a different statement from "this does not
 * exist". Says nothing about the balance and offers no pay button, because the
 * figures are exactly what we failed to read.
 */
function PlanUnavailable({ ref_ }: { ref_: string }) {
  return (
    <div className="hh-invoice">
      <div
        style={{
          margin: '48px auto',
          maxWidth: 620,
          padding: '28px 32px',
          borderRadius: 12,
          background: '#fff',
          border: '1px solid rgba(26,39,68,0.15)',
          fontFamily: 'Georgia, serif',
          color: '#1a2744',
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 'normal', margin: '0 0 14px' }}>We couldn’t load this plan</h1>
        <p style={{ color: '#555', lineHeight: 1.7, margin: '0 0 14px', fontSize: 15 }}>
          Your plan <strong>{ref_}</strong> is still here — we just could not read it this moment. Please refresh in
          a few seconds.
        </p>
        <p style={{ color: '#555', lineHeight: 1.7, margin: 0, fontSize: 14 }}>
          If it keeps happening, call or text <strong>(631) 998-9325</strong> and we will sort it out. Nothing has
          been charged.
        </p>
      </div>
    </div>
  )
}

export default async function PlanSummaryPage({
  params,
  searchParams,
}: {
  params: Promise<{ ref: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { ref } = await params
  const query = await searchParams

  const cookieStore = await cookies()
  const cookieHeader = cookieStore
    .getAll()
    .map(c => `${c.name}=${c.value}`)
    .join('; ')

  // Two ways to be allowed in here, and the rule now lives in lib/planAccess.ts
  // rather than inline, because `/api/plan/[ref]/pay-link` has to make exactly
  // the same decision. A copy of an access rule is a place for it to drift, and
  // if this page enforced "a portal session for another booking is not a session
  // for this one" while the pay route did not, any portal cookie would mint a
  // pay link against any plan.
  //
  //   1. The CUSTOMER's portal cookie, which must name THIS plan.
  //   2. An ADMIN session cookie (migration 038), not scoped to a ref, because
  //      an admin is entitled to every plan.
  const access = planAccess(cookieHeader, ref)
  if (!access.ok) notFound()
  const isAdminView = access.isAdmin
  const adminEmail = access.adminEmail

  const supabase = getSupabase()
  const result = await loadPlanInvoice(ref, supabase)
  if (!result.ok) {
    // Three outcomes here too. A 404 for a plan that exists but could not be
    // READ tells a customer mid-payment that their invoice has vanished — and
    // the pay route next door already refuses to say that (it answers 503). The
    // same rule has to hold on the page, or the two disagree about the same
    // failure. A genuinely absent plan is still a 404, which is also what an
    // unauthorized one looks like, deliberately.
    if (result.notFound) notFound()
    console.error('plan summary: invoice load failed:', result.error)
    return <PlanUnavailable ref_={ref} />
  }

  // The number is issued on FIRST RENDER, not at insert, so a lead that never
  // gets quoted does not burn one. Idempotent: a refresh returns the same one.
  const numbered = await ensureInvoiceNumber(result.invoice.booking.id, supabase)
  const invoice: PlanInvoice = {
    ...result.invoice,
    invoiceNumber: numbered.ok ? numbered.invoiceNumber : result.invoice.invoiceNumber,
  }

  // ── What there is left to pay ────────────────────────────────────────────
  //
  // Priced here, on the server, from the invoice — which since link 23 reads the
  // authoritative payment rows itself and fails closed if it cannot, so there is
  // no second read to go stale and no branch where these buttons are priced as
  // if nothing had been paid. The client gets formatted strings and a `purpose`;
  // it never sees or sends a figure.
  const isCancelled = invoice.booking.status === 'cancelled'
  const payOptions: PayOption[] = []
  if (!isCancelled) {
    for (const purpose of ['deposit', 'balance'] as const) {
      const q = quoteFor(invoice, purpose)
      if (!q.ok) continue
      // ── What the button is allowed to CALL the money ──────────────────────
      //
      // `quoteFor('balance')` charges everything still outstanding. On a plan
      // where the deposit has NOT been paid that is the whole total, while the
      // invoice's own "Balance Due" line reads total-minus-deposit — so the page
      // said "Balance Due $350.00" directly above a button saying "Pay $600.00
      // balance". The figure was right and the word was wrong, and a number that
      // contradicts the line above it is the one error a client always catches.
      const clearsEverything = purpose === 'balance' && q.quote.amountCents > invoice.balanceDueCents
      const noun =
        purpose === 'deposit'
          ? invoice.depositIsSeparate
            ? 'security deposit'
            : 'deposit'
          : clearsEverything
            ? 'in full'
            : 'balance'
      // ── The tip jar, on the final payment only ────────────────────────────
      //
      // `purposeAcceptsTip` is the single owner of which purposes may carry one
      // — the same function the mint path consults — so the panel cannot offer
      // a tip the server would then drop. Percentages are OF THE PARTY TOTAL,
      // not of the amount being charged: on a plan where the deposit is already
      // paid, 10% of the remaining balance would quietly be less than the 10%
      // we told them we recommend.
      const tipBaseCents = invoice.totalCents
      const tip =
        purposeAcceptsTip(purpose) && tipBaseCents > 0
          ? {
              amountCents: q.quote.amountCents,
              feePercent: 3,
              presets: TIP_PRESET_PERCENTS.map(percent => ({
                percent,
                cents: tipCentsForPercent(tipBaseCents, percent),
              })),
              recommendedPercent: Math.round(RECOMMENDED_TIP_RATE * 100),
              recommendedCents: recommendedTipCents(tipBaseCents),
            }
          : undefined

      payOptions.push({
        purpose,
        cta: `Pay ${money(q.quote.amountCents)} ${noun}`,
        detail:
          q.quote.feeCents > 0
            ? `${money(q.quote.amountCents)} + ${money(q.quote.feeCents)} card fee = ${money(q.quote.chargeCents)} charged. Venmo or Zelle avoids the fee.`
            : `${money(q.quote.chargeCents)} charged.`,
        ...(tip ? { tip } : {}),
      })
    }
  }

  // `?paid=1` is where Stripe sends them back. The webhook usually lands first,
  // but it is not guaranteed to, so this promises nothing about the balance
  // below — a banner claiming a payment the ledger has not recorded yet would be
  // the page telling a customer something we cannot see.
  const justPaid = query.paid === '1'

  return (
    <div className="hh-invoice">
      <div className="action-bar no-print">
        {/* In-studio theme only — see canEditPlanInBuilder for why. */}
        {canEditPlanInBuilder(invoice.partyType) && (
          <Link className="action" href={`/party-planner?ref=${encodeURIComponent(ref)}`}>
            Edit plan
          </Link>
        )}
        <PrintButton />
        <PlanShareBar
          ref_={ref}
          canEmail={!!invoice.booking.contact_email}
          isAdmin={isAdminView}
          hasPhone={!!invoice.booking.contact_phone}
        />
        {/* `no-print` so a "Save as PDF" for the client never carries it. */}
        {isAdminView && (
          <span className="action" style={{ cursor: 'default' }}>
            Admin view · {adminEmail} · {ref}
          </span>
        )}
      </div>
      {justPaid && (
        <div
          className="no-print"
          style={{
            margin: '0 auto 16px',
            maxWidth: 820,
            padding: '12px 18px',
            borderRadius: 10,
            background: '#e8f3ec',
            color: '#1a6b3a',
            fontSize: 14,
          }}
        >
          Thank you — your payment is going through. Your receipt will arrive by email, and the balance
          below updates once Stripe confirms it (usually within a minute).
        </div>
      )}
      {isCancelled && (
        <div
          className="no-print"
          style={{
            margin: '0 auto 16px',
            maxWidth: 820,
            padding: '12px 18px',
            borderRadius: 10,
            background: '#fdecea',
            color: '#8a1c1c',
            fontSize: 14,
          }}
        >
          This plan is cancelled, so it cannot take a payment. Please call or text (631) 998-9325.
        </div>
      )}
      <InvoiceBody invoice={invoice} ref_={ref} payOptions={payOptions} isAdminView={isAdminView} />
    </div>
  )
}
