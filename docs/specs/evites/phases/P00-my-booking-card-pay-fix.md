# P00 — `/my-booking` card-payment fix (prerequisite, separate change)

**Branch:** `fix/my-booking-card-pay` (from `main`). This is NOT on `feat/evites`.
**Why:** Invites unlock when a deposit lands. Review §5.1–5.2 found that both card paths on `/my-booking` look broken. Adam approved fixing them first (Q12).

## Read first
- `services/website/src/app/api/portal/pay/route.ts`. The card branch (around L273–328) creates a **PaymentIntent** and returns `{clientSecret, paymentIntentId, method:'card'}`.
- `services/website/src/app/my-booking/MyBookingContent.tsx` around L150–215. It calls `stripe.initEmbeddedCheckout({clientSecret})`, which expects a **Checkout Session** secret.
- `services/website/src/app/my-booking/pay/page.tsx` around L40–65. It only handles `data.url`.
- The working reference implementation: the Payment Element flow in `services/website/src/app/party-builder/PartyBuilderContent.tsx` (search `PaymentElement` / `confirmPayment`). It also posts to `/api/portal/pay`.
- AGENTS.md §11 entries on the portal payment type, the $0 receipt, and "a cancelled booking does not take money".

## Tasks
1. **Confirm the defect** before changing anything. Write a jest test (or a small harness) showing that the response shape from `/api/portal/pay` for `card` has no `url` and returns a `pi_…_secret_…` secret.
2. **Fix both clients** to mount a Stripe **Payment Element** with the returned PaymentIntent `clientSecret` and call `stripe.confirmPayment` with `return_url` = `/my-booking?paid=1`. Reuse the party-builder component or pattern; don't invent a third way.
3. **Do not change `/api/portal/pay`'s money logic.** The response shape stays.
4. Add a regression test (React Testing Library, or a source-level test following the repo's surface-test conventions) asserting that neither client calls `initEmbeddedCheckout` with a portal/pay secret, and that `/my-booking/pay` handles `clientSecret`.

## Acceptance checks
- [ ] `npx jest` passes for the touched suites, plus `portalWriteSurface`, `planMoneySurface` and `stripeWebhookSurface`.
- [ ] `npx tsc --noEmit` passes. `npx next build` passes.
- [ ] No change to the metadata keys or amounts sent to Stripe (diff of `portal/pay/route.ts` is empty).
- [ ] The report describes how the orchestrator should verify in production after deploy. Follow memory `reservation-deposit-on-an-unpriced-plan`: create the PaymentIntent, read its metadata, **cancel it**. Never confirm a payment.

## Out of scope
Any other `/my-booking` change, styling, or webhook change.
