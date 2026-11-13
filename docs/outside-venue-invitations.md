# Outside-venue invitations

A digital invitation (the EVITE: a picture, a page at `/i/<slug>`, RSVPs, reminders) for a **client's
event at a venue that is not ours**: a baby shower at a restaurant, a retirement party at a hall. First
use: Maeghan Murphy's baby shower, James Joyce, 49 S Ocean Ave, Patchogue, Jan 30 2027, 12-3 PM.

Host Hampton makes only the invitation and its RSVP page. It is not a party we run.

## How it is stored

`bookings.party_type = 'outside_event'` (migration 096, same shape as 095's `hat_bar`). The invitation
hangs off a booking row, so there is one, with:

| column | value |
|---|---|
| `status` | `confirmed` (the only way an unpaid booking is "booked", which is what makes the invitation live) |
| `total_cents`, `deposit_amount`, `balance_due_cents` | 0: nothing is priced, nothing is owed |
| `child_name` | the honoree's name as it prints on the invitation |
| `party_time` | 24-hour `HH:MM` start |
| `party_tags` | `location_type: 'mobile'`, `occasion` ("Baby Shower"), `venue_name`, `location_address`, `audience` (`guests` default, or `kids`), `event_end_time` |

`lib/evites/outsideEvent.ts` is the one reader of those tags; `lib/evites/outsideEventCreate.ts` is the
one screen that writes them; `lib/outsideEventIntake.ts` is the one writer.

## Making one

Admin, Parties tab, **+ Outside-venue invitation**. It posts to `POST /api/admin/parties/create` with
`partyType: 'outside_event'`. **It sends the client nothing**: no quote, no portal link, no invitation
email. Look at the invitation on the party's Invitation card, then send it from there (`send_invite_ready`).

## What it is kept out of (`lib/outsideEventGate.ts`)

Because it is `confirmed`, every operational path that reads booked bookings would otherwise pick it up.
Each ignores it by party type: the studio Google Calendar (it would block the studio that day), the crew
roster and its "unclassified" report, the reservation deposit and every pay route, check-in texts and the
booking reminder emails, review asks, birthday rebooking, the Booked tab and dashboard counts, the leads
refresh and Gmail thread matching. It stays in the Parties list so it can be managed. A PostgREST
exclusion must be `OUTSIDE_EVENT_OR_FILTER` (null-safe): a bare `.neq()` drops every booking whose
`party_type` is NULL.

## What the invitation says

- The noun is the occasion: "Maeghan's Baby Shower", not "...Birthday Party" (`InviteFacts.partyNoun`).
- The place is the venue and its street; the link-preview card carries the venue and its town only.
- `event_end_time` sets the window (12-3 PM), else two hours.
- **`audience: 'guests'`** (the default): the RSVP asks "Guests coming" and "Your name", has no adults
  control and no Birthday Club, and the host's emails say Guests with no kids / adults split. The
  database columns are unchanged (`children` keeps the names; a yes RSVP still needs one).
  `audience: 'kids'` is the kids' RSVP form exactly as it was.
- No party planner or invoice link anywhere (there is no plan to open).
- The "questions" line defaults to Allie and the studio number. The host can change who guests contact
  on their invitation page (Customize); an admin can set it on the Invitation card.

## The design

Until a Canva design is added it is drawn with the `plain` template (neon, "BABY / SHOWER" over the
name). To add the real one, follow the `hh-evite-template` skill. A template for an adult occasion
should bind `occasion` / `themeWord` and `themeSub` rather than typing "Birthday", and should hide its
`ageOrdinal` rows (an outside event has no age).
