/**
 * Slack user_id → who approved this (plan §25.6, §11.1).
 *
 * **This is the capability win of the phase, not the ergonomics.** Today an
 * approval from the admin UI writes the actor `'ADMIN'`, and with two people
 * working leads the ledger cannot say which of them sent a message to a
 * customer. §11.1 names that as a blocker. A Slack interaction arrives with a
 * `user.id` that Slack's own signature vouches for, so for the first time the
 * ledger can record a person.
 *
 * ── The fallback is deliberate, and it is not 'ADMIN' ─────────────────────
 *
 * `admin_users.slack_user_id` is NULL for all three rows until somebody fills
 * it in, so the mapping will miss at first. The miss must not cost us the
 * identity we already have: an unmapped reviewer is recorded as
 * `SLACK:U012ABCDEF` — still a specific, verified, non-repudiable person, just
 * one we cannot yet put a name to. Falling back to `'ADMIN'` would throw away
 * the only thing this phase was built to capture.
 *
 * The allowlist is what grants authority; this module only answers "who". A
 * user who is not in `SLACK_REVIEWER_USER_IDS` never reaches it.
 */

import { getSupabase } from '@/lib/supabase'

type Supa = ReturnType<typeof getSupabase>

export interface SlackActor {
  /** What goes in `marketing_ledger.actor`. */
  id: string
  /** Verified reviewers are admins — that is what the allowlist means. */
  isAdmin: true
  /** For a human-readable confirmation in the channel. */
  label: string
  /** The `admin_users` row, when the mapping resolved. */
  adminUserId: string | null
  /** True when no admin_users row carries this slack_user_id. */
  unmapped: boolean
}

/**
 * Resolve a VERIFIED Slack user id to a ledger actor. Never throws: a database
 * hiccup must not turn into a failed approval, it must turn into a
 * less-specific actor.
 *
 * `slackUserId` must come from the signature-verified payload. Passing a value
 * read out of message text would defeat §4.2, which is why this takes an id and
 * not a payload — there is nothing else in here for it to read.
 */
export async function resolveSlackActor(
  supabase: Supa,
  slackUserId: string,
  slackUserName?: string | null,
): Promise<SlackActor> {
  const fallbackLabel = slackUserName ? `@${slackUserName}` : slackUserId
  const fallback: SlackActor = {
    id: `SLACK:${slackUserId}`,
    isAdmin: true,
    label: fallbackLabel,
    adminUserId: null,
    unmapped: true,
  }
  if (!slackUserId) return fallback

  try {
    const { data, error } = await supabase
      .from('admin_users')
      .select('id, email, display_name, is_active')
      .eq('slack_user_id', slackUserId)
      .maybeSingle()

    if (error) {
      console.error('[slack-actor] admin_users lookup failed (non-fatal):', error.message)
      return fallback
    }
    if (!data) {
      console.warn(
        `[slack-actor] no admin_users row has slack_user_id=${slackUserId} — ` +
          `recording as ${fallback.id}. Set it to name this person in the ledger.`,
      )
      return fallback
    }

    const row = data as { id: string; email: string; display_name: string | null; is_active: boolean }

    // A deactivated admin is a person who was deliberately switched off. The
    // allowlist let them in, so the action proceeds — but the ledger says which
    // one it was, and the log says the two lists disagree. Removing them is an
    // env change (SLACK_REVIEWER_USER_IDS), and that is Adam's to make.
    if (!row.is_active) {
      console.warn(
        `[slack-actor] ${row.email} is in SLACK_REVIEWER_USER_IDS but admin_users.is_active is false`,
      )
    }

    return {
      id: `ADMIN:${row.email}`,
      isAdmin: true,
      label: row.display_name || row.email,
      adminUserId: row.id,
      unmapped: false,
    }
  } catch (err) {
    console.error('[slack-actor] threw (non-fatal):', err instanceof Error ? err.message : err)
    return fallback
  }
}
