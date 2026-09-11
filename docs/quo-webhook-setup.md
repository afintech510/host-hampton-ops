# Quo inbound-SMS webhook — setup and recovery runbook

The booking agent's review loop depends on this. Without a webhook subscription,
`POST /api/webhooks/quo` is never called: reviewer replies never arrive, and
customer **STOP opt-outs are never processed**. That was the live state until
2026-09-11 — `GET /v1/webhooks` returned `{"data":[]}` and the endpoint had never
once been hit in production.

**The signing key and the box are coupled.** `/api/webhooks/quo` fails closed
(401 on a bad or missing signature), so if you recreate the webhook in Quo you
MUST copy its new key into `QUO_WEBHOOK_SECRET` on the box or every inbound SMS
starts rejecting.

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

## 4. Verify

Fail-closed first, then a valid signature. Standard Webhooks signs
`{webhook-id}.{webhook-timestamp}.{rawBody}` with HMAC-SHA256 over the
**base64-decoded** secret, and sends the base64 digest as `v1,<sig>`:

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

1. `docker logs hampton_website | grep quo:webhook` — no lines at all means Quo
   is not calling us (subscription deleted/disabled, or the URL changed).
2. Lines saying `signature verification FAILED — rejecting` mean the
   subscription exists but `QUO_WEBHOOK_SECRET` no longer matches its key. Redo
   step 3.
3. As an emergency unblock you can clear `QUO_WEBHOOK_SECRET` (empty =
   verification disabled, the route accepts anything) — but an unsigned inbound
   SMS can then impersonate a reviewer phone and approve a draft, so treat that
   as minutes, not days.
