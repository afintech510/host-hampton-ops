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

export interface PayOption {
  purpose: 'deposit' | 'balance'
  /** Button text, e.g. "Pay $250.00 deposit". */
  cta: string
  /** Sub-line, e.g. "$250.00 + $7.50 card fee = $257.50 charged". */
  detail: string
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

/** The pay buttons. Rendered inside the invoice's own payment section. */
export function PayPanel({ ref_, options }: { ref_: string; options: PayOption[] }) {
  const { busy, setBusy, error, setError } = useBusy()

  async function pay(purpose: string) {
    setError(null)
    setBusy(purpose)
    const { ok, data } = await postJson(`/api/plan/${encodeURIComponent(ref_)}/pay-link`, { purpose })
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
          <button type="button" style={{ ...btn, opacity: busy ? 0.6 : 1 }} disabled={busy !== null} onClick={() => pay(o.purpose)}>
            {busy === o.purpose ? 'Opening Stripe…' : o.cta}
          </button>
          <div className="section-sub" style={{ marginTop: 6, marginBottom: 0, fontSize: 12 }}>
            {o.detail}
          </div>
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
