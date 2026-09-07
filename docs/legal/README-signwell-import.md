# Building the check-in agreement as a SignWell template

Companion to [`party-agreement-and-waiver-DRAFT.md`](./party-agreement-and-waiver-DRAFT.md).

> **Do not build this template until an attorney has reviewed the draft.** The draft
> contains open `[VERIFY WITH ATTORNEY]` and `[OWNER TO DECIDE]` items, and several
> sections carry placeholder policy (supervision ratios, house rules, permanent-jewelry
> age limits) that must be replaced with real Host Hampton policy first. Building the
> template early means rebuilding it.

---

## What this template is for

It is the document behind **`SIGNWELL_CHECKIN_TEMPLATE_ID`** — the pre-arrival check-in
flow, not the studio rental flow. The two are deliberately separate: see the comment in
`services/website/src/app/api/checkin/[token]/agreement/route.ts`, which explains that
sharing `SIGNWELL_TEMPLATE_ID` would cross-wire the webhook column writes.

The signing route creates an embedded document from this template and returns a signing
URL that renders in an iframe on our own check-in page.

---

## A. The field list — copy exactly

SignWell's `{{...}}` text tags are **only** expanded when a document is created via the API
from a raw file. The dashboard template builder does **not** expand them. So the `{{...}}`
markers in the draft are documentation of *where fields go* — you place the fields by hand
in the SignWell editor and set each one's **API ID** (Field → Settings → API ID).

### A1. Pre-filled by the app — these api_ids are mandatory and must match exactly

These are sent by `POST /api/checkin/[token]/agreement`. The names come from the `fields`
object at `services/website/src/app/api/checkin/[token]/agreement/route.ts:55` — **that code
is the source of truth, not this table.** If you rename one here, the prefill silently stops
arriving for that field.

| Field label in the document | api_id | Filled with | Type |
|---|---|---|---|
| Name | `client_name` | `contact_name` | Text, read-only |
| Email | `email` | `contact_email` | Text, read-only |
| Phone | `phone` | `contact_phone` | Text, read-only |
| Event date | `event_date` | `party_date` | **Date** |
| Start time | `start_time` | `party_time` | Text, read-only |
| Package | `package_type` | `package_type` | Text, read-only |
| Approximate guest count | `headcount` | `guest_count_approx` | Text, read-only |
| Where the party happens | `address` | the `checkin_*` address columns, joined | Text, read-only |

Two things to get right:

- **`event_date` must be a SignWell Date field.** The route sends full ISO-8601
  (`2026-06-13T00:00:00Z`) precisely because SignWell rejects a bare date on a Date field.
- **Set all eight to read-only.** These are details we pre-fill; the signer should not be
  editing them.

Note the naming differs slightly from the studio rental template (`docs/studio-rental-agreement-FIELD-MAP-and-REVIEW.md`):
this one has `package_type` and `address` where that one has `event_type` and money fields.
Follow the table above — it matches the check-in code.

### A2. Signer-entered — new fields, not pre-filled by anything

The check-in booking record has no columns for these (see
`starting_plan/migration_031_checkin_link.sql`), so they are captured in SignWell only and
live in the signed PDF. Naming follows the existing lower-snake-case style.

| Field | api_id | Type | Required |
|---|---|---|---|
| Child 1 name | `child_1_name` | Text | yes |
| Child 1 age | `child_1_age` | Text | yes |
| Child 2 name | `child_2_name` | Text | no |
| Child 2 age | `child_2_age` | Text | no |
| Child 3 name | `child_3_name` | Text | no |
| Child 3 age | `child_3_age` | Text | no |
| Allergies / medical / medications | `allergies_medical` | Text (multi-line) | **yes** |
| Emergency contact name | `emergency_contact_name` | Text | **yes** |
| Emergency contact phone | `emergency_contact_phone` | Text | **yes** |
| Relationship to child(ren) | `signer_relationship` | Text | yes |
| Printed name | `signer_printed_name` | Text | yes |
| Signature | `Signature_1` | Signature | yes |
| Date signed | `date_signed` | Date (auto) | yes |

Make the three medical/emergency fields **required**. That is the whole point of collecting
them, and a blank is worse than useless — it looks like an affirmative "none."

### A3. Photo release — checkboxes, all unchecked by default

Six independent checkboxes, **not** a radio group and **not** pre-ticked. Bundling or
pre-ticking is what makes a consent look coerced, and the point of Section 8 is that the
opt-out is genuine.

| Checkbox | api_id |
|---|---|
| No — do not use any photos of my child | `photo_none` |
| Private sharing with me / internal records | `photo_internal` |
| Host Hampton website and portfolio | `photo_website` |
| Host Hampton social media | `photo_social` |
| Paid advertising and boosted posts | `photo_paid_ads` |
| First name only alongside the image | `photo_first_name` |

**Operational rule that makes this real:** the signed PDF is the record of consent. Before
each party, whoever is hosting must check it — if `photo_none` is ticked, that child is not
photographed for public use. A consent form nobody reads on the day is just paperwork.

### A4. Signer role

Keep the signer placeholder named **`Client`**, matching the studio rental template. One
signer, no countersignature.

---

## B. Step by step in the SignWell dashboard

1. **Produce the PDF.** Render `party-agreement-and-waiver-DRAFT.md` to PDF *after* deleting
   the HTML comment block at the top, every `[VERIFY WITH ATTORNEY]` / `[OWNER TO DECIDE]`
   note, and the whole `Appendix — what the attorney needs to decide`. Those are internal.
   Leave room on the page for the fields you are about to place — the tables in the draft
   are laid out with that in mind.
2. **New template.** SignWell → Templates → **Create Template** → upload the PDF.
   Name it `Party Agreement, Risk Acknowledgment & Consents` (or whatever the attorney
   approves it as).
3. **Add the signer role.** One role, named exactly `Client`.
4. **Place the A1 fields**, assigned to `Client`. For each: Field → Settings → **API ID** →
   type the api_id from the table. Set **Read only**. Get `event_date` set to type **Date**.
5. **Place the A2 fields**, assigned to `Client`, editable. Mark `allergies_medical`,
   `emergency_contact_name` and `emergency_contact_phone` **required**.
6. **Place the A3 checkboxes** as six separate checkbox fields, assigned to `Client`,
   all unchecked, none required.
7. **Place the signature block** — `Signature_1` (Signature), `signer_printed_name` (Text),
   `date_signed` (Date, auto-filled at signing).
8. **Save the template**, then get its **API template UUID** — not the slug in the dashboard
   URL. `node --env-file=.env scripts/signwell-check.mjs` lists templates with their UUIDs.

---

## C. Where the template id goes

Set on the box:

```
/opt/hosthampton/.env
```

```
SIGNWELL_CHECKIN_TEMPLATE_ID=<the API template UUID>
```

Then restart the website container so it picks the value up (see `DEPLOY.md`).

Locally, the same variable goes in `services/website/.env.local` — the website reads its own
env, not just the repo-root `.env`. Without it set, the route returns
`{ unavailable: true, signingUrl: null }` and the rest of check-in still works, which is the
intended dev behaviour.

**Do not** reuse `SIGNWELL_TEMPLATE_ID` here. That is the studio rental template; the check-in
route guards on `SIGNWELL_CHECKIN_TEMPLATE_ID` specifically, and the two webhooks write to
different booking columns.

---

## D. After it is live — check these

- Run one real check-in end to end and confirm all eight A1 fields arrive pre-filled. A
  mismatched api_id fails silently: the field just renders empty.
- Confirm the completion webhook writes `checkin_agreement_signed_at` and
  `checkin_agreement_pdf_url` on the booking.
- Confirm the executed PDF is retrievable. Per the draft's Appendix, signed agreements should
  be retained for **20+ years** — the CPLR 208 infancy toll means a child injured at a party
  can sue until roughly age 21, and the signed form is the evidence of what was disclosed.
- **Version the document.** Put the draft version and date in the footer of every PDF you
  upload, and keep the superseded markdown in this folder. If the terms are ever disputed you
  need to show which text that customer actually saw.
