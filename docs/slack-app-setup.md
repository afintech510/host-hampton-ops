# Slack app setup — Host Hampton reviewer channel

Plan §25.4. **The browser steps are Adam's; everything else is code.** Slack
will not issue an app or its tokens to a script, so this file is the handover:
do the numbered steps, put the four values in `.env` on the box, and the rest is
already written or will be.

Nothing here is live yet. Until `REVIEWER_CHANNEL=slack`, the reviewer loop is
SMS exactly as it is today.

---

## 0. First, put the signing secret on the box — and only then step 1

**This is the one step whose ORDER matters, and doing it late looks like a bug
in our code rather than a sequencing mistake.**

Slack signs the `url_verification` handshake it sends when event subscriptions
are enabled, and `/api/slack/events` gives that handshake **no exemption** from
the fail-closed check — an unset `SLACK_SIGNING_SECRET` is a rejection, not a
skip. So if the app is created and its events URL enabled before the secret is
on the box, the handshake fails with a 401 and Slack marks the URL unverified.

Weakening the check to make setup smoother would trade a five-minute ordering
constraint for a permanently open door, so it is not going to be weakened.

The practical sequence:

1. Create the app (§1 below) but **do not enable event subscriptions yet** —
   if you paste the manifest, Slack will try to verify immediately, so expect
   that one to fail and re-verify it in §6.
2. Copy the Signing Secret into `/opt/hosthampton/.env`.
3. Deploy (`ssh hampton-vps`, `cd /opt/hosthampton && docker compose up -d website`).
4. Back in the Slack app → **Event Subscriptions** → **Retry** next to the
   request URL. It goes green.

A local `.env.local` does not reach the container. The value has to be in
`/opt/hosthampton/.env`.

## 1. Create the app from the manifest

1. Go to <https://api.slack.com/apps> → **Create New App** → **From a manifest**
2. Pick the Host Hampton workspace
3. Paste `slack-app-manifest.yml` (next to this file)
4. Create

The manifest sets the name, scopes, and both request URLs, so there is nothing
to configure by hand afterwards — except re-verifying the events URL once the
secret is deployed, per §0.

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
`slack` when §25.8 steps 3–5 are green — the cutover is on completion, not after
a soak week (Adam, 2026-09-12), because §25.5's per-send fallback already proves
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

Also built and tested (§25.8 steps 3–5, deployed 2026-09-13 — see plan §25.11):

- `/api/slack/interactions` and `/api/slack/events`
- Block Kit message + the edit modal
- `chat.postMessage` → `chat.getPermalink` → `/s/` code → one-segment SMS ping

Two rules those do not break, and a test enforces each:

1. **`/api/slack/*` never imports `sendApproved.ts`.** The routes record an
   `ingested_messages` row; the dispatcher claims it and runs the transition.
   `slackSurface.test.ts` walks the import graph transitively — and asserts that
   the dispatcher DOES reach `sendApproved`, so the walker cannot pass by
   failing to resolve anything.
2. **Approval gates on the verified `user.id`**, never on message content,
   checked in the route AND again in `handleSlackAction` — because by the time
   the dispatcher reads it, the evidence of who pressed the button is a string
   in a table row.

## What "done" looks like once the four values are in

- A new lead posts to `#hh-leads` with the draft and four buttons, and you get
  a one-segment text with a `/s/` link to it.
- **Slack being down does not cost you the lead.** The text still sends,
  carrying the `/review/` link instead. Every failure path is tested.
- Pressing **Send it** confirms, then sends within ~2 minutes (the same
  dispatcher that has always run the SMS path), and the thread says who
  approved it.
- Replying in a lead's thread re-drafts it, with no code to quote.

### One thing that will look wrong at first, and is not

The ledger will record `SLACK:U012ABCDEF` rather than your name until
`admin_users.slack_user_id` is set. That is deliberate — it is still a verified,
specific person, and it is better than the anonymous `'ADMIN'` it replaces. To
get the name, run one statement per reviewer:

```sql
UPDATE admin_users SET slack_user_id = 'U012ABCDEF'
 WHERE email = 'adam@easternbuilding.supply';
```

## The one operational limit worth knowing

Slack Free allows **10 app integrations workspace-wide**. Ours is 1. If Adam
later adds Drive, Calendar, a Stripe app and so on, that cap is what will bite —
not the 90-day history, which is fine because Supabase is the system of record
and Slack is a view of it.
