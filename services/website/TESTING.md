# Host Hampton Website — Test Suite Guide

## Quick Start

```bash
cd services/website
npm test            # run all tests
npm run test:watch  # watch mode (re-runs on file change)
npx jest --verbose  # verbose output with individual test names
```

## Stack

- **Jest 30** + **ts-jest** for TypeScript
- Tests live in `src/__tests__/` mirroring the source tree
- Module path alias `@/` maps to `src/` (configured in jest.config.ts)
- No database or external services needed — everything is mocked

## Test Structure

```
src/__tests__/
  mocks/
    fixtures.ts       — Sample data (events, tickets, sessions, checkout bodies)
    supabase.ts       — Reusable mock Supabase chain builder (optional helper)
    nextRequest.ts    — Mock NextRequest/NextResponse factory (optional helper)
  lib/
    emailTemplates.test.ts  — 22 tests: HTML output, brand styling, free/paid, variants
    adminAuth.test.ts       — 6 tests: Bearer auth, missing/wrong/empty auth
    smsTemplates.test.ts    — 25 tests: all SMS templates, TCPA compliance, content validation
  api/
    events.test.ts          — 8 tests: public GET /api/events, GET /api/events/[slug]
    checkout.test.ts        — 8 tests: POST /api/events/checkout (free + paid + Stripe + validation)
    webhook.test.ts         — 5 tests: Stripe webhook (ticket + booking deposit flows)
    adminEvents.test.ts     — 15 tests: admin CRUD, tickets list, bulk email, auth gates
    refund.test.ts          — 7 tests: Stripe refund, partial refund, session tickets, error handling
    fundraiserInquiry.test.ts — 7 tests: validation, upsert, emails, error handling
    adminContacts.test.ts   — 12 tests: list/filter/search contacts, detail view, PATCH status/opt-in
    adminCampaigns.test.ts  — 22 tests: campaigns CRUD, Brevo send, reminders, newsletter actions
    adminOrders.test.ts     — 7 tests: unified orders, type/status/search filters, sort, amount mapping
    webhookBrevo.test.ts    — 7 tests: unsubscribe, bounce, open, click, invalid JSON/fields
    webhookTwilio.test.ts   — 6 tests: STOP opt-out, HELP TwiML, inbound SMS, delivery status
    contact.test.ts         — 16 tests: contact form + lead form validation, upsert, emails
```

**Total: 178 tests across 15 suites**

## What's Tested

### Email Templates (`emailTemplates.test.ts`)
- `ticketConfirmationHtml()` — customer-facing ticket confirmation
  - Contains correct customer name (first name only), event details, ticket ref
  - Shows variant label when present, omits when absent
  - Shows FREE badge vs paid amount
  - Includes Host Hampton brand colors (#1a2744, #A1B5C8) and contact info
- `ticketPurchaseNotifyHtml()` — owner notification email
  - Shows RSVP vs Ticket Purchase label based on isFree
  - Includes phone, variant, Stripe PI when available
- `ticketRefundHtml()` — refund confirmation email
  - Includes refund amount, ticket ref, 5-10 day timeline
  - Optionally includes refund reason

### Admin Auth (`adminAuth.test.ts`)
- `isAdminAuthorized()` — validates `Authorization: Bearer <ADMIN_PASSWORD>`
- Returns false for missing, wrong, or non-Bearer auth

### Public Events API (`events.test.ts`)
- `GET /api/events` — lists active events, filters by category, handles "all", errors
- `GET /api/events/[slug]` — single event by slug, 404 handling, session fetching

### Checkout (`checkout.test.ts`)
- Missing fields → 400
- Event not found → 404
- Insufficient tickets → 400
- Free events: inserts ticket directly, sends emails, returns success URL
- Paid events: creates Stripe checkout session with correct metadata
- Variant pricing: uses variant's priceCents from JSONB array
- Session availability: checks session's available_tickets

### Webhook (`webhook.test.ts`)
- Missing/invalid signature → 400
- `event_ticket` flow: creates ticket, decrements availability, sends 2 emails
- Session-based tickets: decrements session tickets instead of event tickets
- Party booking deposit: inserts into bookings table

### Admin Events (`adminEvents.test.ts`)
- All endpoints require auth (returns 401 without Bearer token)
- `GET /api/admin/events` — lists events with ticket counts
- `POST /api/admin/events` — creates event with auto-generated slug
- `GET /api/admin/events/[id]` — returns event + sessions when has_sessions=true
- `PUT /api/admin/events/[id]` — updates fields, recalculates available_tickets
- `DELETE /api/admin/events/[id]` — soft-deletes (sets is_active=false)
- `GET /api/admin/events/[id]/tickets` — lists tickets for event
- `POST /api/admin/events/[id]/email` — validates subject/body, deduplicates emails

### Refund (`refund.test.ts`)
- Auth gate, 404/400 guards
- Processes Stripe refund + updates ticket status + increments available_tickets
- Session-based refunds: increments session tickets
- Partial refund: passes custom amountCents to Stripe
- Stripe failure: returns 500 with error message

### Admin Contacts (`adminContacts.test.ts`)
- Auth gates on all endpoints
- `GET /api/admin/contacts` — list with pagination, status/opt-in/search filters
- `GET /api/admin/contacts/[id]` — detail with interactions + pending reminders, 404
- `PATCH /api/admin/contacts/[id]` — update status, notes, email/sms opt-in, rejects invalid fields

### Admin Campaigns (`adminCampaigns.test.ts`)
- `GET /api/admin/campaigns` — list with status filter
- `POST /api/admin/campaigns` — create draft or scheduled, validates subject required
- `GET /api/admin/campaigns/[id]` — detail, 404
- `PATCH /api/admin/campaigns/[id]` — send via Brevo, update draft fields, handles Brevo failure
- `DELETE /api/admin/campaigns/[id]` — cancels draft/scheduled campaigns
- `GET /api/admin/reminders` — pending reminders with contact join
- `PATCH /api/admin/reminders` — bulk cancel by IDs, validates non-empty
- `POST /api/admin/campaigns/actions` — draft-newsletter (generates from events), process-reminders

### Admin Orders (`adminOrders.test.ts`)
- Auth gate
- Returns unified bookings + tickets as orders
- Filters by type (booking/ticket), status, and search (name/email/ref)
- Maps booking deposit_amount * 100 to amount_cents
- Sorts by created_at descending

### Brevo Webhook (`webhookBrevo.test.ts`)
- Invalid JSON → 400, missing event/email → 400
- `unsubscribed` → sets email_opt_in=false, logs interaction
- `hard_bounce` → disables email
- `opened` → updates last_engaged_at
- `clicked` → updates last_engaged_at with link metadata
- Unrecognized events → graceful 200 no-op

### Twilio Webhook (`webhookTwilio.test.ts`)
- Invalid body → 400
- STOP/UNSUBSCRIBE → opts out of SMS, cancels pending reminders, logs interaction
- HELP → returns TwiML with help text
- Other inbound SMS → logs as sms_received interaction
- Delivery status callbacks → 200 with received=true

### Contact & Lead Forms (`contact.test.ts`)
- `POST /api/contact` — validates name/email/message required, email format
  - Calls upsertContact, sends admin + auto-response emails
- `POST /api/lead` — validates fullName/email/phone/eventType required
  - Maps service interests from sourcePage/eventType
  - Sends admin notification to hosthampton295@gmail.com + customer confirmation
  - Skips emails when RESEND_API_KEY not set

### SMS Templates (`smsTemplates.test.ts`)
- All 7 template functions return correct content (names, dates, prices, links)
- All templates include STOP opt-out text (TCPA compliance)
- Address includes 295 Montauk Hwy
- Flash sale starts with "FLASH SALE"

## Mocking Pattern

All tests use a **delegating mock** pattern for Supabase:

```typescript
const mockGetSupabase = jest.fn()
jest.mock('@/lib/supabase', () => ({
  getSupabase: (...args: any[]) => mockGetSupabase(...args),
}))

// In each test:
mockGetSupabase.mockReturnValue({ from: fromMock, rpc: rpcMock })
```

Supabase chains use `buildChain()` — a helper that creates a chainable mock
resolving to specified data:

```typescript
function buildChain(resolveValue: any) {
  const chain: any = {}
  for (const m of ['select', 'insert', 'update', 'eq', 'order', 'single', ...]) {
    chain[m] = jest.fn().mockReturnValue(chain)
  }
  const p = Promise.resolve(resolveValue)
  chain.then = p.then.bind(p)
  chain.catch = p.catch.bind(p)
  return chain
}
```

**Key rule:** Do NOT use `jest.resetModules()` — it breaks the mock references.
Use `jest.clearAllMocks()` + reconfigure mock return values in beforeEach instead.

## Adding New Tests

1. Add test file to `src/__tests__/` matching source path
2. Mock `@/lib/supabase` with the delegating pattern above
3. Mock `next/server` with the NextResponse.json factory
4. Mock external services (stripe, resend) at module level
5. Import route handlers AFTER jest.mock() calls
6. Use fixtures from `src/__tests__/mocks/fixtures.ts`

## Running Specific Tests

```bash
npx jest emailTemplates     # run just email template tests
npx jest checkout           # run just checkout tests
npx jest --testPathPattern="refund"  # pattern match
```

## CI Integration

Add to your CI pipeline:
```yaml
- name: Run website tests
  working-directory: services/website
  run: |
    npm ci
    npm test
```

Tests require NO environment variables — all external services are mocked.
