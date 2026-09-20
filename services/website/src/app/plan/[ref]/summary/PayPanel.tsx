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
 * The one exception is the admin custom amount, which is an admin-only field
 * whose value the server caps at what the plan owes. See lib/planPayLinks.ts.
 *
 * `money()` is deliberately NOT imported here: it lives in lib/planInvoice.ts
 * alongside `getSupabase`, and pulling that into a client bundle to format a
 * dollar sign would ship the service-role client's module graph to the browser.
 */

import { useState } from 'react'

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
 * Two deliberate differences from the party-builder portal's version:
 *
 *   1. **It defaults to nothing.** The portal pre-fills 10% because the customer
 *      is already mid-checkout and has read the charge summary. This is a
 *      *document* — someone lands on it to read what the party costs, and a
 *      pre-filled tip would mean the button charges 10% more than the Total the
 *      page prints. The recommendation is stated in words instead, which is what
 *      was actually asked for. One line to change if that call goes the other way.
 *   2. **Whole dollars only.** No cent-level tipping; the presets round to a
 *      dollar and the custom field steps in dollars.
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
      <div className="tip-jar-head">Add a tip for the party team?</div>
      <p className="tip-jar-note">
        Entirely optional, and it goes to the people who run your party — never to the studio. We
        suggest <strong>{tip.recommendedPercent}%</strong> ({usd(tip.recommendedCents)}).
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

/** The pay buttons. Rendered inside the invoice's own payment section. */
export function PayPanel({ ref_, options }: { ref_: string; options: PayOption[] }) {
  const { busy, setBusy, error, setError } = useBusy()
  // Lives on the panel, not on the jar, because it has to reach `pay()`. Zero is
  // the honest default: see TipJar's header.
  const [tipCents, setTipCents] = useState(0)

  async function pay(purpose: string) {
    setError(null)
    setBusy(purpose)
    const option = options.find(o => o.purpose === purpose)
    // Only ever sent for an option the SERVER marked tippable. It re-checks
    // (`purposeAcceptsTip`) and re-clamps (`screenTipCents`) regardless — this
    // is the display agreeing with the server, not the client deciding.
    const tip = option?.tip ? Math.max(0, Math.round(tipCents)) : 0
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
            {busy === o.purpose ? 'Opening Stripe…' : o.tip && tipCents > 0 ? `${o.cta} + ${usd(tipCents)} tip` : o.cta}
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
      {error && (
        <p style={{ color: '#b00020', fontSize: 13, margin: '10px 0 0' }} role="alert">
          {error}
        </p>
      )}
    </div>
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
