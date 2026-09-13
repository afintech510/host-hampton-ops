/**
 * The Slack Web API client (plan §25.8 step 3).
 *
 * Four calls, one rule: **every function in this module returns `null` or
 * `false` on failure and never throws at a caller.**
 *
 * That rule is not politeness, it is §25.5's delivery order made enforceable.
 * The reviewer notification has to survive Slack being down, because the thing
 * on the other end of it is a real lead waiting for an answer — the §18
 * Eleonore failure. If `postMessage` could throw, every caller would need a
 * try/catch and the one that forgot would take a lead down with it. So the
 * failure is absorbed here, once, and the caller's fallback is an `if (!res)`.
 *
 * ── Slack's failures are 200 OK ──────────────────────────────────────────
 *
 * This is the trap this module exists to close. The Web API answers HTTP 200
 * with `{"ok": false, "error": "not_in_channel"}` for most real failures:
 *
 *   not_in_channel     the bot was never /invite'd to #hh-leads
 *   channel_not_found  SLACK_LEADS_CHANNEL is a name, not an ID, or is wrong
 *   invalid_auth       the token was revoked or reinstalled
 *   missing_scope      the manifest changed but the app was not reinstalled
 *
 * A client that checked `res.ok` on the *fetch* would call every one of those a
 * success, mark the draft as posted to Slack, skip the SMS fallback, and the
 * lead would go silent — with a 200 in the logs saying it worked. That is rule
 * 17 again: "posted" and "refused" look identical from outside unless something
 * reads the body and says. So the body's `ok` is the only thing that counts,
 * and the `error` string is logged by name.
 *
 * ── Timeouts ─────────────────────────────────────────────────────────────
 *
 * Every call is bounded. `draftForInquiry` awaits the reviewer notification
 * inside a cron request; an un-timed-out fetch to a degraded Slack would hold
 * that request until the platform killed it, and the SMS — the part that is not
 * best-effort — would never be reached. A slow Slack must cost us the
 * formatting, not the ping.
 */

/** Bounded so a degraded Slack cannot hold a cron request open. */
const SLACK_TIMEOUT_MS = 6000

const API_BASE = 'https://slack.com/api'

export function slackBotToken(): string {
  return process.env.SLACK_BOT_TOKEN?.trim() || ''
}

/** The one channel, `#hh-leads` (§25.4 — one channel, party type as a tag). */
export function slackLeadsChannel(): string {
  return process.env.SLACK_LEADS_CHANNEL?.trim() || ''
}

/**
 * Is Slack usable at all? Both halves are required: a token with no channel has
 * nowhere to post, and a channel with no token cannot authenticate.
 *
 * `notifyReviewers` consults this BEFORE trying, so an unconfigured install
 * takes the SMS path directly instead of spending a doomed round trip on every
 * draft.
 */
export function slackConfigured(): boolean {
  return !!slackBotToken() && !!slackLeadsChannel()
}

export interface SlackPostResult {
  channel: string
  /** Slack's opaque message id. TEXT, not a timestamp — it is the thread key. */
  ts: string
}

/**
 * One POST to the Web API. The single place a Slack error can be produced, so
 * the `ok`-in-the-body rule is enforced once rather than per call site.
 */
async function call(method: string, body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const token = slackBotToken()
  if (!token) {
    console.error(`[slack] ${method}: SLACK_BOT_TOKEN is unset — not calling`)
    return null
  }
  try {
    const res = await fetch(`${API_BASE}/${method}`, {
      method: 'POST',
      headers: {
        // The token is never logged, here or in any branch below.
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
    })

    // A non-2xx is rare (429 and 5xx are the real ones) but still has to be
    // caught before we try to read an `ok` that is not there.
    if (!res.ok) {
      console.error(`[slack] ${method}: HTTP ${res.status}`)
      return null
    }

    const json = (await res.json()) as Record<string, unknown>
    // THE CHECK. See the header — this is what a 200 from Slack does not tell
    // you. `error` is logged by name because 'not_in_channel' is a one-line fix
    // (/invite the bot) and an unnamed failure is an afternoon.
    if (json?.ok !== true) {
      console.error(`[slack] ${method} refused: ${String(json?.error ?? 'unknown')}`)
      return null
    }
    return json
  } catch (err) {
    // Includes the AbortError from the timeout above.
    console.error(`[slack] ${method} threw (non-fatal):`, err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Post a message. `threadTs` replies in an existing thread, which is what makes
 * "one thread per lead" real: a revision belongs under the draft it revises,
 * not as a new top-level message three hours down the channel.
 *
 * `text` is required even when `blocks` are supplied — it is what appears in
 * the push notification on a phone and in the notification-only clients, and a
 * blocks-only message reads as "This content can't be displayed" there. That is
 * the *only* place a reviewer might see this message at 9pm, so it carries the
 * review code and the summary rather than "New lead".
 */
export async function postMessage(opts: {
  channel?: string
  text: string
  blocks?: unknown[]
  threadTs?: string | null
}): Promise<SlackPostResult | null> {
  const channel = opts.channel || slackLeadsChannel()
  if (!channel) {
    console.error('[slack] postMessage: SLACK_LEADS_CHANNEL is unset — not posting')
    return null
  }
  const json = await call('chat.postMessage', {
    channel,
    text: opts.text,
    ...(opts.blocks ? { blocks: opts.blocks } : {}),
    ...(opts.threadTs ? { thread_ts: opts.threadTs } : {}),
    // Slack renders <https://…|label> itself; letting it also "unfurl" a
    // hosthampton.com link would paste a page preview of a REVIEW PAGE — a
    // bearer-token URL — into the channel as an image. Off.
    unfurl_links: false,
    unfurl_media: false,
  })
  if (!json) return null
  const ts = typeof json.ts === 'string' ? json.ts : null
  const ch = typeof json.channel === 'string' ? json.channel : channel
  if (!ts) {
    console.error('[slack] postMessage: ok:true but no ts in the response')
    return null
  }
  return { channel: ch, ts }
}

/**
 * Edit a message that is already in the channel. Used to strike the buttons off
 * an approved draft.
 *
 * This matters more than it looks: without it the Approve button stays live
 * under a message that has already gone to the customer, and the second press
 * — by the other reviewer, who cannot see that the first one happened — reads
 * as a fresh approval. The handler refuses it, but a button that does nothing
 * is a worse answer than a button that is not there.
 */
export async function updateMessage(opts: {
  channel: string
  ts: string
  text: string
  blocks?: unknown[]
}): Promise<boolean> {
  const json = await call('chat.update', {
    channel: opts.channel,
    ts: opts.ts,
    text: opts.text,
    ...(opts.blocks ? { blocks: opts.blocks } : {}),
  })
  return !!json
}

/**
 * A durable link to a posted message (§25.5 step 2), ~78 characters raw, which
 * is why it then goes through `/s/`.
 *
 * `chat.getPermalink` is a GET with query parameters rather than a JSON POST,
 * so it does not go through `call()`. The `ok`-in-the-body rule still applies
 * and is repeated here rather than shared, because sharing it would mean a
 * second code path through `call()` that only this one function uses.
 */
export async function getPermalink(channel: string, messageTs: string): Promise<string | null> {
  const token = slackBotToken()
  if (!token) return null
  try {
    const url = `${API_BASE}/chat.getPermalink?channel=${encodeURIComponent(channel)}&message_ts=${encodeURIComponent(messageTs)}`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
    })
    if (!res.ok) {
      console.error(`[slack] getPermalink: HTTP ${res.status}`)
      return null
    }
    const json = (await res.json()) as Record<string, unknown>
    if (json?.ok !== true) {
      console.error(`[slack] getPermalink refused: ${String(json?.error ?? 'unknown')}`)
      return null
    }
    return typeof json.permalink === 'string' ? json.permalink : null
  } catch (err) {
    console.error('[slack] getPermalink threw (non-fatal):', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Open a modal. `trigger_id` is valid for **3 seconds** from the interaction,
 * which is the whole reason the interactions handler answers Slack first and
 * does its database work after: a modal opened on the far side of two Supabase
 * round trips is a modal that fails with `expired_trigger_id`.
 */
export async function openView(triggerId: string, view: Record<string, unknown>): Promise<boolean> {
  const json = await call('views.open', { trigger_id: triggerId, view })
  return !!json
}

/**
 * Reply to an interaction on its `response_url`.
 *
 * Deliberately NOT through `call()`: a response_url is a pre-authorised
 * one-time webhook and takes no token, it answers `ok` as a plain-text body
 * rather than JSON, and sending our bot token to a URL that does not need it
 * would be handing out a credential for no reason.
 *
 * `ephemeral` means only the reviewer who pressed the button sees it, which is
 * right for "working on it" and wrong for "this went to the customer".
 */
export async function respondToInteraction(
  responseUrl: string,
  opts: { text: string; ephemeral?: boolean; threadTs?: string | null },
): Promise<boolean> {
  if (!responseUrl || !/^https:\/\/hooks\.slack\.com\//.test(responseUrl)) {
    // The response_url arrives inside a payload we have already verified, so
    // this is belt and braces — but it is a URL from a request, and posting to
    // a URL from a request without screening it is how an SSRF starts.
    console.error('[slack] respondToInteraction: refusing a non-Slack response_url')
    return false
  }
  try {
    const res = await fetch(responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        text: opts.text,
        response_type: opts.ephemeral === false ? 'in_channel' : 'ephemeral',
        ...(opts.threadTs ? { thread_ts: opts.threadTs } : {}),
      }),
      signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
    })
    if (!res.ok) {
      console.error(`[slack] respondToInteraction: HTTP ${res.status}`)
      return false
    }
    return true
  } catch (err) {
    console.error('[slack] respondToInteraction threw (non-fatal):', err instanceof Error ? err.message : err)
    return false
  }
}
