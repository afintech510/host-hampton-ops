# Venue & Lead-Directory Listing Plan — AI Agent Evaluation

**Status:** Planning only. Nothing in this document has been executed. No accounts have been created, no listings submitted, no credentials collected.
**Business:** Host Hampton — boutique celebration studio, 295 Montauk Hwy, Suite 7, Speonk, NY 11972 · (631) 998-9325 · hosthampton295@gmail.com · https://www.hosthampton.com
**Author intent:** Give the owner a realistic, skeptical assessment of how far an AI agent can actually get us listed on party-venue marketplaces and event/lead directories — and where a human must do the work.

---

## 0. The honest headline

An AI agent is **good at drafting and staging** listing content, filling forms, and tracking status. It is **bad at, or outright blocked from, finishing** most of these signups, because almost every target site defends the exact step that completes a listing: CAPTCHA, email/phone OTP, identity/ownership verification, payment entry, and Terms of Service that prohibit automated account creation.

The right mental model is **not** "an agent registers us everywhere overnight." It is:

> **Agent = a fast, tireless assistant that prepares every listing to the 90% mark and hands a human a one-click finish line.** The human clears the CAPTCHA, types the OTP, and clicks submit.

Anyone selling you full autonomous multi-site signup is selling you either a ToS violation, a botnet-flavored risk to your brand, or vaporware. This plan is built around the assistant model, not the autonomy fantasy.

---

## 1. Approaches, compared honestly

### 1a. "Claude cowork" / Claude computer-use / Claude for Chrome — what actually exists

The user asked about "Claude cowork." Clarifying the real products, because the naming is fuzzy:

| Thing people mean | What it actually is | Viable for this task today? |
|---|---|---|
| **Claude computer-use (API)** | An Anthropic API capability where the model controls a virtual desktop (mouse/keyboard/screenshots) in a sandbox you host. Powerful but you build/run the environment. | **Partially.** Real and capable, but you'd have to stand up the sandbox, and it hits the same CAPTCHA/OTP walls. Overkill for a handful of listings. |
| **Claude for Chrome / the Claude browser extension agent** | Anthropic's agentic browser extension that drives *your own logged-in Chrome*. Research/limited-availability preview; permission-gated per site. | **This is the closest to what the user imagines.** Because it runs in your real browser session, YOU are logged in, YOU pass the human checks, and the agent handles the tedious form-filling. Availability is limited and it deliberately pauses for sensitive actions. |
| **"Claude cowork" as a named product** | Not a distinct shipping product by that name as of this writing. It's shorthand people use for "Claude working alongside me in the browser." | Treat it as = the Chrome extension agent / computer-use, not a separate tool to go find. |
| **Claude Code + a browser MCP** | Claude Code (this environment) driving a browser via an MCP server (see §6). Semi-interactive: it can navigate/click/type/screenshot, and a human watches and intervenes. | **Viable for a supervised, one-site-at-a-time run.** This is the most practical "agentic" path we already have access to — but it is still human-in-the-loop by necessity. |

**Bottom line on Claude-family tools:** the browser-extension / MCP-driven approaches are viable *as a supervised assistant*. None of them legitimately bypass the human-verification steps, and you should not want them to — bypassing those is what gets accounts banned.

### 1b. Browser-automation agents (Playwright/Puppeteer + LLM, "browser-use," etc.)

- **What it is:** Scripted or LLM-guided headless/headful browser automation.
- **Strengths:** Repeatable, cheap to re-run, good for *updating* many listings once accounts exist.
- **Weaknesses:** Headless browsers are the #1 thing bot-detection (Cloudflare, reCAPTCHA v3, DataDome, hCaptcha) is tuned to catch. Signups from automation frameworks get silently shadow-flagged or hard-blocked. Maintaining selectors across site redesigns is real ongoing work.
- **Verdict:** **Not for signups.** Reasonable later for bulk *edits/refreshes* on platforms that offer it, and even then only within ToS. Do not use it to create accounts on marketplaces.

### 1c. Listing-distribution / citation services (Yext, Uberall, BrightLocal, Moz Local, etc.)

- **What they are:** Paid services that push your Name/Address/Phone (NAP) + business details to dozens of local directories and data aggregators from one dashboard.
- **Strengths:** Purpose-built for the *local citation* half of this list. They handle the directory relationships, keep NAP consistent, and update everywhere at once. Far more reliable than any bespoke agent for Yelp-tier general directories and data aggregators.
- **Weaknesses:** Subscription cost. They do **not** cover curated per-listing marketplaces (Peerspace, Giggster, etc.) or vertical party platforms that require human onboarding, portfolios, and pricing (The Bash, PartySlate, The Knot). Some create listings you don't fully "own" (they can revert if you stop paying — Yext is notorious for this).
- **Verdict:** **The right tool for the citation directories**, and honestly a better use of money than trying to agent-automate Yelp/Bing/Apple. Consider a one-time citation cleanup service (BrightLocal or Whitespark do project-based citation building) rather than a perpetual Yext lease, given a single-location small business.

### 1d. Human-in-the-loop hybrid (agent fills, human clears the wall)

- **What it is:** Agent (Claude browser extension or Claude Code + browser MCP) navigates, fills every field from a prepared content pack, and **pauses** at CAPTCHA / OTP / payment / final submit. Human completes those, agent resumes to capture confirmation and log status.
- **Verdict:** **This is the recommended primary approach for the marketplaces and vertical directories.** It captures ~80% of the tedium (account fields, business description, service lists, hours, photos upload, category selection) while keeping a human on exactly the steps that legally and technically require one.

### Which approach maps to which site

| Site group | Best approach | Why |
|---|---|---|
| **Local citation** (Google Business Profile, Yelp, Bing Places, Apple Business Connect, Nextdoor) | Manual owner setup for GBP; **citation service** (BrightLocal/Whitespark/Uberall) for the long tail | Ownership/postcard/OTP verification + these are exactly what citation services specialize in |
| **Space-rental marketplaces** (Peerspace, Splacer, Giggster, This Open Space, LiquidSpace) | **Human-in-the-loop agent** (draft + fill) → human finishes; each listing is human-curated/approved anyway | Per-listing review, host onboarding, payout/ID setup — no legit full automation |
| **Party/event lead directories** (The Bash, GigSalad, Tagvenue, Eventective, PartySlate, The Knot, WeddingWire) | **Human-in-the-loop agent** for form-fill; human for verification, payment, and portfolio curation | Vendor vetting, paid tiers, portfolio uploads, phone verification |
| **Community/local** (Macaroni KID Hamptons, Facebook Groups, Nextdoor) | **Human, relationship-based** (agent drafts copy only) | These are relationship/editorial channels; automation reads as spam and risks bans |

---

## 2. Hard blockers — be honest

These are the walls. For each, whether an agent can pass it and who must act.

| Blocker | Where it shows up | Can an agent pass it? | Reality |
|---|---|---|---|
| **CAPTCHA / bot detection** (reCAPTCHA, hCaptcha, Cloudflare Turnstile, DataDome) | Nearly every signup | No — legitimately | Solving-service workarounds are ToS violations and get accounts nuked. **Human clears it.** In a supervised session the human is right there. |
| **Email OTP / verification link** | Every platform | Only if the agent can read the inbox | Requires access to the verification inbox (see §3). Even then, treat as human-confirmed. |
| **Phone OTP (SMS)** | The Bash, GigSalad, marketplaces, GBP | Only if agent can read the SMS line | Needs the real business line or a controlled VoIP number the human/agent can read. |
| **Google Business Profile verification** (postcard, phone, **video**) | GBP specifically | **No.** | Google increasingly requires **video verification** (record the storefront, signage, equipment) or a mailed **postcard** with a PIN. Both are physically human. **Owner must do GBP verification personally.** This is non-negotiable and the single most important listing — do it first, by hand. |
| **Terms of Service on automated signup** | Yelp, Google, Facebook/Nextdoor, most marketplaces | — | Many ToS explicitly prohibit automated/bot account creation and scraping. A *supervised human-in-the-loop* session where the human drives the account creation is defensible; fully autonomous bot signup is a ToS breach and a brand risk. **Default to human-driven account creation; agent assists with content.** |
| **Payment / paid tier onboarding** | The Knot, WeddingWire, PartySlate, Tagvenue (paid leads), Yext | No — and shouldn't | Entering card details and committing to spend is an owner decision. **Agent never enters payment. Human only.** |
| **Identity / payout / tax onboarding** | Peerspace, Giggster, Splacer (host payouts) | No | Bank/Stripe/tax ID for receiving booking payouts. **Owner only.** |
| **Portfolio / photo curation & editorial approval** | PartySlate, The Knot, marketplaces | Partial | Agent can upload a prepared asset set; final curation and platform editorial approval are human/manual. |

**Where automation is realistically impossible or ToS-violating:** GBP verification (impossible for an agent), any CAPTCHA-solving via third-party services (ToS-violating), payment entry (prohibited by policy here), Facebook Group / Nextdoor participation via automation (reads as spam, ban risk). **Mandatory human sign-off:** all payments, all identity/payout, GBP verification, and final "publish/submit" on every marketplace.

---

## 3. Prerequisites the owner must provide before any agent runs

Nothing should run until these exist. Gather them into one place first.

1. **A verification-capable inbox the agent (or the human running the agent) can read.** Options:
   - Use the existing `hosthampton295@gmail.com`, **or** a dedicated `listings@hosthampton.com` alias that forwards there. A dedicated alias is cleaner: it isolates listing/verification mail, avoids cluttering the main inbox, and is easy to revoke. (Note: the repo/email stack already routes hosthampton.com mail — see MEMORY email-deliverability notes — so an alias is low-effort.)
2. **A phone line that can receive SMS OTP and calls**, and whose messages the operator can read during a session. The business line (631) 998-9325 is the honest NAP number and should be what's *listed*. For OTP you can use it directly (owner reads the code) or a controlled VoIP number that forwards — but the **listed** number must stay the real business number for NAP consistency.
3. **Brand asset pack:** logo (SVG + PNG, square + horizontal), 8–15 high-res photos (studio room, themed setups, mobile-party setups, permanent jewelry), and 1–2 short video clips (also reusable for GBP video verification).
4. **Standardized copy blocks** (write once, reuse everywhere — see §7 for the starter pack):
   - Short description (~160 chars), long description (~600–1,000 chars)
   - Service list (studio rentals, themed kids/first-birthday/communion parties, baby & bridal showers, blank-canvas room rental, Mobile Party, permanent jewelry)
   - Service area (Speonk + ~20-mile Mobile Party radius; the Hamptons / East End / Long Island)
   - Hours (Sat–Sun 10–8, Mon–Fri 12–7)
   - FAQ (already canonical at /faq — reuse verbatim)
5. **Pricing to publish** — decide explicitly what goes public: packages from $800, first birthday from $850, permanent jewelry from $65, 25% deposit model. Confirm each is OK to show on third-party sites (some owners prefer "starting at / contact for quote").
6. **Credential storage** — a password manager set up *before* the first account (see §5). No account gets created until there's a vault to store it in.
7. **A decision on paid tiers** — which directories the owner is willing to pay for (The Knot/WeddingWire/PartySlate are pay-to-play for real visibility). Free-tier-only is a valid choice; just decide up front.

---

## 4. Phased rollout

Ordered by ROI-to-friction. Each phase names what the agent does, where the human checkpoint sits.

### Phase 0 — Foundation (owner + one setup session, no listings yet)
- Create/confirm the verification inbox/alias and password vault (§3, §5).
- Assemble the asset pack and copy blocks (§7).
- Outcome: everything downstream is copy-paste, not re-decided per site.

### Phase 1 — Own your core identity (highest ROI, do by hand)
**Sites:** Google Business Profile, then Yelp, Bing Places, Apple Business Connect.
- **GBP first and manually.** It's the single biggest local-visibility lever and requires video/postcard verification the owner must do personally. Agent's role here is limited to *drafting* the description/services/categories/Q&A the owner pastes in.
- Human checkpoint: **entirely human** for GBP verification; agent assists only with content.
- Then Yelp/Bing/Apple: owner-driven claim, agent drafts and stages content.

### Phase 2 — Local citation sweep (delegate to a service, not an agent)
**Sites:** the long tail of general directories + data aggregators.
- Engage a **citation service** (BrightLocal / Whitespark project, or Uberall/Yext if perpetual sync is wanted) to push consistent NAP.
- Human checkpoint: owner approves the master NAP record once; service handles distribution.
- Rationale: cheaper, faster, and more reliable than agent-automating dozens of low-value directories.

### Phase 3 — Party/event lead directories (agent-assisted, human-finished)
**Sites, in priority order for this business:**
1. **The Bash** and **GigSalad** — highest intent for party/entertainment leads; strong fit for themed kids parties + mobile party.
2. **Eventective**, **Tagvenue** — venue/space discovery; good fit for the studio room rental.
3. **PartySlate** — visual/portfolio-driven; great for showcasing themed setups (evaluate paid tier).
4. **The Knot**, **WeddingWire** — bridal showers angle; only if willing to pay for a vendor listing (these are pay-to-play).
- Agent's role per site: create draft account fields, fill business info from the copy pack, upload the asset set, select categories, enter service area.
- **Human checkpoints:** clear CAPTCHA, enter email/phone OTP, enter any payment, curate portfolio, click final submit.

### Phase 4 — Space-rental marketplaces (agent-assisted, human-finished)
**Sites, in priority order:**
1. **Peerspace** — largest, best fit for a "blank-canvas studio room rental."
2. **Giggster**, **Splacer** — similar event/production space rental.
3. **This Open Space**, **LiquidSpace** — LiquidSpace skews office/coworking; lowest fit — evaluate before spending effort.
- Agent's role: draft the listing, fill space details/amenities/pricing/availability, upload photos.
- **Human checkpoints:** identity/payout (Stripe/bank) setup, pricing/calendar confirmation, CAPTCHA/OTP, final publish. Each listing is human-reviewed by the platform anyway.

### Phase 5 — Community & relationship channels (human-led, agent drafts only)
**Sites:** Nextdoor Business, Macaroni KID Hamptons, relevant local Facebook Groups.
- These are editorial/relationship channels. Automation reads as spam and risks bans.
- Agent's role: **draft posts/blurbs only.** A human posts, using a real personal/business identity, following each group's rules (many require admin approval / no direct promo).

### Status tracking
Maintain a simple CSV/table (see §8) updated after every session: site → account status → listing-live status → owner-action-needed → notes. This is the single source of truth for "what's left."

---

## 5. Credential & security guidance

**This repo has a documented history of secret leaks** (see MEMORY: `.env.delete` leaked live Stripe/Supabase/Twilio/Resend keys). Treat listing credentials with the same seriousness.

Rules:
1. **Never hardcode credentials in the repo.** No account emails, passwords, API keys, or OTP secrets in any file, commit, script, or this docs tree. This planning doc itself contains zero credentials by design.
2. **Use a dedicated password manager** (1Password, Bitwarden) as the single vault for every listing account. One unique strong password per site. Enable 2FA per site where offered (store TOTP seeds in the vault, not in code).
3. **Shared-inbox pattern for verification**, not shared passwords in plaintext. The agent/human reads OTP from the inbox at runtime; codes are never stored.
4. **A dedicated `listings@hosthampton.com` alias** isolates listing/verification mail and is trivially revocable if a platform relationship sours or a credential is suspected compromised.
5. **Least privilege for any agent run:** the agent gets access to the browser session and the verification inbox *for the duration of a supervised session only*. It does not get standing access to the password vault; the human pastes/authorizes credentials as needed, or uses the browser's own autofill under supervision.
6. **No committing of any run artifacts that contain secrets** — screenshots taken during a session can capture OTPs, tokens, or partial card data; scrub or keep them out of the repo.
7. **Payment data is never handled by the agent.** Owner enters card details directly.

---

## 6. Tooling available in this environment (building blocks — not used here)

Noted for the owner's awareness; **none were invoked for this planning task.**

- **Browser MCP** (`browser_navigate`, `browser_click`, `browser_type`, `browser_screenshot`, `browser_scroll`, etc.) — could drive a real, supervised signup session semi-interactively: navigate to a site, fill fields from the copy pack, screenshot for the human, and pause at verification walls. This is the concrete mechanism behind the "human-in-the-loop agent" approach in §1d/§4. It is a *supervised* tool, not an autonomous one.
- **Gmail / Google MCP connectors** (`search_threads`, `get_message`, etc.) — could read verification emails/OTP links from the listings inbox at runtime, so the human doesn't have to relay codes manually. Use only against the dedicated listings alias, only during a session.
- **Quo (OpenPhone) MCP connector** (`fetch-messages`) — could read SMS OTP delivered to a controlled Quo number, same pattern.
- **Reality check:** having these tools does **not** remove the §2 blockers. They make the human-in-the-loop loop tighter (agent reads the code the moment it arrives), but CAPTCHA, GBP video verification, payment, ToS, and final human sign-off remain. These are accelerants for a supervised process, not a route to autonomy.

---

## 7. Starter content pack (fill/confirm before Phase 1)

Draft from known facts; **owner must confirm each line before it's published anywhere.**

- **Business name:** Host Hampton
- **Short description (~160 chars):** "Host Hampton is a woman-owned boutique celebration studio in Speonk, NY — themed kids & first-birthday parties, showers, studio rentals, and at-home Mobile Parties across the East End."
- **Service list:** Themed kids' & first-birthday parties · Communion parties · Baby & bridal showers · Blank-canvas studio room rental · Mobile Party (at-home activities/decor/host) · Permanent jewelry
- **Service area:** Speonk, NY and the surrounding Hamptons / East End / Long Island; Mobile Party within ~20 miles of Speonk.
- **Hours:** Sat–Sun 10:00–20:00, Mon–Fri 12:00–19:00
- **Pricing (confirm public-vs-private):** Packages from $800 · First birthday from $850 · Permanent jewelry from $65 · 25% deposit to book
- **NAP (must be identical everywhere):** Host Hampton · 295 Montauk Hwy, Suite 7, Speonk, NY 11972 · (631) 998-9325 · https://www.hosthampton.com
- **FAQ:** reuse /faq verbatim.
- **Categories to select (map per platform):** Party planner / event venue / children's party service / bridal shower / event space rental.

> Long description: expand from the site's existing reusable business-facts copy so third-party listings stay consistent with hosthampton.com. Do not invent new claims.

---

## 8. Status-tracking template

Create as `listing-status.csv` (kept out of commits if it ever holds anything sensitive; NAP is public so the base file is fine — just no credentials in it).

| site | group | approach | account_status | listing_live | paid_tier | owner_action_needed | last_updated | notes |
|---|---|---|---|---|---|---|---|---|
| Google Business Profile | local | human | not started | no | free | video/postcard verification | — | do first |
| Yelp | local | human+agent draft | not started | no | free | claim + verify | — | |
| Bing Places | local | human+agent draft | not started | no | free | — | — | can import from GBP |
| Apple Business Connect | local | human+agent draft | not started | no | free | Apple ID verify | — | |
| (citation long tail) | local | service | not started | no | paid | pick service | — | BrightLocal/Whitespark |
| The Bash | lead dir | agent+human | not started | no | ? | phone verify | — | high intent |
| GigSalad | lead dir | agent+human | not started | no | ? | phone verify | — | high intent |
| Eventective | lead dir | agent+human | not started | no | ? | — | — | studio room |
| Tagvenue | lead dir | agent+human | not started | no | ? | — | — | studio room |
| PartySlate | lead dir | agent+human | not started | no | ? paid | portfolio | — | visual |
| The Knot | lead dir | human+payment | not started | no | paid | payment | — | showers |
| WeddingWire | lead dir | human+payment | not started | no | paid | payment | — | showers |
| Peerspace | marketplace | agent+human | not started | no | commission | payout/ID | — | best space fit |
| Giggster | marketplace | agent+human | not started | no | commission | payout/ID | — | |
| Splacer | marketplace | agent+human | not started | no | commission | payout/ID | — | |
| This Open Space | marketplace | agent+human | not started | no | commission | payout/ID | — | lower priority |
| LiquidSpace | marketplace | agent+human | not started | no | commission | payout/ID | — | office-skewed; evaluate |
| Nextdoor Business | community | human | not started | no | free | address verify | — | |
| Macaroni KID Hamptons | community | human | not started | no | ? | editorial | — | relationship |
| Facebook Groups (local) | community | human | not started | no | free | group rules | — | no automation |

---

## 9. Recommendation in one paragraph

Do **not** try to build or buy a fully autonomous agent that "signs up everywhere." Instead: (1) the owner personally sets up and verifies **Google Business Profile** first — it's the highest-value listing and only a human can verify it; (2) hand the **local citation long tail** to a citation service rather than automating it; (3) use a **supervised human-in-the-loop agent** (Claude browser extension or Claude Code + the browser MCP, with the Gmail/Quo connectors reading OTPs) to draft and fill the **marketplaces and vertical party directories**, pausing at every CAPTCHA/OTP/payment/publish wall for the owner; (4) keep **community channels human**. Set up a password manager and a dedicated `listings@` alias before creating a single account, and never put a credential in this repo. The agent's real value is eliminating the tedium of typing the same business facts into 20 different forms — not pretending it can pass the human-verification walls that every one of these platforms deliberately puts in the way.
