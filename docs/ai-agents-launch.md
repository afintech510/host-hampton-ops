# The AI agents: website chat and ChatGPT

Two front doors onto one set of answers:

- **Host Assistant**, the chat bubble on the website (`/api/chat`, `lib/chat/*`). Built and tested; **off** until the steps below are done.
- **The connector** (`https://www.hosthampton.com/api/mcp`, `lib/mcp/*`), which ChatGPT and Claude call. Live.

They are linked in the code: the chat's read tools call the connector's own tool code, and both price through the planner's engine (`lib/quoteRequest.ts` → `lib/quoteEngine.ts`). A price changed in `pricing_items` reaches the planner, `/party-menu`, the chat and ChatGPT within a minute. See `docs/white-label-and-ai-surfaces.md` for the safety model.

| A parent asks… | Tool | Source |
|---|---|---|
| About the business, ages, travel, rentals | `get_business_overview` | `/llms.txt` |
| What themes there are | `list_party_themes` | `pricing_items` + `party_themes` |
| What's included, food, add-ons | `get_party_menu` | `pricing_items` (`lib/partyMenu.ts`) |
| What a party costs | `get_quote` | the planner's engine |
| What's open in a month | `check_availability` | the live calendar + the `kids-party` booking type |
| Whether one date is open | `check_date_availability` | the live calendar |
| Photos, reviews, public events, how to book | `find_photos`, `get_reviews`, `list_upcoming_events`, `get_booking_link` | their own pages' sources |
| To be contacted | `start_inquiry` | replays `POST /api/lead` |

The website chat also has `propose_booking`: a card the parent taps to create their plan and invoice. The connector does not.

## Switching on the website chat

### 1. Get the Turnstile keys (about 5 minutes)

Turnstile is Cloudflare's free bot check. The chat will not run in production without it, because every visitor message costs money.

1. Sign in at [dash.cloudflare.com](https://dash.cloudflare.com) with the account that runs hosthampton.com.
2. In the left menu, open **Turnstile**. (It is at the account level, not inside the hosthampton.com site. If you don't see it, search "Turnstile" in the dashboard's search box.)
3. Click **Add widget**.
4. Fill in the form:
   - **Widget name:** `Host Hampton website chat`
   - **Hostname management:** add `www.hosthampton.com`, then `hosthampton.com`.
   - **Widget mode:** **Managed**. Most visitors see nothing or a quick check; only a suspicious visitor gets a checkbox.
   - **Pre-clearance:** leave it at **No**.
5. Click **Create**.
6. Copy the **Site Key** and the **Secret Key**. The site key is public by design. The secret is a password, so keep it out of chat, email and git.

### 2. Do the two things the launch needs first

- **Privacy policy.** It does not mention AI at all today, and the chat sends what visitors type to our AI provider. Add a paragraph like the draft below to `src/app/privacy-policy/page.tsx`. It is legal text, so it is your call or Christine's, not something to ship unread.
- **How long chats are kept.** `chat_sessions` rows are labelled to expire after 90 days, but **nothing deletes them yet** (migration 085). Decide the number, and a one-line purge job goes in `scripts/cron/jobs.tsv`. Until it exists the policy cannot promise deletion.

> **AI assistants.** Our website has an automated chat assistant, and you may also reach us through AI assistants such as ChatGPT or Claude. When you use our website assistant, what you type is sent to our AI provider, Anthropic, to write a reply, and Cloudflare Turnstile checks that the first message comes from a person. We keep the conversation for [90] days. If you give your name, email and phone and ask us to contact you or set up a party, we use them as we would a form you filled in. If you use another company's AI assistant, its privacy policy covers your conversation with it. We receive only what it sends us: your question and, if you ask it to send an inquiry, your name, email, phone and the party details you gave it.

### 3. Turn it on

```bash
ssh hampton-vps
cd /opt/hosthampton
nano .env
# add these three lines, with your two keys:
#   TURNSTILE_SITE_KEY=...
#   TURNSTILE_SECRET_KEY=...
#   PUBLIC_CHAT_ENABLED=true
docker compose up -d --build website
```

Check it, once the rebuild finishes:

```bash
curl -s https://www.hosthampton.com/api/chat/config
# expect {"enabled":true,"turnstileSiteKey":"0x…"}
```

Then open the site in a private window, tap the bubble and ask a real question. If it answers `{"enabled":false}`, one of the three lines is missing or misspelled.

**To turn it off:** set `PUBLIC_CHAT_ENABLED=false` and run the same `docker compose` line.

**What it costs:** about **$0.02 per visitor message** on `claude-sonnet-5-5` (measured over 38 eval cases). The default ceiling is **$3 a day** (`PUBLIC_CHAT_DAILY_USD_CAP`), roughly 150 messages, and $0.75 per conversation. At a ceiling the chat hands the visitor to Text us / Call.

## Mobile parties: the one figure

Adam removed mobile prices from the website on 2026-11-05, and on 2026-11-07 chose this for the agents: **"starts at $850 for 10 kids, quoted individually"**, never a total. So the agents publish one mobile figure that the website does not.

It is one row, the only thing that makes either agent say a mobile figure. `/llms.txt` deliberately does not repeat it.

```sql
-- change what they say (takes effect within a minute):
UPDATE pricing_items SET price_cents = 85000, metadata = metadata || '{"kids": 10}'
 WHERE metadata->>'catalog_key' = 'mobile_quote_from';

-- no mobile figure at all: they say "quoted individually" and link the quote form:
UPDATE pricing_items SET is_active = false
 WHERE metadata->>'catalog_key' = 'mobile_quote_from';
```

Still mismatched, on purpose until the mobile grid exists: **the planner still charges its own lower mobile ladder** ($400 base), so a parent who finds the planner themselves sees a lower number than $850. The agents send mobile parents to the quote form, not the planner. See plan §15.

## ChatGPT

### What people get today

ChatGPT reads the website and `/llms.txt` for anyone. **The live tools only reach someone who has added the connector**, and today that means a person turning on developer mode. A listing in the ChatGPT directory is what lets any parent use them.

To try it yourself: in ChatGPT's settings, under Apps (or Connectors), turn on developer mode in the advanced settings, create a new connector with the URL `https://www.hosthampton.com/api/mcp` and no authentication, then ask it about a party in a new chat. Menu names move around; [OpenAI's page](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt) has the current ones.

### Submitting to the directory

OpenAI now calls these "plugins". The package is ready in `integrations/chatgpt-plugin/`. **Approval is not assured**; read the risks below first.

Only you can do these, because they are in your name:

1. **Verify your identity** at [platform.openai.com/settings/organization/general](https://platform.openai.com/settings/organization/general), as the business name you will publish under. Publishing under an unverified name is an automatic rejection. If the verified name is not "Host Hampton", change `developerName` in `plugin.json`.
2. **Do the privacy policy paragraph above.** OpenAI requires a policy covering each kind of personal data returned or collected.
3. **Record a short demo** of the five positive test cases on desktop and phone, put it somewhere a reviewer can open, and paste the link into `review.demo_recording_url` in `plugin.json`.
4. **Check the category.** `plugin.json` says `Lifestyle`, but the accepted names are only listed in the portal.
5. **Build the ZIP:**
   ```bash
   cd integrations/chatgpt-plugin && zip -r ../host-hampton-plugin.zip plugin.json mcp.json assets
   ```
6. **Upload it** at [platform.openai.com/plugins](https://platform.openai.com/plugins) (Upload new or existing plugin), then connect and scan the server under MCPs.
7. **Prove you own the domain.** The portal shows a token. Add it to `/opt/hosthampton/.env` as `OPENAI_APPS_CHALLENGE=<token>`, run `docker compose up -d --build website`, and check that `https://www.hosthampton.com/.well-known/openai-apps-challenge` prints the token and nothing else.
8. **Re-run every test case** on desktop and mobile, paste the justifications below, and **Submit for review**.
9. **After approval, click Publish.** It stays hidden until you do. Email press@openai.com before announcing it.

Later changes to the tools are picked up automatically once they pass OpenAI's checks. Changing the listing means a new draft version.

**A reviewer may really send an inquiry.** `start_inquiry` goes to the real lead form, so it would text you and email the address they gave. It will be tagged `source_page = ai-assistant-mcp`.

### Tool annotation justifications (paste into the portal)

| Tool | read-only | destructive | open-world | Why |
|---|---|---|---|---|
| `get_business_overview`, `list_party_themes`, `get_party_menu`, `get_quote`, `check_availability`, `check_date_availability`, `list_upcoming_events`, `get_reviews`, `find_photos`, `get_booking_link` | true | false | false | Reads the business's own published information and calendar. Changes nothing and contacts no one. |
| `start_inquiry` | false | true | true | Sends the user's name, email, phone and party details to the business, which replies, and the business emails the user a confirmation. A sent message cannot be recalled, hence destructive. The description requires an explicit request and details the user gave. It books nothing and takes no payment. |

### The risks in review

These come from [OpenAI's plugin guidelines](https://developers.openai.com/apps-sdk/app-submission-guidelines), which don't address party bookings directly:

- **Commerce.** "Plugins may conduct commerce only for physical goods." A party is a real-world service, and the rule's examples of what is barred are digital. The plugin takes no payment, so this should hold, but a reviewer could read it differently.
- **Links to a transactional page.** The rules allow an informational page and bar linking "directly to a checkout or other transactional page". The planner, where a parent can pay a deposit, could draw an objection. If it does, point `open_in_planner` and `get_booking_link` at `/party-packages`.
- **Advertising.** A plugin "must not exist primarily as an advertising vehicle". Quotes and availability are the real utility; lead with them in the demo.
- **Children.** Plugins "may not explicitly target children under 13". The listing and tools address parents, and the connector no longer asks for a child's name. It still accepts a child's age, because that is what a party is planned around.

Sources: [submission](https://developers.openai.com/plugins/deploy/submission), [review requirements](https://developers.openai.com/plugins/deploy/app-review), [guidelines](https://developers.openai.com/apps-sdk/app-submission-guidelines), [Turnstile dashboard](https://developers.cloudflare.com/turnstile/get-started/widget-management/dashboard/).

## Testing the model ("training")

We don't fine-tune anything. The agents are grounded in live tools and rules, and the eval is how we know they behave: 38 real parent questions through the real chat turn, on live data.

```bash
cd services/website
npm run eval:chat                  # about $0.80 and under a minute
npm run eval:chat -- -t "mobile"   # just the matching cases
```

Keys come from `.env.local` (`ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`). From a worktree: `EVAL_ENV_FILES=/path/.env.local,/path/services/website/.env.local npm run eval:chat`. It sends nothing and writes nothing; the transcripts go to a JSON report in the temp folder.

**To teach it something:** a wrong fact is fixed where the fact lives (the price row, `/llms.txt`, the page), not in the prompt. A wrong behaviour goes in `lib/chat/prompt.ts`, with a new case in `src/__tests__/evals/chatAgent.eval.ts`, so it stays fixed.
