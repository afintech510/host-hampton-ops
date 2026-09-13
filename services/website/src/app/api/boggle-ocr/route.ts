import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { guardRate, costlyRule } from '@/lib/rateLimit'

/**
 * Read a word-game letter grid out of a screenshot.
 *
 * ── WHY THIS IS NOW ADMIN-ONLY ──
 *
 * It was completely unauthenticated and it spends `ANTHROPIC_API_KEY` on every
 * call: an arbitrary caller-supplied base64 image, billed per image token, with no
 * size limit, no call limit, no budget check and no ledger row. Nothing in the
 * site links to `/boggle` — it is an unlisted utility page, not a customer
 * feature — and the box it runs on took **222 probes for `/.env` in the last ten
 * days**, so "nobody knows it is there" is not a control. Three requests reached
 * it in that window and all three answered 502, which is how an open door to a
 * paid API looks when it is not yet being used deliberately.
 *
 * Every other model call in this codebase goes through
 * `lib/marketing/budget.ts`'s monthly cap. This one deliberately does not spend
 * against that cap instead of being gated, because the cap exists for the
 * marketing pipeline and letting strangers' OCR starve the real drafts would be a
 * worse failure than a gate. `/boggle` now needs an admin session — sign in to
 * `/admin` in the same browser and the page works. If Adam wants it public again
 * that is a one-line decision, taken knowingly.
 *
 * Also fixed: the route returned the Anthropic API's raw error body to the caller,
 * which is provider detail an unauthenticated caller has no business seeing.
 */

export const dynamic = 'force-dynamic'

/** Roughly 1.5 MB of image after base64 expansion — far more than a screenshot. */
const MAX_BASE64_CHARS = 2_000_000

const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const limited = guardRate(req, costlyRule('boggle-ocr', 20, 60))
  if (limited) return limited

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }

  try {
    const { base64, mimeType } = await req.json()
    if (!base64 || !mimeType) {
      return NextResponse.json({ error: 'Missing base64 or mimeType' }, { status: 400 })
    }
    if (typeof base64 !== 'string' || base64.length > MAX_BASE64_CHARS) {
      return NextResponse.json({ error: 'Image too large' }, { status: 413 })
    }
    if (typeof mimeType !== 'string' || !ALLOWED_MIME.includes(mimeType)) {
      return NextResponse.json({ error: `mimeType must be one of ${ALLOWED_MIME.join(', ')}` }, { status: 400 })
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1000,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mimeType, data: base64 },
              },
              {
                type: 'text',
                text: 'Extract the letter grid from this word game screenshot. Output ONLY the grid as rows of letters separated by spaces, one row per line. No other text. IMPORTANT: If a tile shows "Qu" (Q and u together on one tile), output it as "Qu" — do NOT split it into separate letters. Example format:\nA B C Qu E F\nG H I J K L\nM N O P R S',
              },
            ],
          },
        ],
      }),
    })

    if (!res.ok) {
      // Logged in full, returned as a status only.
      const err = await res.text()
      console.error(`boggle-ocr: Anthropic API ${res.status}: ${err.slice(0, 500)}`)
      return NextResponse.json({ error: `Could not read that image (upstream ${res.status})` }, { status: 502 })
    }

    const data = await res.json()
    const text = data.content
      ?.filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text)
      .join('\n') ?? ''

    return NextResponse.json({ grid: text.trim() })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error('boggle-ocr error:', msg)
    return NextResponse.json({ error: 'Could not read that image' }, { status: 500 })
  }
}
