# Meta ads tracking: audit, event map, and what is switched on

Written 2026-11-05. The code described here is built and deployed **OFF**: nothing is
sent to Meta from the server until the owner completes the setup steps in section 6.

## 1. What fires today (audit)

| Event | Where | Notes |
|---|---|---|
| `PageView` | every page except `/i/*`, `/my-booking/invitation`, crew and troop pages | no user data (Advanced Matching is off) |
| `Lead` | party packages, draft-party, room-rental and fundraiser forms; booking request success page | `content_name` only |
| `Contact` | contact form, mobile-party form, canvas bags, trucker hat | `method` only |
| `InitiateCheckout` | party packages | used to report `$99` when the theme price was unknown (an invented value); now it sends a value only when it is known |
| `Purchase` | success pages (`/book/success`, events, vendors) | `order_id` is the Stripe session id; value is often 0 |
| `ViewContent` | **server side only**, on `/i/*` invitation views | cleaned URL, no slug |

Gaps found:

1. **No `event_id` on any browser event**, so a server copy could not be matched to it.
2. **Deposits paid in the page** (planner and studio-rental card form) fire **no** browser event. That is most deposits since the Payment Element moved off Checkout.
3. **No `fbclid`, `_fbp` or `_fbc` was stored anywhere**, so a booking could never be matched to the ad click that brought it.
4. Nothing fires `Schedule`, and `ViewContent` does not fire on theme or pricing pages.
5. No consent banner exists. The site relies on the opt-in checkbox on forms for marketing and on the privacy policy for the Pixel.

## 2. Recommended event map

| Funnel step | Meta event | Browser | Server (Conversions API) | Shared `event_id` |
|---|---|---|---|---|
| Looks at a theme / pricing page | `ViewContent` | not built yet (section 7) | no | n/a |
| Submits an inquiry form | `Lead` (or `Contact` on the contact and mobile forms) | yes | **yes, built** | id minted when the form reads its attribution |
| Starts the planner checkout | `InitiateCheckout` | yes | no | n/a |
| **Pays the deposit** | `Purchase`, value = the deposit | success pages only | **yes, built**, all three deposit paths | PaymentIntent id or Checkout Session id (the browser `order_id`) |
| Pays a balance later | none | none | none | deliberately not a second `Purchase` |

Why a deposit is the `Purchase`: it is the moment a lead becomes a booked party, and it carries a real
value. Balance payments are not reported, so one party is never counted as two sales.

`Schedule` is deliberately not used. It would count the same booking twice.

`Contact` on the contact and mobile forms is kept as it is today so that the browser and server copies
match. If you want every inquiry optimised as a `Lead`, that is a one-line change per form and worth doing
before running conversion ads. It is your call.

## 3. What identifies a person, and what does not

Sent with every server event: the visitor's IP address and browser string, and Meta's own `_fbp` / `_fbc`
cookies (or the stored click id from the ad URL).

Sent **only for someone who has opted in to marketing**: a SHA-256 hash of their normalised email and phone.
"Opted in" means `contacts.email_opt_in` is explicitly true **and** `optedOutReason()` finds nothing: a person who
was never asked is not opted in. For a brand-new lead the only consent is the checkbox on the form they just submitted.

Never sent: names, the child, the party, the booking reference, notes, amounts other than the deposit.
Nothing is sent unhashed.

## 4. Audiences (set up in Meta Ads Manager, not in code)

| Audience | Built from | Use |
|---|---|---|
| Site visitors, 30 days | Pixel, all visitors | retargeting |
| Site visitors, 90 days | Pixel, all visitors | retargeting |
| Visited a theme / pricing page, did not book | Pixel `ViewContent` (after section 7) | retargeting |
| Past clients | customer list upload from the admin export (it already applies the opt-out rule) | lookalike source |
| **Booked customers** | the same list, or Pixel `Purchase` 180 days | **exclude from acquisition ads** |

Excluding booked customers matters: without it, ads keep paying to reach people who already booked.

## 5. What was built (all inactive until section 6)

- `lib/metaCapi.ts`: the server sender. Off unless `META_CAPI_ENABLED=true` **and** a token **and** a pixel id exist. Hashes per Meta's rules. Never throws, 2 second timeout, logs a status code and never a body.
- `lib/utm.ts` / `lib/attribution.ts`: the first-touch record now also keeps `fbclid`, `fbc`, `fbp`. Every form's `getAttribution()` call mints a fresh `meta_event_id`; the Pixel call that follows uses the same id.
- `lib/metaPixel.ts` / `lib/gtag.ts`: `Lead`, `Contact` and `Purchase` carry `eventID`.
- Server hooks: `/api/lead`, `/api/contact`, `/api/mobile-party-inquiry` (after the lead is confirmed recorded), and the Stripe webhook's three deposit paths (only on the **first** processing of a payment, never on a redelivery).
- Tests: `metaCapi.test.ts` pins the off-by-default switch, the hashing, the no-consent rule, and the webhook's first-time-only rule.

## 6. What the owner must do (about 15 minutes)

1. In **Meta Events Manager**, open the dataset for the pixel (id `1543468516699272`) and confirm you are an admin of it.
2. Events Manager > the dataset > **Settings** > **Conversions API** > **Generate access token**. Copy it.
3. On the server, put it in `/opt/hosthampton/.env` as `META_CAPI_ACCESS_TOKEN=<token>`. Do not paste it into chat, a ticket or the repository.
4. In the same Settings page, open **Test events** and copy the **test event code** (looks like `TEST12345`). Add `META_CAPI_TEST_EVENT_CODE=<code>` to `.env`.
5. Add `META_CAPI_ENABLED=true` to `.env`, then rebuild: `docker compose up -d --build website` (a plain restart does not pick up `.env`).
6. Submit a test inquiry from the live site. In **Test events** you should see the browser event **and** the server event as one, marked "Deduplicated".
7. Remove `META_CAPI_TEST_EVENT_CODE` from `.env` and rebuild, so real events stop going to the test tab.
8. In **Aggregated Event Measurement** (Events Manager > Settings), set `Purchase` as the top-priority event. This matters for iPhone traffic.
9. In Ads Manager, create the audiences in section 4, and add "Booked customers" as an **exclusion** on acquisition campaigns.
10. Optional but recommended: in Events Manager > Settings, turn on **Automatic Advanced Matching** only if you accept Meta reading form fields; it is off by default and the code does not need it.

## 7. Not built yet, and why

- **`ViewContent` on theme and pricing pages** needs a decision on which routes count; it is a small client component once chosen.
- **A consent banner.** None exists today. The server events honour the opt-in rule above, but the browser Pixel still loads for everyone, as it always has. If you want a banner (some states and the EU/UK require one), say so.
- **Reporting `Lead` for every inquiry form** (section 2 note).
- **Fundraiser, canvas-bag and trucker-hat forms** do not send a server `Lead` yet; their browser events are unchanged.
