'use client'

/**
 * The pay + share controls on `/plan/[ref]/summary` (Phase 5 items 2-4).
 *
 * This component holds no money logic at all, which is the point. Every figure
 * it displays is a pre-formatted string computed on the server from
 * `loadPlanInvoice()`, and every button posts a `purpose` — never an amount. If
 * this file were compromised entirely, the worst it could ask for is "a deposit
 * link" or "a balance link", both of which the server prices itself.
 *
 * There are two exceptions, and both are bounded by the server:
 *   * the admin custom amount, capped at what the plan owes (lib/planPayLinks.ts);
 *   * the customer's "pay part of the balance" amount — at least $50 (or what is
 *     left, if less) and clamped to what is left, enforced by
 *     `resolveInvoicePayment` in lib/planBalance.ts. The browser's min/max are
 *     for the human; they are not the guard.
 *
 * `money()` is deliberately NOT imported here: it lives in lib/planInvoice.ts
 * alongside `getSupabase`, and pulling that into a client bundle to format a
 * dollar sign would ship the service-role client's module graph to the browser.
 */

import { useState } from 'react'
import PortalCardPayment from '../../../my-booking/PortalCardPayment'

export interface TipPreset {
  percent: number
  cents: number
}

/** Everything the tip jar needs. Absent on any option that may not carry a tip. */
export interface TipConfig {
  /** The amount being paid, so the charge line can be recomputed as the tip moves. */
  amountCents: number
  /** 3, as in 3%. Display only — the server re-derives the fee when it mints. */
  feePercent: number
  presets: TipPreset[]
  /** The one we say out loud. `RECOMMENDED_TIP_RATE` in lib/partyPricing.ts. */
  recommendedPercent: number
  recommendedCents: number
}

export interface PayOption {
  purpose: 'deposit' | 'balance'
  /** Button text, e.g. "Pay $250.00 deposit". */
  cta: string
  /** Sub-line, e.g. "$250.00 + $7.50 card fee = $257.50 charged". */
  detail: string
  /** Present only on the final payment — see `purposeAcceptsTip`. */
  tip?: TipConfig
}

/**
 * The bounds of a part payment, for display. The server (`resolveInvoicePayment`)
 * re-derives and re-enforces both — a browser that ignored them would be refused,
 * not obeyed. Offered only to a customer paying in-page (never to an admin, whose
 * tool is the custom link) and only once the deposit is paid.
 */
export interface PartialConfig {
  minCents: number
  maxCents: number
  feePercent: number
}

/** What `/api/portal/pay` settled on — the figures the card button must read back. */
interface CardIntent {
  clientSecret: string
  paymentIntentId: string | null
  amountCents: number
  tipCents: number
  feeCents: number
  chargeCents: number
}

/**
 * A local dollar formatter.
 *
 * `money()` from lib/planInvoice.ts is deliberately not imported (see the file
 * header — it would drag the service-role Supabase client's module graph into
 * the browser bundle), and until the tip jar every figure on this panel arrived
 * pre-formatted from the server. A tip moves while the customer is choosing it,
 * so this one has to be formatted here.
 */
function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
}

/**
 * "Download PDF" — the browser's own print-to-PDF, not a generated file.
 *
 * There is no server-side renderer here by choice (plan §17): the `@media print`
 * rules in `invoice.css` strip the page down to the document itself, so "Save as
 * PDF" from the print sheet produces the invoice and nothing else. On iOS the
 * same button opens the share sheet, where "Save to Files" writes a PDF.
 *
 * A plain `<button>` rather than a link: `window.print()` needs a user gesture
 * and there is no URL that means "print".
 */
export function PrintButton() {
  return (
    <button
      type="button"
      className="action"
      onClick={() => window.print()}
      style={{ cursor: 'pointer', border: 'none', fontFamily: 'inherit' }}
    >
      Download PDF
    </button>
  )
}

type Busy = null | string

function useBusy() {
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  return { busy, setBusy, error, setError, done, setDone }
}

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  let data: Record<string, unknown> = {}
  try {
    data = (await res.json()) as Record<string, unknown>
  } catch {
    /* a non-JSON body is still a failure we can report generically */
  }
  return { ok: res.ok, data }
}

const btn: React.CSSProperties = {
  display: 'inline-block',
  background: '#1a2744',
  color: '#F6F1EB',
  border: 'none',
  padding: '15px 40px',
  borderRadius: 50,
  fontSize: 15,
  fontWeight: 700,
  letterSpacing: '0.5px',
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const linkBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  color: '#1a2744',
  textDecoration: 'underline',
  cursor: 'pointer',
  fontSize: 13,
  fontFamily: 'inherit',
}

/**
 * The tip jar, shown under the final payment only.
 *
 * **It pre-selects 10%** — Adam's call, 2026-09-20, matching the party-builder
 * portal so the two surfaces behave the same way. It shipped defaulting to zero
 * for one deploy on the argument that an invoice is a document rather than a
 * checkout, and that a pre-filled tip means the button charges more than the
 * Total printed above it. That argument is answered by making the difference
 * impossible to miss rather than by defaulting low: the button itself reads
 * "…+ $125.00 tip", the charge line under the jar spells out every component,
 * and **"No tip" is the first chip**, not a buried link.
 *
 * Whole dollars only — the presets round to a dollar and the custom field
 * steps in dollars.
 */
function TipJar({
  tip,
  tipCents,
  setTipCents,
  disabled,
}: {
  tip: TipConfig
  tipCents: number
  setTipCents: (c: number) => void
  disabled: boolean
}) {
  const [custom, setCustom] = useState('')
  const matched = tip.presets.find(p => p.cents === tipCents && p.cents > 0)
  const feeCents = Math.round((tip.amountCents + tipCents) * (tip.feePercent / 100))

  return (
    <div className="tip-jar">
      <div className="tip-jar-head">Tip for the party team</div>
      <p className="tip-jar-note">
        Entirely optional, and it goes to the people who run your party — never to the studio. We&rsquo;ve
        filled in our suggested <strong>{tip.recommendedPercent}%</strong> ({usd(tip.recommendedCents)})
        — change it to any amount, or choose <strong>No tip</strong>.
      </p>
      <div className="tip-jar-row">
        {tip.presets.map(p => {
          const active = p.cents === 0 ? tipCents === 0 : tipCents === p.cents
          return (
            <button
              key={p.percent}
              type="button"
              disabled={disabled}
              className={`tip-chip${active ? ' is-active' : ''}`}
              onClick={() => {
                setCustom('')
                setTipCents(p.cents)
              }}
            >
              {p.percent === 0 ? 'No tip' : `${p.percent}%`}
            </button>
          )
        })}
        <label className="tip-custom">
          <span aria-hidden="true">$</span>
          <input
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            aria-label="Custom tip in dollars"
            placeholder="Other"
            disabled={disabled}
            value={custom}
            onChange={e => {
              const raw = e.target.value
              setCustom(raw)
              if (raw === '') {
                setTipCents(0)
                return
              }
              const n = Number(raw)
              setTipCents(Number.isFinite(n) && n > 0 ? Math.round(n) * 100 : 0)
            }}
          />
        </label>
      </div>
      <div className="tip-jar-total">
        {tipCents > 0 ? (
          <>
            {usd(tip.amountCents)} + <strong>{usd(tipCents)} tip</strong> + {usd(feeCents)} card fee ={' '}
            <strong>{usd(tip.amountCents + tipCents + feeCents)}</strong> charged
            {matched ? ` (${matched.percent}%)` : ''}
          </>
        ) : (
          <>No tip &mdash; {usd(tip.amountCents + feeCents)} charged.</>
        )}
      </div>
    </div>
  )
}

/**
 * "Pay part of the balance" — a bounded custom amount, in-page only.
 *
 * The one place on this panel where a figure comes from the customer, which is
 * why the bounds are shown and also re-enforced by the server: `min`/`max` here
 * are for the human, `resolveInvoicePayment` is for the money. Whatever is typed,
 * the card form that follows is labelled with what the SERVER settled on.
 */
function PartialPayForm({
  partial,
  disabled,
  onSubmit,
}: {
  partial: PartialConfig
  disabled: boolean
  onSubmit: (amountCents: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [dollars, setDollars] = useState('')
  const cents = Math.round(Number(dollars) * 100)
  const valid = dollars.trim() !== '' && Number.isFinite(cents) && cents >= partial.minCents && cents <= partial.maxCents
  const feeCents = Math.round(cents * (partial.feePercent / 100))

  if (!open) {
    return (
      <div style={{ marginTop: 10 }}>
        <button type="button" style={linkBtn} disabled={disabled} onClick={() => setOpen(true)}>
          Pay part of the balance instead
        </button>
      </div>
    )
  }

  return (
    <div className="tip-jar" style={{ marginTop: 14, textAlign: 'left' }}>
      <div className="tip-jar-head">Pay part of the balance</div>
      <p className="tip-jar-note">
        Choose any amount from <strong>{usd(partial.minCents)}</strong> up to your full balance of{' '}
        <strong>{usd(partial.maxCents)}</strong>. Whatever is left stays on this invoice, and you can pay
        it the same way whenever you like.
      </p>
      <div className="tip-jar-row">
        <label className="tip-custom">
          <span aria-hidden="true">$</span>
          <input
            type="number"
            min={partial.minCents / 100}
            max={partial.maxCents / 100}
            step="0.01"
            inputMode="decimal"
            aria-label="Amount to pay in dollars"
            placeholder="Amount"
            disabled={disabled}
            value={dollars}
            onChange={e => setDollars(e.target.value)}
          />
        </label>
        <button
          type="button"
          style={{ ...btn, padding: '10px 28px', fontSize: 14, opacity: disabled || !valid ? 0.6 : 1 }}
          disabled={disabled || !valid}
          onClick={() => onSubmit(cents)}
        >
          Continue to card
        </button>
        <button type="button" style={linkBtn} disabled={disabled} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <div className="tip-jar-total">
        {valid ? (
          <>
            {usd(cents)} + {usd(feeCents)} card fee = <strong>{usd(cents + feeCents)}</strong> charged
            {partial.maxCents - cents > 0 ? <> &mdash; {usd(partial.maxCents - cents)} would remain.</> : <>.</>}
          </>
        ) : (
          <>
            {usd(partial.minCents)} minimum. A {partial.feePercent}% card fee applies; Venmo and Zelle avoid it.
          </>
        )}
      </div>
    </div>
  )
}

/**
 * The pay buttons. Rendered inside the invoice's own payment section.
 *
 * Two modes, and which one is a SERVER decision (`embedded`):
 *
 *   * **embedded** — the customer's own session. The buttons open Stripe's card
 *     form right here, on this page, through `/api/portal/pay` (a PaymentIntent)
 *     and the same `PortalCardPayment` Payment Element `/my-booking` uses. No
 *     redirect, and no second pay path: that route and
 *     `/api/party-builder/confirm-session` / the `payment_intent.succeeded`
 *     webhook already record exactly this.
 *   * **not embedded** — an admin looking at the page (no portal cookie, so
 *     `/api/portal/pay` would 401), or a booking `/api/portal/pay` refuses
 *     (`completed`). The buttons mint a hosted Stripe Payment Link, as they
 *     always have; an admin wants the URL to send on in any case.
 */
export function PayPanel({
  ref_,
  options,
  embedded = false,
  partial,
}: {
  ref_: string
  options: PayOption[]
  embedded?: boolean
  partial?: PartialConfig
}) {
  const { busy, setBusy, error, setError } = useBusy()
  const [card, setCard] = useState<CardIntent | null>(null)
  // Lives on the panel, not on the jar, because it has to reach `pay()`.
  // Seeded with the recommended 10% when a tip is on offer (see TipJar's
  // header). Computed in the initialiser rather than an effect, so the first
  // paint already agrees with the button label — a tip that appears a frame
  // after the page settles is a figure the customer did not watch arrive.
  const [tipCents, setTipCents] = useState(
    () => options.find(o => o.tip)?.tip?.recommendedCents ?? 0,
  )

  /**
   * Ask `/api/portal/pay` for a PaymentIntent and open the card form in place.
   * Posts a `purpose` — never an amount, except a part payment's bounded one.
   */
  async function startCard(purpose: 'deposit' | 'balance' | 'partial', extra: Record<string, unknown>) {
    setError(null)
    setBusy(purpose)
    const { ok, data } = await postJson('/api/portal/pay', { paymentMethod: 'card', purpose, ...extra })
    setBusy(null)
    if (
      !ok ||
      typeof data.clientSecret !== 'string' ||
      typeof data.chargeCents !== 'number' ||
      typeof data.amountCents !== 'number'
    ) {
      setError(typeof data.error === 'string' ? data.error : 'Could not start the payment — please try again.')
      return
    }
    setCard({
      clientSecret: data.clientSecret,
      paymentIntentId: typeof data.paymentIntentId === 'string' ? data.paymentIntentId : null,
      amountCents: data.amountCents,
      tipCents: typeof data.tipCents === 'number' ? data.tipCents : 0,
      feeCents: typeof data.feeCents === 'number' ? data.feeCents : 0,
      chargeCents: data.chargeCents,
    })
  }

  async function pay(purpose: string) {
    setError(null)
    setBusy(purpose)
    const option = options.find(o => o.purpose === purpose)
    // Only ever sent for an option the SERVER marked tippable. It re-checks
    // (`purposeAcceptsTip`) and re-clamps (`screenTipCents`) regardless — this
    // is the display agreeing with the server, not the client deciding.
    const tip = option?.tip ? Math.max(0, Math.round(tipCents)) : 0
    if (embedded) {
      await startCard(purpose as 'deposit' | 'balance', tip > 0 ? { tipCents: tip } : {})
      return
    }
    const { ok, data } = await postJson(`/api/plan/${encodeURIComponent(ref_)}/pay-link`, {
      purpose,
      ...(tip > 0 ? { tipCents: tip } : {}),
    })
    if (!ok || typeof data.payUrl !== 'string') {
      setBusy(null)
      setError(typeof data.error === 'string' ? data.error : 'Could not start the payment — please try again.')
      return
    }
    // Straight to Stripe. `busy` is deliberately left set: the page is on its way
    // out and re-enabling the button would invite a second click that mints a
    // second link and voids the one they are about to use.
    window.location.href = data.payUrl
  }

  if (options.length === 0) return null

  // The card form replaces the buttons while it is open. Leaving them up would
  // invite a second click that opens a second PaymentIntent beside the live one.
  if (card) {
    const lines = [
      `${usd(card.amountCents)}`,
      ...(card.tipCents > 0 ? [`${usd(card.tipCents)} tip`] : []),
      ...(card.feeCents > 0 ? [`${usd(card.feeCents)} card fee`] : []),
    ]
    return (
      <div className="no-print" style={{ textAlign: 'left', maxWidth: 460, margin: '0 auto' }}>
        <p className="section-sub" style={{ marginBottom: 14 }}>
          {lines.join(' + ')} = <strong>{usd(card.chargeCents)}</strong> charged to your card.
        </p>
        <PortalCardPayment
          clientSecret={card.clientSecret}
          paymentIntentId={card.paymentIntentId}
          payLabel={`Pay ${usd(card.chargeCents)}`}
          returnPath={`/plan/${encodeURIComponent(ref_)}/summary?paid=1`}
          onCancel={() => setCard(null)}
          // A full navigation, not a router refresh: this is a server-rendered
          // document and the cheapest way to be certain every figure on it is
          // re-read is to load it again.
          onSuccess={() => window.location.assign(`/plan/${encodeURIComponent(ref_)}/summary?paid=1`)}
        />
      </div>
    )
  }

  return (
    <div className="no-print">
      {options.map(o => (
        <div key={o.purpose} style={{ marginBottom: 14 }}>
          {/*
            The jar sits ABOVE its button on purpose: a tip chosen after the
            customer has already read the button is a tip they have to notice
            changed the figure. This way the charge line under the jar and the
            button they press are read in that order.
          */}
          {o.tip && (
            <TipJar tip={o.tip} tipCents={tipCents} setTipCents={setTipCents} disabled={busy !== null} />
          )}
          <button type="button" style={{ ...btn, opacity: busy ? 0.6 : 1 }} disabled={busy !== null} onClick={() => pay(o.purpose)}>
            {busy === o.purpose
              ? embedded ? 'Loading card form…' : 'Opening Stripe…'
              : o.tip && tipCents > 0 ? `${o.cta} + ${usd(tipCents)} tip` : o.cta}
          </button>
          {/*
            `detail` is the server's static charge line. When there is a jar it
            is suppressed, because the jar prints the same sentence with the tip
            folded in and live — two charge lines that disagree by the tip is
            exactly the "invoice says one thing, button charges another" failure
            this panel is otherwise careful about.
          */}
          {!o.tip && (
            <div className="section-sub" style={{ marginTop: 6, marginBottom: 0, fontSize: 12 }}>
              {o.detail}
            </div>
          )}
        </div>
      ))}
      {embedded && partial && (
        <PartialPayForm
          partial={partial}
          disabled={busy !== null}
          onSubmit={cents => startCard('partial', { amountCents: cents })}
        />
      )}
      {error && (
        <p style={{ color: '#b00020', fontSize: 13, margin: '10px 0 0' }} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * The refundable damage hold on a studio rental — its own button, deliberately
 * NOT a `PayOption`.
 *
 * Keeping it out of `PayPanel` is the point. Everything in that panel charges
 * money that pays the invoice down; this authorizes money that is never
 * captured and never touches the balance. Folding it in would put a $250 button
 * next to the balance buttons with no way for a customer to tell which of them
 * takes their money — and no way for us to be sure a future change to the pay
 * loop did not start treating it as revenue.
 *
 * Three states, because "no button" answers two different questions wrongly: a
 * customer five days out needs the button, a customer six weeks out needs to
 * know it is coming, and a customer who has already authorized needs to be told
 * to stop looking for it.
 */
export function SecurityHoldPanel({
  ref_,
  state,
  amountLabel,
  opensOnLabel,
}: {
  ref_: string
  state: 'offer' | 'too_early' | 'done'
  amountLabel: string
  opensOnLabel: string
}) {
  const { busy, setBusy, error, setError } = useBusy()

  async function startHold() {
    setError(null)
    setBusy('hold')
    const { ok, data } = await postJson(`/api/plan/${encodeURIComponent(ref_)}/security-hold`, {})
    if (!ok || typeof data.url !== 'string') {
      setBusy(null)
      setError(typeof data.error === 'string' ? data.error : 'Could not start the hold — please try again.')
      return
    }
    // `busy` stays set on the way out, same as the pay buttons: a second click
    // here is a second authorization on the same card.
    window.location.href = data.url
  }

  if (state === 'done') {
    return (
      <div className="section-sub" style={{ marginTop: 10, marginBottom: 0 }}>
        ✓ Your <strong>{amountLabel}</strong> refundable hold is on file — nothing further to do.
        It is an authorization, not a charge, and it drops off your card after your rental.
      </div>
    )
  }

  if (state === 'too_early') {
    return (
      <div className="section-sub" style={{ marginTop: 10, marginBottom: 0 }}>
        Your <strong>{amountLabel}</strong> refundable hold opens on <strong>{opensOnLabel}</strong>.
        We&rsquo;ll place it on your card then — or you can do it with us in person on the day.
      </div>
    )
  }

  return (
    <div className="no-print" style={{ marginTop: 10 }}>
      <button
        type="button"
        style={{ ...btn, opacity: busy ? 0.6 : 1 }}
        disabled={busy !== null}
        onClick={startHold}
      >
        {busy ? 'Opening Stripe…' : `Place the ${amountLabel} refundable hold`}
      </button>
      <div className="section-sub" style={{ marginTop: 6, marginBottom: 0, fontSize: 12 }}>
        An authorization on your card, not a charge — it is released after your rental once the
        space is confirmed in good condition. You can also do this with us in person on the day.
      </div>
      {error && (
        <p style={{ color: '#b00020', fontSize: 13, margin: '10px 0 0' }} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * The room-rental waiver — the SignWell Studio Rental Agreement & Liability
 * Waiver, reached through the same tokenised `/checkin/<token>` link the
 * pre-arrival text carries (details first, then the agreement).
 *
 * Kept out of `PayPanel` for the reason `SecurityHoldPanel` is: it takes no money
 * and must not sit among the buttons that do. The page decides the state
 * (`waiverOffer`); the route re-asks it before minting, so a stale page cannot
 * obtain a link the rules refuse.
 *
 *   * the customer is taken straight to the link;
 *   * an admin gets it COPIED instead — an admin viewing the page wants a URL to
 *     send on (that is the only way an admin can get this link today), not to be
 *     taken through the customer's check-in themselves.
 */
export function WaiverPanel({
  ref_,
  state,
  isAdmin,
}: {
  ref_: string
  state: 'offer' | 'signed'
  isAdmin: boolean
}) {
  const { busy, setBusy, error, setError, done, setDone } = useBusy()

  async function open() {
    setError(null)
    setDone(null)
    setBusy('waiver')
    const { ok, data } = await postJson(`/api/plan/${encodeURIComponent(ref_)}/waiver-link`, {})
    if (!ok || typeof data.url !== 'string') {
      setBusy(null)
      setError(typeof data.error === 'string' ? data.error : 'Could not open the waiver — please try again.')
      return
    }
    if (isAdmin) {
      await navigator.clipboard?.writeText(data.url).catch(() => {})
      setBusy(null)
      setDone(data.url)
      return
    }
    // `busy` stays set on the way out: a second click mints a second token.
    window.location.href = data.url
  }

  if (state === 'signed') {
    return (
      <div className="section-sub" style={{ marginTop: 10, marginBottom: 0 }}>
        ✓ Your <strong>rental agreement &amp; waiver</strong> is signed &mdash; nothing further to do.
      </div>
    )
  }

  return (
    <div className="no-print" style={{ marginTop: 10 }}>
      <button type="button" style={{ ...btn, opacity: busy ? 0.6 : 1 }} disabled={busy !== null} onClick={open}>
        {busy ? 'Opening…' : isAdmin ? 'Copy the rental waiver link' : 'Sign your room rental waiver'}
      </button>
      <div className="section-sub" style={{ marginTop: 6, marginBottom: 0, fontSize: 12 }}>
        {isAdmin
          ? 'Admin · copies the customer’s check-in link (details, then the agreement). Nothing is sent. Valid until the day of the rental.'
          : 'Takes a couple of minutes: confirm your details, then sign the rental agreement and liability waiver. Please complete it before your rental.'}
      </div>
      {done && (
        <p style={{ color: '#1a6b3a', fontSize: 13, margin: '8px 0 0', wordBreak: 'break-all' }}>
          Copied: {done}
        </p>
      )}
      {error && (
        <p style={{ color: '#b00020', fontSize: 13, margin: '10px 0 0' }} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * "Where's the party?" — the customer types their street address on the
 * invoice. Drawn only when lib/partyAddress.ts says the address on file is a
 * placeholder; the route re-asks the same module before it writes. `current`
 * pre-fills the field with whatever we have ("Westhampton, NY …") so the
 * customer completes it rather than starting over.
 */
export function PartyAddressForm({ ref_, current }: { ref_: string; current: string | null }) {
  const { busy, setBusy, error, setError, done, setDone } = useBusy()
  const [value, setValue] = useState(current && !/\b(tbc|tbd)\b/i.test(current) ? current : '')

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy('address')
    const { ok, data } = await postJson(`/api/plan/${encodeURIComponent(ref_)}/address`, { address: value })
    setBusy(null)
    if (!ok) {
      setError(typeof data.error === 'string' ? data.error : 'Could not save the address — please try again.')
      return
    }
    setDone(typeof data.address === 'string' ? data.address : value)
  }

  if (done) {
    return (
      <div className="address-callout no-print">
        <strong>✓ Thank you — we have your party address:</strong> {done}
        <div className="section-sub" style={{ margin: '6px 0 0', fontSize: 13 }}>
          Need to change it? Call or text (631) 998-9325.
        </div>
      </div>
    )
  }

  return (
    <form className="address-callout no-print" onSubmit={save}>
      <label htmlFor="party-address" style={{ display: 'block', fontWeight: 700, marginBottom: 4 }}>
        Where&rsquo;s the party?
      </label>
      <div className="section-sub" style={{ margin: '0 0 10px', fontSize: 13 }}>
        Please add the full street address so our team knows exactly where to set up.
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          id="party-address"
          type="text"
          autoComplete="street-address"
          placeholder="Street address, town, ZIP"
          value={value}
          onChange={e => setValue(e.target.value)}
          maxLength={200}
          required
          style={{
            flex: '1 1 260px',
            padding: '12px 14px',
            borderRadius: 10,
            border: '1px solid rgba(26,39,68,0.25)',
            fontSize: 15,
            fontFamily: 'inherit',
          }}
        />
        <button type="submit" style={{ ...btn, padding: '12px 28px', opacity: busy ? 0.6 : 1 }} disabled={busy !== null}>
          {busy ? 'Saving…' : 'Save address'}
        </button>
      </div>
      {error && (
        <p style={{ color: '#b00020', fontSize: 13, margin: '10px 0 0' }} role="alert">
          {error}
        </p>
      )}
    </form>
  )
}

/**
 * "Email me this" for the customer, and "Send to client" for an admin.
 *
 * The admin half is a two-step: pick a channel, then confirm. The server also
 * requires `confirm: true`, so this dialog is a courtesy to the human rather
 * than the guard — nothing auto-sends to a customer, and the check that
 * guarantees it is server-side.
 */
export function PlanShareBar({
  ref_,
  canEmail,
  isAdmin,
  hasPhone,
}: {
  ref_: string
  canEmail: boolean
  isAdmin: boolean
  hasPhone: boolean
}) {
  const { busy, setBusy, error, setError, done, setDone } = useBusy()
  const [confirming, setConfirming] = useState(false)
  const [channel, setChannel] = useState<'email' | 'sms' | 'both'>('email')
  const [note, setNote] = useState('')

  async function emailMe() {
    setError(null)
    setDone(null)
    setBusy('me')
    const { ok, data } = await postJson(`/api/plan/${encodeURIComponent(ref_)}/email-me`, {})
    setBusy(null)
    if (!ok) {
      setError(typeof data.error === 'string' ? data.error : 'Could not send — please try again.')
      return
    }
    setDone(`Sent to ${typeof data.sentTo === 'string' ? data.sentTo : 'your inbox'}.`)
  }

  async function sendToClient() {
    setError(null)
    setDone(null)
    setBusy('client')
    const { ok, data } = await postJson(`/api/admin/plan/${encodeURIComponent(ref_)}/send`, {
      channel,
      confirm: true,
      note: note.trim() || undefined,
    })
    setBusy(null)
    setConfirming(false)
    if (!ok) {
      setError(typeof data.error === 'string' ? data.error : 'Could not send — please try again.')
      return
    }
    const results = Array.isArray(data.results) ? (data.results as string[]) : []
    const failures = Array.isArray(data.failures) ? (data.failures as string[]) : []
    setDone([results.join(' · '), failures.length ? `Failed: ${failures.join('; ')}` : ''].filter(Boolean).join(' — '))
  }

  return (
    <span className="no-print" style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
      {canEmail && (
        <button type="button" className="action" disabled={busy !== null} onClick={emailMe} style={{ cursor: 'pointer', border: 'none', fontFamily: 'inherit' }}>
          {busy === 'me' ? 'Sending…' : 'Email me this'}
        </button>
      )}

      {isAdmin && (
        <>
          {!confirming ? (
            <button
              type="button"
              className="action"
              onClick={() => setConfirming(true)}
              style={{ cursor: 'pointer', border: 'none', fontFamily: 'inherit' }}
            >
              Send to client…
            </button>
          ) : (
            <span
              style={{
                display: 'inline-flex',
                flexWrap: 'wrap',
                gap: 8,
                alignItems: 'center',
                background: '#fff',
                border: '1px solid rgba(26,39,68,0.2)',
                borderRadius: 10,
                padding: '8px 12px',
              }}
            >
              <select
                value={channel}
                onChange={e => setChannel(e.target.value as 'email' | 'sms' | 'both')}
                style={{ fontFamily: 'inherit', fontSize: 13, padding: '4px 6px' }}
              >
                <option value="email">Email</option>
                <option value="sms" disabled={!hasPhone}>
                  Text{hasPhone ? '' : ' (no number)'}
                </option>
                <option value="both" disabled={!hasPhone}>
                  Both{hasPhone ? '' : ' (no number)'}
                </option>
              </select>
              <input
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Optional note to the client"
                style={{ fontFamily: 'inherit', fontSize: 13, padding: '5px 8px', minWidth: 210 }}
              />
              <button
                type="button"
                disabled={busy !== null}
                onClick={sendToClient}
                style={{ ...linkBtn, fontWeight: 700, textDecoration: 'none', background: '#1a2744', color: '#F6F1EB', padding: '6px 14px', borderRadius: 50 }}
              >
                {busy === 'client' ? 'Sending…' : 'Confirm send'}
              </button>
              <button type="button" onClick={() => setConfirming(false)} style={linkBtn}>
                Cancel
              </button>
            </span>
          )}
        </>
      )}

      {done && <span style={{ fontSize: 13, color: '#1a6b3a' }}>{done}</span>}
      {error && (
        <span style={{ fontSize: 13, color: '#b00020' }} role="alert">
          {error}
        </span>
      )}
    </span>
  )
}

/**
 * Admin-only: charge an amount this plan owes that is neither the deposit nor
 * the whole balance. The server caps it at `remaining + depositOwed`, so this
 * cannot be used to charge more than the invoice justifies.
 */
export function AdminCustomCharge({ ref_ }: { ref_: string }) {
  const { busy, setBusy, error, setError } = useBusy()
  const [amount, setAmount] = useState('')

  async function go() {
    setError(null)
    setBusy('custom')
    const { ok, data } = await postJson(`/api/plan/${encodeURIComponent(ref_)}/pay-link`, {
      purpose: 'custom',
      amountDollars: amount,
    })
    if (!ok || typeof data.payUrl !== 'string') {
      setBusy(null)
      setError(typeof data.error === 'string' ? data.error : 'Could not create the link.')
      return
    }
    // An admin wants the URL to send on, not to be taken to Stripe themselves.
    await navigator.clipboard?.writeText(data.payUrl).catch(() => {})
    setBusy(null)
    setError(null)
    window.open(data.payUrl, '_blank', 'noopener')
  }

  return (
    <div className="no-print" style={{ marginTop: 18, paddingTop: 14, borderTop: '1px dashed rgba(26,39,68,0.2)' }}>
      <div className="section-sub" style={{ marginBottom: 6, fontSize: 12 }}>
        Admin · custom amount (capped at what this plan owes)
      </div>
      <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
        <input
          value={amount}
          onChange={e => setAmount(e.target.value)}
          inputMode="decimal"
          placeholder="Amount in dollars"
          style={{ fontFamily: 'inherit', fontSize: 13, padding: '6px 9px', width: 150 }}
        />
        <button type="button" disabled={busy !== null || !amount.trim()} onClick={go} style={linkBtn}>
          {busy ? 'Creating…' : 'Create link'}
        </button>
      </span>
      {error && (
        <p style={{ color: '#b00020', fontSize: 13, margin: '8px 0 0' }} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
