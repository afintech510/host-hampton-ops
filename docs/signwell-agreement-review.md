# The SignWell e-signature surface — attack and repair

**Link 15 of the build chain. 2026-09-12.** Worktree `singing-nebula`.
Main was `8dbd644` at the start; this work landed as `97718bd`.
**No migration taken — 046 is still free.**
Suite **2111 → 2191 green**, 0 app `tsc` errors, `/book` still `○ Static` 7.15 kB.

Scope: the rental agreement, the pre-arrival check-in agreement, the marketing
consent release, and the security deposit.

---

## 1. What was measured first

The brief supplied four numbers and asked rule 17 of them: of 61 bookings,
2 had a `signwell_document_id`, **0 had ever had an `agreement_signed_at`**,
0 had a check-in document, and **0 had ever held a security deposit**.

The schema was read before anything was concluded (rule 13). All eight columns
are `text` or `timestamptz` and all are nullable; the only CHECK anywhere on the
surface is `bookings_checkin_status_check` on `('pending','started','complete')`,
which nothing here writes outside those values. **So unlike link 10's queue, the
tables would have accepted the evidence.** That ruled out the cheap explanation
and left the expensive one.

Then SignWell's own API was asked what it thought. That is where the session
turned:

```
GET /api/v1/documents/   →  15 documents, all but four live (test_mode: false)
GET /api/v1/hooks        →  []
```

**`GET /hooks` returned an empty array.** No webhook had ever been registered on
the account. All three handler routes, their tests and their documentation
described a system that had never once been invoked — not "no customer signed",
but *no signature could ever have been recorded*. This is the exact shape link 10
and link 11 each found a dead subsystem with, and it is why the rule is worded
"never ran and could not have run look identical from outside".

And the documents themselves settle what that cost:

| document | booking_ref | created | SignWell status | in our DB? |
|---|---|---|---|---|
| `57797bd0…` | `HH-STU-WL8YJ` | 2026-06-10 | **Completed** | **no row** |
| `83b0e230…` | `HH-STU-MEQJT` | 2026-06-09 | **Completed** | **no row** |
| `a412536e…` | `HH-STU-ZVM4U` | 2026-09-06 | Viewed | yes, `awaiting_deposit` |
| `30e038fa…` | `HH-STU-2CTJ3` | 2026-09-07 | Viewed | yes, `awaiting_deposit` |
| 4 more `HH-STU-*` | — | 2026-06-08/09 | Expired | **no rows** |
| 5 more | — | 2026-06-08/09 | Expired | test_mode, no metadata |

**Two real liability waivers were signed in June 2026 and this business has no
record of either.** The signer is the same person for both, and it is not Adam:
hashing the recipient addresses and comparing against the three known admin
addresses ruled that out, while the same hash matches two real bookings —
`HH-2026-9806` (a cancelled March room rental) and **`HH-STU-ZVM4U`**, the studio
rental whose party is **2026-09-30, eighteen days away**. So it is a returning
customer, and the rental they have coming up is the one currently showing no
agreement.

The six June `HH-STU-*` refs have no rows in `bookings` at all. `git show ee84273`
confirms the original route inserted the booking *before* creating the document,
so those rows existed and were **deleted** afterwards. Who deleted them and
whether those June rentals were real is the one question here that is Adam's
(needs-Adam 25).

---

## 2. The headline: none of the three webhooks verified anything

`/api/studio-rental/signwell-webhook` carried the comment *"Verification is
best-effort and the handler is idempotent."* It performed no verification of any
kind. Neither did `/api/webhooks/signwell-checkin`. Neither did
`/api/webhooks/signwell-consent`. That is rule 8's seventh outing and rule 11's
sharpest — the brief predicted it from the directory listing alone, and the
directory listing was right.

`/api/webhooks/quo` fails closed on a bad or missing signature and sits in the
same tree. The precedent existed and was not followed.

**Driven in production**, from a laptop, with no credentials, against the
throwaway cancelled booking `HH-TEST-PAY8` armed with a sentinel document id:

```json
POST /api/studio-rental/signwell-webhook
{"event":{"type":"document_completed","time":…,"hash":"totally-made-up-hash"},
 "data":{"object":{"id":"FORGERY-PROBE-046","status":"completed",
                   "metadata":{"booking_ref":"HH-TEST-PAY8"}}}}

→ 200 {"received":true}
```

```
booking_ref  | agreement_signed_at
HH-TEST-PAY8 | 2026-09-12 20:32:57.712+00
```

**Anyone on the internet could mark any customer's liability waiver signed.** The
`hash` field was a string I made up. There was no second door to get through.

It is worse than "mark your own waiver signed", because the handler fell back to
`metadata.booking_ref` **from the POST body** when no document id matched — so a
forged request could mark the *wrong* customer's waiver signed, and booking refs
were an enumerable 10,000-wide space that link 14 found `/api/portal/auth` had
been oracling until yesterday.

The consent webhook is the same defect pointed at something arguably worse: a
`consent_release` row is the legal statement that a **named child's photograph**
may be published, and it is the only thing between flagged content and the public
site (the migration-022 trigger on `website_content`). An unverified flag is worse
than no flag, because the flag is then believed.

### What SignWell actually signs, and why the hash alone is not enough

Per SignWell's documented scheme, `event.hash` is
`HMAC-SHA256(webhook_id, "${event.type}@${event.time}")`.

Read that carefully: the signature covers **the type and the timestamp, and
nothing else**. The document id, the status and the metadata — every field that
decides *which booking gets written* — are outside it. So a valid hash proves
"SignWell emitted an event of this type at this time"; it does not prove the body
describes that event. Anyone who ever observes one genuine `(type, time, hash)`
triple can replay it with a body of their choosing.

Verifying the hash is therefore **necessary but not sufficient**, and a fix that
stopped there would have looked complete and been wrong. So the design is two
gates:

1. **Verify `event.hash`**, timing-safe, against `SIGNWELL_WEBHOOK_ID`, with a
   24-hour freshness window bounding replay of an observed triple.
2. **Re-read the document from SignWell's own API** over TLS with our API key,
   and take the status, the `booking_ref` and the `metadata.type` from *that*
   response. The webhook body is downgraded to a hint about which document to go
   and ask about.

Gate 2 is what makes a forged or replayed body inert regardless of the scheme's
weakness, and it is demonstrated working in §5.

**Fails closed when unconfigured.** `verifySignwellEvent` returns
`{ok:false, reason:'unconfigured'}` when `SIGNWELL_WEBHOOK_ID` is unset, and the
routes answer 503. This deliberately differs from `/api/webhooks/quo`, which
skips verification when its secret is missing: quo's unverified actions were
logging and opt-out, whereas an unverified event here marks a legal document
signed. "Not configured yet" must not be a bypass on this surface.

---

## 3. The signed PDF was never retrievable

`fetchSignedPdfUrl()` did:

```ts
const data = await res.json() as { files?: { pdf_url?: string }[] }
return data.files?.find(f => f.pdf_url)?.pdf_url ?? null
```

Measured against the real API on a genuinely `Completed` document, `files` is:

```json
[{"name":"Host Hampton — Studio Rental Agreement.pdf","pages_number":3}]
```

**There is no `pdf_url` key on it. Ever. On any document in any state.** The
function returned `null` 100% of the time, and both handlers wrote that null into
`agreement_pdf_url` beside a non-null `agreement_signed_at`.

So even if a webhook *had* been registered, this system would have recorded that
a waiver was signed **while keeping no copy of it** — a claim about a legal
document with the document missing. The old doc comment read *"Returns null if
not available yet"*, which frames a permanent failure as a transient one and is
exactly the wording that stops anyone investigating (rule 8).

The documented endpoint is `GET /documents/{id}/completed_pdf/?url_only=true`,
which answers `{"file_url": "…"}`. §5 shows it capturing a real URL.

---

## 4. The security deposit does not exist

`security_deposit_pi_id` is NULL on all 61 rows and
`security_deposit_status` is the literal `'none'` on all 61. Grepping the whole
app for either column finds **three** writers and none of them is a hold:

- `studio-rental/checkout` writes `security_deposit_status: 'none'` at insert;
- `portal/booking` names both columns in its output allow-list;
- nothing, anywhere, ever writes `security_deposit_pi_id`.

**There is no code in this product that places, captures or releases a security
deposit.** Not broken code — absent code.

That matters more than an unused column, because the studio rental agreement
*states the deposit*: `studio-rental/checkout` passes
`security_deposit: formatMoney(studioRates.securityDepositCents)` as a merge
field into the SignWell template. The figure is **$500**
(`pricing_items.studio_security_hold`, falling back to `50000` cents). So the two
customers who signed in June signed a document naming a $500 security deposit
that the system has never had any mechanism to take, and the two current studio
rentals are looking at the same document.

Whether Adam wants card holds at all is a business decision and a money decision,
so it is recorded and not guessed (needs-Adam 26). **No hold was created**; the
money rules forbid placing a real hold on a real card and nothing here did.

---

## 5. What was fixed, and how each fix was proved

All of this is deployed and was driven against production.

**New: `lib/signwellWebhook.ts`** — the one place that decides whether an event is
genuine. `verifySignwellEvent` (HMAC, timing-safe, freshness-bounded, fails
closed), `parseSignwellEvent` (normalises the several payload shapes and
type-checks every extracted field — a non-string `id` used to flow straight into
a PostgREST `.eq()`), `claimsCompletion`, and `confirmCompletedAtSignwell` (the
authoritative re-read, with **three** outcomes so a blip is never "not signed").

**New: `lib/signwellHandlers.ts`** — one pipeline, three writers. The three routes
had drifted into three different ideas of "signed": only the check-in one filtered
on `metadata.type`, only the check-in one read the booking before writing, and
only the consent one had a fallback that could silently no-op. A fourth document
type is now an entry in `SIGNWELL_WRITERS`, not a fourth route.

**New: `/api/webhooks/signwell`** — the canonical endpoint, and the one now
registered. SignWell keys each hook's HMAC with that hook's own id, so one hook
dispatching by type is both the correct configuration and the reason there is a
single `SIGNWELL_WEBHOOK_ID`. The three legacy URLs are kept and hardened through
the same pipeline, since they are documented and could be pasted into the
dashboard.

**The webhook was registered** (`POST /hooks`), which is the fix for the root
cause. Its id — which *is* the HMAC key — was echoed by the first registration
script's closing `GET /hooks`, so it was treated as disclosed: the hook was
**deleted and re-created**, the replacement id written to `/opt/hosthampton/.env`
without ever being printed, and the disclosed value is now inert at SignWell.

### Production evidence, both directions

Forged requests, before and after (same five payloads, same script):

| probe | before | after |
|---|---|---|
| no signature, forged completion | `200 {"received":true}` **and it wrote** | `401 bad-hash` |
| wrong signature header | `200 {"received":true}` | `401 bad-hash` |
| check-in route, forged | `200` | `401 bad-hash` |
| consent route, forged | `200` | `401 bad-hash` |
| no document id, body `booking_ref` only | `200 {"received":true}` | `401 missing-hash` |

And with **genuinely valid signatures**, computed inside the container from the
real `SIGNWELL_WEBHOOK_ID` — the SignWell equivalent of the signed-synthetic-event
harness the money rules prescribe for Stripe:

| probe | result |
|---|---|
| valid signature, completion claimed for `HH-STU-ZVM4U` (SignWell says **Viewed**) | `200 ignored: "not completed at SignWell"` — **nothing written to a real booking** |
| valid signature, document genuinely **Completed** | `200 {"matched":1}` — written |
| same valid signature, 48 hours old | `401 stale` |
| realistic `document_viewed` (status `Viewed`) | `200 ignored: "document_viewed"` |
| realistic `document_sent` | `200 ignored: "document_sent"` |
| `document_completed` with no `status` field | `200 {"matched":1}` — event type alone suffices |
| forged `metadata.type: "something_new"` on a real studio document | dispatched to **`signwell[studio]`** — SignWell's own metadata overrode the body's |

The second row is gate 2 doing its job: a **cryptographically valid** event
claiming a completion was refused because SignWell itself said the document is
only `Viewed`. The last row is the same principle on the dispatch key.

The write in row 2 captured a real PDF URL — 67 characters,
`https://www.signwell.com/app/signed/…` — which under the old code would have
been `NULL`. That is the §3 fix proved against a genuinely completed document.

The log lines say what happened in both directions (rule 10):

```
signwell[studio]:   REFUSED unverified event — bad-hash
signwell[dispatch]: event claimed completion but SignWell says Viewed for a412536e-…
signwell[studio]:   agreement signed for HH-TEST-PAY8 | pdf: captured
signwell[dispatch]: REFUSED unverified event — stale
```

### Rules 10, 12 and 19, swept

- **`markReleaseSigned` returned a boolean** for "signed", "already signed", "no
  such release" and "the database was unreachable" alike. A Supabase blip
  answered `200 {"signed":false}` and SignWell would never redeliver — a real
  signature on a real child's consent release, dropped, with the gate left closed
  and nothing saying why. Now four outcomes; `unavailable` answers 503.
- **Four unchecked writes** now read their result, including the two that are the
  only link between a live SignWell document and our row
  (`studio-rental/checkout` and `checkin/[token]/agreement`). The check-in one
  now **fails the request** rather than handing out a signing URL it cannot
  honour, because that handler matches only on the document id and has no
  `booking_ref` fallback. The `createConsentRelease` link write now throws with a
  message that says not to send the link.
- **The studio update had no `.select()`**, so a zero-row update was
  indistinguishable from success — it answered `{"received":true}` whether or not
  it had written anything. It now reports `matched`, and a completed document with
  no matching booking is logged as `SIGNED DOCUMENT WITH NO MATCHING BOOKING`
  (rule 14 — which is precisely the June situation, and would now be visible).
- **Three lookups** collapsed "could not read" into "not found".

### One defect introduced and caught inside this session

The first draft of the studio writer matched the booking with
`.or(\`signwell_document_id.eq.${documentId},booking_ref.eq.${bookingRef}\`)`.
`.or()` takes a **raw PostgREST filter expression**, so an attacker-supplied
document id containing `,` or `)` rewrites the filter — the same family as the
`.ilike('%')` authorization hole link 14 found in the portal. Replaced with two
sequential `.eq()` calls, which are parameter-encoded, and rule R6 of the tripwire
now fails the suite if a template literal is ever passed to `.or()` anywhere on
this surface. Rule 8 applies to one's own patches, again.

---

## 6. What HELD

Reporting only what broke would overstate the state of this surface.

- **`resolveCheckinToken` is sound.** Tokens are looked up **by hash** — the raw
  token is never stored, so a database read cannot be replayed as a working link
  — and every failure returns a flat `invalid`, so a caller cannot distinguish
  "no such token" from "wrong token". It also expires on the party date, not just
  the token TTL.
- **`/api/checkin/[token]` has a real column allow-list** (`publicBookingView`),
  which is the pattern link 14 had to retrofit onto the portal. It was here
  first, with a comment explaining why.
- **The check-in route's contact handling is correct**, and visibly post-link-14:
  `findContactsByEmail` rather than `.eq`, an explicit `unavailable` branch that
  refuses to guess, the `status`/`source` restore so a paying customer is not
  demoted to `lead`, and the corrected `bookings.contact_id` comment.
- **`releasesAllSigned` is default-deny** — an empty or absent list is *not*
  satisfied, and an error is not satisfied either. The publishing gate's app-side
  half was written by someone thinking about the failure mode.
- **The structural gate is in the database**, not the app: migration 022's trigger
  on `website_content` is what actually blocks child-media publishing, so even
  the unverified webhook could not have published anything by itself.
- **`requiresRentalAgreement` defaults to requiring one** when the event type
  cannot be classified, with the trade-off written down: an unnecessary waiver is
  an annoyance, a missing one is a liability gap. That is the right default and
  the right comment.
- **`publicOrigin(req)` and `lib/contactLookup.ts` are intact** across the
  surface; link 13's and link 14's tripwires still pass, and
  `studio-rental/checkout` does not build a Stripe `success_url` at all (it uses
  an in-page PaymentIntent), so there is nothing there to get wrong.
- **`SIGNWELL_TEST_MODE=false`** is correct and deliberate: these are real legal
  documents. No document was created, voided, re-sent or cancelled by this
  session, and neither real studio rental was written to.

---

## 7. The tripwire, and attacking it

`src/__tests__/lib/signwellSurface.test.ts` reads the sources off disk, in the
shape `portalAuthSurface.test.ts` established: a deny-list of shapes, a positive
convention check, and a staleness walker, every exemption scoped to a named file
with a written reason. Nine rule groups: every webhook route verifies (R1); the
HMAC exists in exactly one file (R2); only the writer module writes a signature
column (R3); every Supabase write in the surface reads its result (R4); the PDF
comes from the endpoint that returns one (R5); no `.or()` from a template literal
(R6); identity comes from SignWell's response and never the body (R7); the
unconfigured case fails closed and every `unavailable` branch is retryable (R8);
and no unlisted route may touch SignWell events or the signature columns (R0).

Plus `signwellWebhookVerify.test.ts` (45 tests) exercising the real HMAC against
the real algorithm — including the exact forged payload that worked against
production, a hash valid for a *different* type, one valid for a *different*
timestamp, and both directions of the freshness window.

**Then the tripwire was attacked**, with `scripts/attack-signwell-tripwire.js`:
fourteen defects reintroduced one at a time into the real sources, the suite run
against each, the source restored. Every mutation verifies it landed on disk
before jest runs — links 13 and 14 each lost time to a codemod that silently did
nothing and reported as a tripwire hole.

**Two of the fourteen got through the first run**, both in rules that looked
obviously correct:

1. **R2 matched `event.hash` but not `event?.hash`.** A route reading
   `body?.event?.hash` walked straight past it — and optional chaining is the
   idiomatic way to read an untrusted payload, so it is exactly the form a real
   reintroduction would take.
2. **R8b was a whole-file regex**, `/unavailable[\s\S]{0,400}503/`. The
   orchestrator's 503 was replaced with a silent 200 and the rule stayed green,
   because two *other* `unavailable → 503` branches further down the file still
   matched. A whole-file regex tells you at least one site is correct; it cannot
   tell you every site is. It now checks each branch individually, and asserts
   the branches exist so it cannot become vacuous.

A third mutation reported `MUTATION DID NOT APPLY` — a six-line anchor that no
longer matched exactly. That reads identically to a tripwire hole and is not one,
which is its own lesson: **keep mutation anchors small enough to be certain**.
Fixed, and the harness now matches anchors against both LF and CRLF forms, since
files written this session are LF while the rest of the repo is CRLF.

One deliberate **negative** case is included: a legitimate *read* of a signature
column must not trip R3. It doesn't — R3 matches the column only as an object
key, which is a write. Link 14's equivalent rule could not tell a read from a
write.

**14/14 after the fixes.**

---

## 8. What I could NOT verify

- **Whether the two June signatures correspond to real bookings.** The rows are
  gone from `bookings` and nothing in the database says who removed them or when.
  The documents are real, live-mode, and completed; that is all that can be
  established from here.
- **The check-in agreement path end to end.** `SIGNWELL_CHECKIN_TEMPLATE_ID` is
  **not set in production**, so `/api/checkin/[token]/agreement` answers
  `{unavailable: true}` and no check-in document can be created at all. The route
  is otherwise exercised and its document-id write is now checked, but the
  SignWell half of it has never run and could not be driven. `checkin_tokens` is
  still 0 rows and the three reminder crons are still unscheduled (needs-Adam 18),
  so no token was minted either — minting one would have proved the token path,
  not the agreement path, and the agreement path is the part that was unverifiable.
- **The consent release path end to end.** `SIGNWELL_CONSENT_TEMPLATE_ID` is not
  set either, `isConsentConfigured()` is false, `/api/admin/marketing/consent`
  answers 503, and `consent_releases` has 0 rows. The webhook half is verified and
  tested; the creation half cannot run until a consent template exists in the
  SignWell dashboard.
- **The `no handler for this document type` branch** could not be driven in
  production, because it needs a genuinely `Completed` SignWell document whose
  real metadata names an unknown type, and creating one is a live document. It is
  covered by code and by R7, not by a production probe.
- **Whether `agreement_signed_at` should be the completion time rather than the
  webhook arrival time.** Both handlers write `new Date()`. SignWell's document
  resource returns `completed_at: null` even on completed documents, so the true
  signing time was not available to use. Left as-is and noted.

---

## 9. Needs Adam

**25. The two signed June waivers, and six deleted studio bookings.**
`HH-STU-WL8YJ` and `HH-STU-MEQJT` are **Completed, live-mode** SignWell documents
signed by a real returning customer — the same person as `HH-STU-ZVM4U`, whose
party is 2026-09-30. Four more `HH-STU-*` documents expired unsigned. **None of
the six has a row in `bookings`.** Were these real rentals? If so there is signed
paperwork for revenue that is not in the system; if they were end-to-end tests run
in live mode, the two completed ones should be archived at SignWell so they stop
reading as held waivers. I have not touched them either way.

**26. Whether the studio security deposit should actually be held.** Every studio
rental agreement states a **$500** security deposit. No code has ever placed one,
and `security_deposit_pi_id` is empty across all 61 bookings. This is a money
decision — a hold is a real authorization on a real customer's card — so it is
recorded rather than implemented. If yes, the mechanism is a separate
`manual_capture` PaymentIntent at check-in time and a release after the party;
that is a build, not a fix.

**27. `SIGNWELL_CHECKIN_TEMPLATE_ID` and `SIGNWELL_CONSENT_TEMPLATE_ID` are
unset.** Both need a template built in the SignWell dashboard (which I have no
login for) and its id put in `/opt/hosthampton/.env`. Until then the pre-arrival
waiver and the entire child-media consent flow cannot run — the code is live,
verified and tested, and simply reports itself unavailable.

Not blocking, and already actioned: the webhook registration itself needed no
decision and was done.

---

## 10. Housekeeping

- **Probe rows fully restored.** `HH-TEST-PAY8` (cancelled throwaway) was used as
  the target for both the forgery probe and the valid-signature probe; its
  `signwell_document_id`, `agreement_signed_at` and `agreement_pdf_url` are all
  back to NULL via conditional `UPDATE`s. Final invariants match the baseline
  exactly: **61 bookings, 2 document ids, 0 signed, 0 pdfs, 0 check-in
  documents**. The two real studio rentals were never written to and were
  re-checked as NULL after every probe.
- **No SignWell document was created, sent, voided or cancelled.** The only
  SignWell writes this session made were `POST /hooks` and `DELETE /hooks/{id}`
  during the key rotation.
- **No email, no SMS, no Stripe object, no charge, no card hold, no model call.**
- **Nothing was written to `marketing_ledger`** (the append-only table), because
  no consent release could be created.
- `audit_scratch/` and `services/website/scripts/attack-signwell-tripwire.js` are
  untracked on purpose, per the do-not-commit list.
