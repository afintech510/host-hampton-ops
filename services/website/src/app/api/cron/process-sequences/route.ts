import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { getSupabase } from '@/lib/supabase'
import { renderTemplate } from '@/lib/sequences'

export const dynamic = 'force-dynamic'

function isCronAuthorized(req: NextRequest): boolean {
  const secret = req.headers.get('x-cron-secret') || req.nextUrl.searchParams.get('secret')
  return secret === process.env.CRON_SECRET
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getSupabase()
  const now = new Date()

  // Fetch active enrollments with their sequence info
  const { data: enrollments, error } = await supabase
    .from('contact_sequence_enrollments')
    .select(`
      id, contact_id, sequence_id, current_step, enrolled_at, last_sent_at, metadata,
      email_sequences!inner(id, total_emails, is_active)
    `)
    .eq('status', 'active')
    .limit(50)

  if (error || !enrollments) {
    console.error('cron:sequences fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch enrollments' }, { status: 500 })
  }

  if (enrollments.length === 0) {
    return NextResponse.json({ processed: 0 })
  }

  let sent = 0
  let skipped = 0
  let failed = 0

  for (const enrollment of enrollments) {
    try {
      const seq = enrollment.email_sequences as any
      if (!seq?.is_active) {
        skipped++
        continue
      }

      const nextStepNum = enrollment.current_step + 1

      // Check if sequence is complete
      if (nextStepNum > seq.total_emails) {
        await supabase
          .from('contact_sequence_enrollments')
          .update({ status: 'completed', completed_at: now.toISOString() })
          .eq('id', enrollment.id)
        skipped++
        continue
      }

      // Fetch the next step
      const { data: step } = await supabase
        .from('email_sequence_steps')
        .select('*')
        .eq('sequence_id', enrollment.sequence_id)
        .eq('step_number', nextStepNum)
        .single()

      if (!step) {
        // Step missing — mark complete
        await supabase
          .from('contact_sequence_enrollments')
          .update({ status: 'completed', completed_at: now.toISOString() })
          .eq('id', enrollment.id)
        skipped++
        continue
      }

      // Determine if step is due
      const meta = (enrollment.metadata || {}) as Record<string, string>
      let referenceDate: Date

      if (step.delay_reference === 'event_date' && meta.event_date) {
        referenceDate = new Date(meta.event_date + 'T12:00:00')
      } else if (nextStepNum === 1) {
        referenceDate = new Date(enrollment.enrolled_at)
      } else {
        referenceDate = enrollment.last_sent_at
          ? new Date(enrollment.last_sent_at)
          : new Date(enrollment.enrolled_at)
      }

      const dueDate = new Date(referenceDate)
      dueDate.setDate(dueDate.getDate() + step.delay_days)

      if (now < dueDate) {
        skipped++
        continue
      }

      // Fetch contact info for template rendering and sending
      const { data: contact } = await supabase
        .from('contacts')
        .select('email, first_name, email_opt_in')
        .eq('id', enrollment.contact_id)
        .single()

      if (!contact || !contact.email_opt_in) {
        // Contact doesn't exist or opted out — cancel enrollment
        await supabase
          .from('contact_sequence_enrollments')
          .update({ status: 'unsubscribed' })
          .eq('id', enrollment.id)
        skipped++
        continue
      }

      // Render and send email
      const html = renderTemplate(step.body_html, {
        firstName: contact.first_name || undefined,
      })

      if (!process.env.RESEND_API_KEY) {
        console.warn('RESEND_API_KEY not set — skipping sequence email')
        skipped++
        continue
      }

      const resend = new Resend(process.env.RESEND_API_KEY)
      const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'

      const { error: sendErr } = await resend.emails.send({
        from,
        to: contact.email,
        subject: renderTemplate(step.subject, { firstName: contact.first_name || undefined }),
        html,
      })

      if (sendErr) {
        console.error(`Sequence email send error for ${contact.email}:`, sendErr)
        failed++
        continue
      }

      // Update enrollment
      const isComplete = nextStepNum >= seq.total_emails
      await supabase
        .from('contact_sequence_enrollments')
        .update({
          current_step: nextStepNum,
          last_sent_at: now.toISOString(),
          ...(isComplete ? { status: 'completed', completed_at: now.toISOString() } : {}),
        })
        .eq('id', enrollment.id)

      // Log interaction
      await supabase.from('contact_interactions').insert({
        contact_id: enrollment.contact_id,
        type: 'sequence_email_sent',
        summary: `Sequence step ${nextStepNum}: ${step.subject}`,
        metadata: {
          sequence_id: enrollment.sequence_id,
          step_number: nextStepNum,
          subject: step.subject,
        },
      }).then(() => {})

      sent++
      console.log(`Sequence email sent: ${contact.email} step ${nextStepNum}/${seq.total_emails}`)
    } catch (err) {
      console.error('cron:sequence processing error:', enrollment.id, err)
      failed++
    }
  }

  console.log(`cron:sequences processed — sent=${sent} skipped=${skipped} failed=${failed}`)
  return NextResponse.json({ processed: enrollments.length, sent, skipped, failed })
}
