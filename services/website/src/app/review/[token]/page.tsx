import { notFound } from 'next/navigation'
import { getSupabase } from '@/lib/supabase'
import { describeMissing } from '@/lib/inquiryDrafts'
import {
  isReviewTokenExpired,
  reviewCodeFromToken,
  reviewTokenExpiresAt,
  validateReviewToken,
} from '@/lib/agent/reviewLink'
import { reviewLinkSecret } from '@/lib/agent/config'
import { loadLeadTimeline, type TimelineItem } from '@/lib/agent/threadTimeline'

export const dynamic = 'force-dynamic'

/**
 * Public, token-gated preview of one agent draft — the "open the link" half of
 * the reviewer SMS.
 *
 * Auth model is the portal's: the token is never stored, only its HMAC
 * (inquiry_drafts.preview_token_hash), and a wrong/absent/expired token is a
 * 404 rather than an error page that confirms the draft exists. Read-only:
 * approving happens by text (Phase 2) or in Admin → Inbox, never from a link
 * that could be forwarded.
 *
 * ── What this page gained in Phase 4.5, and what it deliberately did not ──
 *
 * Gained: the lead TIMELINE (the same `loadLeadTimeline()` the workspace uses,
 * so the glance is genuinely useful), a countdown to the link's expiry, and one
 * "Open in Host Hampton →" deep link into the authenticated workspace.
 *
 * NOT gained, and this is not negotiable: approve, send or edit. A bearer token
 * in a URL is forwardable — an SMS screenshot in a group chat is a working
 * credential for whoever receives it — so giving this page a mutation would
 * drive a hole straight through the guardrail that `approved` and `sent` need a
 * verified admin. The deep link is the entire mechanism by which this page can
 * lead to an action: it sends you somewhere that checks who you are.
 *
 * Preview links now EXPIRE (7 days, lib/agent/reviewLink.ts). An expired one is
 * a 404 like a wrong one, for the same reason: an error page that distinguishes
 * "expired" from "never existed" confirms the draft exists to someone who
 * should not know.
 */

export const metadata = {
  title: 'Draft review — Host Hampton',
  robots: { index: false, follow: false },
}

interface DraftRow {
  id: string
  review_code: string
  status: string
  party_type: string
  contact_path: string
  missing_fields: string[] | null
  subject: string | null
  email_draft: string | null
  sms_draft: string | null
  error: string | null
  created_at: string
  sent_for_review_at: string | null
  contact_id: string | null
  booking_id: string | null
  preview_token_hash: string | null
}

/** "6 days" / "4 hours" / "18 minutes" — enough precision to act on. */
function countdown(expiresAt: Date, now = new Date()): string {
  const ms = expiresAt.getTime() - now.getTime()
  if (ms <= 0) return 'expired'
  const minutes = Math.floor(ms / 60000)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`
  return `${Math.floor(hours / 24)} days`
}

/** The read-only timeline. No controls, by design — see the header. */
function TimelineRow({ item }: { item: TimelineItem }) {
  const at = new Date(item.at).toLocaleString()
  if (item.kind === 'message') {
    const inbound = item.side !== 'outbound'
    return (
      <div className={`flex ${inbound ? 'justify-start' : 'justify-end'} my-2`}>
        <div
          className={`max-w-[85%] rounded-2xl border px-3 py-2 ${
            inbound ? 'bg-white border-gray-200' : 'bg-hampton-navy/5 border-hampton-navy/20'
          }`}
        >
          <div className="text-[11px] text-gray-400 mb-0.5">
            {item.source} · {item.from || 'unknown'} · {at}
          </div>
          <div className="whitespace-pre-wrap text-sm text-gray-700 break-words">{item.body || '(no body)'}</div>
        </div>
      </div>
    )
  }
  if (item.kind === 'draft_version' && item.version > 0) {
    return (
      <div className="flex justify-end my-2">
        <div className="max-w-[85%] rounded-2xl border bg-hampton-navy/5 border-hampton-navy/20 px-3 py-2">
          <div className="text-[11px] text-gray-400 mb-0.5">
            draft v{item.version} · {item.author}
            {item.note ? ` · ${item.note}` : ''} · {at} — never sent
          </div>
          <div className="whitespace-pre-wrap text-sm text-gray-700 break-words">
            {item.smsDraft || item.emailDraft || '(empty)'}
          </div>
        </div>
      </div>
    )
  }
  let text: string
  if (item.kind === 'draft_version') text = `${item.author} asked: “${item.note}”`
  else if (item.kind === 'payment') text = `${item.paymentType} paid — $${(item.amountCents / 100).toFixed(2)}`
  else if (item.kind === 'interaction') text = item.type.replace(/_/g, ' ')
  else if (item.action === 'transition') text = `${item.fromStatus ?? '—'} → ${item.toStatus}`
  else text = `${item.action}${item.meta?.job ? ` · ${item.meta.job}` : ''}`
  return (
    <div className="flex items-center gap-3 my-1">
      <div className="h-px flex-1 bg-gray-200" />
      <span className="text-[11px] text-gray-400 whitespace-nowrap">
        {text} · {at}
      </span>
      <div className="h-px flex-1 bg-gray-200" />
    </div>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === '') return null
  return (
    <div className="flex gap-3 py-1.5 text-sm border-b border-gray-100 last:border-0">
      <span className="w-32 shrink-0 text-gray-400">{label}</span>
      <span className="text-hampton-navy font-medium break-words">{value}</span>
    </div>
  )
}

export default async function ReviewDraftPage({ params }: { params: { token: string } }) {
  const token = decodeURIComponent(params.token || '')
  const reviewCode = reviewCodeFromToken(token)
  const secret = reviewLinkSecret()
  if (!reviewCode || !secret) notFound()

  const supabase = getSupabase()
  const { data: draft } = await supabase
    .from('inquiry_drafts')
    .select(
      'id, review_code, status, party_type, contact_path, missing_fields, subject, email_draft, sms_draft, error, created_at, sent_for_review_at, contact_id, booking_id, preview_token_hash',
    )
    .eq('review_code', reviewCode)
    .maybeSingle<DraftRow>()

  if (!draft || !validateReviewToken(token, secret, draft.preview_token_hash)) notFound()

  // The token is minted exactly when this timestamp is written, on every path
  // that mints one — see REVIEW_TOKEN_TTL_MS. An expired link is a 404, not a
  // friendlier error: a page that says "this link expired" has confirmed the
  // draft exists to whoever was forwarded it.
  const mintedAt = draft.sent_for_review_at || draft.created_at
  if (isReviewTokenExpired(mintedAt)) notFound()
  const expiresAt = reviewTokenExpiresAt(mintedAt)

  let booking: Record<string, unknown> | null = null
  if (draft.booking_id) {
    const { data } = await supabase
      .from('bookings')
      .select(
        'booking_ref, status, party_date, party_time, guest_count_approx, contact_name, contact_email, contact_phone, event_type, package_type, notes',
      )
      .eq('id', draft.booking_id)
      .maybeSingle()
    booking = data ?? null
  }

  const missing = describeMissing(draft.missing_fields ?? [])

  const timeline = await loadLeadTimeline({
    supabase,
    bookingId: draft.booking_id,
    contactId: draft.contact_id,
    draftId: draft.id,
  })
  // The deep link uses the booking ref when there is one and the review code
  // otherwise — /admin/lead/[ref] resolves both, so there is no case where the
  // "open it properly" button has nothing to point at.
  const workspaceRef = (booking?.booking_ref as string) || draft.review_code

  return (
    <main className="min-h-screen bg-[#f5f6f8] py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-5">
        <header className="bg-white rounded-2xl border border-gray-200 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-hampton-navy">{draft.review_code}</span>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
              {draft.status}
            </span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
              {draft.party_type.replace(/_/g, ' ')}
            </span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
              {draft.contact_path === 'quote' ? 'quote path' : 'info gather'}
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            Drafted {new Date(draft.created_at).toLocaleString()} · nothing has been sent to the customer.
          </p>
          {expiresAt && (
            <p className="text-xs text-gray-400 mt-1">
              This link stops working in {countdown(expiresAt)} ({expiresAt.toLocaleDateString()}).
            </p>
          )}
          <a
            href={`/admin/lead/${encodeURIComponent(workspaceRef)}`}
            className="mt-3 inline-block px-4 py-2 rounded-lg bg-hampton-navy text-white text-sm font-semibold"
          >
            Open in Host Hampton →
          </a>
          <p className="text-[11px] text-gray-400 mt-1.5">
            Approving, editing and sending live there, behind a sign-in. This link is read-only because it can be
            forwarded.
          </p>
          {draft.error && (
            <p className="mt-3 text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">
              Held back: {draft.error}
            </p>
          )}
        </header>

        {missing.length > 0 && (
          <section className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-amber-900 mb-1">Missing before we can quote</h2>
            <p className="text-sm text-amber-800">{missing.join(' · ')}</p>
          </section>
        )}

        <section className="bg-white rounded-2xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-hampton-navy mb-3">The plan so far</h2>
          <Field label="Booking" value={booking?.booking_ref as string} />
          <Field label="Name" value={booking?.contact_name as string} />
          <Field label="Email" value={booking?.contact_email as string} />
          <Field label="Phone" value={booking?.contact_phone as string} />
          <Field label="Date" value={booking?.party_date as string} />
          <Field label="Time" value={booking?.party_time as string} />
          <Field label="Guests" value={booking?.guest_count_approx as number} />
          <Field label="Event type" value={booking?.event_type as string} />
          <Field label="Package" value={booking?.package_type as string} />
          <Field label="Notes" value={booking?.notes as string} />
          {!booking && (
            <p className="text-sm text-gray-400">
              No party plan row yet — this lead came in through a website form. The plan is created when the
              quote goes out.
            </p>
          )}
        </section>

        <section className="bg-white rounded-2xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-hampton-navy mb-1">Email draft</h2>
          <p className="text-xs text-gray-400 mb-3">Subject: {draft.subject || '(none)'}</p>
          <pre className="whitespace-pre-wrap font-sans text-sm text-gray-700 leading-relaxed">
            {draft.email_draft || '(empty)'}
          </pre>
        </section>

        <section className="bg-white rounded-2xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-hampton-navy mb-1">SMS draft</h2>
          <p className="text-xs text-gray-400 mb-3">{(draft.sms_draft || '').length} characters</p>
          <pre className="whitespace-pre-wrap font-sans text-sm text-gray-700 leading-relaxed">
            {draft.sms_draft || '(empty)'}
          </pre>
        </section>

        <section className="bg-white rounded-2xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-hampton-navy mb-2">The whole thread</h2>
          {timeline.items.length === 0 && <p className="text-sm text-gray-400">Nothing recorded on this lead yet.</p>}
          {timeline.items.map(item => (
            <TimelineRow key={item.id} item={item} />
          ))}
          {timeline.errors.length > 0 && (
            <p className="text-[11px] text-amber-700 mt-2">
              Part of the history could not be read: {timeline.errors.join(' · ')}
            </p>
          )}
        </section>

        <p className="text-xs text-gray-400 text-center pb-8">
          Read-only preview. Approve, edit or send in Host Hampton.
        </p>
      </div>
    </main>
  )
}
