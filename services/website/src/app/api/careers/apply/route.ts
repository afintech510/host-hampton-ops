/**
 * POST /api/careers/apply — an application from /join-the-team.
 *
 * ── AN APPLICANT IS NOT A LEAD ──
 *
 * Every other public form here calls `upsertContact` (which mirrors the person
 * into Brevo's marketing list and Quo's SMS contacts), enrols a sequence, opens a
 * Party Plan and records an inbound event for the booking agent to draft a reply
 * to. None of that is right for somebody asking for a job, so this route calls
 * none of it: it writes one `job_applications` row (migration 071) and tells the
 * people who hire. publicIntakeSurface.test.ts R11 fails if that changes.
 *
 * ── A 200 MEANS SOMETHING LANDED ──
 *
 * The `/api/contact` rule, with this route's two places to land: the row, and
 * the owner alert. Nothing at all → 503, so the form offers a retry instead of
 * thanking somebody whose application exists nowhere. The alert alone → 200, but
 * DAMAGED: the email says in red that it is the only copy, and the log says so
 * too. The row alone → 200; the owner can still see it on /admin/applications.
 *
 * The insert is tried first and its failure does not stop the alert — the alert
 * carries every answer precisely so a refused row is recoverable by hand.
 */

import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { guardRate, intakeRule } from '@/lib/rateLimit'
import { getSupabase } from '@/lib/supabase'
import { notifyOwnerSms, leadSmsLine } from '@/lib/ownerNotify'
import { settledOk } from '@/lib/publicIntake'
import { attributionFromBody, hasAttributionSignal } from '@/lib/attribution'
import { screenJobApplication } from '@/lib/jobApplication'
import { careersAlertEmail } from '@/lib/careersNotify'
import {
  roleInterestLabel,
  labelOf,
  WEEKEND_OPTIONS,
  WEEKDAY_OPTIONS,
  YES_SOME_NO,
  JOB_HEARD_ABOUT,
  HELPER_SKILLS,
  asksLead,
  asksHelper,
} from '@/lib/careers'
import { jobApplicationOwnerEmail, jobApplicationConfirmEmail } from '@/lib/email-templates/careers'
import { SITE_URL } from '@/lib/seo'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const limited = guardRate(req, intakeRule('careers-apply'))
  if (limited) return limited

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  // Honeypot. `website` is a field no person can see; a bot fills every field.
  // The bot is told it succeeded, so it has no reason to try a variation — and
  // nothing is written, mailed or texted.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    console.warn('careers apply: honeypot filled — dropped without a write')
    return NextResponse.json({ success: true })
  }

  const screened = screenJobApplication(body)
  if (!screened.ok) {
    return NextResponse.json({ error: screened.error, code: screened.code }, { status: 400 })
  }
  const row = screened.row
  const attribution = attributionFromBody(body)

  const recorded = { application: false, ownerNotified: false }

  // ── The row ───────────────────────────────────────────────────────────────
  const { data: inserted, error: insertErr } = await getSupabase()
    .from('job_applications')
    .insert({ ...row, attribution: hasAttributionSignal(attribution) ? attribution : null })
    .select('id, application_ref')
    .single()

  if (insertErr || !inserted) {
    console.error('careers apply: insert FAILED —', insertErr?.code, insertErr?.message)
  } else {
    recorded.application = true
  }
  const ref: string | null = inserted?.application_ref ?? null

  // ── The people who hire ───────────────────────────────────────────────────
  const roleLabel = roleInterestLabel(row.role_interest)
  const firstName = row.name.split(/\s+/)[0]

  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
    const alertTo = careersAlertEmail()

    const ratingLabel = (n: number | null) => (n ? `${n} / 5` : '—')
    const owner = jobApplicationOwnerEmail({
      applicationRef: ref,
      name: row.name,
      email: row.email,
      phone: row.phone,
      roleLabel,
      weekendLabel: labelOf(WEEKEND_OPTIONS, row.weekend_availability),
      weekdayLabel: labelOf(WEEKDAY_OPTIONS, row.weekday_availability),
      carLabel: row.has_car ? 'Yes' : 'No',
      heardLabel:
        labelOf(JOB_HEARD_ABOUT, row.heard_about) + (row.heard_about_detail ? ` — ${row.heard_about_detail}` : ''),
      leadAnswers: asksLead(row.role_interest)
        ? [
            { label: 'Experience', value: row.hospitality_experience ?? '—' },
            { label: 'Managing parents + a team', value: ratingLabel(row.lead_comfort_rating) },
            { label: 'Decorating / design', value: row.decorating_experience ?? '—' },
            { label: 'Balloon arch / garland', value: labelOf(YES_SOME_NO, row.balloon_experience) },
          ]
        : null,
      helperAnswers: asksHelper(row.role_interest)
        ? [
            { label: 'Experience with kids', value: row.kids_experience ?? '—' },
            { label: 'Leading group activities', value: ratingLabel(row.activity_comfort_rating) },
            ...HELPER_SKILLS.map(s => ({ label: s.label, value: labelOf(YES_SOME_NO, row[s.field]) })),
            { label: 'Willing to learn tinsel, braids, nails', value: row.will_learn_beauty ? 'Yes' : '—' },
          ]
        : null,
      whyUs: row.why_us,
      portfolioUrl: row.portfolio_url,
      adminUrl: `${SITE_URL}/admin/applications`,
      notSaved: !recorded.application,
    })
    const confirm = jobApplicationConfirmEmail({ firstName, roleLabel })

    const results = await Promise.allSettled([
      resend.emails.send({
        from,
        to: alertTo,
        replyTo: row.email,
        subject: owner.subject,
        html: owner.html,
        text: owner.text,
      }),
      resend.emails.send({
        from,
        to: row.email,
        replyTo: alertTo,
        subject: confirm.subject,
        html: confirm.html,
        text: confirm.text,
      }),
    ])
    // results[0] is the OWNER alert — the one that makes a refused row
    // recoverable. A rejected promise and a resolved `{ error }` both fail.
    recorded.ownerNotified = settledOk(results[0])
    if (!recorded.ownerNotified) {
      console.error('careers apply: owner alert did NOT send —', JSON.stringify(results[0]).slice(0, 300))
    }
    if (!settledOk(results[1])) {
      console.warn('careers apply: applicant confirmation did not send —', JSON.stringify(results[1]).slice(0, 300))
    }
  }

  // One line, and deliberately not the answers: a text is billed per segment.
  await notifyOwnerSms(
    leadSmsLine({
      kind: 'Job application',
      name: row.name,
      phone: row.phone,
      extra: `${roleLabel}${ref ? ` (${ref})` : ''}${recorded.application ? '' : ' - NOT SAVED, see email'}`,
    }),
  )

  if (!recorded.application && !recorded.ownerNotified) {
    console.error(`careers apply: NOTHING recorded for an application from ${row.email}`)
    return NextResponse.json(
      { error: "We couldn't send your application just now. Please try again in a minute." },
      { status: 503 },
    )
  }
  if (!recorded.application || !recorded.ownerNotified) {
    console.warn(
      `careers apply: application from ${row.email} recorded with gaps —`,
      recorded.application ? 'owner alert missing' : 'row missing (the owner email is the only copy)',
    )
  }

  return NextResponse.json({ success: true, ref, recorded })
}
