# Pre-Arrival Check-In Link — Feature Plan

**Requested 2026-09-05 (owner):** *"Generate a link that is auto texted to client. It should be a link
to a Host Hampton page for them to put in their name, address, phone, email (marketing opt in), CC info
for $500 auth hold for security deposit, and review / sign rental agreement / liability waiver."*

**Status: NOT BUILT.** The deposit/policy changes shipped separately. This is a multi-part build
touching payments, SMS and e-signature, and it has two hard external dependencies (below). Written up
so it can be scoped and sequenced rather than half-built.

---

## 1. What it does

One tokenised link per booking, texted to the client before their event. The page collects, in order:

1. **Contact details** — name, address, phone, email
2. **Marketing opt-in** — explicit checkbox (must write through the existing consent layer,
   `lib/consent.ts`, not a bare boolean — this is the same consent gate the marketing system uses)
3. **Card on file → $500 security authorization**
4. **Review + sign** the rental agreement / liability waiver

On completion: booking flips to "checked in", card is stored, agreement is on file, and staff see a
green light in admin.

## 2. Dependencies — ALL RESOLVED 2026-09-06

**A. SMS is unblocked.** ✅ A2P 10DLC registration is **complete and approved**. Send through
`sendSMS()` in `lib/sms.ts`, which routes on the `SMS_PROVIDER` env var; transactional traffic is
pinned to **Quo**, marketing stays on Twilio. Use `sendSMSVia('quo', …)` if the check-in link must
be provider-explicit regardless of the global default. Note MMS always goes via Twilio (Quo has no
media support) — not relevant here, this is a plain text link.

**B. Card-on-file is approved.** ✅ Owner confirmed "allow save card". So the two-step shape:

- **At check-in time:** `SetupIntent` → save the card as a reusable payment method (no charge, no hold).
- **On/just before arrival:** create a `PaymentIntent` with `capture_method: 'manual'` for $500
  against the saved card. That is the actual hold. Capture it only if there is damage; otherwise
  cancel it and the hold drops off.

This is required rather than optional, because **Stripe authorization holds expire in about 7 days** —
you cannot place the hold when the form is filled in three weeks before the party. It also matches
what the site now tells customers ("authorized on your card when you arrive"). Note there is
currently **no** programmatic auth code anywhere — `security_deposit_status` is only ever written
as `'none'`.

**C. Signature method: use SignWell, embedded.** ✅ See §2b.

### 2b. SignWell vs. an in-page waiver

`lib/signwell.ts` is already a working **embedded** signing client — it creates a document from a
dashboard template and returns a signing URL that renders **inside an iframe on our own page**, with
a completion webhook (`app/api/studio-rental/signwell-webhook`). So this is not a redirect away to a
third-party site.

| | SignWell (already built) | In-page waiver (would be built) |
|---|---|---|
| What it is | A DocuSign competitor — same category, cheaper | Rolling our own minimal version of DocuSign |
| Legal evidence | Certificate of completion + tamper-evident audit trail (identity, timestamp, IP), executed PDF stored | Valid under ESIGN/UETA if logged well, but *we* must produce and defend the evidence |
| Document versioning | Handled by the template | We must snapshot the exact text version each signer saw |
| UX | Embedded iframe — stays on our page | Fully inline, marginally faster |
| Dev effort | Low — reuse what exists | Higher — build, store, version, and audit it ourselves |
| Cost | Per-document / plan | Free |

**Recommendation — hybrid, and it is the cheap option:** our check-in page collects the contact
details, marketing consent and card; the **rental agreement and liability waiver go through the
embedded SignWell template**. A liability waiver is precisely the document where an audit trail
earns its keep — if a parent later disputes signing it, "here is the signed PDF and its certificate"
ends the conversation, whereas home-grown logs invite an argument. Since SignWell is already
integrated and embeds inline, choosing it costs almost no extra build effort.

## 3. Build outline

| Piece | Notes |
|---|---|
| **DB** | Add `checkin_token` (unique, unguessable), `checkin_status`, `checkin_completed_at`, `stripe_payment_method_id`, `security_deposit_payment_intent_id` to the bookings table. `security_deposit_status` already exists — start using its non-`none` values. |
| **Route** | `app/checkin/[token]/page.tsx` — public but token-gated. Token must be random (not the booking ref), single-purpose, and expire after the event. |
| **API** | `POST /api/checkin/[token]` (save details + consent), `POST /api/checkin/[token]/setup-intent` (card), `POST /api/admin/bookings/[id]/security-hold` (place/capture/release — admin only). |
| **Consent** | Route the marketing opt-in through `lib/consent.ts` so it lands in the same ledger the marketing graph reads. Do not store a loose boolean. |
| **Agreement** | Two options — embed **SignWell** (already integrated for studio rentals, `app/api/studio-rental/signwell-webhook`), or an in-page waiver with a typed signature + timestamp + IP. SignWell is stronger evidence and already wired; in-page is faster and cheaper. **Owner decision needed.** |
| **Send** | Trigger options: cron (X hours before event), admin button, or automatically on booking confirmation. Recommend **admin button first** — zero automation risk while the flow is proven, then add cron. |
| **Admin** | Surface check-in status per booking, plus buttons to resend the link and to capture or release the hold. |

## 4. Edge cases to handle

- **Link opened after the event** → expire it, show a friendly message.
- **Card declines the $500 auth** on arrival → staff needs a clear failure state and a retry path.
- **Customer never fills it in** → the party still has to run; this cannot become a hard gate on the day.
- **Multiple submissions / shared link** → last-write-wins, and never expose booking details before
  the token is validated.
- **Auth placed but event cancelled** → must explicitly cancel the PaymentIntent so the hold releases.
- **Hold expiry** if the event slips past 7 days from the auth → re-auth needed.
- **PCI** — card data must go through Stripe Elements only; never touches our server or DB.
- **Existing bookings** taken before this exists have no token — backfill or leave manual.

## 5. Decisions

**Settled 2026-09-06:**
- ✅ **SMS by text is fine** — A2P approved; send via Quo (transactional).
- ✅ **Save the card** — SetupIntent at check-in, manual-capture hold on arrival.
- ✅ **SignWell, embedded** for the agreement + waiver (§2b).
- ✅ **Refund policy** confirmed: half the $250 deposit non-refundable >30 days out, full deposit
  within 30 days, no date-change fee.

**Still open (do not build past these without an answer):**
1. **When does the link send** — on booking confirmation, X hours before the event, or
   admin-triggered? *(Recommend: admin button first, then a cron once proven.)*
2. **Is check-in required** before the party, or best-effort? *(Recommend best-effort — it must
   never block a party that is physically happening.)*
3. **Who can capture the $500** — any staff, or owner only?

## 6. Sequencing

Now that nothing is blocked, this can go in one pass, but staging it still de-risks the payments part:

Phase 1 — check-in page + contact details + marketing consent + embedded SignWell agreement, link
sent by **SMS** (admin-triggered).
Phase 2 — Stripe SetupIntent (save card) + the $500 manual-capture hold, plus admin capture/release
controls and the `security_deposit_status` transitions.
Phase 3 — automate the send on a schedule, and add reminders for anyone who has not checked in.

Phase 1 delivers most of the value (details, consent, signed waiver) with none of the payments risk.
