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
| **Send** | Reuse the existing `scheduled_reminders` table + `app/api/cron/send-reminders` — **no new cron needed**. On booking, insert two rows: `checkin_link_36hr` (party start − 36h) and `checkin_link_dayof` (6:00am local on the party date), `channel: 'sms'`. Plus an admin "Send check-in link" button for on-demand. Skip/cancel both rows once `checkin_status = 'complete'`. Mind the local-vs-UTC conversion — `lib/reminders.ts` already parses party times, follow that pattern rather than inventing a second one. |
| **Admin** | Surface check-in status per booking, plus buttons to send/resend the link and to place, capture or release the $500 hold. Any staff may do all of it. Also needs a way to record a hold taken on the **GoDaddy POS** (§5b) and to flag it as still outstanding until released. |

## 4. Edge cases to handle

- **Link opened after the event** → expire it, show a friendly message.
- **Reminder fires after check-in is already done** → both scheduled sends must be cancelled or
  skipped on completion, or customers get texted about something they finished.
- **6am send on a party already checked in at 36h** → same suppression rule covers it.
- **Party time changes after the rows are scheduled** → reschedule both reminder rows, or they fire
  at the wrong time. Date changes are free now, so this will happen.
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

**Settled 2026-09-06 (second round) — nothing is open now:**
- ✅ **Send schedule:** an **admin button** (send on demand) **plus** two automatic sends —
  **36 hours before** the party, and again at **6:00am on the day**. Both suppressed once check-in
  is complete, so nobody gets nagged after they have already done it.
- ✅ **Best effort** — check-in never blocks a party. No hard gate on the day.
- ✅ **Any staff** can place, capture or release the $500 hold.
- ✅ **A GoDaddy POS terminal is available on site** as an alternative way to take the hold — see §5b.

### 5b. Two processors: Stripe vs the GoDaddy POS

Worth being explicit, because this is the one place the design can quietly go wrong: **the GoDaddy
POS is a different payment processor from Stripe.** Deposits and balances run through Stripe. A hold
placed on the GoDaddy terminal lives entirely outside this application — we cannot see it, release
it, or reconcile it automatically, and it lands in a separate dashboard and payout.

**Recommended split:**

- **Stripe is the default path.** The card saved at check-in is held with a manual-capture
  PaymentIntent. Staff place, capture and release it from admin with one click, and every state
  change is recorded on the booking. This is the whole point of collecting the card up front.
- **The GoDaddy POS is a documented manual fallback** — for a walk-in with no check-in on file, or
  when the saved card declines on arrival. Admin records it by setting
  `security_deposit_status = 'held_external'` with a free-text note (terminal reference, amount,
  who took it).

**The fallback's honest limitation:** a POS hold must also be **voided on the terminal** by staff.
Our app can flag that it is outstanding, but it cannot release it. If that manual step is missed the
customer's money stays tied up, which is exactly the kind of thing that produces an angry review. So
the admin UI should surface any `held_external` hold as an open item until someone marks it released.

If reconciliation across two processors turns out to be a nuisance in practice, the simplification is
to make Stripe the only path and keep the POS purely for ad-hoc in-person sales.

## 5c. Deployment notes — Phase 1 (PR #3, branch `worktree/grand-sparrow`)

**Env var to set on the box** (`.env`, see [[secrets-and-data]]):

```
SIGNWELL_CHECKIN_TEMPLATE_ID=07f9832a-65dd-493a-bb17-c11b10b9fca4
```

Owner-supplied 2026-09-07, from
`https://www.signwell.com/app/template_builder/07f9832a-65dd-493a-bb17-c11b10b9fca4`.
This is deliberately **separate** from `SIGNWELL_TEMPLATE_ID`, which stays pointed at the Studio
Rental Agreement — the check-in route reads its own var so the two documents never get confused.
Reuses the existing `SIGNWELL_API_KEY`. The ID is a template identifier, not a credential, but it is
useless without the API key.

**⚠ Pre-flight before running `migration_031_checkin_link.sql`.** Section 3 DROPs and rebuilds
`scheduled_reminders_reminder_type_check` from **migration 023's list**, and per
[[starting-plan-sql-is-stale]] the live DB has been hand-edited since. This exact class of failure
already bit this migration once — an earlier draft rebuilt `contact_interactions_type_check` from
the stale schema file and failed with 23514 because live rows used values the file did not list
(that section was removed, see §5 of the SQL).

Every `reminder_type` the *application code* writes is covered by the new list — that was checked.
The residual risk is **legacy values present in the live table that the code no longer writes**.
So read the live constraint first:

```sql
SELECT pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'scheduled_reminders_reminder_type_check';

-- and, belt and braces, what values actually exist:
SELECT DISTINCT reminder_type FROM public.scheduled_reminders ORDER BY 1;
```

Merge anything those return that the migration's list omits, **then** run it. If you skip this, the
rebuild either fails outright with 23514, or succeeds and silently breaks future inserts of the
dropped type — which is the precise bug migration 023 was written to fix.

## 6. Sequencing

Now that nothing is blocked, this can go in one pass, but staging it still de-risks the payments part:

Phase 1 — check-in page + contact details + marketing consent + embedded SignWell agreement, link
sent by **SMS** (admin-triggered).
Phase 2 — Stripe SetupIntent (save card) + the $500 manual-capture hold, plus admin capture/release
controls and the `security_deposit_status` transitions.
Phase 3 — automate the send on a schedule, and add reminders for anyone who has not checked in.

Phase 1 delivers most of the value (details, consent, signed waiver) with none of the payments risk.
