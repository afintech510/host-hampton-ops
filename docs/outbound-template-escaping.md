# The outbound template layer — escaping, and the header that decided every link

**Link 13 of the build chain. 2026-09-12. No migration — 046 is still free. Suite 1840 → 1984 green.**

Scope: every place customer- or admin-written data is interpolated into an
outbound email body — `lib/emailTemplates.ts`, `lib/email-templates/*`,
`lib/planPayment.ts`, `lib/planShare.ts`, `lib/unclaimedPayment.ts`,
`lib/sequences/render.ts`, `lib/agent/sendApproved.ts`, and the fourteen API
routes that build their own HTML inline. Recorded as a known gap in
`docs/reminder-engine-review.md` §10.4 and left there deliberately, because a
cron review is not the place to rewrite live revenue-path email.

---

## 1. The measurement, before anything else

The brief carried a table of six files and said not to trust it. It was right
not to: the table counted `${…}` occurrences per file, which conflates a colour
token with a customer's name, and it named six files when the surface is
twenty-nine.

Re-derived by lexing every `.ts`/`.tsx` under `src/`, finding each template
literal, deciding whether that literal is building markup, and extracting each
interpolation with the symbols it still reaches:

| | measured |
|---|---|
| files that build outbound mail HTML | **29** |
| interpolations inside an HTML literal | **606** |
| of those, in an `href` / `src` attribute | 39 |
| files that instantiate Resend directly | **38** |
| `escapeHtml` calls across the whole mail layer, before | **26** (9 of them in one file link 8 wrote, 9 in one link 10 wrote) |

The lexer that did this is now `src/__tests__/helpers/templateScan.ts`, because
the measurement instrument and the tripwire want to be the same thing.

**One number from the brief's table that turned out to be the interesting one:**
`lib/email-templates/marketing-emails.ts`, 324 lines and five templates, has
**zero importers**. Nothing in the repo references it. See §7.

---

## 2. Blast radius, which is the judgement that mattered

§4 of the reminder review drew the right line and this pass followed it: most of
these emails go to the person who typed the value, so the damage is their own
inbox. The ones that cross a trust boundary are the dangerous ones. Mapped by
pairing every `resend.emails.send` call with the `to:` beside it:

**Customer-written text → the OWNER's inbox** (`ownerEmail()` =
`hosthampton295@gmail.com`, and `ALLIE_EMAIL` for one):

| template | reached by |
|---|---|
| `leadNotifyHtml` | `/api/lead` — the public intake form. `fullName`, `email`, `notes` raw. |
| `partyAdminNewBookingHtml` | `/api/checkout`, `/api/party-checkout`, `/api/party-builder/save`, `/api/webhook` ×3 |
| `ticketPurchaseNotifyHtml` | `/api/events/checkout` ×3, `/api/webhook` ×3 |
| `fundraiserInquiryNotifyHtml` | `/api/fundraiser-inquiry` |
| `giftCardNotifyHtml` | `/api/webhook` |
| `summerHairAdminNotifyHtml` | `/api/summer-hair/book` → Allie |
| inline HTML | `/api/contact`, `/api/quote/save`, `/api/canvas-bag-inquiry`, `/api/trucker-inquiry`, `/api/mobile-party-inquiry`, `/api/cm-cheer-order`, `/api/studio-rental/edit`, `/api/portal/notify-payment`, `/api/portal/send-message`, `/api/signup`, `/api/webhook` ×2, `lib/planPayment.ts`, `lib/unclaimedPayment.ts` |

`partyAdminUnpaidDayOfHtml` was the one link 10 named; it is six templates and
fourteen inline bodies.

**Customer A's text → customer B's inbox.** One case, and nobody had noticed it:
`giftCardHtml` renders `senderName` and `personalMessage` — both typed by the
PURCHASER — and `/api/webhook` sends it `to: m.recipientEmail`. A gift card is
the one product on this site where the person who writes the words and the
person who reads them are different people.

**Admin-written text → a customer's inbox.** `/api/admin/orders/[id]/email` and
`/api/admin/events/[id]/email`. Rule 5 says a field is hostile because of who
CAN write it, and an admin-typed `location` is a field an injected instruction
could reach in some other phase — but these two are deliberate HTML composers
and are treated as such in §6.

**Did not cross a boundary:** the twenty-odd templates that go to the address
that typed the value — booking confirmations, receipts, magic links, reminders.
Fixed anyway; named here so the record says which is which.

---

## 3. The finding that was not on the brief: one header decided every link

While classifying the `href` interpolations — the brief's own instruction that
*an href needs a URL screen, not HTML escaping* — the question became "where do
these URLs come from". Twenty-two routes answered it the same way:

```ts
const host = req.headers.get('x-forwarded-host') || req.headers.get('host')
const origin = `https://${host}`
```

`Host` cannot be forged past the edge: nginx's HTTPS `default_server` answers
**444** for any hostname that is not one of its `server_name`s (read out of
`/etc/nginx/nginx.conf` in the running container, not assumed). But **nginx
never sets `X-Forwarded-Host`** — it sets `Host`, `X-Real-IP`, `X-Forwarded-For`
and `X-Forwarded-Proto` and nothing else — so `X-Forwarded-Host` arrives exactly
as the caller typed it, and the code above *prefers* it.

Measured against production, on a route with no side effects:

```
curl -D- https://www.hosthampton.com/api/portal/auth
→ 307  location: https://www.hosthampton.com/my-booking/login?error=invalid

curl -D- -H 'X-Forwarded-Host: evil.example.com' https://www.hosthampton.com/api/portal/auth
→ 307  location: https://evil.example.com/my-booking/login?error=invalid
```

That one header decided:

- **The links in Adam's own notification emails.** `/api/quote/save` mails
  `<a href="${quoteLink}">View their quote</a>` to `ownerEmail()`, and
  `/api/checkout`, `/api/party-checkout` and `/api/party-builder/save` mail an
  `adminUrl` into `partyAdminNewBookingHtml`. All four are public POSTs. A link
  in the owner's own mail, pointing at the caller's host, carrying a real
  booking ref — aimed at the person holding `hh_admin`.
- **A link mailed to a CUSTOMER.** `/api/quote/save` and
  `/api/portal/resend-link` both build the saved-quote link from it.
- **Stripe's `success_url` and `cancel_url`** in `/api/events/checkout`,
  `/api/cart-checkout`, `/api/gift-cards/checkout`,
  `/api/studio-rental/checkout` and `/api/admin/pay-link`. A customer who really
  paid was redirected afterwards to whatever host the request claimed, **with a
  live `{CHECKOUT_SESSION_ID}` in the query string.** This is the money one.
- **Every redirect out of `/api/portal/auth`, `/api/portal/email-auth/verify`
  and `/api/portal/my-bookings`** — a plain open redirect on
  `www.hosthampton.com`, which is the same thing link 11 went to some lengths to
  keep out of `/r/[token]`.

**What it did NOT reach, and the reason that matters:** the portal MAGIC LINK.
`buildPortalUrl` uses `NEXT_PUBLIC_SITE_URL` with a hard-coded default, because
somebody writing *that* line thought about it. The token was never leaked. The
difference between the line that was safe and the twenty-two that were not is
that the safe one did not ask the request where it was.

### The shape underneath it — rule 11's sharpest form, six times

The origin of this site was spelled **six different ways**:

| spelling | file |
|---|---|
| `SITE_URL` | `lib/seo.ts` |
| `process.env.NEXT_PUBLIC_SITE_URL \|\| 'https://www.hosthampton.com'` | `lib/portalAuth.ts`, `lib/checkinAuth.ts`, `lib/unsubscribeLink.ts`, `lib/experiments/track.ts`, `/api/cron/send-reminders` ×2 |
| `siteUrl()` | `lib/agent/config.ts` |
| `SITE_ORIGIN` | `lib/content/contentSafety.ts` |
| `const host = 'www.hosthampton.com'` | `/api/admin/pay-link` |
| `req.headers.get('x-forwarded-host')` | 22 routes, 26 sites |

A concept defined six times is a concept nothing is checking, and the spelling
nobody checked is the one that reached an inbox.

### The fix

`src/lib/publicOrigin.ts` — one module, one allowlist, and a screen that
**parses** rather than prefix-matches, for the reason `safeImageUrl` does:

```
www.hosthampton.com.evil.example.com    → refused (a subdomain OF the attacker)
evil.example.com@www.hosthampton.com    → refused (userinfo; the real host is after the @)
www.hosthampton.com:80@evil.example.com → refused (the form that fools a split on ':')
www.hosthampton.com, evil.example.com   → refused (the multi-proxy comma list)
www.hosthampton.com\@evil.example.com   → refused (a backslash normalises to a slash)
//evil.example.com                      → refused
www.hosthampton.com                 → refused (IDN homograph)
NUL / CR / LF / DEL / C1 / U+2028 / U+2029 inside the host → refused
```

All 26 derivations now call `publicOrigin(req)`, and the other five spellings
import `CANONICAL_ORIGIN`. A test asserts `CANONICAL_ORIGIN === SITE_URL` and
that **no file outside `lib/publicOrigin.ts` reads `x-forwarded-host` or
`NEXT_PUBLIC_SITE_URL`**, so a seventh spelling fails the suite.

### The bug in my own fix, found by its own test

The first version put `localhost` and `127.0.0.1` on the allowlist — correct, so
that `next start` and the deploy script's own smoke test get working links — and
then had `isLocalRequest()` read that allowlist. Several routes use
`isLocalRequest` to decide whether a session cookie gets the **`Secure`** flag.
So a caller could send `X-Forwarded-Host: localhost` to production and be issued
an admin session cookie without `Secure`, by asking for it.

A development host is now believed only from `Host`, never from
`X-Forwarded-Host`. Behind nginx `Host` is always a `server_name`; in
development there is no proxy at all; so this costs nothing and closes it. Rule
8 applies to one's own patches — that is the third time in two sessions, and
every one of the three was found by writing the test rather than by re-reading
the diff.

---

## 4. The escaping, and the classification that had to come first

Rule 4's habit: classify before you "fix" a field. Four kinds of interpolation
live in these files and three of them must **not** be escaped.

| kind | treatment | why |
|---|---|---|
| text in an element body | `escapeHtml` | the customer's name, a note, an event title |
| a URL in `href`/`src` | a URL SCREEN, then attribute encoding | `escapeHtml` alone leaves `javascript:alert(1)` working while looking screened |
| a number you computed | nothing | `${(cents/100).toFixed(2)}` cannot carry markup |
| a nested template you built | nothing | it is already HTML; escaping prints the tags to the customer |

`src/lib/emailSafety.ts` holds the composition — `escapeFields`, `mailHref`,
`mailHrefExternal`, `mailToHref`, `telHref`. It defines **nothing new**: it
composes `escapeHtml` and the screens in `lib/content/contentSafety.ts`. Rule 11
is the whole reason it is shaped that way; a second escaper or a second URL
parser in the mail layer is exactly the defect this session found three of.

To make that sharing real rather than claimed, `safeImageUrl`'s parsing half was
extracted as `parseScreenedUrl` — the control-character refusal, the backslash
refusal, the shape test, `new URL` resolution, https-only, and the
doubled-leading-slash refusal — and `safeImageUrl`, `safeSiteLink` and the two
mail screens all go through it. The 49 existing `contentSafety` tests pass
unchanged, which is what says the refactor was behaviour-preserving.

**Escape at ENTRY, not at 606 call sites.** Every exported template now starts
with `const d = escapeFields(raw)`, and URL fields are taken off `raw` — because
an HTML-escaped URL is no longer a URL. It is the pattern
`email-templates/reminders.ts` already used, made reusable instead of retyped.
The reason for entry rather than per-site: the sites are the part that gets
added to. A new table row copied from the row above it inherits whatever that
row did, and the reviewer sees a one-line diff that looks like every other line
in the file.

### What that turned up in code two links had already "fixed"

`lib/email-templates/reminders.ts` escaped five fields with
`.map(v => escapeHtml(v ?? ''))` and destructured **`eventDate`**,
**`partyDate`** and **`balanceDueNote`** raw on the line above, in the same
functions. All three reach the mail through `detailCard([{ value: partyDate }])`
— a data structure, not an interpolation, which is why reading the template
body would never have shown it. A per-field list is a list somebody has to keep
complete; that is the argument for the entry pattern, and all four reminder
templates now use it.

### The plain-text half

Checked, and deliberately left alone. `escapeHtml` in a `text:` body puts
`&amp;` in front of a customer. The tripwire only judges literals that are
building markup, so it cannot drift into demanding it.

### SMS

Not touched. `lib/sms-templates.ts` is not HTML and must never be escaped; its
hazard is segment counting, which link 10 already routed through
`lib/smsSegments.ts`. Nothing in this pass changed an SMS body, so no segment
count moved.

---

## 5. Rule 11, three times, in the escapers themselves

- **`lib/agent/sendApproved.ts`** carried a private `esc()` — `&`, `<`, `>`, `"`
  and **not** `'`.
- **`/api/portal/send-message`** carried a third copy inline — `&`, `<`, `>` and
  **neither** `"` nor `'` — on the body a customer types in the portal and Adam
  reads in his inbox.
- `lib/escapeHtml.ts` is the real one.

Both now import it. A test walks `src/` and fails on any new hand-rolled
escaper, with `app/sitemap.xml/route.ts` exempted and the reason stated: it
escapes for **XML**, where the entity set is genuinely different (`&apos;` is
XML; HTML wants `&#39;`). Two screens for two languages is not rule 11; one
screen used for both would be.

---

## 6. The other defects found on the way

**`OrdersTab.tsx` sent a plain textarea as HTML.** `htmlBody: body.replace(/\n/g,
'<br>')`, no escape. An admin typing *"sizes < 10 left"* sent a customer
*"sizes "* — the browser read `< 10 left…` as a tag and ate the rest of the
sentence. That is the `containsMarkup` defect from `docs/content-pipeline.md`
§11.2 in a second place. Fixed at the sender, where the plain-text contract is
known; the two admin compose ROUTES keep accepting HTML, because the events tab
really is a `contentEditable` rich-text composer — exempted in the test, with
that sentence as the reason.

**`encodeURI` was the whole screen on the unsubscribe href.**
`lib/sequences/render.ts` did `const safe = encodeURI(url)`.
`encodeURI('javascript:alert(1)')` returns it unchanged. The URL is built
server-side so nothing hostile reaches it today, but an encoder is not a screen.

**`lib/planShare.ts` and `lib/planPayment.ts`** interpolated `invoiceNumber`,
`eventDateTime`, `booking_ref` and an `invoiceUrl` href raw beside fields that
were carefully escaped three lines up.

---

## 7. `marketing-emails.ts` is dead code

324 lines, five templates, **zero importers**. Screened anyway — a template that
is safe only while unused is a trap for whoever wires it up, and the wiring is a
one-line import. Two things recorded rather than fixed:

- Its CAN-SPAM footer's unsubscribe href is the literal `{{unsubscribe_url}}` —
  **our sequencer's token name, which Brevo has never heard of**. That is the
  exact bug `docs/phase-4-campaign-automation.md` records link 8 fixing in the
  newsletter template; this copy was missed because nothing sends it. Left as
  found, because changing an unsubscribe token in a file nothing calls is a
  change nobody can verify.
- It publishes "Starting at $249". Studio/party pricing, not mobile, so outside
  the do-not-touch list — but worth a human's eye if it is ever wired up.

---

## 8. The tripwire, and the two holes the probe found in it

The reason this gap survived two reviews is that **nothing failed** when a
template was added unescaped. `src/__tests__/lib/emailTemplateEscaping.test.ts`
(61 tests) is the thing that fails now. It reads the sources off disk, the way
`slugSafety.test.ts` walks `src/app` and `experimentsSchema.test.ts` parses
migration 045.

Four checks:

1. **No hostile field reaches markup raw.** A deny-list of ~60 field NAMES, not
   an allow-list of expressions — matched on the last path segment, case- and
   underscore-insensitively, so `d.customerName`, `booking.contact_name` and
   `m.contactName` are one entry. It recognises both escape spellings.
2. **Every interpolated `href`/`src` goes through a screen**, not an escaper.
3. **Every exported template escapes at entry** — the positive half, and the one
   that catches what a lexer cannot (§4's `partyDate`, which reached the mail
   through an array).
4. **The file list cannot go stale.** A walker finds every file that sends mail
   and fails if it is neither audited nor listed as template-free; another fails
   on any new hand-rolled escaper.

Every exemption carries a reason in code beside the thing it exempts, and a test
asserts the reasons are non-trivial. That is deliberate: a false positive should
cost one line with a sentence, not the deletion of the check — which is what a
strict test actually dies of.

**Then I tried to defeat it, and it let two things through.** Three defects were
reintroduced by hand and the suite was re-run:

| reintroduced | caught? |
|---|---|
| `${raw.fullName}` in the owner's lead notification | **no** |
| `payButton(raw.portalUrl, …)` — an unscreened URL | **no** |
| an escape-at-entry line deleted | yes |

The first was a regex anchored on the leaf with a guard forbidding a preceding
`.` — which can never match a member expression, because `raw.fullName` has a
dot in front of `fullName` by construction. So the check silently excused every
`${raw.anything}` in the file. The second is the hole that the `payButton`
exemption opens: the URL never appears inside an `href="…"` in that file, so the
href check cannot see it; it is closed from the other side now, by a check that
every button builder is handed a screened href.

Both were found by **reintroducing the defect and watching the tests stay
green** — not by reading them. A tripwire that has only ever passed is a comment
asserting its own correctness.

That exercise also surfaced a real residue: `lineItemRows` interpolates `i.name`
raw. It is safe, because every call site passes `d.lineItems` and `escapeFields`
recurses into arrays — so it is exempted, and the invariant its reason rests on
(*every call site passes `d.`, never `raw.`*) is now itself a test. An exemption
whose reason is an invariant should be an exemption whose invariant is checked.

---

## 9. The bug my own codemod introduced

The escaping pass over the fourteen inline-HTML routes was done by a codemod.
Re-running the scanner afterwards found that it had wrapped **four HTML
fragments** in `escapeHtml`:

- `escapeHtml(itemRows)` ×2 and `escapeHtml(paymentBadge)` in
  `/api/cm-cheer-order` — the customer's order-confirmation email, which would
  have arrived with `&lt;tr&gt;` printed down the page;
- `escapeHtml(eventRows)` in `/api/admin/campaigns/actions`;
- `escapeHtml(escaped)` in `/api/portal/send-message`, double-escaping a body
  that was already escaped upstream.

Its fragment detection missed locals built by `.map(...).join('')` across
several lines. This is §11.12 of the Phase 5 review happening again on a
different patch: **a wrong fix here silently breaks a live revenue email, which
is worse than the injection it was fixing.** Caught by re-measuring, which is
the argument for building the measurement instrument before the fix rather than
after.

There is a fifth of the same family that is *not* a bug and is worth stating,
because it is the reason the tripwire checks call sites: passing an
already-escaped URL to `mailHref` does **not** produce a refusal. `&amp;` is a
perfectly valid query string, so the URL parses, passes the host check, and
comes back double-escaped — the recipient clicks a link carrying a parameter
literally named `amp;b`. Pinned by a test that asserts exactly that output, so
nobody later "fixes" the screen into refusing it.

---

## 10. Driven against production

**The header, end to end.** The 307 probe above was run before any change, on a
route with no side effects, and again after deploy — see §12.

**The reminder pipeline, after deploy.** `scheduled_reminders` was at **0 rows**
(the whole table, so the "how many real rows are in the scan" question answers
itself). One throwaway row was inserted directly by SQL — no
`upsertContact`, so nothing was mirrored into Brevo — with
`scheduled_for = 2000-01-01` so it sorts first, pointing at an existing event
and at the existing contact row for `adam@easternbuilding.supply`. That
contact's `first_name` was temporarily set to a hostile payload (its own row,
restored afterwards by a conditional `UPDATE … WHERE first_name = <payload>`,
rule 6). `/api/cron/send-reminders?limit=1` was then fired once and the
delivered body read back through the Resend API.

**What this did NOT prove, stated rather than implied.** The *unescaped* "before"
state was not demonstrated by mailing a hostile payload out of unfixed
production code. Every route that renders customer text into the owner's inbox
— `/api/contact`, `/api/quote/save`, the four inquiry routes — calls
`upsertContact`, which **mirrors the contact into Brevo and Quo** and enrols a
sequence. Driving one would have written a contact into the marketing system and
created a 45th enrollment to prove something a unit test proves for free. The
before-state is established by the source measurement in §1 and by tests that
render the real template functions with the real payload; the after-state is
established in production. That asymmetry is deliberate and is the honest
version of "exercise it".

---

## 11. Tests

| suite | what it holds up |
|---|---|
| `lib/emailTemplateEscaping.test.ts` (61) | the four checks in §8, every exemption with a reason |
| `lib/publicOrigin.test.ts` (40) | 16 hostile host forms, 8 control code points, both directions, the refusal being reported, and that no file spells the origin a seventh way |
| `lib/emailSafety.test.ts` (43) | `mailHref`/`mailHrefExternal`/`mailToHref`/`telHref` refusing and accepting; `escapeFields` leaving numbers alone, not mutating, not hanging on a cycle; the double-escape corruption pinned |
| `lib/contentSafety.test.ts` (49, unchanged) | that extracting `parseScreenedUrl` changed no behaviour |
| `lib/reminderTemplates.test.ts` (18, unchanged) | that converting four templates to `escapeFields` changed no output |

**1840 → 1984 green.** `tsc --noEmit` filtered to app code: **0**.
`next build`: `✓ Compiled successfully`, `/book` still `○ Static` at 7.15 kB.

---

## 12. Production verification

See the commit and the deploy log; the probe results are recorded in §10 and the
post-deploy numbers in the chain table row in `PLAN.md`.

---

## 13. Needs Adam

1. **Nothing new.** No price, no business rule and no credential was needed for
   any of this.

## 14. Recorded, not fixed

- **`.eq('email', …)` survives in nine more places** —
  `/api/admin/auth/login`, `/api/admin/auth/session` (both on `admin_users`, a
  different table with a different write path), `/api/admin/photos/backfill-reminders`,
  `/api/checkin/[token]`, `/api/cron/gmail-sync`, `/api/portal/email-auth/request`,
  `/api/portal/email-auth/verify`, `/api/portal/resend-link`,
  `lib/agent/draftInquiry.ts`, `lib/contacts.ts`. The
  `email-matching-is-case-sensitive` memory says to grep for this before
  assuming it is finished, and it is not finished. **The portal email-auth pair
  is the customer LOGIN surface**, so for the 21 mixed-case contacts this may be
  a real login failure rather than a missed marketing email — it was not
  verified here and is the first thing link 14 should measure.
- **`/api/portal/send-message`** does not read the error on its
  `booking_modifications` insert (rule 19), and its `.single()` collapses
  "could not read" into a 404 for an authenticated customer (rule 12). Two lines,
  but they belong to whoever audits the portal properly.
- **Subject lines interpolate customer text** (`Contact form: ${name}`). Resend
  is a JSON API and encodes subjects, so this is probably a non-issue — but it
  was not proved with a probe carrying a newline, so it is recorded rather than
  claimed.
- **`marketing-emails.ts`'s unsubscribe token**, §7.

## 15. Not touched

Mobile pricing. The 44 active enrollments, the 103 draft campaigns, the Brevo
list, the Twilio configuration, the three `draft` social posts, the real open
customer drafts, the `HH-TEST-PAY*` plans, the `agent_learnings` proposals,
voice profile v2, the four `pending_review` town drafts, the four dead English
drafts, `agent_memory`'s 44 rows, the five Phase 5 tables. `process-sequences`
was not run. No Stripe object was created and no charge of any kind was made. No
SMS was sent to any number other than the sanctioned test number. No migration
was taken — **046 is still free.**
