# Edit coverage: invoice integrity and the manager assistant

Started 2026-11-09 after the Denise (HH) double-charge: the assistant typed an "Additional guest" line, the planner derived the same 9 extra heads from the guest count and loaded the typed line as a custom, so $315 was charged twice (fixed in PR #26). A read-only audit of the party planner, admin Parties, the studio rental flow and the assistant found the same family elsewhere: **an edit path changes a field without updating the invoice lines derived from it.**

One PR at a time. Each PR: own worktree, tests, `pr-check` green, squash-merge, watch the Deploy, tick the box here in the PR that follows.

## Owner rulings (Adam, 2026-11-09)

- **No refunds** through the assistant. Refunds stay in Stripe / the dashboard.
- **Guest count is fluid until the final invoice is paid, and changing it changes the price** (customer portal included). Locked once paid in full.
- **Tips: yes. Discounts: yes** (propose cards, confirmed by a human click, like every other write).
- **Free-form texts and emails: yes**, through a reviewed card. **Sign as Allie once per number**, not on every message.

## Bugs found (status)

| # | Bug | Where | State |
|---|---|---|---|
| 0 | Admin guest-count PATCH left the flat "Additional Guests" line stale; typed duplicate double-charged | `admin/parties/[id]` PATCH, `PartyBuilderContent` load, assistant `add_line_item` | **Fixed, PR #26** |
| 1 | Customer rental edit rewrites every line: admin discounts and hand-typed lines (Party Helper, custom) are deleted, total rises | `studio-rental/edit/route.ts:129` | **Fixed, PR 1** (keeps lines with no pricing_item_id) |
| 2 | Customer rental edit ignores `custom_hourly_rate_cents`; reprices at the rate card | `edit/route.ts:99-113`, `StudioManageContent.tsx:98` | **Fixed, PR 1** server side (`lib/rentalPricing.ts`). The manage page's live price preview still shows the card rate: PR 5. |
| 3 | Admin `party_date`/`party_time` PATCH on a rental does not reprice or update `rental_*`/`is_weekend` tags or label | `admin/parties/[id]` PATCH | **Fixed, PR 1** |
| 4 | Portal guest-count PATCH does not re-derive totals; planner restores the old `snap.guestCount` over it | `portal/booking/route.ts:312`, `PartyBuilderContent.tsx:775` | **Fixed, PR 3a** (per the guest-count ruling; locked once paid in full; shared `lib/bookingTotals.ts`) |
| 5 | `edit_rental` ignores errors on the tags write and `recalcTotals`, answers ok with a stale total; does not re-enqueue reminders | `admin/parties/[id]` ~1448 | **Fixed, PR 1** |
| 6 | Admin `package_type` / `party_type` PATCH writes the column only; theme line, travel fee, rental lines, `event_type`, evite unchanged | PATCH | PR 2 |
| 7 | PATCH accepts raw `total_cents`, `balance_due_cents`, `party_tags`, `status` (skips cancel/approve handling) | PATCH allowlist | **Fixed, PR 2**: `status`, `total_cents`, `balance_due_cents` refused; `party_tags` limited to `modifications_unlocked` / `catchy_party_name` and merged. |
| 8 | Typed theme / activity-upgrade / mobile-cupcake lines are kept as customs next to the engine's regenerated ones | `PartyBuilderContent.tsx:870-880` | **Partly fixed, PR 2**: the stored mobile package line is no longer loaded as a custom. A typed theme or activity-upgrade line still cannot be told from a real custom; PR 3 stops the assistant typing them. |
| 9 | Planner load drops `is_optional`, `description`, `is_featured` (optional items become billed on re-save); negative admin lines make a public re-save 400 | `PartyBuilderContent.tsx:874-881`, `publicIntake.ts:151` | PR 5 |
| 10 | Mini party overwrites the raw guest count with the capped one | `plan.ts:100-105` | PR 5 |
| 11 | Seating 66-85 accepted; checkout silently clamps under-minimum windows; Party Helper hours do not follow a rental time change | `edit:56`, `studioRentalRateWith` | PR 5 |

## Inventory: what can be edited, and where

| Field | Planner | Admin Parties | Rental form | Assistant today |
|---|---|---|---|---|
| Contact name / email / phone | yes | yes | yes | covered |
| Child name / age | yes | yes | n/a | covered |
| Party name (`catchy_party_name`, `package_type`, rental `event_label`) | yes | `package_type` only | label at create | partial (`package_type` text; label at create only) |
| Date | yes | yes (no reprice on rentals) | no | covered, no reprice |
| Start time | yes | yes | yes | partial (start only) |
| Rental end / hours / custom rate / seating | n/a | `edit_rental` | yes (rate card only) | **missing** (tool not wired) |
| Guest count | yes | yes (fixed #26) | yes | covered |
| Theme | yes | text only | n/a | partial (text only) |
| Mobile / studio / rental switch | location toggle | `party_type` column only | n/a | partial (column only) |
| Mobile address, travel fee | yes | none | n/a | create only |
| Mini party | yes | none | n/a | **missing** |
| Activities, food, desserts, beverages, decor, entertainment, add-ons | yes | line items | add-ons | add/remove only; **no edit price/qty** |
| Pizza or bagels, cupcake flavor, mobile cupcakes, preferences, character request | yes (snapshot) | none | n/a | **missing** |
| Custom items | admin | yes | admin | covered (>= $0) |
| Discounts | admin | yes (negative line) | admin | **blocked** |
| Tip | n/a | with payment | n/a | **missing** (read only) |
| Security deposit | n/a | create only | create / hold | **missing** |
| Payments | pay panel | record_payment | deposit | covered (no refund, by ruling) |
| Receipt / portal / invoice / planner / invite links | n/a | yes | yes | covered |
| Check-in link, e-sign, photo album, reminders | n/a | check-in link, album | agreement | **missing** |
| Free-form SMS / email to the customer | n/a | none | n/a | **missing** |
| Evite / invitation edits | portal | `invitation` route | n/a | read + send only |
| Admin notes | n/a | yes | n/a | overwrite only; no append |

## PR sequence

- [x] **PR 0 (#26)** Guest count drives "Additional Guests"; assistant refuses a typed extra-guest line.
- [x] **PR 1 Invoice integrity (bugs 1, 2, 3, 5; bug 4 deferred).** Customer rental edit keeps admin-only lines and honours the custom hourly rate. Admin date/time PATCH on a rental reprices through the same code as `edit_rental`. Portal guest-count PATCH re-derives the flat lines and totals. `edit_rental` checks its errors and re-enqueues reminders.
- [x] **PR 2 Switch fixes (bugs 6-8).** Raw totals, `party_tags` and `status` leave the PATCH allowlist; theme / `party_type` changes warn when the lines disagree (a real rebuild needs choices, so it is a PR 3 action); the planner stops loading the stored mobile package as a custom.
- [x] **PR 3a Portal guest count reprices** (ruling above; mini-party cap respected).
- [x] **PR 3 Assistant field tools (part 1).** `propose_edit_line_item`, `propose_edit_rental`, `propose_set_preferences`, `admin_notes_append`. Two new admin actions (`edit_line_item`, `set_preferences`). Mobile address is in flight in another session's worktree (`hh-assistant-invoice-address`), so it is not duplicated here.
- [ ] **PR 3b Assistant field tools (part 2):** theme swap, party-type switch, mini flag (rebuild lines through the quote engine).
- [ ] **PR 4 Assistant money and messages.** Discounts (card names the amount and the reason), tips, security deposit, receipt, check-in link, e-sign resend, photo album, reminders, and free-form SMS / email. **No refunds.** Messages: the existing screen (STOP line, 8am-9pm ET, opt-out, no foreign URLs or phone numbers); the first message to a number is signed as Allie, later ones are not.
- [ ] **PR 5 Cleanup (bugs 9-11).**

## Rules for every PR here

- The assistant never writes directly: it proposes, a human clicks, and the confirmed route is the dashboard's own admin route (`assistantSurface.test.ts` A1/A2). New tools replay existing admin routes, so the dashboard and the assistant cannot disagree.
- A new derived line has one writer (the PATCH or the planner engine). Tools never type a copy of it.
- Probe production on throwaway rows (`HH-TEST-*`), never a real customer, and send test messages only to `hosthampton295@gmail.com`.
