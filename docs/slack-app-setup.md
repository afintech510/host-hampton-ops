# Slack app setup — Host Hampton reviewer channel

Plan §21.4. **The browser steps are Adam's; everything else is code.** Slack
will not issue an app or its tokens to a script, so this file is the handover:
do the numbered steps, put the four values in `.env` on the box, and the rest is
already written or will be.

Nothing here is live yet. Until `REVIEWER_CHANNEL=slack`, the reviewer loop is
SMS exactly as it is today.

---

## 1. Create the app from the manifest

1. Go to <https://api.slack.com/apps> → **Create New App** → **From a manifest**
2. Pick the Host Hampton workspace
3. Paste `slack-app-manifest.yml` (next to this file)
4. Create

The manifest sets the name, scopes, and both request URLs, so there is nothing
to configure by hand afterwards.

## 2. Install it

**Settings → Install App → Install to Workspace**, then approve.

## 3. Create the channel and invite the app

Create **`#hh-leads`** (one channel, not three — §12's arithmetic: at ~16
leads/month, three channels is ~5 leads each per month; the party type is a tag
in the message). Then in the channel:

```
/invite @Host Hampton
```

A bot cannot post to a channel it is not in, and the failure looks like
`not_in_channel` rather than anything obvious.

## 4. Collect four values

| Where | Value | Goes in `.env` as |
|---|---|---|
| Settings → Basic Information → App Credentials | **Signing Secret** | `SLACK_SIGNING_SECRET` |
| Settings → Install App | **Bot User OAuth Token** (`xoxb-…`) | `SLACK_BOT_TOKEN` |
| Right-click `#hh-leads` → View channel details → bottom | **Channel ID** (`C…`) | `SLACK_LEADS_CHANNEL` |
| Your Slack profile → ⋮ → Copy member ID | **Member ID** (`U…`) | `SLACK_REVIEWER_USER_IDS` |

`SLACK_REVIEWER_USER_IDS` is comma-separated — add Allie's member ID when she
has one.

### Why the member ID matters beyond access

It is the fix for the thing §11.1 names as a blocker: today an admin-UI approval
writes the anonymous actor `'ADMIN'`, so with two people working leads the
ledger cannot say **who** approved a message to a customer. A verified Slack
`user_id` maps to an `admin_users` row (migration 048 added
`admin_users.slack_user_id`), and the approval gets a name.

## 5. Env block

```
SLACK_SIGNING_SECRET=...
SLACK_BOT_TOKEN=xoxb-...
SLACK_LEADS_CHANNEL=C...
SLACK_REVIEWER_USER_IDS=U...
REVIEWER_CHANNEL=sms
```

**Leave `REVIEWER_CHANNEL=sms` until the handlers are built.** Flip it to
`slack` when §21.8 steps 3–5 are green — the cutover is on completion, not after
a soak week (Adam, 2026-09-12), because §21.5's per-send fallback already proves
continuously what a soak would have proved once.

---

## Security posture, so a later change does not quietly undo it

Already built and tested (`lib/slack/signature.ts`, 12 tests):

- **Signature verification against Slack's documented base string**,
  `v0:${timestamp}:${rawBody}`, on the RAW body — Slack sends interactions
  form-encoded, and anything that parses before hashing breaks every signature.
- **Fail closed.** An unset `SLACK_SIGNING_SECRET` is a rejection, never a skip.
- **A 5-minute timestamp window, checked in both directions.** Without it, a
  signature Slack produced once is valid forever and a captured "Approve" could
  be replayed later.
- **An empty `SLACK_REVIEWER_USER_IDS` authorises nobody.** "Not configured"
  reads as "no authority", the same direction as an unset `REVIEWER_PHONES`
  meaning "text nobody".

Still to build (§21.8 steps 3–5):

- `/api/slack/interactions` and `/api/slack/events`
- Block Kit message + the edit modal
- `chat.postMessage` → `chat.getPermalink` → `/r/` code → one-segment SMS ping

Two rules those must not break:

1. **`/api/slack/*` must never import `sendApproved.ts`.** The guardrail is
   enforced by the module graph, not by discipline — that is why
   `lib/agent/reviewers.ts` is its own module. Slack gets the same treatment.
2. **Approval gates on the verified `user.id`**, never on message content. §4.2
   does not change because the channel changed.

## The one operational limit worth knowing

Slack Free allows **10 app integrations workspace-wide**. Ours is 1. If Adam
later adds Drive, Calendar, a Stripe app and so on, that cap is what will bite —
not the 90-day history, which is fine because Supabase is the system of record
and Slack is a view of it.
