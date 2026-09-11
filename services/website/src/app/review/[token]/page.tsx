import { notFound } from 'next/navigation'
import { getSupabase } from '@/lib/supabase'
import { describeMissing } from '@/lib/inquiryDrafts'
import { reviewCodeFromToken, validateReviewToken } from '@/lib/agent/reviewLink'
import { reviewLinkSecret } from '@/lib/agent/config'

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
  booking_id: string | null
  preview_token_hash: string | null
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
      'id, review_code, status, party_type, contact_path, missing_fields, subject, email_draft, sms_draft, error, created_at, booking_id, preview_token_hash',
    )
    .eq('review_code', reviewCode)
    .maybeSingle<DraftRow>()

  if (!draft || !validateReviewToken(token, secret, draft.preview_token_hash)) notFound()

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

        <p className="text-xs text-gray-400 text-center pb-8">
          Read-only preview. Approve or edit in Admin → Inbox.
        </p>
      </div>
    </main>
  )
}
