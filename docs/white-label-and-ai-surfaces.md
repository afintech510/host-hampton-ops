# White-label foundation, Manager assistant, public MCP

Added 2026-11-02. Three pieces, all live behind feature flags in `src/tenant/`.

## 1. The tenant config (white-label foundation)

`services/website/src/tenant/` is the one home for a business's facts:
name, domain, phone numbers, address, social links, the person customer
messages are signed by, logo, email colours, and which modules are on.

- `types.ts` — the `TenantConfig` shape and the `FeatureName` list.
- `hosthampton.ts` — tenant #1. Every value is what production served before.
- `index.ts` — `export const TENANT = HOST_HAMPTON`. **This is the one line a
  clone changes.** It is a static import so client components (Nav, Footer)
  can read it and the bundle carries only one tenant.

Already reading from it: `layout.tsx` (metadata + both JSON-LD nodes), `Nav`,
`Footer`, the shared email blocks in `emailTemplates.ts`, and the constant
modules `paymentContacts`, `studioLocation`, `seo`, `ownerNotify`,
`publicOrigin`, `careersNotify`, `content/slug`, `crew/templates`,
`evites/{facts,ics,mail}`, `rateLimit`.

**Not yet:** about 630 "Host Hampton" mentions in page copy, ~95 phone
literals, the SMS templates, the `hampton-*` Tailwind palette, and the
HH-only pages (`/cm-cheer`, `/troop2514`, `/rse-merch`, …).
`tenantSurface.test.ts` T1 is a **ratchet**: it fails if any of those counts
goes UP. When you move some, lower the ceiling in the same commit.

One visible change: the JSON-LD `streetAddress` and the email footer now say
"295 Montauk Hwy" (the tenant value, per the 2026-10-04 "every listing says
exactly 295 Montauk Hwy" ruling) instead of "Montauk Highway".

### Cloning for a client (today)
1. Add `src/tenant/<client>.ts` exporting a `TenantConfig`; point `index.ts` at it.
2. Replace logos/icons under `public/images/`.
3. New Supabase project: base schema + addendum (`scripts/db_setup.sh`), then
   every `starting_plan/migration_*.sql` in order.
4. The client's own Stripe, SignWell, Resend domain, Quo/Twilio number (A2P
   10DLC registration takes 1–3 weeks), `.env` from the AGENTS.md §7 list.
5. Work the T1 ratchet down for the pages that client will show.

### Feature flags
`featureEnabled(name)` = the tenant file's value, which an env var can switch
OFF (`FEATURE_<NAME>`, anything but `true` once set) but never ON — an env var
cannot grant a module the tenant was not sold.

| Flag | Env override | What it gates |
|---|---|---|
| `managerAssistant` | `FEATURE_MANAGER_ASSISTANT` | `/admin/assistant` + its two API routes |
| `publicMcp` | `FEATURE_PUBLIC_MCP` | `POST /api/mcp` (404 when off) |
| `publicMcpInquiry` | `FEATURE_PUBLIC_MCP_INQUIRY` | the `start_inquiry` tool only |

## 2. Manager assistant — `/admin/assistant`

A chat in the admin (sidebar → Overview → Assistant). Claude with tool use;
model `ASSISTANT_MODEL` (default `claude-opus-5-5`, effort medium, refusal
fallbacks on). Spend is recorded per call to `marketing_ledger` as entity
`manager_assistant` and checked against the monthly LLM budget.

**Safety model:** the model can READ and PROPOSE; only a human can WRITE.

- Read tools: `find_client`, `search_parties`, `get_party`, `check_date`,
  `get_pricing`. Emails/phones go through `lib/contactLookup.ts`; stage comes
  from real `booking_payments` rows.
- Propose tools: `propose_create_party`, `propose_send_client_links`,
  `propose_pay_link`. They write nothing; they return a card with a signed
  token (`lib/assistant/proposals.ts`): HMAC with `adminSessionSecret()`,
  bound to the admin who asked, 30-minute expiry, single-use per container.
- Confirm (`/api/admin/assistant/confirm`) **replays the dashboard's own admin
  route** on the confirming admin's credentials (`lib/assistant/execute.ts`):
  `parties/create`, `parties/[id]` `send_client_links`, `plan/[ref]/pay-link`.
  So quiet hours, STOP lists, cancelled-booking refusals and pay-link caps all
  apply unchanged, and nothing about money or messaging is re-implemented.
- Creating a party always sends `sendEmail:false` (an unpriced plan would mail
  "$0.00"); links go out only through a separate confirmed send.
- A 4xx from the replayed route releases the claim (nothing happened, retry is
  safe); a 5xx keeps it (it may have half-happened).

## 3. Public MCP — `https://www.hosthampton.com/api/mcp`

Model Context Protocol, Streamable HTTP, stateless JSON responses, no auth.
Add it as a custom connector in ChatGPT (developer mode / Apps) or Claude
(Settings → Connectors → Add custom connector).

| Tool | Source |
|---|---|
| `get_business_overview` | the `/llms.txt` document, verbatim |
| `list_party_themes` | `loadQuoteCatalog` (the rows the quote matches, so every listed name prices) + `HOSTED_THEME_GROUPS` |
| `get_party_menu` | `buildPartyMenu` over the same catalog: inclusions, activity rules, every add-on, the mobile anchor |
| `get_quote` | the planner's engine. A mobile party gets its starting price and the quote link, never a total |
| `check_availability` | `GET /api/availability?bookingType=kids-party`: a month's open dates and start times |
| `check_date_availability` | `GET /api/availability` (calendar blocks). A calendar that could not be read is `available: null`, never open |
| `find_photos` | `findPhotos`: approved, no identifiable child |
| `get_booking_link` | the planner, the form and the phone |
| `list_upcoming_events` | `GET /api/events` |
| `get_reviews` | `lib/reviews.ts` |
| `start_inquiry` | **replays `POST /api/lead`** — screened, rate-limited, owner emailed + texted, customer auto-reply, attributed `utm_source=mcp`, `sourcePage=ai-assistant-mcp`, `heardAbout=ai_assistant`, `marketingConsent:false` |

Rate limit 200/caller and 2000/route per 10 minutes (ChatGPT's egress IPs are
shared, so the caller bucket is loose on purpose); `/api/lead`'s own intake
limit still applies to `start_inquiry`.

To count MCP leads: `bookings.party_tags->>'source_page' = 'ai-assistant-mcp'`.

Turning on the website chat, the ChatGPT directory package and the eval: `docs/ai-agents-launch.md`.
