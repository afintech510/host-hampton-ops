'use client'

/**
 * The market vendor book — the screen that did not exist for the Spring Market.
 *
 * ── AUTH ──
 *
 * Two doors, both already built, neither one new:
 *
 *   1. The `hh_admin` HttpOnly cookie. If Adam is signed into /admin in this
 *      browser it is sent automatically and this page just works.
 *   2. `localStorage['hh_admin_token']` — the shared-password bearer the main
 *      admin panel already stores under exactly that key.
 *
 * If neither opens the door we show a password box that writes key 2. The
 * password is never in the bundle and is only ever judged by the server.
 *
 * Note how the login result is read: **only a 401 means the password is wrong.**
 * Anything else is reported as "could not reach the vendor book", because a
 * network fault that reads as a bad password sends Adam hunting for a
 * credential that was never the problem.
 */

import { useCallback, useEffect, useState } from 'react'

const TOKEN_KEY = 'hh_admin_token'

interface Vendor {
  id: string
  vendor_ref: string
  contact_name: string
  business_name: string
  ig_handle: string | null
  email: string
  phone: string
  product_category: string
  product_description: string | null
  needs_electricity: boolean
  booth_note: string | null
  payment_method: 'card' | 'venmo'
  total_cents: number
  status: string
  status_note: string | null
  notes: string | null
  paid_at: string | null
  created_at: string
}

interface Stats {
  paid: number
  pending: number
  waitlist: number
  collectedCents: number
  boothsLeft: number
  needElectricity: number
}

interface MarketMeta {
  slug: string
  name: string
  dateLabel: string
  capacity: number
  totalCents: number
}

const money = (c: number) => `$${(c / 100).toFixed(2)}`

const STATUS_STYLE: Record<string, string> = {
  paid: 'bg-emerald-100 text-emerald-800',
  pending_payment: 'bg-amber-100 text-amber-800',
  waitlist: 'bg-sky-100 text-sky-800',
  cancelled: 'bg-gray-200 text-gray-600',
  refunded: 'bg-rose-100 text-rose-800',
}

const STATUS_LABEL: Record<string, string> = {
  paid: 'Paid',
  pending_payment: 'Awaiting payment',
  waitlist: 'Waitlist',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
}

export default function MarketVendorsPage() {
  const [authed, setAuthed] = useState(false)
  const [checking, setChecking] = useState(true)
  const [pw, setPw] = useState('')
  const [loginError, setLoginError] = useState('')

  const [vendors, setVendors] = useState<Vendor[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [market, setMarket] = useState<MarketMeta | null>(null)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const authHeaders = useCallback((): HeadersInit => {
    const t = typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null
    return t ? { Authorization: `Bearer ${t}` } : {}
  }, [])

  const load = useCallback(async (): Promise<'ok' | 'unauthorized' | 'error'> => {
    try {
      const res = await fetch('/api/admin/market-vendors', { headers: authHeaders() })
      if (res.status === 401) return 'unauthorized'
      if (!res.ok) {
        setError('Could not reach the vendor book.')
        return 'error'
      }
      const data = await res.json()
      setVendors(data.vendors || [])
      setStats(data.stats || null)
      setMarket(data.market || null)
      setError('')
      return 'ok'
    } catch {
      setError('Could not reach the vendor book.')
      return 'error'
    }
  }, [authHeaders])

  useEffect(() => {
    load().then(r => {
      setAuthed(r === 'ok')
      setChecking(false)
    })
  }, [load])

  async function login(e: React.FormEvent) {
    e.preventDefault()
    setLoginError('')
    localStorage.setItem(TOKEN_KEY, pw)
    const r = await load()
    if (r === 'ok') {
      setAuthed(true)
      return
    }
    localStorage.removeItem(TOKEN_KEY)
    // Only a 401 is a wrong password. Everything else is a reachability problem
    // and saying "wrong password" would be a lie that costs an hour.
    setLoginError(r === 'unauthorized' ? 'That password was not accepted.' : 'Could not reach the vendor book — try again.')
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setBusyId(id)
    try {
      const res = await fetch(`/api/admin/market-vendors/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Update failed.')
        return
      }
      await load()
    } catch {
      setError('Update failed.')
    } finally {
      setBusyId('')
    }
  }

  function exportCsv() {
    const head = ['Ref', 'Business', 'Contact', 'Email', 'Phone', 'Instagram', 'Sells', 'Power', 'Pay', 'Total', 'Status', 'Signed up']
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const body = vendors.map(v => [
      v.vendor_ref, v.business_name, v.contact_name, v.email, v.phone, v.ig_handle || '',
      v.product_category, v.needs_electricity ? 'YES' : '', v.payment_method,
      money(v.total_cents), STATUS_LABEL[v.status] || v.status,
      new Date(v.created_at).toLocaleDateString(),
    ].map(esc).join(','))
    const blob = new Blob([[head.map(esc).join(','), ...body].join('\n')], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `market-vendors-${market?.slug || 'export'}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  if (checking) {
    return <div className="min-h-screen bg-[#F6F1EB] grid place-items-center text-hampton-navy/60">Loading…</div>
  }

  if (!authed) {
    return (
      <div className="min-h-screen bg-[#F6F1EB] grid place-items-center px-5">
        <form onSubmit={login} className="bg-white rounded-2xl shadow-sm p-8 w-full max-w-sm">
          <h1 className="font-serif text-2xl text-hampton-navy mb-2">Vendor book</h1>
          <p className="text-hampton-navy/60 text-sm mb-5">Admin password.</p>
          <input
            type="password"
            value={pw}
            onChange={e => setPw(e.target.value)}
            className="w-full border-2 border-hampton-pink/40 rounded-lg px-4 py-3 mb-3 outline-none focus:border-hampton-navy"
            placeholder="Password"
            autoFocus
          />
          {loginError && <p className="text-red-600 text-sm mb-3">{loginError}</p>}
          <button type="submit" className="w-full bg-hampton-navy text-[#F6F1EB] font-bold py-3 rounded-full">
            Open
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F6F1EB] px-5 py-10">
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
          <div>
            <h1 className="font-serif text-3xl text-hampton-navy">{market?.name || 'Market vendors'}</h1>
            <p className="text-hampton-navy/60 text-sm mt-1">{market?.dateLabel}</p>
          </div>
          <button onClick={exportCsv} className="text-sm font-semibold text-hampton-navy border-2 border-hampton-navy rounded-full px-5 py-2">
            Export CSV
          </button>
        </div>

        {error && <p className="bg-red-50 text-red-700 text-sm rounded-lg px-4 py-3 mb-5">{error}</p>}

        {stats && market && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
            <Tile label="Booths left" value={`${stats.boothsLeft} of ${market.capacity}`} />
            <Tile label="Paid" value={String(stats.paid)} />
            <Tile label="Awaiting payment" value={String(stats.pending)} accent={stats.pending > 0} />
            <Tile label="Collected" value={money(stats.collectedCents)} />
          </div>
        )}

        {stats && stats.needElectricity > 0 && (
          <p className="text-hampton-navy/70 text-sm mb-5">
            ⚡ {stats.needElectricity} paid vendor{stats.needElectricity === 1 ? '' : 's'} asked for an outlet.
          </p>
        )}

        {vendors.length === 0 ? (
          <div className="bg-white rounded-2xl p-10 text-center text-hampton-navy/50">
            No registrations yet.
          </div>
        ) : (
          <div className="space-y-3">
            {vendors.map(v => (
              <div key={v.id} className="bg-white rounded-2xl shadow-sm overflow-hidden">
                <button
                  onClick={() => setExpanded(expanded === v.id ? null : v.id)}
                  className="w-full text-left px-5 py-4 flex flex-wrap items-center gap-3"
                >
                  <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${STATUS_STYLE[v.status] || 'bg-gray-100 text-gray-700'}`}>
                    {STATUS_LABEL[v.status] || v.status}
                  </span>
                  <span className="font-semibold text-hampton-navy">{v.business_name}</span>
                  <span className="text-hampton-navy/50 text-sm">{v.product_category}</span>
                  {v.needs_electricity && <span title="Needs an outlet">⚡</span>}
                  <span className="ml-auto text-hampton-navy/40 text-xs font-mono">{v.vendor_ref}</span>
                </button>

                {expanded === v.id && (
                  <div className="px-5 pb-5 border-t border-hampton-pink/20 pt-4 space-y-4">
                    <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                      <Row label="Contact" value={v.contact_name} />
                      <Row label="Email" value={<a className="underline" href={`mailto:${v.email}`}>{v.email}</a>} />
                      <Row label="Phone" value={<a className="underline" href={`tel:${v.phone.replace(/[^\d+]/g, '')}`}>{v.phone}</a>} />
                      <Row label="Instagram" value={v.ig_handle || '—'} />
                      <Row label="Pays by" value={v.payment_method === 'venmo' ? 'Venmo' : 'Card'} />
                      <Row label="Amount" value={money(v.total_cents)} />
                      <Row label="Signed up" value={new Date(v.created_at).toLocaleString()} />
                      {v.paid_at && <Row label="Paid" value={new Date(v.paid_at).toLocaleString()} />}
                    </div>

                    {v.product_description && (
                      <div>
                        <p className="text-hampton-navy/50 text-xs uppercase tracking-wider mb-1">Sells</p>
                        <p className="text-hampton-navy/80 text-sm">{v.product_description}</p>
                      </div>
                    )}
                    {v.booth_note && (
                      <div>
                        <p className="text-hampton-navy/50 text-xs uppercase tracking-wider mb-1">Their note</p>
                        <p className="text-hampton-navy/80 text-sm">{v.booth_note}</p>
                      </div>
                    )}
                    {v.status_note && <p className="text-hampton-navy/40 text-xs italic">{v.status_note}</p>}

                    <NotesBox
                      initial={v.notes || ''}
                      busy={busyId === v.id}
                      onSave={notes => patch(v.id, { notes })}
                    />

                    <div className="flex flex-wrap gap-2 pt-1">
                      {v.payment_method === 'venmo' && v.status !== 'paid' && v.status !== 'cancelled' && (
                        <button
                          disabled={busyId === v.id}
                          onClick={() => patch(v.id, { action: 'confirm_venmo' })}
                          className="text-sm font-semibold bg-emerald-600 text-white rounded-full px-4 py-2 disabled:opacity-50"
                        >
                          I see the Venmo — mark paid
                        </button>
                      )}
                      {v.status === 'waitlist' && (
                        <button
                          disabled={busyId === v.id}
                          onClick={() => patch(v.id, { status: 'pending_payment' })}
                          className="text-sm font-semibold border-2 border-hampton-navy text-hampton-navy rounded-full px-4 py-2 disabled:opacity-50"
                        >
                          Offer them a booth
                        </button>
                      )}
                      {v.status !== 'cancelled' && (
                        <button
                          disabled={busyId === v.id}
                          onClick={() => patch(v.id, { status: 'cancelled' })}
                          className="text-sm font-semibold text-red-600 border-2 border-red-200 rounded-full px-4 py-2 disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      )}
                    </div>

                    {v.status === 'paid' && (
                      <p className="text-hampton-navy/40 text-xs">
                        A paid vendor can&rsquo;t be edited back to unpaid here — refund it in Stripe (or in
                        Financials for a Venmo payment) so the money and the status stay in step.
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <p className="text-hampton-navy/40 text-xs mt-8">
          Attendee RSVPs are separate — they live under <strong>Admin → Events → Christmas Market → Tickets</strong>.
        </p>
      </div>
    </div>
  )
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl p-4 ${accent ? 'bg-amber-50' : 'bg-white'}`}>
      <p className="text-hampton-navy/50 text-[11px] uppercase tracking-wider mb-1">{label}</p>
      <p className="text-hampton-navy text-xl font-bold">{value}</p>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <p className="text-hampton-navy/80">
      <span className="text-hampton-navy/50">{label}: </span>
      {value}
    </p>
  )
}

function NotesBox({ initial, busy, onSave }: { initial: string; busy: boolean; onSave: (v: string) => void }) {
  const [value, setValue] = useState(initial)
  const dirty = value !== initial
  return (
    <div>
      <p className="text-hampton-navy/50 text-xs uppercase tracking-wider mb-1">Your notes</p>
      <textarea
        value={value}
        onChange={e => setValue(e.target.value)}
        rows={2}
        placeholder="Table by the window, arriving 8:45…"
        className="w-full border-2 border-hampton-pink/30 rounded-lg px-3 py-2 text-sm outline-none focus:border-hampton-navy"
      />
      {dirty && (
        <button
          disabled={busy}
          onClick={() => onSave(value)}
          className="mt-2 text-sm font-semibold bg-hampton-navy text-[#F6F1EB] rounded-full px-4 py-1.5 disabled:opacity-50"
        >
          Save notes
        </button>
      )}
    </div>
  )
}
