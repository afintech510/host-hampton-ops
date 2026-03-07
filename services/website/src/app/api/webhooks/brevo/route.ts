import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Brevo webhook events: https://developers.brevo.com/docs/transactional-webhooks
export async function POST(req: NextRequest) {
  const supabase = getSupabase()

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const event = body.event
  const email = body.email

  if (!event || !email) {
    return NextResponse.json({ error: 'Missing event or email' }, { status: 400 })
  }

  console.log(`brevo:webhook ${event} for ${email}`)

  try {
    if (event === 'unsubscribed' || event === 'unsubscribe') {
      // Opt out of email marketing
      await supabase
        .from('contacts')
        .update({ email_opt_in: false })
        .eq('email', email)

      await logInteraction(supabase, email, 'email_unsubscribed', { source: 'brevo', event })
    }

    if (event === 'hard_bounce' || event === 'hardBounce') {
      // Hard bounce — disable email
      await supabase
        .from('contacts')
        .update({ email_opt_in: false })
        .eq('email', email)

      await logInteraction(supabase, email, 'email_bounced', { source: 'brevo', event, bounce_type: 'hard' })
    }

    if (event === 'soft_bounce' || event === 'softBounce') {
      // Look up contact first so we can scope the bounce count
      const { data: contact } = await supabase
        .from('contacts')
        .select('id')
        .eq('email', email)
        .single()

      await logInteraction(supabase, email, 'email_bounced', { source: 'brevo', event, bounce_type: 'soft' })

      // Check if 3+ soft bounces for THIS contact — then disable
      if (contact) {
        const { count } = await supabase
          .from('contact_interactions')
          .select('*', { count: 'exact', head: true })
          .eq('contact_id', contact.id)
          .eq('interaction_type', 'email_bounced')

        if (count && count >= 3) {
          await supabase
            .from('contacts')
            .update({ email_opt_in: false })
            .eq('id', contact.id)
          console.log(`brevo:webhook disabled email for ${email} after ${count} soft bounces`)
        }
      }
    }

    if (event === 'opened' || event === 'open') {
      await supabase
        .from('contacts')
        .update({ last_engaged_at: new Date().toISOString() })
        .eq('email', email)

      await logInteraction(supabase, email, 'email_opened', {
        source: 'brevo',
        campaign_id: body.tag || body['campaign id'],
      })
    }

    if (event === 'clicked' || event === 'click') {
      await supabase
        .from('contacts')
        .update({ last_engaged_at: new Date().toISOString() })
        .eq('email', email)

      await logInteraction(supabase, email, 'email_clicked', {
        source: 'brevo',
        campaign_id: body.tag || body['campaign id'],
        link: body.link,
      })
    }
  } catch (err) {
    console.error('brevo:webhook error:', err)
  }

  return NextResponse.json({ received: true })
}

async function logInteraction(supabase: any, email: string, type: string, metadata: Record<string, any>) {
  const { data: contact } = await supabase
    .from('contacts')
    .select('id')
    .eq('email', email)
    .single()

  if (!contact) return

  await supabase.from('contact_interactions').insert({
    contact_id: contact.id,
    interaction_type: type,
    metadata,
  }).catch((err: any) => console.error('brevo:log error:', err))
}
