# P07 — Host page `/my-booking/invitation`

**Branch:** `feat/evites` (can run in parallel with P08). **Spec:** §7.2. HANDOFF §4, D5, D10, D12.

## Read first
- `lib/portalAuth.ts` (`getPortalBookingRef`), `lib/planAccess.ts`.
- `app/api/portal/auth/route.ts` (redirect allow-list L175–186).
- `app/my-booking/MyBookingContent.tsx`, `app/my-booking/login/page.tsx`.
- `portalAuthSurface.test.ts`, `portalWriteSurface.test.ts`.

## Tasks
1. **`GET /api/portal/invitation`** and **`PATCH /api/portal/invitation`** (`app/api/portal/invitation/route.ts`) per §7.2:
   - portal cookie → 401
   - `HOST_RSVP_COLUMNS` only
   - summary: kidsYes = Σ `child_count` over yes; adultsYes counts 2 as "2+"; cap = `guest_count_approx`; an allergy roll-up
   - PATCH allow-list and screens; then `queueRender`
2. **`POST /api/portal/invitation/event`:** `share_clicked`.
3. **`app/my-booking/invitation/page.tsx`:**
   - Invite preview (web canvas).
   - State banner, with copy for each of preview / needs_time / live / closed.
   - **Share panel:** Text My Invitation (Web Share, else the `sms:` body, iOS vs other); Copy link; Download image; Re-share. Disabled unless `state==='live' && renderFresh`, with "Updating your invitation…" otherwise.
   - **Customize** (all optional): host note, gift note, RSVP-by date, "Any questions?" name and phone, show/hide.
   - **RSVP list:** kids, adults, allergies, notes to the birthday child, "11 of 10 kids" vs cap, and a "Can't make it" section.
   - Polls every 30 s while `document.visibilityState === 'visible'`.
4. **`/my-booking/login`:** support `?next=` restricted to the portal allow-list.
5. **`/api/portal/auth`:** add `/my-booking/invitation` to the redirect allow-list.
6. **`/my-booking`:** an "Your invitation" card linking to the host page, shown when an evite exists.

## Tests
- API: 401 without a cookie; the response never includes `reminder_email`, `reminder_phone_e164`, `club_*` or `consent_ip` (assert the keys); summary math with siblings (the birthday child is never counted); PATCH rejects unknown fields and screens the phone format; `rsvp_deadline` must fall in today…party_date.
- The login `next` param rejects `//evil.com`, `https://…` and paths outside the allow-list.
- The portal auth redirect accepts `/my-booking/invitation`.
- Share button disabled states.

## Acceptance checks
- [ ] Jest is green, including `portalAuthSurface`, `portalWriteSurface` and `publicIntakeSurface` (the host routes are portal-gated, not public). `tsc` is clean. `next build` passes.
