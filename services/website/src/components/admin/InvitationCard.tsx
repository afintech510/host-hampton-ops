'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { isEviteEligible } from '@/lib/evites/eligibility'
import type { AdminRsvpView, LedgerGroup, RsvpSummary } from '@/lib/evites/adminView'

/**
 * The "Invitation & RSVPs" card in the Parties detail drawer (spec §7.3).
 *
 * `InvitationCard` fetches and acts; `InvitationCardView` is pure (props in, markup
 * out) so it can be rendered with a fixture. Type-only imports from `adminView`:
 * its runtime code reads font files and must never reach the browser bundle.
 *
 * PRINT: the RSVP sheet is an element with class `evite-print-sheet`, `display: none`
 * on screen. `PRINT_CSS` hides every other element when printing and shows only the
 * sheet, so `window.print()` prints this one page and nothing of the admin chrome.
 *
 * Raw reminder addresses are NEVER in the payload; the "Show contact" button fetches
 * one RSVP's at a time from `?reveal=`, which the server logs.
 */

type StateName = 'disabled' | 'unavailable' | 'closed' | 'live' | 'needs_time' | 'preview'

type Section<T> = ({ available: true; truncated: boolean } & T) | { available: false; error: string }

export interface InvitationPayload {
  evite: null | {
    id: string
    slug: string
    previousSlugs: string[]
    templateSlug: string
    templateChoice?: string | null
    themeWord: string | null
    themeSub: string | null
    renderVersion: number
    renderedAt: string | null
    renderError: string | null
    calVersion: number
    wentLiveAt: string | null
    cancelledNoticeAt: string | null
    archivedAt: string | null
    createdAt: string
    canReslug: boolean
  }
  eligible: boolean
  pagesMode: string
  sendsMode: string
  canEnsure?: boolean
  booking?: { id: string; bookingRef: string | null; status: string | null; partyDate: string | null; contactName: string | null }
  state?: StateName
  facts?: {
    title: string
    hasName: boolean
    themeWord: string
    themeSub: string
    templateSlug: string
    dateLine: string
    placeLine: string
    hostContactLine: string | null
    hostNote: string | null
    giftNote: string | null
    rsvpDeadline: string | null
    guestCap: number | null
  }
  links?: { publicUrl: string; hostPageUrl: string; hostPageNote: string }
  images?: { invite: string | null; og: string | null }
  templateOptions?: string[]
  designOptions?: Array<{ slug: string; label: string }>
  renderFresh?: boolean | null
  warnings?: { needsTime: boolean; noParentEmail: boolean }
  rsvps?: Section<{ rows: AdminRsvpView[] }>
  summary?: RsvpSummary | null
  ledger?: Section<{ groups: LedgerGroup[] }>
}

export interface RevealedContact {
  reminderEmail: string | null
  reminderPhone: string | null
  clubEmail: string | null
}

export type RevealState = 'loading' | 'error' | RevealedContact

export const PRINT_CSS = `
.evite-print-sheet { display: none; }
@media print {
  body * { visibility: hidden !important; }
  .evite-print-sheet, .evite-print-sheet * { visibility: visible !important; }
  .evite-print-sheet { display: block !important; position: absolute; left: 0; top: 0; width: 100%; padding: 24px; color: #000; background: #fff; font-size: 12px; }
  .evite-print-sheet table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  .evite-print-sheet th, .evite-print-sheet td { border: 1px solid #444; padding: 4px 6px; text-align: left; vertical-align: top; }
  .evite-print-sheet h1 { font-size: 18px; margin: 0 0 2px; }
  .evite-print-sheet h2 { font-size: 13px; margin: 14px 0 4px; }
}
`

const STATE_CHIP: Record<StateName, { label: string; cls: string }> = {
  live: { label: 'Live', cls: 'bg-green-100 text-green-800' },
  preview: { label: 'Preview', cls: 'bg-blue-100 text-blue-800' },
  needs_time: { label: 'Needs a start time', cls: 'bg-amber-100 text-amber-800' },
  closed: { label: 'Party over', cls: 'bg-gray-100 text-gray-600' },
  unavailable: { label: 'Withdrawn', cls: 'bg-red-100 text-red-700' },
  disabled: { label: 'Switched off', cls: 'bg-gray-100 text-gray-600' },
}

const SEND_LABELS: Record<string, string> = {
  lead_preview: 'Lead preview',
  invite_ready: 'Invite ready',
  new_rsvp: 'New RSVP (to parent)',
  rsvp_changed: 'RSVP changed (to parent)',
  rsvp_confirmed: 'RSVP confirmed (to guest)',
  week_before: 'Week before',
  day_before: 'Day before',
  details_changed: 'Details changed',
  final_headcount: 'Final headcount',
  party_cancelled: 'Party cancelled',
}

function when(iso: string | null | undefined): string {
  if (!iso) return '-'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return '-'
  return new Date(t).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function adultsText(n: number, plus: boolean): string {
  return `${n}${plus ? '+' : ''} adult${n === 1 && !plus ? '' : 's'}`
}

function kidsText(kids: number, cap: number | null): string {
  return cap !== null ? `${kids} of ${cap} kids` : `${kids} kid${kids === 1 ? '' : 's'}`
}

export type InvitationAction = 'ensure' | 'rerender' | 'archive' | 'unarchive' | 'set_theme' | 'set_design' | 'reslug' | 'notify_cancelled' | 'void_rsvp'

export interface InvitationViewProps {
  data: InvitationPayload
  busy: string | null
  message: { ok: boolean; text: string } | null
  revealed: Record<string, RevealState>
  onAction: (action: InvitationAction, extra?: Record<string, unknown>) => void
  onReveal: (rsvpId: string) => void
  onPrint: () => void
  onCopy?: (text: string) => void
}

function Warn({ children }: { children: ReactNode }) {
  return <p className="text-xs rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2">{children}</p>
}

export function PrintSheet({ data }: { data: InvitationPayload }) {
  const rows = data.rsvps && data.rsvps.available ? data.rsvps.rows : []
  const yes = rows.filter((r) => r.status === 'yes')
  const no = rows.filter((r) => r.status === 'no')
  const s = data.summary
  return (
    <div className="evite-print-sheet" data-testid="evite-print-sheet">
      <h1>{data.facts?.title ?? 'Party'}</h1>
      <div>
        {data.facts?.dateLine} &middot; {data.facts?.placeLine}
        {data.booking?.bookingRef ? <> &middot; {data.booking.bookingRef}</> : null}
      </div>
      {s ? (
        <div>
          <strong>{kidsText(s.kidsYes, s.cap)}</strong> &middot; {adultsText(s.adultsYes, s.adultsPlus)} &middot; {s.noCount} declined
        </div>
      ) : (
        <div>RSVPs unavailable when this sheet was printed.</div>
      )}

      <h2>Coming ({yes.length})</h2>
      <table>
        <thead>
          <tr>
            <th>Parent</th>
            <th>Kids</th>
            <th>Adults</th>
            <th>Allergy</th>
            <th>Here</th>
          </tr>
        </thead>
        <tbody>
          {yes.map((r) => (
            <tr key={r.id}>
              <td>{r.parent_name}</td>
              <td>{(r.children ?? []).map((c) => c.first_name).join(', ')}</td>
              <td>{r.adult_count >= 2 ? '2+' : r.adult_count}</td>
              <td>{r.has_allergy ? (r.allergy_note ?? (r.allergy_purged_at ? '(note purged)' : 'Yes')) : ''}</td>
              <td>&#9744;</td>
            </tr>
          ))}
        </tbody>
      </table>

      {no.length > 0 ? (
        <>
          <h2>Can&apos;t come ({no.length})</h2>
          <div>{no.map((r) => r.parent_name).join(', ')}</div>
        </>
      ) : null}

      <h2>Allergies</h2>
      {s && s.allergies.length > 0 ? (
        <ul>
          {s.allergies.map((a, i) => (
            <li key={i}>
              {a.children.join(', ') || a.parent} ({a.parent}): {a.note ?? (a.purged ? 'note purged' : 'allergy flagged, no details')}
            </li>
          ))}
        </ul>
      ) : (
        <div>None reported.</div>
      )}

      <h2>Notes for the birthday child</h2>
      {s && s.notes.length > 0 ? (
        <ul>
          {s.notes.map((n, i) => (
            <li key={i}>
              {n.parent}: {n.note}
            </li>
          ))}
        </ul>
      ) : (
        <div>None.</div>
      )}
    </div>
  )
}

export function InvitationCardView({ data, busy, message, revealed, onAction, onReveal, onPrint, onCopy }: InvitationViewProps) {
  const [word, setWord] = useState(data.evite?.themeWord ?? '')
  const [sub, setSub] = useState(data.evite?.themeSub ?? '')
  const [template, setTemplate] = useState(data.evite?.templateSlug ?? 'glow')
  const [design, setDesign] = useState(data.evite?.templateChoice ?? '')

  const ev = data.evite
  const disabledBtn = 'disabled:opacity-50'
  const btn = `border-2 border-hampton-blue/40 text-[#1a2744] py-1.5 px-3 rounded-lg text-xs font-medium hover:bg-hampton-blue/10 ${disabledBtn}`
  const working = busy !== null

  // No invitation yet.
  if (!ev) {
    return (
      <div className="bg-white rounded-xl border p-5" data-testid="invitation-card">
        <h3 className="text-sm font-medium text-[#1a2744] mb-3">Invitation &amp; RSVPs</h3>
        <p className="text-sm text-gray-500 mb-3">No invitation has been created for this party.</p>
        {message ? <p className={`text-xs mb-2 ${message.ok ? 'text-green-700' : 'text-red-700'}`}>{message.text}</p> : null}
        <button type="button" className={btn} disabled={working || !data.canEnsure} onClick={() => onAction('ensure')}>
          {busy === 'ensure' ? 'Creating...' : 'Create invitation'}
        </button>
        {!data.canEnsure ? (
          <p className="text-[11px] text-gray-400 mt-2">
            {data.pagesMode === 'off' ? 'Invitations are switched off (EVITES_PAGES).' : 'Not available for this booking in the current rollout mode.'}
          </p>
        ) : null}
      </div>
    )
  }

  const state = data.state ?? 'preview'
  const chip = STATE_CHIP[state]
  const facts = data.facts
  const summary = data.summary
  const cancelled = data.booking?.status === 'cancelled' || data.booking?.status === 'lost'
  const archived = !!ev.archivedAt

  return (
    <div className="bg-white rounded-xl border p-5 space-y-4" data-testid="invitation-card">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-medium text-[#1a2744]">Invitation &amp; RSVPs</h3>
        <div className="flex items-center gap-2">
          {archived ? <span className="text-xs px-2 py-1 rounded-full bg-gray-200 text-gray-700">Archived</span> : null}
          <span className={`text-xs px-2 py-1 rounded-full ${chip.cls}`} data-testid="state-chip">
            {chip.label}
          </span>
        </div>
      </div>

      {message ? <p className={`text-xs ${message.ok ? 'text-green-700' : 'text-red-700'}`} role="status">{message.text}</p> : null}

      {data.warnings?.needsTime ? <Warn>Needs a start time. Guests cannot RSVP until the party has one.</Warn> : null}
      {data.warnings?.noParentEmail ? <Warn>No parent email: share the invitation manually. Nothing can be emailed to this customer.</Warn> : null}
      {ev.renderError ? <Warn>Last render failed: {ev.renderError}</Warn> : null}
      {data.pagesMode === 'off' ? <Warn>Invitations are switched off (EVITES_PAGES), so the public page is not served.</Warn> : null}

      {/* Links */}
      {data.links ? (
        <div className="text-xs space-y-1 text-gray-600">
          <p>
            <span className="text-gray-400">Public invite: </span>
            <a href={data.links.publicUrl} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline break-all">
              {data.links.publicUrl}
            </a>{' '}
            {onCopy ? (
              <button type="button" className="underline text-gray-500" onClick={() => onCopy(data.links?.publicUrl ?? '')}>
                copy
              </button>
            ) : null}
          </p>
          <p>
            <span className="text-gray-400">Host page: </span>
            <span className="break-all">{data.links.hostPageUrl}</span>
            <span className="text-gray-400"> ({data.links.hostPageNote})</span>
          </p>
          <p className="text-gray-400">
            Image v{ev.renderVersion}
            {ev.renderedAt ? `, rendered ${when(ev.renderedAt)}` : ', not rendered yet'}
            {data.renderFresh === true ? ', up to date' : data.renderFresh === false ? ', out of date (a re-render is due)' : ''}
            {data.images?.invite ? (
              <>
                {' '}
                &middot;{' '}
                <a href={data.images.invite} target="_blank" rel="noopener noreferrer" className="underline">
                  invite image
                </a>
              </>
            ) : null}
            {data.images?.og ? (
              <>
                {' '}
                &middot;{' '}
                <a href={data.images.og} target="_blank" rel="noopener noreferrer" className="underline">
                  share card
                </a>
              </>
            ) : null}
          </p>
          {ev.wentLiveAt ? <p className="text-gray-400">Went live {when(ev.wentLiveAt)}; the link can no longer change.</p> : null}
        </div>
      ) : null}

      {/* Headcount */}
      {data.rsvps && !data.rsvps.available ? (
        <p className="text-sm text-red-700">RSVPs unavailable. Reload to try again.</p>
      ) : summary ? (
        <div className="text-sm space-y-1">
          <p>
            <strong className={summary.overCap ? 'text-red-600' : 'text-[#1a2744]'} data-testid="headcount">
              {kidsText(summary.kidsYes, summary.cap)}
            </strong>
            <span className="text-gray-500">
              {' '}
              &middot; {adultsText(summary.adultsYes, summary.adultsPlus)} &middot; {summary.yesCount} coming &middot; {summary.noCount} declined
            </span>
          </p>
          {summary.overCap ? <p className="text-xs text-red-600">More kids than the booked guest count.</p> : null}
          {data.rsvps && data.rsvps.available && data.rsvps.truncated ? (
            <p className="text-xs text-amber-700">Showing the first 500 RSVPs only.</p>
          ) : null}

          <div>
            <p className="text-xs font-medium text-[#1a2744] mt-2">Allergies</p>
            {summary.allergies.length === 0 ? (
              <p className="text-xs text-gray-400">None reported.</p>
            ) : (
              <ul className="text-xs text-gray-700 list-disc pl-4">
                {summary.allergies.map((a, i) => (
                  <li key={i}>
                    {a.children.join(', ') || a.parent} ({a.parent}): {a.note ?? (a.purged ? 'note purged' : 'flagged, no details')}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <p className="text-xs font-medium text-[#1a2744] mt-2">Notes to the birthday child</p>
            {summary.notes.length === 0 ? (
              <p className="text-xs text-gray-400">None yet.</p>
            ) : (
              <ul className="text-xs text-gray-700 list-disc pl-4">
                {summary.notes.map((n, i) => (
                  <li key={i}>
                    {n.note} <span className="text-gray-400">({n.parent})</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      {/* RSVP list with the logged contact reveal */}
      {data.rsvps && data.rsvps.available && data.rsvps.rows.length > 0 ? (
        <div className="text-xs">
          <p className="font-medium text-[#1a2744] mb-1">Responses</p>
          <ul className="divide-y">
            {data.rsvps.rows.map((r) => {
              const rev = revealed[r.id]
              return (
                <li key={r.id} className="py-1.5 flex items-start justify-between gap-2">
                  <div>
                    <span className="font-medium">{r.parent_name}</span>{' '}
                    <span className={r.status === 'yes' ? 'text-green-700' : 'text-gray-500'}>{r.status === 'yes' ? 'coming' : "can't come"}</span>
                    {r.status === 'yes' ? (
                      <span className="text-gray-500">
                        {' '}
                        &middot; {(r.children ?? []).map((c) => c.first_name).join(', ')} &middot; {r.adult_count >= 2 ? '2+' : r.adult_count} adult
                      </span>
                    ) : null}
                    {r.club_opt_in_at && !r.club_opted_out_at ? <span className="text-gray-400"> &middot; club</span> : null}
                    {r.reminder_opt_out_at ? <span className="text-gray-400"> &middot; reminders stopped</span> : null}
                    {r.contacts_purged_at ? <span className="text-gray-400"> &middot; contacts purged</span> : null}
                    {rev && rev !== 'loading' && rev !== 'error' ? (
                      <div className="text-gray-700 break-all">
                        {[rev.reminderEmail, rev.reminderPhone, rev.clubEmail && rev.clubEmail !== rev.reminderEmail ? `club: ${rev.clubEmail}` : null]
                          .filter(Boolean)
                          .join(' / ') || 'No contact on file'}
                      </div>
                    ) : null}
                    {rev === 'error' ? <div className="text-red-700">Could not show the contact.</div> : null}
                  </div>
                  <div className="shrink-0 text-right">
                    {r.hasReminderContact || r.hasClubEmail ? (
                      <button
                        type="button"
                        className="underline text-gray-600 disabled:opacity-50"
                        disabled={rev === 'loading'}
                        onClick={() => onReveal(r.id)}
                        title="Shows the address and records that you looked"
                      >
                        {rev === 'loading' ? '...' : 'Show contact'}
                      </button>
                    ) : (
                      <span className="text-gray-400">no contact</span>
                    )}
                    <div>
                      <button
                        type="button"
                        className="underline text-red-700 disabled:opacity-50"
                        disabled={working}
                        onClick={() => onAction('void_rsvp', { rsvpId: r.id })}
                        title="Deletes this answer (for a junk or mistaken RSVP)"
                        data-testid="remove-rsvp"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      {/* Send ledger */}
      <div className="text-xs">
        <p className="font-medium text-[#1a2744] mb-1">Emails sent</p>
        {!data.ledger || !data.ledger.available ? (
          <p className="text-red-700">Ledger unavailable. This is not the same as nothing sent.</p>
        ) : data.ledger.groups.length === 0 ? (
          <p className="text-gray-400">Nothing sent yet ({`sends are ${data.sendsMode}`}).</p>
        ) : (
          <ul className="space-y-1">
            {data.ledger.groups.map((g) => (
              <li key={`${g.sendType}|${g.channel}`}>
                <span className="font-medium">{SEND_LABELS[g.sendType] ?? g.sendType}</span>
                {g.channel === 'sms' ? <span className="text-gray-400"> (sms)</span> : null}
                <span className="text-gray-600">
                  {' '}
                  {[
                    g.counts.sent ? `${g.counts.sent} sent` : null,
                    g.counts.sending ? `${g.counts.sending} sending` : null,
                    g.counts.skipped ? `${g.counts.skipped} skipped` : null,
                    g.counts.failed ? `${g.counts.failed} failed` : null,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </span>
                <span className="text-gray-400"> &middot; last {when(g.latest.sentAt ?? g.latest.claimedAt)}</span>
                {g.stuckCount > 0 ? (
                  <div className="text-red-700" data-testid="ledger-stuck">
                    {g.stuckCount} stuck or failed:
                    {g.problems.map((p, i) => (
                      <span key={i} className="block pl-2">
                        {p.status} since {when(p.claimedAt)}, attempt {p.attempts}
                        {p.lastError ? `: ${p.lastError}` : ''}
                      </span>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {data.ledger && data.ledger.available && data.ledger.truncated ? <p className="text-amber-700">Older sends are not shown.</p> : null}
      </div>

      {/* Design (the host's gallery pick, migration 070) */}
      {data.designOptions && data.designOptions.length > 0 ? (
        <form
          className="text-xs space-y-2 p-3 bg-gray-50 rounded-lg"
          onSubmit={(e) => {
            e.preventDefault()
            onAction('set_design', { template_choice: design === '' ? null : design })
          }}
        >
          <p className="font-medium text-[#1a2744]">
            Design <span className="font-normal text-gray-400">(now: {facts?.templateSlug})</span>
          </p>
          <div className="flex gap-2 flex-wrap">
            <select value={design} onChange={(e) => setDesign(e.target.value)} className="border rounded px-2 py-1">
              <option value="">Theme default</option>
              {data.designOptions.map((d) => (
                <option key={d.slug} value={d.slug}>
                  {d.label}
                </option>
              ))}
            </select>
            <button type="submit" className={btn} disabled={working || design === (ev.templateChoice ?? '')}>
              {busy === 'set_design' ? 'Saving...' : 'Use design'}
            </button>
          </div>
          <p className="text-gray-400">The parent can also pick one on their invitation page. Theme default = the design for the party&apos;s theme.</p>
        </form>
      ) : null}

      {/* Theme */}
      <form
        className="text-xs space-y-2 p-3 bg-gray-50 rounded-lg"
        onSubmit={(e) => {
          e.preventDefault()
          // The template is sent only when it was changed, so clearing a word does not rewrite it.
          onAction('set_theme', {
            ...(template !== ev.templateSlug ? { template_slug: template } : {}),
            theme_word: word.trim() === '' ? null : word,
            theme_sub: sub.trim() === '' ? null : sub,
          })
        }}
      >
        <p className="font-medium text-[#1a2744]">
          Theme override <span className="font-normal text-gray-400">(now: {facts?.themeWord} {facts?.themeSub})</span>
        </p>
        <div className="flex gap-2 flex-wrap">
          <select value={template} onChange={(e) => setTemplate(e.target.value)} className="border rounded px-2 py-1">
            {(data.templateOptions ?? ['glow', 'plain']).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input value={word} onChange={(e) => setWord(e.target.value)} maxLength={12} placeholder="Theme word" className="border rounded px-2 py-1 w-28" />
          <input value={sub} onChange={(e) => setSub(e.target.value)} maxLength={12} placeholder="Sub" className="border rounded px-2 py-1 w-24" />
          <button type="submit" className={btn} disabled={working}>
            {busy === 'set_theme' ? 'Saving...' : 'Apply'}
          </button>
        </div>
        <p className="text-gray-400">The template only applies together with a word or sub. Empty = the booking&apos;s own theme.</p>
      </form>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn} disabled={working} onClick={() => onAction('rerender')}>
          {busy === 'rerender' ? 'Rendering...' : 'Re-render'}
        </button>
        <button type="button" className={btn} onClick={onPrint}>
          Print RSVP sheet
        </button>
        {archived ? (
          <button type="button" className={btn} disabled={working} onClick={() => onAction('unarchive')}>
            Unarchive
          </button>
        ) : (
          <button type="button" className={btn} disabled={working} onClick={() => onAction('archive')}>
            Archive
          </button>
        )}
        <button
          type="button"
          className={btn}
          disabled={working || !ev.canReslug}
          title={ev.canReslug ? 'Mint a new link; the old one keeps working' : 'Gone live: the link is fixed'}
          onClick={() => onAction('reslug')}
        >
          Re-mint link
        </button>
        {cancelled ? (
          <button type="button" className={btn} disabled={working} onClick={() => onAction('notify_cancelled')}>
            Tell guests it&apos;s cancelled
          </button>
        ) : null}
      </div>

      <PrintSheet data={data} />
    </div>
  )
}

const CONFIRMS: Partial<Record<InvitationAction, string>> = {
  archive: 'Archive this invitation? The public link stops working immediately.',
  reslug: 'Mint a new invitation link? Anyone with the old link is forwarded to the new one.',
  notify_cancelled: 'Email every guest who said yes that the party is cancelled? This cannot be undone.',
  void_rsvp: 'Remove this RSVP? The answer is deleted, the headcount changes, and it cannot be restored. (A club member is also taken off the list.)',
}

export default function InvitationCard({ bookingId, headers, status, partyType, partyTags }: {
  bookingId: string
  headers: HeadersInit
  /** Echoes of the booking so the card stays hidden for a booking that could never have an invitation. */
  status?: string | null
  partyType?: string | null
  partyTags?: unknown
}) {
  const [data, setData] = useState<InvitationPayload | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [revealed, setRevealed] = useState<Record<string, RevealState>>({})

  const url = `/api/admin/parties/${bookingId}/invitation`
  const jsonHeaders = { ...Object.fromEntries(new Headers(headers).entries()), 'Content-Type': 'application/json' }

  const load = useCallback(async () => {
    try {
      const res = await fetch(url, { headers })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body) {
        setLoadError(body?.error ?? `Could not load the invitation (${res.status})`)
        return
      }
      setLoadError(null)
      setData(body as InvitationPayload)
    } catch {
      setLoadError('Could not load the invitation')
    }
  }, [url, headers])

  useEffect(() => {
    setData(null)
    setRevealed({})
    setMessage(null)
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId])

  async function onAction(action: InvitationAction, extra: Record<string, unknown> = {}) {
    const confirmText = CONFIRMS[action]
    if (confirmText && !window.confirm(confirmText)) return
    setBusy(action)
    setMessage(null)
    try {
      const res = await fetch(url, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ action, ...extra }) })
      const body = await res.json().catch(() => null)
      if (!res.ok || body?.ok === false) {
        setMessage({ ok: false, text: describeFailure(action, body, res.status) })
      } else {
        setMessage({ ok: true, text: describeSuccess(action, body) })
      }
      await load()
    } catch {
      setMessage({ ok: false, text: 'Something went wrong. Reload and check before trying again.' })
    } finally {
      setBusy(null)
    }
  }

  async function onReveal(rsvpId: string) {
    setRevealed((r) => ({ ...r, [rsvpId]: 'loading' }))
    try {
      const res = await fetch(`${url}?reveal=${encodeURIComponent(rsvpId)}`, { headers })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body) throw new Error('reveal failed')
      setRevealed((r) => ({ ...r, [rsvpId]: { reminderEmail: body.reminderEmail ?? null, reminderPhone: body.reminderPhone ?? null, clubEmail: body.clubEmail ?? null } }))
    } catch {
      setRevealed((r) => ({ ...r, [rsvpId]: 'error' }))
    }
  }

  // A booking that could never have an invitation: no card (a cancelled one may still have one to withdraw).
  // Status is judged by the server; here only the party-type half (status null = not yet judged).
  const everEligible = isEviteEligible({ status: null, party_type: partyType, party_tags: partyTags })
  if (!everEligible && status !== 'cancelled' && status !== 'lost') return null
  if (loadError) {
    return (
      <div className="bg-white rounded-xl border p-5">
        <h3 className="text-sm font-medium text-[#1a2744] mb-2">Invitation &amp; RSVPs</h3>
        <p className="text-xs text-red-700">{loadError}</p>
        <button type="button" className="text-xs underline mt-2" onClick={() => void load()}>Retry</button>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="bg-white rounded-xl border p-5" data-testid="invitation-card-loading">
        <h3 className="text-sm font-medium text-[#1a2744] mb-2">Invitation &amp; RSVPs</h3>
        <p className="text-xs text-gray-400">Loading...</p>
      </div>
    )
  }
  // No invitation, and none can be made: say nothing rather than a dead card.
  if (!data.evite && !data.eligible) return null

  return (
    <InvitationCardView
      data={data}
      busy={busy}
      message={message}
      revealed={revealed}
      onAction={onAction}
      onReveal={onReveal}
      onPrint={() => window.print()}
      onCopy={(text) => void navigator.clipboard?.writeText(text)}
    />
  )
}

function describeFailure(action: InvitationAction, body: { error?: string; reason?: string; outcome?: unknown } | null, status: number): string {
  if (body?.error) return body.error
  if (body?.reason) return body.reason
  if (action === 'rerender' && body?.outcome && typeof body.outcome === 'object') {
    const o = body.outcome as { kind?: string; reason?: string }
    return `Render ${o.kind ?? 'failed'}${o.reason ? `: ${o.reason}` : ''}`
  }
  return `That did not work (${status}).`
}

function describeSuccess(action: InvitationAction, body: Record<string, unknown> | null): string {
  switch (action) {
    case 'ensure':
      return body?.outcome === 'created' ? 'Invitation created; the image is rendering.' : 'This party already had an invitation.'
    case 'rerender': {
      const o = body?.outcome as { kind?: string } | undefined
      return o?.kind === 'rendered' ? 'Re-rendered.' : `Render: ${o?.kind ?? 'done'}.`
    }
    case 'archive':
      return 'Archived.'
    case 'unarchive':
      return 'Unarchived.'
    case 'set_theme':
      return typeof body?.warning === 'string' ? `Saved. ${body.warning}` : 'Theme saved; the image is re-rendering.'
    case 'set_design':
      return 'Design saved; the image is re-rendering.'
    case 'reslug':
      return 'New link minted. The old one forwards to it.'
    case 'void_rsvp':
      return 'RSVP removed.'
    case 'notify_cancelled':
      return body?.queued === true ? 'Cancellation emails queued.' : `Not sent: ${typeof body?.reason === 'string' ? body.reason : 'nothing queued'}.`
  }
}
