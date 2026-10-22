'use client'

/**
 * The troop family board (/troop2514). One page, seven tabs: News, Schedule,
 * Snacks, Can't make it, Ideas, Contact — and Leaders, which appears only for a
 * signed-in leader (TROOP_LEADER_PASSWORD, or an HH admin session).
 *
 * The tab is mirrored into the URL hash, so a leader can share
 * hosthampton.com/troop2514#snacks and it opens on the snack sign-up.
 *
 * Data: GET /api/troop/[troop] (public view), POST …/submit and …/snack (family
 * forms), and …/leader (everything else). See lib/troop.ts.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
// Client-safe (no server imports): the consent sentence a parent reads must be
// the one the server records.
import { familyConsentText } from '@/lib/troop'

/* ── Types (mirrors lib/troop.ts) ── */

interface Post { id: string; title: string; body: string; post_date: string; pinned: boolean }
interface Sched {
  id: string; title: string; kind: 'meeting' | 'event'; event_date: string; start_time: string | null
  end_time: string | null; location: string | null; notes: string | null; needs_snack: boolean
}
interface PublicSnack { parent_name: string; item: string }
interface Board {
  name: string; welcome: string; leaders: string[]; posts: Post[]; schedule: Sched[]; snacks: Record<string, PublicSnack>
}
interface SnackClaim { schedule_id: string; parent_name: string; scout_name: string; item: string }
interface InboxItem {
  id: string; kind: 'absence' | 'idea' | 'message'; scout_name: string | null; parent_name: string | null
  email: string | null; reply_to: string | null; missed_date: string | null; idea_kind: string | null
  body: string | null; anonymous: boolean; done: boolean; created_at: string
}
interface Family { id: string; parent_name: string; scout_name: string | null; email: string; phone: string | null; consented_at: string }
interface LeaderData {
  posts: Post[]; schedule: Sched[]; snacks: SnackClaim[]; inbox: InboxItem[]; families: Family[]
  settings: { welcome: string | null; leader_names: string[]; leader_emails: string[] }
}

const FAMILY_TABS = [
  { id: 'news', label: 'News' },
  { id: 'updates', label: 'Get updates' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'snacks', label: 'Snacks' },
  { id: 'absent', label: "Can't make it" },
  { id: 'ideas', label: 'Ideas' },
  { id: 'contact', label: 'Contact' },
] as const
type TabId = (typeof FAMILY_TABS)[number]['id'] | 'leaders'
const TAB_IDS: string[] = [...FAMILY_TABS.map(t => t.id), 'leaders']

/* ── Dates ── */

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DOWL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const parseDate = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1) }
const todayStr = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}` }
const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : '')
const fmtTime = (t: string | null | undefined) => {
  if (!t) return ''
  const [h0, m] = hhmm(t).split(':').map(Number)
  const ap = h0 >= 12 ? 'PM' : 'AM'
  return `${h0 % 12 || 12}:${String(m).padStart(2, '0')} ${ap}`
}
const fmtLong = (s: string) => { const d = parseDate(s); return `${DOWL[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}` }
const fmtShort = (s: string) => { const d = parseDate(s); return `${MON[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}` }
const timeRange = (s: Sched) =>
  s.start_time ? `${fmtTime(s.start_time)}${s.end_time ? ` to ${fmtTime(s.end_time)}` : ''}` : 'Time TBA'

function calLink(s: Sched, troopName: string): string {
  const d = s.event_date.replace(/-/g, '')
  let dates: string
  if (s.start_time) {
    const st = hhmm(s.start_time).replace(':', '')
    const en = hhmm(s.end_time || s.start_time).replace(':', '')
    dates = `${d}T${st}00/${d}T${en}00`
  } else {
    // No time yet: an all-day entry, which Google wants as [day, next day).
    const next = parseDate(s.event_date)
    next.setDate(next.getDate() + 1)
    dates = `${d}/${next.getFullYear()}${String(next.getMonth() + 1).padStart(2, '0')}${String(next.getDate()).padStart(2, '0')}`
  }
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${troopName}: ${s.title}`,
    dates,
    ctz: 'America/New_York',
    details: s.notes || '',
    location: s.location || '',
  })
  return `https://calendar.google.com/calendar/render?${p}`
}

const sortUpcoming = (list: Sched[]) =>
  list.filter(s => s.event_date >= todayStr()).sort((a, b) => (a.event_date + (a.start_time || '~')).localeCompare(b.event_date + (b.start_time || '~')))

/* ── Component ── */

export default function TroopBoard({ troop }: { troop: string }) {
  const api = `/api/troop/${troop}`
  const tokenKey = `troop${troop}-leader`

  const [board, setBoard] = useState<Board | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [tab, setTab] = useState<TabId>('news')
  const [isLeader, setIsLeader] = useState(false)
  const [showSignIn, setShowSignIn] = useState(false)
  const [token, setToken] = useState('')
  const [leader, setLeader] = useState<LeaderData | null>(null)
  const [sheet, setSheet] = useState<{ scheduleId: string; asLeader: boolean } | null>(null)
  const [toastMsg, setToastMsg] = useState('')
  const tabsRef = useRef<HTMLElement>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout>>()

  const toast = useCallback((msg: string) => {
    setToastMsg(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastMsg(''), 2600)
  }, [])

  const loadBoard = useCallback(async () => {
    try {
      const r = await fetch(api, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'load failed')
      setBoard(j)
      setLoadErr('')
    } catch {
      setLoadErr("Couldn't load the troop page. Check your connection and refresh.")
    }
  }, [api])

  const leaderHeaders = useCallback(
    (tok: string): Record<string, string> => ({ 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }),
    [],
  )

  /** Returns true when the credential (or an HH admin cookie) is accepted. */
  const loadLeader = useCallback(
    async (tok: string): Promise<boolean> => {
      try {
        const r = await fetch(`${api}/leader`, { headers: leaderHeaders(tok), cache: 'no-store' })
        if (!r.ok) return false
        setLeader(await r.json())
        setIsLeader(true)
        return true
      } catch {
        return false
      }
    },
    [api, leaderHeaders],
  )

  const refresh = useCallback(async () => {
    await Promise.all([loadBoard(), isLeader ? loadLeader(token) : Promise.resolve(false)])
  }, [loadBoard, loadLeader, isLeader, token])

  // First load: the board, the tab from the URL, and a quiet leader check.
  useEffect(() => {
    loadBoard()
    const hash = window.location.hash.replace('#', '')
    if (TAB_IDS.includes(hash)) setTab(hash as TabId)
    if (hash === 'leaders') setShowSignIn(true)
    let saved = ''
    try { saved = sessionStorage.getItem(tokenKey) || '' } catch { /* storage off */ }
    loadLeader(saved).then(ok => {
      if (ok) setToken(saved)
      else if (saved) try { sessionStorage.removeItem(tokenKey) } catch { /* storage off */ }
    })
  }, [loadBoard, loadLeader, tokenKey])

  // Keep the selected tab visible in the scrolling bar (Leaders sits off-screen on a phone).
  useEffect(() => {
    const btn = tabsRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    const row = btn?.parentElement
    if (btn && row) row.scrollTo({ left: btn.offsetLeft - row.clientWidth / 2 + btn.clientWidth / 2, behavior: 'smooth' })
  }, [tab, isLeader])

  function go(id: TabId) {
    setTab(id)
    try { history.replaceState(null, '', `#${id}`) } catch { /* ignore */ }
    const bar = tabsRef.current
    if (bar && window.scrollY > bar.offsetTop) window.scrollTo({ top: bar.offsetTop, behavior: 'smooth' })
  }

  async function leaderAction(payload: Record<string, unknown>, okMsg: string): Promise<boolean> {
    try {
      const r = await fetch(`${api}/leader`, { method: 'POST', headers: leaderHeaders(token), body: JSON.stringify(payload) })
      const j = await r.json().catch(() => ({}))
      if (r.status === 401) {
        setIsLeader(false)
        setShowSignIn(true)
        toast('Please sign in again.')
        return false
      }
      if (!r.ok) {
        toast(j.error || "Couldn't save. Try again.")
        return false
      }
      toast(okMsg)
      await refresh()
      return true
    } catch {
      toast("Couldn't save. Check your connection.")
      return false
    }
  }

  const upcoming = useMemo(() => (board ? sortUpcoming(board.schedule) : []), [board])
  const troopName = board?.name || `Troop ${troop}`
  const tabs: { id: TabId; label: string }[] = [
    ...FAMILY_TABS,
    ...(isLeader || showSignIn ? [{ id: 'leaders' as TabId, label: 'Leaders' }] : []),
  ]
  const openCount = leader ? leader.inbox.filter(i => !i.done).length : 0

  return (
    <div className="tb">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <div className="tb-hero">
        <div className="tb-wrap">
          <div className="tb-badge" aria-hidden="true">
            <svg viewBox="0 0 48 48" width="40" height="40"><g fill="#fff"><path d="M24 44C14 34 9 22 17 8c10 8 15 22 7 36z" /><path d="M25 44c3-12 10-20 22-22-3 12-10 20-22 22z" /><path d="M23 44C16 35 7 32 1 34c5 7 15 11 22 10z" /></g></svg>
          </div>
          <div className="tb-hero-text">
            <h1>Girl Scouts Troop&nbsp;{troop}</h1>
            <p>{board?.welcome || 'Welcome, families! Troop news, meetings, snack sign-ups and a quick way to reach our leaders.'}</p>
          </div>
        </div>
      </div>

      <nav className="tb-tabs" ref={tabsRef} aria-label="Sections">
        <div className="tb-wrap" role="tablist">
          {tabs.map(t => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={t.id === 'leaders' ? 'lead' : undefined}
              onClick={() => go(t.id)}
            >
              {t.label}
              {t.id === 'leaders' && openCount > 0 ? <span className="tb-count">{openCount}</span> : null}
            </button>
          ))}
        </div>
      </nav>

      <div className="tb-wrap tb-main">
        {loadErr ? <p className="tb-notice">{loadErr}</p> : null}

        {tab === 'news' && (
          <section className="tb-card">
            <h2>Announcements</h2>
            {!board ? <p className="tb-empty">Loading troop news…</p> : <Posts posts={board.posts} />}
            <div className="tb-cta">
              <span>Want troop news by email or text?</span>
              <button type="button" className="small" onClick={() => go('updates')}>Get updates</button>
            </div>
          </section>
        )}

        {tab === 'updates' && (
          <section className="tb-card">
            <h2>Get troop updates</h2>
            <p className="tb-sub">Leave your details and the leaders will send you troop news and announcements. Only leaders see this list.</p>
            <UpdatesForm api={api} troopName={troopName} />
          </section>
        )}

        {tab === 'schedule' && (
          <section className="tb-card">
            <h2>Schedule</h2>
            {!board ? <p className="tb-empty">Loading meetings and events…</p> : <Schedule items={upcoming} troopName={troopName} />}
          </section>
        )}

        {tab === 'snacks' && (
          <section className="tb-card">
            <h2>Snack sign-up</h2>
            <div className="tb-allergy">
              <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2 1 21h22L12 2zm0 5 7.5 12h-15L12 7zm-1 4v4h2v-4h-2zm0 5v2h2v-2h-2z" /></svg>
              <span>Please keep snacks <b>nut-free</b> and allergy-aware. Store-bought with an ingredient label is best.</span>
            </div>
            {!board ? (
              <p className="tb-empty">Loading snack dates…</p>
            ) : (
              <SnackSlots
                slots={upcoming.filter(s => s.needs_snack)}
                taken={board.snacks}
                onClaim={id => setSheet({ scheduleId: id, asLeader: false })}
              />
            )}
          </section>
        )}

        {tab === 'absent' && (
          <section className="tb-card">
            <h2>Can&apos;t make it?</h2>
            <p className="tb-sub">Let the leaders know your scout will miss a meeting. Only leaders see this.</p>
            <FamilyForm
              api={api}
              kind="absence"
              okTitle="Got it, thanks!"
              okText={v => `The leaders know ${v.scout} will miss ${v.date ? fmtLong(String(v.date)) : 'that meeting'}.`}
              validate={v => (!v.scout || !v.parent || !v.date ? "Please add your scout's name, your name and the date." : '')}
            >
              <div className="tb-grid2">
                <label>Scout&apos;s name <small>First name and last initial</small><input name="scout" required maxLength={40} autoComplete="off" placeholder="Maya R." /></label>
                <label>Your name<input name="parent" required maxLength={60} autoComplete="name" /></label>
              </div>
              <label>
                Date being missed
                <select name="date" required>
                  {upcoming.length ? (
                    upcoming.map(s => <option key={s.id} value={s.event_date}>{fmtLong(s.event_date)} · {s.title}</option>)
                  ) : (
                    <option value="">No upcoming dates posted</option>
                  )}
                </select>
              </label>
              <label>Note <small>Optional</small><textarea name="note" maxLength={500} placeholder="Anything the leaders should know" /></label>
              <label>Your email <small>Optional, for a confirmation</small><input name="email" type="email" maxLength={120} autoComplete="email" /></label>
            </FamilyForm>
          </section>
        )}

        {tab === 'ideas' && (
          <section className="tb-card">
            <h2>Suggestions &amp; ideas</h2>
            <p className="tb-sub">Activities, trips, badges or general feedback. Leaders read every one.</p>
            <IdeaForm api={api} />
          </section>
        )}

        {tab === 'contact' && (
          <section className="tb-card">
            <h2>Contact the leaders</h2>
            <p className="tb-sub">
              {board?.leaders?.length
                ? `Troop leaders: ${board.leaders.join(', ')}. Send a note below and a leader will get back to you.`
                : 'Send a note below and a troop leader will get back to you.'}
            </p>
            <FamilyForm
              api={api}
              kind="message"
              okTitle="Message sent"
              okText={() => 'A leader will get back to you soon.'}
              validate={v => (!v.name || !v.reply || !v.text ? 'Please add your name, how to reach you, and a message.' : '')}
            >
              <label>Your name<input name="name" required maxLength={60} autoComplete="name" /></label>
              <label>How should we reach you? <small>Email or phone</small><input name="reply" required maxLength={120} /></label>
              <label>Message<textarea name="text" required maxLength={1500} /></label>
            </FamilyForm>
          </section>
        )}

        {tab === 'leaders' && (
          <section className="tb-card tb-leaders">
            <h2>Leader tools</h2>
            {isLeader && leader ? (
              <LeaderPanel
                data={leader}
                troop={troop}
                upcomingSnackSlots={sortUpcoming(leader.schedule).filter(s => s.needs_snack)}
                action={leaderAction}
                onFill={id => setSheet({ scheduleId: id, asLeader: true })}
                onSignOut={() => {
                  try { sessionStorage.removeItem(tokenKey) } catch { /* ignore */ }
                  setToken('')
                  setIsLeader(false)
                  setLeader(null)
                  setShowSignIn(false)
                  go('news')
                }}
                hasToken={!!token}
                notify={toast}
              />
            ) : (
              <SignIn
                onSubmit={async pw => {
                  const ok = await loadLeader(pw)
                  if (ok) {
                    setToken(pw)
                    try { sessionStorage.setItem(tokenKey, pw) } catch { /* ignore */ }
                  }
                  return ok
                }}
              />
            )}
          </section>
        )}
      </div>

      <footer className="tb-foot">
        {troopName} · Private family page · Please don&apos;t share outside the troop
        {!isLeader && !showSignIn ? (
          <>
            {' · '}
            <button type="button" className="tb-linkbtn" onClick={() => { setShowSignIn(true); go('leaders') }}>Leader sign-in</button>
          </>
        ) : null}
      </footer>

      {sheet && board ? (
        <SnackSheet
          api={api}
          sched={(leader?.schedule || board.schedule).find(s => s.id === sheet.scheduleId) || null}
          asLeader={sheet.asLeader}
          leaderSave={payload => leaderAction({ action: 'fill_snack', ...payload }, 'Snack date filled in')}
          onClose={() => setSheet(null)}
          onDone={async () => {
            setSheet(null)
            toast("You're on snacks. Thank you!")
            await loadBoard()
          }}
          onTaken={loadBoard}
        />
      ) : null}

      {toastMsg ? <div className="tb-toast" role="status">{toastMsg}</div> : null}
    </div>
  )
}

/* ── Public pieces ── */

function Posts({ posts }: { posts: Post[] }) {
  if (!posts.length) return <p className="tb-empty">No announcements yet. Leaders post troop news here.</p>
  const list = [...posts].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.post_date.localeCompare(a.post_date))
  return (
    <div className="tb-posts">
      {list.map(p => (
        <article key={p.id} className={`tb-post${p.pinned ? ' pinned' : ''}`}>
          <div className="tb-meta">{p.pinned ? <span className="tb-pin">Pinned</span> : null}<span>{fmtShort(p.post_date)}</span></div>
          <h3>{p.title}</h3>
          <p>{p.body}</p>
        </article>
      ))}
    </div>
  )
}

function Schedule({ items, troopName }: { items: Sched[]; troopName: string }) {
  if (!items.length) return <p className="tb-empty">No upcoming meetings posted yet.</p>
  const [next, ...rest] = items
  return (
    <>
      <div className="tb-next">
        <div className="label">Next up</div>
        <h3>{next.title}</h3>
        <div className="row">{fmtLong(next.event_date)} · {timeRange(next)}</div>
        {next.location ? <div className="row">{next.location}</div> : null}
        {next.notes ? <div className="row"><b>Remember:</b> {next.notes}</div> : null}
        <div className="row"><a href={calLink(next, troopName)} target="_blank" rel="noopener noreferrer">Add to calendar ↗</a></div>
      </div>
      <ul className="tb-items">
        {rest.map(s => {
          const d = parseDate(s.event_date)
          return (
            <li key={s.id} className="tb-item">
              <div className="tb-date"><span>{DOW[d.getDay()]}</span><b>{d.getDate()}</b><span>{MON[d.getMonth()]}</span></div>
              <div className="body">
                <div className="tb-meta">
                  <span className={`tb-tag${s.kind === 'event' ? ' event' : ''}`}>{s.kind === 'event' ? 'Event' : 'Meeting'}</span>
                  <span>{timeRange(s)}</span>
                </div>
                <h3>{s.title}</h3>
                {s.location ? <div className="tb-meta">{s.location}</div> : null}
                {s.notes ? <div className="note">{s.notes}</div> : null}
                <a className="cal" href={calLink(s, troopName)} target="_blank" rel="noopener noreferrer">Add to calendar ↗</a>
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}

function SnackSlots({ slots, taken, onClaim }: { slots: Sched[]; taken: Record<string, PublicSnack>; onClaim: (id: string) => void }) {
  if (!slots.length) return <p className="tb-empty">No snack dates are open right now.</p>
  return (
    <div>
      {slots.map(s => {
        const c = taken[s.id]
        return (
          <div key={s.id} className={`tb-slot${c ? ' taken' : ''}`}>
            <div className="body">
              <b>{fmtLong(s.event_date)}</b>
              <div className="who">{c ? `${c.parent_name} · ${c.item}` : 'Open'}</div>
            </div>
            {c ? <span className="tb-badge-taken">Taken</span> : <button type="button" className="small" onClick={() => onClaim(s.id)}>Sign up</button>}
          </div>
        )
      })}
    </div>
  )
}

function OkBox({ title, text, onAgain }: { title: string; text: string; onAgain: () => void }) {
  return (
    <div className="tb-ok">
      <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="var(--tb-green)" /><path d="M7 12.5l3 3 7-7" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
      <div>
        <h3>{title}</h3>
        <p>{text}</p>
        <p><button type="button" className="ghost" onClick={onAgain}>Send another</button></p>
      </div>
    </div>
  )
}

type FormValues = Record<string, FormDataEntryValue | boolean>

function useSubmit(api: string) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const send = useCallback(
    async (path: string, payload: Record<string, unknown>): Promise<boolean> => {
      setBusy(true)
      setErr('')
      try {
        const r = await fetch(`${api}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) {
          setErr(r.status === 429 ? 'Please wait a few minutes and try again.' : j.error || "Couldn't send. Try again.")
          return false
        }
        return true
      } catch {
        setErr("Couldn't send. Check your connection and try again.")
        return false
      } finally {
        setBusy(false)
      }
    },
    [api],
  )
  return { busy, err, setErr, send }
}

function FamilyForm({
  api, kind, okTitle, okText, validate, children,
}: {
  api: string
  kind: 'absence' | 'message'
  okTitle: string
  okText: (v: FormValues) => string
  validate: (v: FormValues) => string
  children: React.ReactNode
}) {
  const { busy, err, setErr, send } = useSubmit(api)
  const [done, setDone] = useState<string | null>(null)
  if (done !== null) return <OkBox title={okTitle} text={done} onAgain={() => setDone(null)} />
  return (
    <form
      noValidate
      onSubmit={async e => {
        e.preventDefault()
        const f = e.currentTarget
        const v: FormValues = Object.fromEntries(new FormData(f).entries())
        for (const k of Object.keys(v)) if (typeof v[k] === 'string') v[k] = String(v[k]).trim()
        const problem = validate(v)
        if (problem) return setErr(problem)
        if (await send('/submit', { kind, ...v })) {
          f.reset()
          setDone(okText(v))
        }
      }}
    >
      {children}
      <label className="tb-hp" aria-hidden="true">Website<input tabIndex={-1} name="website" autoComplete="off" /></label>
      {err ? <p className="tb-err">{err}</p> : null}
      <div className="tb-actions"><button type="submit" disabled={busy}>{busy ? 'Sending…' : kind === 'absence' ? 'Send to leaders' : 'Send message'}</button></div>
    </form>
  )
}

function UpdatesForm({ api, troopName }: { api: string; troopName: string }) {
  const { busy, err, setErr, send } = useSubmit(api)
  const [phone, setPhone] = useState('')
  const [consent, setConsent] = useState(false)
  const [done, setDone] = useState(false)
  if (done) {
    return <OkBox title="You're on the list!" text="The leaders will send you troop news and announcements." onAgain={() => setDone(false)} />
  }
  return (
    <form
      noValidate
      onSubmit={async e => {
        e.preventDefault()
        const f = e.currentTarget
        const fd = new FormData(f)
        const name = String(fd.get('name') || '').trim()
        const email = String(fd.get('email') || '').trim()
        if (!name || !email) return setErr('Please add your name and email.')
        if (!consent) return setErr('Please tick the box to say yes to updates.')
        const ok = await send('/join', {
          name,
          email,
          phone: phone.trim(),
          scout: String(fd.get('scout') || '').trim(),
          consent,
          website: fd.get('website'),
        })
        if (ok) {
          f.reset()
          setPhone('')
          setConsent(false)
          setDone(true)
        }
      }}
    >
      <div className="tb-grid2">
        <label>Your name<input name="name" required maxLength={60} autoComplete="name" /></label>
        <label>Scout&apos;s name <small>Optional</small><input name="scout" maxLength={60} autoComplete="off" /></label>
      </div>
      <label>Email<input name="email" type="email" required maxLength={120} autoComplete="email" /></label>
      <label>Cell phone <small>Optional, for texts</small><input name="phone" type="tel" maxLength={30} autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value)} /></label>
      <label className="tb-check"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> {familyConsentText(troopName, phone.trim() !== '')}</label>
      <p className="tb-small">To stop getting updates, just tell a leader.</p>
      <label className="tb-hp" aria-hidden="true">Website<input tabIndex={-1} name="website" autoComplete="off" /></label>
      {err ? <p className="tb-err">{err}</p> : null}
      <div className="tb-actions"><button type="submit" disabled={busy}>{busy ? 'Signing up…' : 'Sign me up'}</button></div>
    </form>
  )
}

function IdeaForm({ api }: { api: string }) {
  const { busy, err, setErr, send } = useSubmit(api)
  const [anon, setAnon] = useState(false)
  const [done, setDone] = useState(false)
  if (done) return <OkBox title="Idea sent!" text="Thanks for helping plan our year." onAgain={() => setDone(false)} />
  return (
    <form
      noValidate
      onSubmit={async e => {
        e.preventDefault()
        const f = e.currentTarget
        const fd = new FormData(f)
        const text = String(fd.get('text') || '').trim()
        if (!text) return setErr('Please write your idea first.')
        const ok = await send('/submit', {
          kind: 'idea',
          ideaKind: fd.get('ideaKind'),
          text,
          anon,
          name: anon ? '' : String(fd.get('name') || '').trim(),
          website: fd.get('website'),
        })
        if (ok) {
          f.reset()
          setAnon(false)
          setDone(true)
        }
      }}
    >
      <label>
        What kind of idea?
        <select name="ideaKind">
          <option>Activity idea</option><option>Trip idea</option><option>Badge idea</option><option>General feedback</option>
        </select>
      </label>
      <label>Your idea<textarea name="text" required maxLength={1000} placeholder="We could visit the aquarium for the Animal Habitats badge…" /></label>
      <label className="tb-check"><input type="checkbox" checked={anon} onChange={e => setAnon(e.target.checked)} /> Send anonymously</label>
      {!anon ? <label>Your name <small>Optional</small><input name="name" maxLength={60} autoComplete="name" /></label> : null}
      <label className="tb-hp" aria-hidden="true">Website<input tabIndex={-1} name="website" autoComplete="off" /></label>
      {err ? <p className="tb-err">{err}</p> : null}
      <div className="tb-actions"><button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send idea'}</button></div>
    </form>
  )
}

function SnackSheet({
  api, sched, asLeader, leaderSave, onClose, onDone, onTaken,
}: {
  api: string
  sched: Sched | null
  asLeader: boolean
  leaderSave: (payload: Record<string, unknown>) => Promise<boolean>
  onClose: () => void
  onDone: () => void
  onTaken: () => void
}) {
  const { busy, err, setErr, send } = useSubmit(api)
  const firstRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const t = setTimeout(() => firstRef.current?.focus(), 50)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => { clearTimeout(t); document.removeEventListener('keydown', onKey) }
  }, [onClose])
  if (!sched) return null
  return (
    <div className="tb-sheet-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="tb-sheet" role="dialog" aria-modal="true" aria-labelledby="tbSheetTitle">
        <h3 id="tbSheetTitle">{asLeader ? 'Fill in a snack date' : 'Bring a snack'}</h3>
        <p className="tb-sub">{fmtLong(sched.event_date)} · {sched.title}</p>
        <form
          noValidate
          onSubmit={async e => {
            e.preventDefault()
            const fd = new FormData(e.currentTarget)
            const payload = {
              scheduleId: sched.id,
              parent: String(fd.get('parent') || '').trim(),
              scout: String(fd.get('scout') || '').trim(),
              item: String(fd.get('item') || '').trim(),
              website: fd.get('website'),
            }
            if (!payload.parent || !payload.scout || !payload.item) return setErr('Please fill in all three fields.')
            if (asLeader) {
              if (await leaderSave(payload)) onClose()
              return
            }
            if (await send('/snack', payload)) onDone()
            else onTaken()
          }}
        >
          <label>Your name<input ref={firstRef} name="parent" required maxLength={60} autoComplete="name" /></label>
          <label>Scout&apos;s name <small>First name and last initial. Only leaders see this.</small><input name="scout" required maxLength={40} autoComplete="off" /></label>
          <label>What you&apos;ll bring<input name="item" required maxLength={80} placeholder="Apple slices and pretzels" /></label>
          <label className="tb-hp" aria-hidden="true">Website<input tabIndex={-1} name="website" autoComplete="off" /></label>
          {err ? <p className="tb-err">{err}</p> : null}
          <div className="tb-actions">
            <button type="submit" disabled={busy}>{asLeader ? 'Save' : busy ? 'Saving…' : 'Claim this date'}</button>
            <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ── Leaders ── */

function SignIn({ onSubmit }: { onSubmit: (pw: string) => Promise<boolean> }) {
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  return (
    <form
      onSubmit={async e => {
        e.preventDefault()
        if (!pw) return
        setBusy(true)
        setErr('')
        const ok = await onSubmit(pw)
        setBusy(false)
        if (!ok) setErr("That password didn't work.")
      }}
    >
      <p className="tb-sub">For troop leaders. Enter the leader password to manage the page.</p>
      <label>Leader password<input type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="current-password" /></label>
      {err ? <p className="tb-err">{err}</p> : null}
      <div className="tb-actions"><button type="submit" disabled={busy || !pw}>{busy ? 'Checking…' : 'Sign in'}</button></div>
    </form>
  )
}

/** A delete button that asks for a second tap within 3 seconds. */
function ConfirmButton({ label, onConfirm }: { label: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(t)
  }, [armed])
  return (
    <button type="button" className="ghost" onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}>
      {armed ? 'Tap again to confirm' : label}
    </button>
  )
}

const LEADER_TABS = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'families', label: 'Families' },
  { id: 'posts', label: 'Announcements' },
  { id: 'sched', label: 'Schedule' },
  { id: 'snk', label: 'Snacks' },
  { id: 'setup', label: 'Setup' },
] as const

function LeaderPanel({
  data, troop, upcomingSnackSlots, action, onFill, onSignOut, hasToken, notify,
}: {
  data: LeaderData
  troop: string
  upcomingSnackSlots: Sched[]
  action: (payload: Record<string, unknown>, okMsg: string) => Promise<boolean>
  onFill: (scheduleId: string) => void
  onSignOut: () => void
  hasToken: boolean
  notify: (msg: string) => void
}) {
  const [sub, setSub] = useState<(typeof LEADER_TABS)[number]['id']>('inbox')
  const [filter, setFilter] = useState<'all' | InboxItem['kind']>('all')
  const [editPost, setEditPost] = useState<Post | null>(null)
  const [editSched, setEditSched] = useState<Sched | null>(null)
  const [formKey, setFormKey] = useState(0)
  const snackBySlot = useMemo(() => Object.fromEntries(data.snacks.map(c => [c.schedule_id, c])), [data.snacks])
  const open = data.inbox.filter(i => !i.done).length
  const inbox = data.inbox.filter(i => filter === 'all' || i.kind === filter)

  function downloadCsv(rows: string[][], name: string) {
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `troop-${troop}-${name}-${todayStr()}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  function exportCsv() {
    const rows = [['type', 'received', 'scout', 'parent_or_name', 'date_missed', 'kind', 'text_or_note', 'contact', 'anonymous', 'done']]
    data.inbox.forEach(i =>
      rows.push([
        i.kind, i.created_at, i.scout_name || '', i.parent_name || '', i.missed_date || '', i.idea_kind || '',
        i.body || '', i.email || i.reply_to || '', i.anonymous ? 'yes' : '', i.done ? 'yes' : '',
      ]),
    )
    downloadCsv(rows, 'inbox')
  }

  function exportFamilies() {
    const rows = [['parent', 'scout', 'email', 'phone', 'signed_up']]
    data.families.forEach(f => rows.push([f.parent_name, f.scout_name || '', f.email, f.phone || '', f.consented_at]))
    downloadCsv(rows, 'families')
  }

  async function copyList(values: string[], what: string) {
    if (!values.length) return notify(`No ${what} yet.`)
    try {
      await navigator.clipboard.writeText(values.join(', '))
      notify(`Copied ${values.length} ${what}`)
    } catch {
      notify("Couldn't copy. Try Export CSV instead.")
    }
  }

  return (
    <>
      <p className="tb-sub">
        Only signed-in leaders see this tab.{' '}
        {hasToken ? <button type="button" className="tb-linkbtn" onClick={onSignOut}>Sign out</button> : null}
      </p>
      <div className="tb-subtabs" role="tablist">
        {LEADER_TABS.map(t => (
          <button key={t.id} type="button" role="tab" aria-selected={sub === t.id} onClick={() => setSub(t.id)}>
            {t.label}
            {t.id === 'inbox' && open ? <span className="tb-count">{open}</span> : null}
          </button>
        ))}
      </div>

      {sub === 'inbox' && (
        <>
          <div className="tb-actions">
            <select aria-label="Filter inbox" value={filter} onChange={e => setFilter(e.target.value as typeof filter)} style={{ width: 'auto' }}>
              <option value="all">Everything</option><option value="absence">Absences</option><option value="idea">Ideas</option><option value="message">Messages</option>
            </select>
            <button type="button" className="secondary small" onClick={exportCsv}>Export CSV</button>
          </div>
          <div className="tb-adm-list">
            {inbox.length ? inbox.map(it => <InboxRow key={it.id} it={it} onToggle={() => action({ action: 'toggle_done', id: it.id, done: !it.done }, it.done ? 'Reopened' : 'Marked done')} />) : (
              <p className="tb-empty">Nothing here yet. Absence notes, ideas and messages from families show up in this inbox.</p>
            )}
          </div>
        </>
      )}

      {sub === 'families' && (
        <>
          <p className="tb-small">
            {data.families.length} {data.families.length === 1 ? 'family has' : 'families have'} signed up for updates on the Get updates tab.
            Copy the list into an email or a group text.
          </p>
          <div className="tb-actions" style={{ marginTop: 10 }}>
            <button type="button" className="secondary small" onClick={() => copyList(data.families.map(f => f.email), 'emails')}>Copy emails</button>
            <button type="button" className="secondary small" onClick={() => copyList(data.families.flatMap(f => (f.phone ? [f.phone] : [])), 'phone numbers')}>Copy phones</button>
            <button type="button" className="secondary small" onClick={exportFamilies}>Export CSV</button>
          </div>
          <div className="tb-adm-list">
            {data.families.length ? data.families.map(f => (
              <div key={f.id} className="tb-adm-row">
                <div className="top">
                  <div>
                    <b>{f.parent_name}</b>{f.scout_name ? <span className="tb-meta" style={{ display: 'inline' }}> · {f.scout_name}</span> : null}
                    <p><a href={`mailto:${f.email}`}>{f.email}</a>{f.phone ? <> · <a href={`tel:${f.phone.replace(/[^\d+]/g, '')}`}>{f.phone}</a></> : null}</p>
                  </div>
                  <ConfirmButton label="Remove" onConfirm={() => action({ action: 'remove_family', id: f.id }, 'Removed')} />
                </div>
              </div>
            )) : <p className="tb-empty">No one has signed up yet. Share the Get updates tab: hosthampton.com/troop{troop}#updates</p>}
          </div>
        </>
      )}

      {sub === 'posts' && (
        <>
          <form
            key={`p${formKey}`}
            onSubmit={async e => {
              e.preventDefault()
              const fd = new FormData(e.currentTarget)
              const ok = await action(
                {
                  action: 'save_post',
                  id: editPost?.id,
                  title: fd.get('title'),
                  body: fd.get('body'),
                  post_date: fd.get('post_date'),
                  pinned: fd.get('pinned') === 'on',
                },
                editPost ? 'Announcement updated' : 'Announcement posted',
              )
              if (ok) { setEditPost(null); setFormKey(k => k + 1) }
            }}
          >
            <label>Title<input name="title" required maxLength={100} defaultValue={editPost?.title} /></label>
            <label>Message<textarea name="body" required maxLength={2000} defaultValue={editPost?.body} /></label>
            <div className="tb-grid2">
              <label>Date<input name="post_date" type="date" required defaultValue={editPost?.post_date || todayStr()} /></label>
              <label className="tb-check" style={{ alignSelf: 'end', paddingBottom: 12 }}><input type="checkbox" name="pinned" defaultChecked={!!editPost?.pinned} /> Pin to top</label>
            </div>
            <div className="tb-actions">
              <button type="submit">{editPost ? 'Save changes' : 'Post announcement'}</button>
              {editPost ? <button type="button" className="secondary" onClick={() => { setEditPost(null); setFormKey(k => k + 1) }}>Cancel edit</button> : null}
            </div>
          </form>
          <div className="tb-adm-list">
            {data.posts.length ? data.posts.map(p => (
              <div key={p.id} className="tb-adm-row">
                <div className="top">
                  <div>
                    <div className="tb-meta">{p.pinned ? <span className="tb-pin">Pinned</span> : null}{fmtShort(p.post_date)}</div>
                    <b>{p.title}</b>
                  </div>
                  <div className="tb-actions">
                    <button type="button" className="ghost" onClick={() => { setEditPost(p); setFormKey(k => k + 1) }}>Edit</button>
                    <ConfirmButton label="Delete" onConfirm={() => action({ action: 'delete_post', id: p.id }, 'Deleted')} />
                  </div>
                </div>
              </div>
            )) : <p className="tb-empty">No announcements yet.</p>}
          </div>
        </>
      )}

      {sub === 'sched' && (
        <>
          <form
            key={`s${formKey}`}
            onSubmit={async e => {
              e.preventDefault()
              const fd = new FormData(e.currentTarget)
              const ok = await action(
                {
                  action: 'save_schedule',
                  id: editSched?.id,
                  title: fd.get('title'),
                  kind: fd.get('kind'),
                  event_date: fd.get('event_date'),
                  location: fd.get('location'),
                  start_time: fd.get('start_time'),
                  end_time: fd.get('end_time'),
                  notes: fd.get('notes'),
                  needs_snack: fd.get('needs_snack') === 'on',
                },
                editSched ? 'Schedule updated' : 'Added to schedule',
              )
              if (ok) { setEditSched(null); setFormKey(k => k + 1) }
            }}
          >
            <div className="tb-grid2">
              <label>Title<input name="title" required maxLength={80} defaultValue={editSched?.title ?? 'Troop meeting'} /></label>
              <label>Type<select name="kind" defaultValue={editSched?.kind ?? 'meeting'}><option value="meeting">Meeting</option><option value="event">Event</option></select></label>
              <label>Date<input name="event_date" type="date" required defaultValue={editSched?.event_date} /></label>
              <label>Location<input name="location" maxLength={100} defaultValue={editSched?.location ?? ''} /></label>
              <label>Starts <small>Leave blank for Time TBA</small><input name="start_time" type="time" defaultValue={editSched ? hhmm(editSched.start_time) : '18:30'} /></label>
              <label>Ends<input name="end_time" type="time" defaultValue={editSched ? hhmm(editSched.end_time) : '19:45'} /></label>
            </div>
            <label>Notes for families<input name="notes" maxLength={200} placeholder="Wear your vest" defaultValue={editSched?.notes ?? ''} /></label>
            <label className="tb-check"><input type="checkbox" name="needs_snack" defaultChecked={editSched ? editSched.needs_snack : true} /> Needs a snack volunteer</label>
            <div className="tb-actions">
              <button type="submit">{editSched ? 'Save changes' : 'Add to schedule'}</button>
              {editSched ? <button type="button" className="secondary" onClick={() => { setEditSched(null); setFormKey(k => k + 1) }}>Cancel edit</button> : null}
            </div>
          </form>
          <div className="tb-adm-list">
            {data.schedule.length ? data.schedule.map(s => (
              <div key={s.id} className={`tb-adm-row${s.event_date < todayStr() ? ' done' : ''}`}>
                <div className="top">
                  <div>
                    <div className="tb-meta">{fmtShort(s.event_date)} · {s.start_time ? fmtTime(s.start_time) : 'Time TBA'}{s.needs_snack ? ' · snack slot' : ''}</div>
                    <b>{s.title}</b>
                  </div>
                  <div className="tb-actions">
                    <button type="button" className="ghost" onClick={() => { setEditSched(s); setFormKey(k => k + 1) }}>Edit</button>
                    <ConfirmButton label="Delete" onConfirm={() => action({ action: 'delete_schedule', id: s.id }, 'Deleted')} />
                  </div>
                </div>
              </div>
            )) : <p className="tb-empty">Nothing scheduled yet.</p>}
          </div>
        </>
      )}

      {sub === 'snk' && (
        <>
          <p className="tb-small">Snack dates come from schedule items marked &quot;Needs a snack volunteer&quot;. Clear a claim to reopen the date, or tap Reassign to fill it in for a family.</p>
          <div className="tb-adm-list">
            {upcomingSnackSlots.length ? upcomingSnackSlots.map(s => {
              const c = snackBySlot[s.id]
              return (
                <div key={s.id} className="tb-adm-row">
                  <div className="top">
                    <div>
                      <b>{fmtLong(s.event_date)}</b>
                      <p>{c ? `${c.parent_name} (${c.scout_name}) · ${c.item}` : 'Open'}</p>
                    </div>
                    <div className="tb-actions">
                      {c ? <ConfirmButton label="Clear" onConfirm={() => action({ action: 'clear_snack', scheduleId: s.id }, 'Snack date reopened')} /> : null}
                      <button type="button" className="ghost" onClick={() => onFill(s.id)}>{c ? 'Reassign' : 'Fill in'}</button>
                    </div>
                  </div>
                </div>
              )
            }) : <p className="tb-empty">No upcoming snack dates.</p>}
          </div>
        </>
      )}

      {sub === 'setup' && (
        <form
          onSubmit={async e => {
            e.preventDefault()
            const fd = new FormData(e.currentTarget)
            await action(
              {
                action: 'save_settings',
                welcome: fd.get('welcome'),
                leader_names: String(fd.get('names') || '').split(',').map(s => s.trim()).filter(Boolean),
                leader_emails: String(fd.get('emails') || '').split(/[,\s]+/).map(s => s.trim()).filter(Boolean),
              },
              'Setup saved',
            )
          }}
        >
          <label>Welcome line<input name="welcome" maxLength={160} defaultValue={data.settings.welcome ?? ''} /></label>
          <label>Leader names shown to families <small>Comma separated</small><input name="names" maxLength={200} placeholder="Ms. Kelly, Mrs. Ortiz" defaultValue={data.settings.leader_names.join(', ')} /></label>
          <label>
            Leader emails for notifications <small>Private. Each absence note, idea and message is emailed here.</small>
            <textarea name="emails" maxLength={500} placeholder="leader1@example.com, leader2@example.com" style={{ minHeight: 60 }} defaultValue={data.settings.leader_emails.join(', ')} />
          </label>
          <div className="tb-actions"><button type="submit">Save setup</button></div>
        </form>
      )}
    </>
  )
}

function InboxRow({ it, onToggle }: { it: InboxItem; onToggle: () => void }) {
  const when = new Date(it.created_at)
  const ts = Number.isNaN(when.getTime()) ? '' : `${MON[when.getMonth()]} ${when.getDate()}, ${fmtTime(`${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`)}`
  let title = ''
  let body = ''
  if (it.kind === 'absence') {
    title = `${it.scout_name} will miss ${it.missed_date ? fmtLong(it.missed_date) : 'a meeting'}`
    body = `From ${it.parent_name}${it.email ? ` · ${it.email}` : ''}${it.body ? `\n${it.body}` : ''}`
  } else if (it.kind === 'idea') {
    title = it.idea_kind || 'Idea'
    body = `${it.body}\n${it.anonymous ? 'Anonymous' : it.parent_name ? `From ${it.parent_name}` : 'No name given'}`
  } else {
    title = `Message from ${it.parent_name}`
    body = `${it.body}\nReply to: ${it.reply_to}`
  }
  return (
    <div className={`tb-adm-row${it.done ? ' done' : ''}`}>
      <div className="top">
        <div>
          <span className={`tb-type ${it.kind}`}>{it.kind}</span> <span className="tb-meta" style={{ display: 'inline' }}>{ts}</span>
          <h3>{title}</h3>
        </div>
        <button type="button" className="ghost" onClick={onToggle}>{it.done ? 'Reopen' : 'Mark done'}</button>
      </div>
      <p>{body}</p>
    </div>
  )
}

/* ── Styles: the troop's green, scoped under .tb so nothing leaks into the site ── */

const CSS = `
.tb{--tb-bg:#f3f7f2;--tb-surface:#fff;--tb-surface-2:#eaf3ea;--tb-fg:#18261d;--tb-muted:#5b6d61;--tb-line:#d6e3d7;
  --tb-green:#00AE58;--tb-green-ink:#00773c;--tb-on-green:#fff;--tb-gold:#f2c14e;--tb-gold-soft:#fdf2d2;--tb-gold-ink:#7a5600;
  --tb-danger:#b3261e;--tb-danger-soft:#fbe7e5;--tb-shadow:0 1px 2px rgba(11,90,50,.06),0 4px 14px rgba(11,90,50,.06);
  --tb-display:var(--font-troop-display),"Trebuchet MS",system-ui,sans-serif;--tb-body:var(--font-troop-body),system-ui,-apple-system,"Segoe UI",sans-serif;
  background:var(--tb-bg);color:var(--tb-fg);font-family:var(--tb-body);font-size:16px;line-height:1.5;min-height:100vh}
.tb *{box-sizing:border-box}
.tb h1,.tb h2,.tb h3{font-family:var(--tb-display);line-height:1.1;margin:0}
.tb a{color:var(--tb-green-ink)}
.tb :focus-visible{outline:3px solid var(--tb-gold);outline-offset:2px}
.tb-wrap{max-width:680px;margin:0 auto;padding-left:16px;padding-right:16px}
.tb-hero{background:var(--tb-green);color:var(--tb-on-green)}
.tb-hero .tb-wrap{padding-top:28px;padding-bottom:30px;display:flex;gap:16px;align-items:center}
.tb-hero h1{font-size:clamp(28px,7.5vw,40px);font-weight:800;letter-spacing:-.01em}
.tb-hero p{margin:6px 0 0;opacity:.95;max-width:38ch}
.tb-badge{flex:0 0 auto;width:64px;height:64px;border-radius:18px;background:rgba(255,255,255,.16);display:grid;place-items:center}
.tb-hero-text{min-width:0}
.tb-tabs{position:sticky;top:0;z-index:5;background:var(--tb-surface);border-bottom:1px solid var(--tb-line)}
.tb-tabs .tb-wrap{display:flex;gap:8px;overflow-x:auto;padding-top:10px;padding-bottom:10px;scrollbar-width:none}
.tb-tabs .tb-wrap::-webkit-scrollbar{display:none}
.tb-tabs button{flex:0 0 auto;border:0;cursor:pointer;color:var(--tb-fg);background:var(--tb-surface-2);border-radius:999px;padding:8px 14px;font:inherit;font-weight:600;font-size:14px;white-space:nowrap;min-height:38px}
.tb-tabs button[aria-selected="true"]{background:var(--tb-green);color:var(--tb-on-green)}
.tb-tabs button.lead{background:var(--tb-gold-soft);color:var(--tb-gold-ink)}
.tb-tabs button.lead[aria-selected="true"]{background:var(--tb-gold);color:#3b2a00}
.tb-main{padding-top:18px;padding-bottom:40px}
.tb-card{background:var(--tb-surface);border-radius:20px;box-shadow:var(--tb-shadow);padding:20px}
.tb-card h2{font-size:26px;font-weight:700;color:var(--tb-green-ink);margin-bottom:12px}
.tb-sub{color:var(--tb-muted);font-size:14px;margin:-4px 0 14px}
.tb-notice{border-radius:12px;padding:10px 12px;font-size:14px;background:var(--tb-gold-soft);color:var(--tb-gold-ink);margin:0 0 14px}
.tb-empty{color:var(--tb-muted);font-size:15px;padding:8px 0;margin:0}
.tb-posts{display:flex;flex-direction:column;gap:12px}
.tb-post{border:1px solid var(--tb-line);border-radius:16px;padding:14px}
.tb-post.pinned{border-color:var(--tb-gold);background:var(--tb-gold-soft)}
.tb-post h3{font-size:19px;font-weight:700}
.tb-post p{margin:6px 0 0;white-space:pre-wrap}
.tb-meta{font-size:13px;color:var(--tb-muted);display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.tb-pin{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;background:var(--tb-gold);color:#3b2a00;border-radius:999px;padding:2px 8px}
.tb-next{background:var(--tb-green);color:var(--tb-on-green);border-radius:16px;padding:16px;margin-bottom:12px}
.tb-next .label{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;opacity:.9}
.tb-next h3{font-size:24px;margin-top:2px}
.tb-next .row{margin-top:6px;font-size:15px}
.tb-next a{color:var(--tb-on-green);font-weight:600}
.tb-items{list-style:none;margin:0;padding:0}
.tb-item{display:grid;grid-template-columns:56px 1fr;gap:12px;padding:12px 0;border-top:1px solid var(--tb-line)}
.tb-item:first-child{border-top:0}
.tb-date{border-radius:12px;background:var(--tb-surface-2);text-align:center;padding:6px 0;align-self:start}
.tb-date b{display:block;font-family:var(--tb-display);font-size:22px;line-height:1}
.tb-date span{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--tb-muted)}
.tb-item .body{min-width:0}
.tb-item h3{font-size:17px;font-family:var(--tb-body);font-weight:700}
.tb-item .note{font-size:14px;margin-top:4px}
.tb-item .cal{font-size:13px;font-weight:600}
.tb-tag{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;border-radius:999px;padding:2px 8px;background:var(--tb-surface-2);color:var(--tb-green-ink)}
.tb-tag.event{background:var(--tb-gold-soft);color:var(--tb-gold-ink)}
.tb-allergy{display:flex;gap:10px;align-items:flex-start;background:var(--tb-gold-soft);color:var(--tb-gold-ink);border-radius:12px;padding:10px 12px;font-size:14px;margin-bottom:12px}
.tb-slot{display:flex;align-items:center;gap:12px;padding:12px 0;border-top:1px solid var(--tb-line)}
.tb-slot:first-child{border-top:0}
.tb-slot .body{flex:1;min-width:0}
.tb-slot .who{font-size:14px;color:var(--tb-muted)}
.tb-slot.taken .who{color:var(--tb-fg)}
.tb-badge-taken{font-size:12px;font-weight:700;color:var(--tb-muted);background:var(--tb-surface-2);border-radius:999px;padding:6px 12px;white-space:nowrap}
.tb form{display:flex;flex-direction:column;gap:12px}
.tb-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media (max-width:480px){.tb-grid2{grid-template-columns:1fr}}
.tb label{display:flex;flex-direction:column;gap:4px;font-size:14px;font-weight:600;min-width:0}
.tb label small{font-weight:400;color:var(--tb-muted)}
.tb input,.tb select,.tb textarea{font:inherit;font-size:16px;color:var(--tb-fg);background:var(--tb-bg);border:1.5px solid var(--tb-line);border-radius:12px;padding:11px 12px;width:100%;min-width:0}
.tb textarea{min-height:92px;resize:vertical}
.tb input:focus,.tb select:focus,.tb textarea:focus{border-color:var(--tb-green);outline:none;box-shadow:0 0 0 3px rgba(0,174,88,.25)}
.tb .tb-check{flex-direction:row;align-items:center;gap:10px;font-weight:500}
.tb .tb-check input{width:20px;height:20px;accent-color:var(--tb-green)}
.tb-hp{position:absolute!important;left:-9999px;width:1px;height:1px;overflow:hidden}
.tb-card button,.tb-sheet button{font:inherit;font-weight:700;font-size:15px;border:0;border-radius:999px;padding:12px 20px;cursor:pointer;background:var(--tb-green);color:var(--tb-on-green);min-height:44px}
.tb .secondary{background:var(--tb-surface-2);color:var(--tb-green-ink)}
.tb .small{padding:8px 14px;min-height:36px;font-size:14px}
.tb .ghost{background:transparent;color:var(--tb-green-ink);padding:8px 10px;min-height:36px;font-size:14px;white-space:nowrap}
.tb button:disabled{opacity:.55;cursor:not-allowed}
.tb-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.tb-ok{border-radius:16px;background:var(--tb-surface-2);padding:16px;display:flex;gap:12px;align-items:flex-start}
.tb-ok svg{flex:0 0 28px}
.tb-ok h3{font-size:19px}
.tb-ok p{margin:4px 0 0;font-size:14px}
.tb-err{color:var(--tb-danger);font-size:14px;font-weight:600;margin:0}
.tb-sheet-bg{position:fixed;inset:0;background:rgba(10,30,18,.45);z-index:60;display:flex;align-items:flex-end;justify-content:center}
.tb-sheet{background:var(--tb-surface);width:100%;max-width:560px;border-radius:24px 24px 0 0;padding:20px 16px calc(20px + env(safe-area-inset-bottom,0px));max-height:90vh;overflow:auto}
.tb-sheet h3{font-size:22px;margin-bottom:4px}
.tb-leaders{border:2px solid var(--tb-gold)}
.tb-leaders h2{color:var(--tb-gold-ink)}
.tb-subtabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}
.tb-card .tb-subtabs button{background:var(--tb-surface-2);color:var(--tb-fg);font-size:14px;padding:8px 14px;min-height:36px}
.tb-card .tb-subtabs button[aria-selected="true"]{background:var(--tb-green);color:var(--tb-on-green)}
.tb-adm-list{display:flex;flex-direction:column;gap:10px;margin-top:14px}
.tb-adm-row{border:1px solid var(--tb-line);border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:6px}
.tb-adm-row .top{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}
.tb-adm-row .top>div{min-width:0}
.tb-adm-row h3{font-size:16px;font-family:var(--tb-body);margin-top:4px}
.tb-adm-row p{margin:0;font-size:14px;white-space:pre-wrap;overflow-wrap:anywhere}
.tb-adm-row.done{opacity:.6}
.tb-type{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;border-radius:999px;padding:2px 8px}
.tb-type.absence{background:var(--tb-danger-soft);color:var(--tb-danger)}
.tb-type.idea{background:var(--tb-gold-soft);color:var(--tb-gold-ink)}
.tb-type.message{background:var(--tb-surface-2);color:var(--tb-green-ink)}
.tb-count{font-size:12px;font-weight:700;background:var(--tb-danger);color:#fff;border-radius:999px;padding:1px 7px;margin-left:6px}
.tb-small{font-size:13px;color:var(--tb-muted);margin:0}
.tb-cta{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:16px;padding:12px 14px;border-radius:14px;background:var(--tb-surface-2);font-weight:600;font-size:15px}
.tb-foot{text-align:center;font-size:13px;color:var(--tb-muted);padding:0 16px 32px}
.tb-linkbtn{background:none;border:0;padding:0;font:inherit;color:var(--tb-green-ink);text-decoration:underline;cursor:pointer}
.tb-card .tb-linkbtn{min-height:0;font-weight:600;padding:0;background:none;color:var(--tb-green-ink)}
.tb-toast{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(20px + env(safe-area-inset-bottom,0px));background:var(--tb-fg);color:var(--tb-bg);border-radius:999px;padding:10px 18px;font-weight:600;font-size:14px;z-index:70;max-width:calc(100% - 32px)}
`
