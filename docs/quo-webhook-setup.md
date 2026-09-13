# Quo inbound-SMS webhook — setup and recovery runbook

The booking agent's review loop depends on this. Without a working webhook,
`POST /api/webhooks/quo` does nothing: reviewer replies never arrive, and
customer **STOP opt-outs are never processed**.

**The signing key and the box are coupled.** `/api/webhooks/quo` fails closed
(401 on a bad or missing signature), so if you recreate the webhook in Quo you
MUST copy its new key into `QUO_WEBHOOK_SECRET` on the box or every inbound SMS
starts rejecting.

---

## ⚠ Two corrections this document got wrong, and what they cost

**1. "The endpoint had never once been hit in production" was false.** The nginx
log (read 2026-09-13) holds successful `POST /api/webhooks/quo` deliveries from
**2026-09-02 onward**, and `contact_interactions` holds **30 real inbound
customer SMS** from 8 real people between 2026-08-27 and 2026-09-10, every one
of them `provider: quo`. Something was already delivering. See §6.

**2. §4's verification proved nothing.** It signed a payload the way the route
checks it — which can only ever show that the verifier agrees with itself. The
route implemented **Standard Webhooks** (`webhook-id` / `webhook-timestamp` /
`webhook-signature` over `id.timestamp.body`). **Quo does not sign that way.**

> Quo signs ONE header:
> `openphone-signature: hmac;1;<ms-timestamp>;<base64sig>`,
> HMAC-SHA256 over `` `${timestamp}.${rawBody}` ``, keyed by the
> **base64-decoded** signing key.
> <https://support.quo.com/core-concepts/integrations/webhooks>

So every genuine delivery arrived carrying none of the headers being looked for
and was refused. **Every POST to this route answered 401 from 2026-09-11 12:00
UTC until it was fixed on 2026-09-13 — 38 deliveries across 2.5 days.** The SMS
review loop was dead with 16 drafts waiting, inbound customer texts reached
nothing, and no customer STOP could be recorded. Nothing watched the 401s.

`lib/inboundWebhookVerify.ts` now accepts **both** schemes and names which one
verified, and a refusal names the reason and the signature headers that were
present — `signature verification FAILED` cannot tell a wrong key from a wrong
scheme, and that is what cost the 2.5 days.

**The lesson for this runbook: a webhook is verified when a REAL delivery from
the provider returns 200, never when your own signed request does.** §4 below is
a liveness check, not a verification.

---

## Current subscription (as of 2026-09-11)

| Field | Value |
|---|---|
| Webhook id | `WHc7b78b376fd743ab9bfc10365f5d241f` |
| Phone number id | `PNYQcWcAEd` (+1 631-998-9325, "Host Hampton") |
| Events | `message.received` |
| URL | `https://www.hosthampton.com/api/webhooks/quo` |
| Signing key | = `QUO_WEBHOOK_SECRET` in `/opt/hosthampton/.env` |

---

## API facts that trip people up

- Base URL is `https://api.quo.com/v1` (Quo is OpenPhone-compatible).
- Auth is the **raw API key** in the `Authorization` header — **no `Bearer`
  prefix**. `Authorization: $QUO_API_KEY`.
- Create path is `/v1/webhooks/**messages**`; list and delete are `/v1/webhooks`
  and `/v1/webhooks/{id}`. `GET /v1/webhooks/messages` is an error (it parses
  `messages` as an id and demands `^WH(.*)$`).
- The signing key is returned **only in the create response** (and on list, as
  `key`). There is no "reveal secret" endpoint to rely on later — capture it.

---

## 1. Find the phone-number id

```bash
QUO_API_KEY=...        # from /opt/hosthampton/.env or repo-root .env.local
curl -s https://api.quo.com/v1/phone-numbers \
  -H "Authorization: $QUO_API_KEY" | jq '.data[] | {id, number, name}'
# → { "id": "PNYQcWcAEd", "number": "+16319989325", "name": "Host Hampton" }
```

## 2. Create the subscription

```bash
curl -s -X POST https://api.quo.com/v1/webhooks/messages \
  -H "Authorization: $QUO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.hosthampton.com/api/webhooks/quo",
    "events": ["message.received"],
    "resourceIds": ["PNYQcWcAEd"],
    "label": "HH booking agent inbound SMS",
    "status": "enabled"
  }' | jq
```

Expect `201`. The response (and `GET /v1/webhooks`) includes `key` — a 44-char
base64 string. **That is the signing secret.**

> Only `message.received` is subscribed. Do not add `message.delivered` unless
> something needs it: the route ignores non-inbound events, so it would be pure
> noise, and every delivery receipt would be an authenticated request to handle.

## 3. Put the key on the box

Never echo the value. Pipe it, and print only a digest to confirm both sides
match:

```bash
# On your laptop
export SECRET=$(curl -s https://api.quo.com/v1/webhooks -H "Authorization: $QUO_API_KEY" \
  | jq -r '.data[] | select(.id=="WHc7b78b376fd743ab9bfc10365f5d241f") | .key')
printf %s "$SECRET" | sha256sum | cut -c1-12      # note this

ssh hampton-vps 'cat > /root/setsec.py' <<'PY'
import sys, hashlib, io
secret = sys.stdin.read().strip()
if not secret: print("ERROR: empty secret on stdin"); sys.exit(1)
path = "/opt/hosthampton/.env"
lines = io.open(path, encoding="utf-8").read().split("\n")
out = [("QUO_WEBHOOK_SECRET=" + secret) if l.startswith("QUO_WEBHOOK_SECRET=") else l for l in lines]
if not any(l.startswith("QUO_WEBHOOK_SECRET=") for l in out): out.append("QUO_WEBHOOK_SECRET=" + secret)
io.open(path, "w", encoding="utf-8", newline="\n").write("\n".join(out))
print("fingerprint:", hashlib.sha256(secret.encode()).hexdigest()[:12])
PY
printf %s "$SECRET" | ssh hampton-vps 'python3 /root/setsec.py; rm -f /root/setsec.py'
```

The two fingerprints must match. Then **rebuild** (`.env` changes are not picked
up by a restart):

```bash
bash scripts/deploy.sh
ssh hampton-vps 'docker exec hampton_website sh -c "echo \${#QUO_WEBHOOK_SECRET}"'   # expect 44
```

> Gotcha: `deploy.sh` can print `Conflict. The container name ... is already in
> use` and leave the OLD container running with the OLD env. Always verify the
> env inside the container afterwards; if it is stale, run
> `ssh hampton-vps 'cd /opt/hosthampton && docker compose up -d --force-recreate website'`.

## 4. Verify — and understand what this does NOT prove

**This is a liveness check, not a verification.** It signs a payload the way the
route checks it, so a route that verifies the wrong scheme entirely will pass it
— which is exactly what happened between 2026-09-11 and 2026-09-13. The only
real verification is **a genuine Quo delivery answering 200**; see §6.

Fail-closed first, then a valid signature. The route still accepts Standard
Webhooks — `{webhook-id}.{webhook-timestamp}.{rawBody}` with HMAC-SHA256 over
the **base64-decoded** secret, base64 digest as `v1,<sig>` — alongside Quo's own
`openphone-signature` scheme:

```bash
python - <<'PY'
import json, hmac, hashlib, base64, time, os, urllib.request, urllib.error
secret = base64.b64decode(os.environ['SECRET'])
URL = 'https://www.hosthampton.com/api/webhooks/quo'
body = json.dumps({"type":"message.received","data":{"object":{
    "id":"ACverify1","from":"+16314008080","to":["+16319989325"],
    "text":"TEST","direction":"incoming","conversationId":"CNverify1"}}})
ts, wid = str(int(time.time())), 'verify1'
def post(h):
    r = urllib.request.Request(URL, data=body.encode(), method='POST',
        headers={'content-type':'application/json', 'user-agent':'hh/1.0', **h})
    try:
        x = urllib.request.urlopen(r); return x.status, x.read().decode()[:200]
    except urllib.error.HTTPError as e: return e.code, e.read().decode()[:200]
sig = 'v1,' + base64.b64encode(hmac.new(secret, f'{wid}.{ts}.{body}'.encode(), hashlib.sha256).digest()).decode()
print('no headers   ->', post({}))                                   # expect 401
print('bad sig      ->', post({'webhook-id':wid,'webhook-timestamp':ts,'webhook-signature':'v1,AAAA'}))  # 401
print('valid sig    ->', post({'webhook-id':wid,'webhook-timestamp':ts,'webhook-signature':sig}))        # 200
PY
```

A valid request returns `{"received":true,"eventId":"…","reviewer":true}` —
`reviewer` reflects whether `from` is in `REVIEWER_PHONES`. The `TEST` above
reaches the review loop on the next dispatcher run, so it will send you a test
copy of whichever draft is open; use a nonsense body instead if you don't want
that.

## 5. Managing it later

```bash
# List
curl -s https://api.quo.com/v1/webhooks -H "Authorization: $QUO_API_KEY" | jq '.data[] | {id,url,events,status}'
# Delete (then redo steps 2-4, including the new key)
curl -s -X DELETE https://api.quo.com/v1/webhooks/WHc7b78b376fd743ab9bfc10365f5d241f -H "Authorization: $QUO_API_KEY" -i
```

### If inbound SMS stops working

1. `docker logs hampton_nginx | grep webhooks/quo` — **filter by STATUS, not just
   by path.** A stream of `401` reads exactly like a stream of `200` if you only
   count lines, and that is how 2.5 days of refusals went unnoticed.
2. `docker logs hampton_website | grep quo:webhook` — no lines at all means Quo
   is not calling us (subscription deleted/disabled, or the URL changed).
3. A line saying `signature verification FAILED (<reason>) — rejecting. signature
   headers present: …` now tells you which of two things is wrong:
   * **`headers present: NONE`** — Quo is sending a scheme we do not read, or
     something other than Quo is calling the URL.
   * **`headers present: openphone-signature`, reason `bad-signature`** — the
     scheme is right and the KEY is wrong. Redo step 3.
     The line also carries `bodyFp` / `theirSigFp` / `ourSigFp` fingerprints
     (never the values), which is how you tell two deliveries of one message
     apart.
4. **Do NOT clear `QUO_WEBHOOK_SECRET`.** An earlier version of this document
   offered that as an emergency unblock. It no longer works — an unset secret
   fails CLOSED in production (link 22) — and it never should have: an unsigned
   inbound SMS can impersonate a reviewer phone and approve a draft.

## 6. A second delivery stream we cannot see

Measured 2026-09-13: **every inbound message arrives at this route TWICE**, from
two Cloudflare edges a second or two apart, with **different bodies** (605 bytes
vs 519 for the same 45-character text) and only one of the pair verifying.

* `GET /v1/webhooks` lists exactly **one** subscription
  (`WHc7b78b376fd743ab9bfc10365f5d241f`) and its key fingerprint matches
  `QUO_WEBHOOK_SECRET` exactly.
* The refused copy is `type=message.received direction=incoming` — the same
  event — signed with a key the API does not expose.

So there is a second subscription, almost certainly created in the **Quo app UI**
rather than through the API (the API has no list endpoint that shows it —
`/v1/webhooks/{messages,calls,contacts}` all 400 with `Expected string to match
'^WH(.*)$'`). It is the one that delivered the 30 real customer messages of
2026-08-27…09-10, back when this route had no secret set and accepted anything.

**Today this is harmless**: the API subscription delivers the same message and it
verifies, so every message lands exactly once. **It is not harmless tomorrow** —
it means this route runs a permanent ~50% 401 rate, which is precisely the noise
a real outage hides in. **needs Adam**: find it on the Quo app's webhooks /
integrations page and either delete it or put its key on the box.
