/**
 * Block Kit — what a reviewer actually sees (plan §25.8 step 3).
 *
 * ── Escaping, at entry ───────────────────────────────────────────────────
 *
 * Slack `mrkdwn` is not plain text. Three characters are structural — `&`, `<`
 * and `>` — and `<` is the one that matters, because `<url|label>` is how a
 * link is written. A draft is model-written text about a customer, so the
 * hostile and the merely awkward arrive through the same door:
 *
 *   a customer called "Ben & Jerry's"        → renders wrong
 *   a draft containing "<https://evil.test|click here>"
 *                                            → renders as a LINK a reviewer
 *                                              might press, written by
 *                                              whoever wrote the inquiry
 *
 * That second one is the same shape as the injected payment handle §24 found in
 * a voice profile: untrusted text reaching a trusted surface. So `esc()` is
 * applied at ENTRY — every value that comes from a draft, a customer, or a
 * model goes through it as it enters a block, not somewhere downstream where a
 * later edit can route around it. Same rule as lib/mailTemplates.ts.
 *
 * The links WE build are assembled from `esc()`ed labels and a URL we minted,
 * so they are the only `<…|…>` in the output.
 *
 * ── Slack's limits are rejections, not truncations ───────────────────────
 *
 * Over-long text does not get trimmed by Slack, it gets the whole message
 * refused with `invalid_blocks` — which under the fail-soft client reads as
 * "Slack was down" and silently falls back to SMS forever. A 3000-character
 * email draft is not unusual, so the caps below are load-bearing.
 */

/** Slack's documented maxima for the fields used here. */
const SECTION_TEXT_MAX = 3000
const HEADER_TEXT_MAX = 150
const BUTTON_TEXT_MAX = 75

/**
 * Escape the three characters that are structural in Slack mrkdwn.
 *
 * `&` MUST be first — escaping it after `<` would turn the `&lt;` just produced
 * into `&amp;lt;`. The identical ordering bug, in the identical shape, is why
 * escapeHtml in lib/mailTemplates.ts has the same comment.
 */
export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Escape and cap, with a marker so a reader knows the text continues. */
function escCap(s: unknown, max: number): string {
  const e = esc(s)
  return e.length <= max ? e : e.slice(0, max - 3) + '...'
}

/* ── Action ids ─────────────────────────────────────────────────────────
 *
 * Exported constants rather than string literals at the call sites: the
 * interactions handler switches on these, and a typo in one of two places
 * would be a button that silently does nothing — which is indistinguishable
 * from a button that is not wired up yet.
 */
export const ACTION_APPROVE = 'hh_approve'
export const ACTION_CANCEL = 'hh_cancel'
export const ACTION_TEST = 'hh_test'
export const ACTION_EDIT = 'hh_edit'

/** The modal's callback_id and the id of the one input inside it. */
export const EDIT_MODAL_CALLBACK = 'hh_edit_modal'
export const EDIT_BLOCK_ID = 'hh_edit_block'
export const EDIT_INPUT_ID = 'hh_edit_input'

/**
 * What a button carries: which draft, and the code for the human-readable
 * confirmation.
 *
 * This is an IDENTIFIER, not an instruction — the handler re-reads the draft
 * from Supabase and re-checks its status. It has to: a `value` is round-tripped
 * through Slack, and §4.2's rule is that authority comes from the verified
 * `user.id`, never from anything travelling with the message. A forged value
 * could at most name a different draft, which is why the allowlist check comes
 * first and the status check comes second.
 */
export interface DraftActionValue {
  draftId: string
  reviewCode: string
}

export function encodeActionValue(v: DraftActionValue): string {
  return JSON.stringify(v)
}

export function decodeActionValue(raw: unknown): DraftActionValue | null {
  if (typeof raw !== 'string') return null
  try {
    const v = JSON.parse(raw) as Partial<DraftActionValue>
    if (typeof v?.draftId !== 'string' || !v.draftId) return null
    return { draftId: v.draftId, reviewCode: typeof v.reviewCode === 'string' ? v.reviewCode : '' }
  } catch {
    return null
  }
}

/* ── The draft message ──────────────────────────────────────────────────── */

export interface DraftMessageOpts {
  draftId: string
  reviewCode: string
  partyType: string
  path: 'info_gather' | 'quote'
  /** One-line summary for a human — the same string the SMS carries. */
  summary: string
  /** The email body as drafted. Shown in full so Slack replaces the /review/ page. */
  emailDraft?: string | null
  smsDraft?: string | null
  missing?: string[]
  /** A guardrail hit. When present the draft is PARKED and has no buttons. */
  warning?: string | null
  /** Link to the full review page. Short or long — the caller decides. */
  reviewUrl?: string | null
  revision?: boolean
}

/**
 * The notification a reviewer reads. Deliberately carries the DRAFT ITSELF
 * rather than a link to it: §25.1's third measurement was that the SMS sent the
 * draft twice, and the answer there was to drop the inline copy and keep the
 * link. Here it is the other way round — Slack has no per-segment bill and no
 * 160-character line, so the whole point of moving to it is that a reviewer can
 * read and approve without leaving the app. The link stays for the things the
 * page does that a message cannot (the thread, the plan fields, the history).
 */
export function draftMessageBlocks(opts: DraftMessageOpts): unknown[] {
  const parked = !!opts.warning
  const tag = opts.partyType.replace(/_/g, ' ')
  const kind = opts.path === 'quote' ? 'quote' : 'info-gather'
  const head = parked
    ? `DRAFT HELD - needs you`
    : opts.revision
      ? `revised ${kind} draft`
      : `${kind} draft ready`

  const blocks: unknown[] = [
    {
      type: 'header',
      // plain_text, so mrkdwn is not interpreted here at all — but it is still
      // escaped, because a header is not a safe place to find out otherwise.
      text: { type: 'plain_text', text: escCap(`${opts.reviewCode} — ${head}`, HEADER_TEXT_MAX), emoji: false },
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `*${esc(tag)}*  ·  ${esc(opts.reviewCode)}` }],
    },
  ]

  // The warning LEADS, before the draft, for the same reason it does in the
  // SMS: a reviewer skimming on a phone is exactly who an injected payment
  // handle is aimed at, and a warning below the text is a warning read second.
  if (parked) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `:warning: *CHECK THIS —* ${escCap(opts.warning, SECTION_TEXT_MAX - 40)}` },
    })
  }

  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: escCap(opts.summary, SECTION_TEXT_MAX) } })

  if (opts.missing && opts.missing.length > 0) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `Missing: ${escCap(opts.missing.join(', '), 1000)}` }],
    })
  }

  if (opts.emailDraft) {
    blocks.push({ type: 'divider' })
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Email draft*\n${escCap(opts.emailDraft, SECTION_TEXT_MAX - 20)}` },
    })
  }
  if (opts.smsDraft) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*SMS draft*\n${escCap(opts.smsDraft, SECTION_TEXT_MAX - 20)}` },
    })
  }

  if (opts.reviewUrl) {
    blocks.push({
      type: 'context',
      // The label is ours and the URL was minted by us; nothing from the draft
      // reaches either side of the pipe.
      elements: [{ type: 'mrkdwn', text: `<${opts.reviewUrl}|Open the full review page>` }],
    })
  }

  const value = encodeActionValue({ draftId: opts.draftId, reviewCode: opts.reviewCode })

  if (parked) {
    // A parked draft gets NO Approve button, and that is the whole point of
    // parking. §25.6 keeps the guardrail shape unchanged, and parkedSmsBody's
    // reasoning applies harder here: a button is one thumb away, and the reason
    // the draft was held is that a human needs to read WHY first. Opening it in
    // Admin is a deliberate act, which is what this decision deserves.
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: 'Not sent for approval. Nothing has gone to the customer. Open Admin › Inbox to edit or release it.',
        },
      ],
    })
    return blocks
  }

  blocks.push({
    type: 'actions',
    block_id: `hh_actions_${opts.draftId}`,
    elements: [
      {
        type: 'button',
        action_id: ACTION_APPROVE,
        text: { type: 'plain_text', text: escCap('Send it', BUTTON_TEXT_MAX), emoji: false },
        style: 'primary',
        value,
        // Slack's own "are you sure?" sheet. One tap of confirmation in front
        // of the only irreversible action on this message — the SMS path asks
        // for the same thing when an approval names an out-of-context draft,
        // and a button is easier to hit by accident than a code is to type.
        confirm: {
          title: { type: 'plain_text', text: 'Send to the customer?' },
          text: {
            type: 'mrkdwn',
            text: `This sends *${esc(opts.reviewCode)}* to the customer by email and text. There is no undo.`,
          },
          confirm: { type: 'plain_text', text: 'Send it' },
          deny: { type: 'plain_text', text: 'Not yet' },
        },
      },
      {
        type: 'button',
        action_id: ACTION_EDIT,
        text: { type: 'plain_text', text: escCap('Change...', BUTTON_TEXT_MAX), emoji: false },
        value,
      },
      {
        type: 'button',
        action_id: ACTION_TEST,
        text: { type: 'plain_text', text: escCap('Test to me', BUTTON_TEXT_MAX), emoji: false },
        value,
      },
      {
        type: 'button',
        action_id: ACTION_CANCEL,
        text: { type: 'plain_text', text: escCap('Drop', BUTTON_TEXT_MAX), emoji: false },
        style: 'danger',
        value,
      },
    ],
  })

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: 'Nothing has gone to the customer. Reply in this thread to ask for a change.' }],
  })

  return blocks
}

/**
 * The push-notification line, and the message for clients that do not render
 * blocks. Never "New lead" — this is the half a reviewer sees on a lock screen
 * at 9pm, which is the moment speed-to-lead is actually decided.
 */
export function draftMessageText(opts: DraftMessageOpts): string {
  const tag = opts.partyType.replace(/_/g, ' ')
  const head = opts.warning ? 'DRAFT HELD - needs you' : opts.revision ? 'revised draft ready' : 'draft ready'
  return escCap(`[${opts.reviewCode} - ${tag}] ${head}: ${opts.summary}`, 400)
}

/* ── After an action ────────────────────────────────────────────────────── */

/**
 * Replace a message's buttons with a record of what happened to it.
 *
 * The buttons are REMOVED, not disabled — Slack has no disabled state for a
 * button, so the only way to stop a second press is to take it away. The
 * handler refuses the second press anyway; this is so it never has to.
 */
export function settledBlocks(opts: {
  original: unknown[]
  outcome: string
  by: string
}): unknown[] {
  const kept = (opts.original || []).filter(b => (b as { type?: string })?.type !== 'actions')
  return [
    ...kept,
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `*${esc(opts.outcome)}* — ${esc(opts.by)}` }],
    },
  ]
}

/* ── The edit modal ─────────────────────────────────────────────────────── */

/**
 * "Change..." opens this. It is the Slack form of the SMS path's free-text
 * revision, and it produces the same thing: a note that goes to
 * `redraftForReviewer`.
 *
 * `private_metadata` carries the draft id across the modal's round trip. It is
 * the same identifier-not-instruction as a button value, and it is re-checked
 * the same way — the submission is verified and allowlisted before the id in
 * here is used for anything.
 */
export function editModalView(opts: {
  draftId: string
  reviewCode: string
  /** Seeded so the reviewer edits rather than starts from nothing. */
  currentNote?: string | null
  channel?: string | null
  threadTs?: string | null
}): Record<string, unknown> {
  return {
    type: 'modal',
    callback_id: EDIT_MODAL_CALLBACK,
    private_metadata: JSON.stringify({
      draftId: opts.draftId,
      reviewCode: opts.reviewCode,
      channel: opts.channel ?? null,
      threadTs: opts.threadTs ?? null,
    }),
    title: { type: 'plain_text', text: escCap(`Change ${opts.reviewCode}`, 24) },
    submit: { type: 'plain_text', text: 'Re-draft' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: EDIT_BLOCK_ID,
        label: { type: 'plain_text', text: 'What should change?' },
        hint: {
          type: 'plain_text',
          text: 'Plain English. "drop the price to 850", "warmer, and mention parking".',
        },
        element: {
          type: 'plain_text_input',
          action_id: EDIT_INPUT_ID,
          multiline: true,
          max_length: 2000,
          ...(opts.currentNote ? { initial_value: String(opts.currentNote).slice(0, 2000) } : {}),
        },
      },
    ],
  }
}
