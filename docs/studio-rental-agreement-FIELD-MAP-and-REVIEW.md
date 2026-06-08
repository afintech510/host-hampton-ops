# Studio Rental Agreement — SignWell setup, field map & legal review

Companion to `studio-rental-agreement-signwell.html`.

---

## A. How to get it into SignWell

> NOTE: SignWell's `{{...}}` text tags are only expanded when a document is created
> **via the API from a raw file** — the dashboard "upload template" builder does NOT
> expand them. So fields are placed manually in the editor. The code is resilient: it
> only sends prefill for api_ids that exist on the template (no 422), and auto-fills
> more as you add fields. Build the template once, set the api_ids below exactly.

**Env (already done):**
- Use the **API template UUID** for `SIGNWELL_TEMPLATE_ID` (NOT the dashboard URL slug).
  List it with `node --env-file=.env scripts/signwell-check.mjs`.
- Keys must live in `services/website/.env.local` (the website's env), not just repo-root `.env`.

**Template fields to place in the SignWell editor (signer role = `Client`):**

Already added (keep): autofill name, autofill email, signature.

Add a **Text** field on each value cell and set its **API ID** (Field → Settings → API ID)
to exactly these — these are what the booking flow pre-fills:

```
event_type   event_date   start_time   end_time   headcount
rental_fee   addons       total_due    deposit_due   balance_due   security_deposit
phone        (or convert the existing autofill-phone field to a Text field with api_id "phone")
```

Set those Text fields to **Read only** so the client can't edit the details we pre-fill.
Leave the signature (and any printed-name) editable by the signer.

Copy the template UUID → `SIGNWELL_TEMPLATE_ID` → restart `next dev`. The webhook URL is a
production-only step.

---

## B. Text-tag syntax used (for reference)

Format: `{{type:signer:required:label:prefill:api_id:width:height}}`
(colons separate options; empty between two colons = use default)

The code pre-fills each field by **api_id** at send time via the API, so the api_id
values below **must not change** — they map 1:1 to `/api/studio-rental/checkout`.

| Field (label) | api_id | Filled with |
|---|---|---|
| Client Name | `client_name` | contact name |
| Phone | `phone` | contact phone |
| Email | `email` | contact email |
| Event Type | `event_type` | e.g. "Baby Shower" |
| Event Date | `event_date` | "Saturday, June 13, 2026" |
| Start Time | `start_time` | "2:00 PM" |
| End Time | `end_time` | "6:00 PM" |
| Headcount | `headcount` | guest count |
| Rental Fee | `rental_fee` | block rate, e.g. "$775" |
| Add-Ons | `addons` | add-ons subtotal |
| Total Due | `total_due` | rental + add-ons |
| Deposit Due | `deposit_due` | 25% reservation deposit |
| Balance Due | `balance_due` | remaining balance |
| Security Deposit | `security_deposit` | "$500" |
| Signature | (signature) | client signs |
| Date Signed | (auto date) | sign date |
| Printed Name | `signer_printed_name` | client types name |

`signer_printed_name` is signer-entered (not pre-filled by the API) — that's fine,
it's an extra field, not required by the code.

---

## C. What I changed vs. the HoneyBook version, and why

The original was written for the **$75/hr hourly studio** with a **$100** deposit and
**60-seat** capacity. Your real product here is the **full-studio block rental** ($450/$575
tiers), **$500** refundable security deposit, **65 seated / 85 standing**. Rather than
hard-code numbers, the template now pulls every dollar figure and detail from **merge
fields**, so one template serves every booking and always matches what the customer saw
and paid online.

**Protection upgrades (recommended, already in the template):**

1. **Two deposits clearly separated.** The original blurred "security deposit" (it said
   $100 "due to secure reservation"). Now: a **25% non-refundable Reservation Deposit**
   that holds the date + a **separate refundable $500 Security Deposit hold** placed day-of.
   This removes the biggest ambiguity and matches the online flow.
2. **Explicit card-authorization clause (Section 1).** The client authorizes charges for
   the balance, overtime, and damages up to and beyond capturing the security hold. Without
   this, charging a card later is legally shaky — this is the single most important addition.
3. **Payment schedule in writing:** balance due 7 days before; add-on/guest-count lock dates.
4. **Indemnification + defense** added to the liability waiver (original only had a release).
5. **Attorneys' fees, severability, entire-agreement, NY venue (Suffolk County)** in the
   governing-law section — standard teeth that make it enforceable and cheaper to enforce.
6. **Electronic-signature consent (ESIGN/UETA)** — makes the SignWell e-signature
   clearly binding.
7. **Occupancy limits** the client must not exceed (fire-code / safety).
8. **Alcohol liability** shifted squarely to the client; bartender/insurance may be required.
9. **Photography/marketing release** with a written opt-out.
10. Capacity corrected to **65 seated / 85 standing**; garbage-removal expectation clarified.

**Policy decisions — FINALIZED (no placeholders remain in the template):**

- **Cancellation** (Section 8): 25% deposit always non-refundable; cancel >30 days out =
  amounts above the deposit refunded; within 30 days = 50% of balance paid refundable;
  within 7 days = no refund.
- **Reschedule** (Section 8): one reschedule, ≥14 days notice, subject to availability.
- **Signers:** one signer (the Client) — matches the embedded flow. No countersignature.

**Optional, not added (tell me if you want them):**

- A **certificate-of-insurance / event-insurance requirement** for larger headcounts.
- A **noise/curfew** clause if your location has one.
- A **"no resale / no commercial filming without permit"** clause.

---

## D. Status

Policy wording is finalized — the template is ready to upload as-is. Optional polish still
available on request: restyle to the site brand (navy + Libre Baskerville) so the signed PDF
looks on-brand, or add a COI/event-insurance requirement for larger headcounts.
