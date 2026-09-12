import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { findContactsByEmail } from '@/lib/contactLookup'
import { logInteraction, type ContactInteractionType } from '@/lib/contactInteractions'

export const dynamic = 'force-dynamic'

/**
 * Brevo marketing webhook. https://developers.brevo.com/docs/transactional-webhooks
 *
 * This is one of only two writers of `contacts.email_opt_in = false`, and
 * `optedOutReason()` in the sequence processor reads that column before every
 * single marketing send. So a miss here is not a missing statistic — it is the
 * sequencer continuing to mail somebody who pressed Unsubscribe.
 *
 * It missed. Every lookup here was `.eq('email', …)`, which is case-SENSITIVE,
 * and Brevo posts the address back lowercased while **21 of our 1216 contacts
 * are stored with capitals** (measured 2026-09-12; seven of them are on an
 * active sequence enrollment). For those people an `unsubscribed` or
 * `hardBounce` event updated ZERO rows and the handler still answered
 * `{received: true}`. Resolved once, case-insensitively, and every write below
 * is by `id` — see `lib/contactLookup.ts`.
 */
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

  console.log(`brevo:webhook ${event} for ${maskEmail(String(email))}`)

  const lookup = await findContactsByEmail(supabase, String(email))
  if (lookup.kind === 'unavailable') {
    // Rule 12, and it matters on this route in particular: answering 200 to an
    // `unsubscribed` event we could not record means Brevo never redelivers it
    // and the opt-out is lost. A 500 is a retry.
    console.error(`brevo:webhook could not read contacts for ${event}: ${lookup.error}`)
    return NextResponse.json({ error: 'Could not process' }, { status: 500 })
  }
  if (lookup.kind === 'absent') {
    // Rule 10: a handler that did nothing must not look like a handler that
    // worked. Brevo's list holds 944 people and ours holds 1216, so this is an
    // ordinary outcome — but an `unsubscribed` we cannot attribute is worth a
    // line in the log, because it is an opt-out nothing recorded.
    console.warn(`brevo:webhook ${event} for an address with no contact row (${maskEmail(String(email))})`)
    return NextResponse.json({ received: true, matched: 0 })
  }

  const ids = lookup.contacts.map(c => c.id)

  /** Opt every matched row out of marketing email, by id. */
  const optOut = async (why: string): Promise<void> => {
    const { error } = await supabase.from('contacts').update({ email_opt_in: false }).in('id', ids)
    if (error) {
      console.error(`brevo:webhook FAILED to opt out ${maskEmail(String(email))} (${why}): ${error.message}`)
      return
    }
    console.log(`brevo:webhook opted out ${maskEmail(String(email))} (${why}, ${ids.length} row(s))`)
  }

  const log = async (type: ContactInteractionType, metadata: Record<string, unknown>): Promise<void> => {
    for (const id of ids) {
      await logInteraction(supabase, { contactId: id, type, metadata })
    }
  }

  const touchEngagement = async (): Promise<void> => {
    await supabase.from('contacts').update({ last_engaged_at: new Date().toISOString() }).in('id', ids)
  }

  try {
    if (event === 'unsubscribed' || event === 'unsubscribe') {
      await optOut('unsubscribed')
      await log('email_unsubscribed', { source: 'brevo', event })
    }

    if (event === 'hard_bounce' || event === 'hardBounce') {
      await optOut('hard bounce')
      await log('email_bounced', { source: 'brevo', event, bounce_type: 'hard' })
    }

    if (event === 'soft_bounce' || event === 'softBounce') {
      await log('email_bounced', { source: 'brevo', event, bounce_type: 'soft' })

      // Three soft bounces for THIS contact and the address is treated as dead.
      const { count, error } = await supabase
        .from('contact_interactions')
        .select('*', { count: 'exact', head: true })
        .in('contact_id', ids)
        .eq('type', 'email_bounced')

      if (error) {
        console.error(`brevo:webhook could not count bounces for ${maskEmail(String(email))}: ${error.message}`)
      } else if (count && count >= 3) {
        await optOut(`${count} soft bounces`)
      }
    }

    if (event === 'opened' || event === 'open') {
      await touchEngagement()
      await log('email_opened', { source: 'brevo', campaign_id: body.tag || body['campaign id'] })
    }

    if (event === 'clicked' || event === 'click') {
      await touchEngagement()
      await log('email_clicked', {
        source: 'brevo',
        campaign_id: body.tag || body['campaign id'],
        link: body.link,
      })
    }
  } catch (err) {
    console.error('brevo:webhook error:', err)
  }

  return NextResponse.json({ received: true, matched: ids.length })
}

function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at <= 1) return '***'
  return `${email[0]}***${email.slice(at)}`
}
