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

## 2. The two hard dependencies

**A. SMS delivery is not currently guaranteed.** `lib/sms.ts` routes through `SMS_PROVIDER`
(Twilio default, Quo available), and **A2P 10DLC registration is still pending** — see
[[quo-sms-integration]]. Until A2P is approved, automated application-to-person texts to US numbers
are liable to be filtered or blocked. **Decide:** wait for A2P, or send the link by email first with
SMS added later. Email works today via Resend.

**B. Stripe authorization holds expire in about 7 days.** You cannot place the $500 hold when the
link is filled in if that is three weeks before the party. The correct shape is two steps:

- **At check-in time:** `SetupIntent` → save the card as a reusable payment method (no charge, no hold).
- **On/just before arrival:** create a `PaymentIntent` with `capture_method: 'manual'` for $500
  against the saved card. That is the actual hold. Capture it only if there is damage; otherwise
  cancel it and the hold drops off.

This also matches what the site now tells customers ("authorized on your card when you arrive").
Note there is currently **no** programmatic auth code anywhere — `security_deposit_status` is only
ever written as `'none'`.

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

## 5. Decisions needed before building

1. **SMS now or email now?** (blocked on A2P — see 2A)
2. **SignWell embed, or in-page waiver?**
3. **When does the link send** — on booking, X hours before, or admin-triggered?
4. **Is check-in required** before the party, or best-effort?
5. **Who can capture the $500** — any staff, or owner only?

## 6. Sequencing suggestion

Phase 1 — the page + details + consent + agreement, link sent **by email**, admin-triggered.
Phase 2 — add the Stripe SetupIntent + manual-capture hold and the admin capture/release controls.
Phase 3 — add SMS once A2P clears, and automate the send on a schedule.

Phase 1 delivers most of the value (details, consent, signed waiver) with none of the payments risk.
