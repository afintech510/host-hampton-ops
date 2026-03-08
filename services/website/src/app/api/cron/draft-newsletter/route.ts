import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { eventNewsletterHtml } from '@/lib/email-templates/event-newsletter'

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

    const data = await res.json() as { content: { type: string; text: string }[] }
    const text = data.content[0]?.type === 'text' ? data.content[0].text : ''
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
    return NextResponse.json({ message: 'No upcoming events to feature', drafted: false })
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
  const copy = await generateCopy(templateEvents.map(e => ({ title: e.title, date: e.date, price: e.price })))

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
  })
}
