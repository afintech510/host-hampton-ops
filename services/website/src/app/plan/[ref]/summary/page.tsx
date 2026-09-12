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
import { loadPlanInvoice, money, type PlanInvoice } from '@/lib/planInvoice'
import { ensureInvoiceNumber } from '@/lib/invoiceNumber'
import { planAccess } from '@/lib/planAccess'
import { quoteFor, type PaymentRow } from '@/lib/planPayLinks'
import { PayPanel, PlanShareBar, AdminCustomCharge, type PayOption } from './PayPanel'
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
  const venmoAmount = (invoice.depositCents / 100).toFixed(2)
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
              <strong>{invoice.docTitle.replace(/ (Quotation|Invoice)$/, '')}</strong>
              {booking.package_type && (
                <>
                  <br />
                  {booking.package_type}
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
                  {invoice.venueAddress}
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
            <div className="totals-row balance">
              <div>
                <span className="label">Balance Due</span>
                {content.balanceNote && <div className="balance-note">{content.balanceNote}</div>}
              </div>
              <span className="amount">{money(invoice.balanceDueCents)}</span>
            </div>
          </div>

          {/* DEPOSIT CALLOUT — outside totals-section on purpose. */}
          {invoice.depositCents > 0 && (
            <div className="deposit-callout">
              <div>
                <div className="label">{content.depositLabel}</div>
                <div className="deposit-note">{content.depositNote}</div>
              </div>
              <div className="amount">{money(invoice.depositCents)}</div>
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

        {/* ============ GOOD TO KNOW / POLICIES ============ */}
        {(content.goodToKnow.length > 0 || content.policies.length > 0) && (
          <div className="goodtoknow">
            {content.goodToKnow.length > 0 && (
              <>
                <strong>Good to know:</strong>{' '}
                {content.goodToKnow.map((p, i) => (
                  <span key={i}>
                    <RichText text={p} />{' '}
                  </span>
                ))}
              </>
            )}
            {invoice.securityHoldCents != null && (
              <>
                {' '}
                A refundable {money(invoice.securityHoldCents)} card hold is placed on the day of your
                rental and released afterwards assuming no damage &mdash; it is not a charge and is
                separate from the deposit above.
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

        {/* ============ LOCKED PAYMENT SECTION ============ */}
        {invoice.depositCents > 0 && (
          <div className="pay-section invoice-section" style={{ textAlign: 'center' }}>
            <h2>Reserve Your Date</h2>
            <p className="section-sub">
              A <strong>{money(invoice.depositCents)}</strong> {content.depositLabel.split(' — ')[0].toLowerCase()} is
              required to book &mdash; separate from your total, see above. A 3% processing fee applies to
              card payments; Venmo and Zelle avoid it.
            </p>
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
            <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid rgba(174,182,194,0.2)' }}>
              <p className="section-sub" style={{ marginBottom: 6 }}>
                Prefer Venmo? Send {money(invoice.depositCents)} &mdash; no card fee.
              </p>
              <a
                href={`https://venmo.com/hosthampton?txn=pay&amount=${venmoAmount}&note=${encodeURIComponent(venmoNote)}`}
                target="_blank"
                rel="noopener"
                style={{ fontSize: 16, fontWeight: 600, color: 'var(--navy)' }}
              >
                @hosthampton
              </a>
              <div className="section-sub" style={{ marginTop: 6, marginBottom: 0 }}>
                Please include &ldquo;{venmoNote}&rdquo; in the note.
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
  if (!result.ok) notFound()

  // The number is issued on FIRST RENDER, not at insert, so a lead that never
  // gets quoted does not burn one. Idempotent: a refresh returns the same one.
  const numbered = await ensureInvoiceNumber(result.invoice.booking.id, supabase)
  const invoice: PlanInvoice = {
    ...result.invoice,
    invoiceNumber: numbered.ok ? numbered.invoiceNumber : result.invoice.invoiceNumber,
  }

  // ── What there is left to pay ────────────────────────────────────────────
  //
  // Priced here, on the server, from the invoice and the authoritative payment
  // rows. The client gets formatted strings and a `purpose`; it never sees or
  // sends a figure. A payments read failure shows NO pay buttons rather than
  // buttons priced as if nothing had been paid — offering to charge a deposit
  // that is already paid is the one mistake worth failing closed on.
  const { data: payRows, error: payErr } = await supabase
    .from('booking_payments')
    .select('amount_cents, payment_type')
    .eq('booking_id', invoice.booking.id)
  if (payErr) console.error('plan summary: payments read failed:', payErr.message)
  const payments = (payRows ?? []) as PaymentRow[]

  const isCancelled = invoice.booking.status === 'cancelled'
  const payOptions: PayOption[] = []
  if (!payErr && !isCancelled) {
    for (const purpose of ['deposit', 'balance'] as const) {
      const q = quoteFor(invoice, payments, purpose)
      if (!q.ok) continue
      const noun = purpose === 'deposit' ? (invoice.depositIsSeparate ? 'security deposit' : 'deposit') : 'balance'
      payOptions.push({
        purpose,
        cta: `Pay ${money(q.quote.amountCents)} ${noun}`,
        detail:
          q.quote.feeCents > 0
            ? `${money(q.quote.amountCents)} + ${money(q.quote.feeCents)} card fee = ${money(q.quote.chargeCents)} charged. Venmo or Zelle avoids the fee.`
            : `${money(q.quote.chargeCents)} charged.`,
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
        <Link className="action" href={`/party-planner?ref=${encodeURIComponent(ref)}`}>
          Edit plan
        </Link>
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
