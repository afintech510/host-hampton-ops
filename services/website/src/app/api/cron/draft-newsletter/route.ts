import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { eventNewsletterHtml } from '@/lib/email-templates/event-newsletter'
import {
  containsFabricatedTerms,
  containsForeignContact,
  NO_AMOUNTS_ALLOWED,
} from '@/lib/agent/draftGuards'
import { containsMarkup } from '@/lib/content/contentSafety'
import { flattenToOneLine } from '@/lib/agent/extractPlanFields'

export const dynamic = 'force-dynamic'

function isCronAuthorized(req: NextRequest): boolean {
  const secret = req.headers.get('x-cron-secret') || req.nextUrl.searchParams.get('secret')
  return secret === process.env.CRON_SECRET
}

const COPY_SYSTEM_PROMPT = `You are COPY, the content writing agent for Host Hampton — a boutique celebration studio in Speonk, NY run by Allie Larkin.

BRAND VOICE:
- Warm, fun, community-first. Never corporate or pushy.
- Use "we" — not "I". Speak directly to the reader as "you".
- Conversational but polished. Celebrate the moment. Make it feel real.
- NEVER say: "amazing", "incredible", "game-changer", "perfect", "seamless", "effortless"
- DO say: "beautiful", "real", "genuine", "we love", "your crew", "the good stuff"

Respond ONLY with valid JSON — no markdown, no extra text.`

interface CopyResult {
  subject: string
  intro: string
}

/**
 * Refuse model prose that states money, promises a concession, or carries a
 * link/handle that is not ours. A refusal drops back to the static copy — the
 * newsletter still goes out, it just goes out in words a human wrote — and the
 * reason is named, never silent (hard-won rule 10).
 */
function screenCopy(copy: CopyResult | null, notes: string[]): CopyResult | null {
  if (!copy) return null

  const subject = typeof copy.subject === 'string' ? flattenToOneLine(copy.subject) : ''
  const intro = typeof copy.intro === 'string' ? copy.intro : ''
  if (!subject || !intro) {
    notes.push('reply was missing a subject or an intro')
    return null
  }

  for (const [label, text] of [['subject', subject], ['intro', intro]] as const) {
    const money = containsFabricatedTerms(text, { allowedAmounts: NO_AMOUNTS_ALLOWED })
    if (money) {
      notes.push(`${label} states ${money}`)
      return null
    }
    const foreign = containsForeignContact(text)
    if (foreign) {
      notes.push(`${label} carries a ${foreign}`)
      return null
    }
    if (containsMarkup(text)) {
      notes.push(`${label} contains markup`)
      return null
    }
  }

  return { subject, intro }
}

/** See rule 1. Find the first block that IS text, not whichever is first. */
function firstTextBlock(content: unknown): string {
  if (!Array.isArray(content)) return ''
  for (const block of content) {
    if (block && typeof block === 'object' && (block as { type?: string }).type === 'text') {
      const t = (block as { text?: unknown }).text
      if (typeof t === 'string') return t
    }
  }
  return ''
}

async function generateCopy(
  events: { title: string; date: string; price: string }[]
): Promise<CopyResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.warn('cron:newsletter — ANTHROPIC_API_KEY not set, skipping AI copy')
    return null
  }

  const eventList = events.map(e => `- ${e.title} (${e.date}, ${e.price})`).join('\n')

  const userPrompt = `Write newsletter copy for these upcoming Host Hampton events:
${eventList}

Respond with JSON:
{
  "subject": "email subject line, max 55 chars, no emojis, warm & specific",
  "intro": "2-3 sentence intro paragraph (plain text, no HTML). Warm, conversational. Mention 1-2 events by name. End with a light CTA to grab a spot."
}`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: COPY_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })

    if (!res.ok) {
      console.error('cron:newsletter claude error:', res.status, await res.text())
      return null
    }

    const data = await res.json() as { content?: unknown }
    // Hard-won rule 1: `content[0]` is not necessarily the text — with extended
    // thinking it is a `thinking` block, and reading index 0 then yields '' and
    // fails as "no JSON" rather than as the config change it really is.
    const text = firstTextBlock(data.content)
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null

    return JSON.parse(jsonMatch[0]) as CopyResult
  } catch (err) {
    console.error('cron:newsletter claude exception:', err)
    return null
  }
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getSupabase()
  const today = new Date().toISOString().split('T')[0]

  // Archive past events (set is_active=false where event_date < today)
  const { data: archivedRows } = await supabase
    .from('events')
    .update({ is_active: false })
    .eq('is_active', true)
    .lt('event_date', today)
    .select('id')
  const archivedCount = archivedRows?.length ?? 0

  if (archivedCount) {
    console.log(`cron:newsletter archived ${archivedCount} past event(s)`)
  }

  const futureDate = new Date()
  futureDate.setDate(futureDate.getDate() + 21)
  const endDate = futureDate.toISOString().split('T')[0]

  const { data: events, error } = await supabase
    .from('events')
    .select('title, slug, event_date, event_time, price_cents, images, image_url')
    .eq('is_active', true)
    .gte('event_date', today)
    .lte('event_date', endDate)
    .order('event_date')
    .limit(8)

  if (error) {
    console.error('cron:newsletter fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch events' }, { status: 500 })
  }

  if (!events?.length) {
    return NextResponse.json({ message: 'No upcoming events to feature', drafted: false, archived: archivedCount || 0 })
  }

  // Don't draft on top of a draft nobody has looked at.
  //
  // Measured 2026-09-12: this job ran daily at 11:00 UTC and left **17
  // `event_update` drafts** in `scheduled_campaigns` between 2026-07-01 and
  // 2026-07-17, seven of them for the same Bitchy Bingo event with seven
  // different subject lines. Not one was ever sent. A review queue that grows by
  // one unread item a day is a review queue nobody reads — the same failure the
  // Inbox triage fix (plan, `cf6ddcc`) was written for, one surface over.
  //
  // A read failure does NOT fall through to drafting: "could not tell" is not
  // "there is nothing there" (rule 12), and drafting on an unreadable table is
  // exactly how the pile above accumulated.
  const { data: openDrafts, error: openErr } = await supabase
    .from('scheduled_campaigns')
    .select('id, created_at')
    .eq('campaign_type', 'event_update')
    .in('status', ['draft', 'scheduled'])
    .order('created_at', { ascending: false })
    .limit(1)

  if (openErr) {
    console.error('cron:newsletter could not check for an existing draft:', openErr.message)
    return NextResponse.json(
      { error: `Could not check for an existing draft: ${openErr.message}`, drafted: false },
      { status: 503 }
    )
  }

  if (openDrafts && openDrafts.length > 0) {
    console.log(`cron:newsletter skipped — draft ${openDrafts[0].id} is still waiting for review`)
    return NextResponse.json({
      drafted: false,
      skipped: 'an event_update draft is already waiting for review',
      existingDraftId: openDrafts[0].id,
      existingDraftCreatedAt: openDrafts[0].created_at,
      archived: archivedCount || 0,
    })
  }

  // Format events for the template
  const templateEvents = events.map(e => {
    const imgs = (e.images as any[]) || []
    const primary = imgs.find((i: any) => i.is_primary) || imgs[0]
    const imageUrl = primary?.url || e.image_url || undefined

    const dateDisplay = e.event_date
      ? new Date(e.event_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
      : 'TBD'

    const price = e.price_cents === 0
      ? 'Free'
      : `$${(e.price_cents / 100).toFixed(e.price_cents % 100 === 0 ? 0 : 2)}`

    return {
      title: e.title,
      date: dateDisplay,
      time: e.event_time || '',
      price,
      imageUrl,
      ticketUrl: `https://www.hosthampton.com/events/${e.slug}`,
    }
  })

  // Generate AI copy via COPY agent (Claude Haiku — fast + cheap)
  const rawCopy = await generateCopy(templateEvents.map(e => ({ title: e.title, date: e.date, price: e.price })))

  // Screen the model's prose before it can reach 944 real inboxes. The event
  // CARDS carry real ticket prices from the DB and that is fine — what is not
  // fine is the model inventing a figure, a discount or a link in the intro it
  // writes. Same screens the agent's drafts use, imported not restated (rule 11).
  const screenNotes: string[] = []
  const copy = screenCopy(rawCopy, screenNotes)
  for (const n of screenNotes) console.warn(`cron:newsletter dropped model copy — ${n}`)

  const subject = copy?.subject ?? `What's Coming Up at Host Hampton | ${templateEvents[0].date}`
  const html = eventNewsletterHtml({
    events: templateEvents,
    intro: copy?.intro,
  })

  // Save as draft campaign
  const { data: campaign, error: insertErr } = await supabase
    .from('scheduled_campaigns')
    .insert({
      campaign_type: 'event_update',
      subject,
      body_html: html,
      target_segment: 'email_opted_in',
      status: 'draft',
    })
    .select('id')
    .single()

  if (insertErr) {
    console.error('cron:newsletter insert error:', insertErr)
    return NextResponse.json({ error: 'Failed to save draft' }, { status: 500 })
  }

  console.log('Newsletter draft created:', campaign?.id, '| AI copy:', !!copy, '| events:', templateEvents.length)
  return NextResponse.json({
    drafted: true,
    campaignId: campaign?.id,
    eventsCount: templateEvents.length,
    aiCopy: !!copy,
    archived: archivedCount || 0,
  })
}
