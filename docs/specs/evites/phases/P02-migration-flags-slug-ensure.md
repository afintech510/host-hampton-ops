# P02 — Migration 068 file, flags, slug, eligibility, ensure

**Branch:** `feat/evites`. **Spec:** §1 (exact SQL), §2 (module map rows: config, eligibility, slug, ensure, views), §2.1, §16.

## Read first
- `starting_plan/migration_064_lost_status.sql` and `migration_067_*.sql`, for house style.
- `services/website/src/lib/plan.ts` (`ensureLeadPlan`, ordering rule L16–26).
- `lib/pipelineStages.ts`, `lib/bookingStatus.ts`, `lib/supabase*.ts` (how a server client is obtained).
- `lib/appointmentEvents.ts` (registry pattern).

## Tasks
1. Write `starting_plan/migration_068_evites.sql` **exactly as spec §1**, including the storage bucket insert. Insert into `storage.buckets` (`id 'evites'`, `public true`, `file_size_limit 2097152`, `allowed_mime_types '{image/jpeg}'`) with `ON CONFLICT DO NOTHING`. Add a header comment block and a commented rollback section.
   **Do not apply it.**
2. `lib/evites/config.ts`: `evitePagesMode()`, `eviteSendsMode()`, `isPilotBooking(ref)`. Anything unrecognised reads as `off`.
3. `lib/evites/slug.ts`: `makeSlug(firstName | null, themeShort)`, `slugNamePart(slug)`, `isSlugShape(s)`. The regex is identical to the migration CHECK. The alphabet constant is exported.
4. `lib/evites/eligibility.ts`: `isEviteEligible(booking)` per spec §2.
5. `lib/evites/views.ts`: the four column allow-list constants, as explicit column lists.
6. `lib/evites/ensure.ts`: `ensureEviteForBooking(supabase, bookingId)` with the five outcomes. Slug collisions retry up to 5 times; a `booking_id` 23505 means `exists`; it never throws. It uses `themes.ts` / `facts`-free inputs only. Themes are not built yet, so take `themeShort` from a temporary `resolveThemeShort(booking)` stub in `ensure.ts`, marked `// replaced in P03`.
7. Add the `evites` types (`EviteRow`, `EviteRsvpRow`, `EviteSendRow`) in `lib/evites/types.ts`.

## Tests (new, under `src/__tests__/lib/evites/`)
- **slug:** shape; alphabet excludes `i l o u`; name normalisation (`"Zoë-Ann  Smith"` → `zoeann`); null → `party`; 1,000 generated slugs all match the regex.
- **config:** every mode, plus garbage → off.
- **eligibility:** each `party_type`, the location_type fallback, cancelled/lost/studio_rental excluded.
- **ensure:** with a fake supabase. `created`; slug collision then success; `booking_id` collision → `exists`; archived row → `exists`; insert error → `unavailable`; flag off → `disabled`.
- **migration text test:** the SQL file contains each table, `NULLS NOT DISTINCT`, `UNIQUE` on `booking_id`, RLS enabled on all five tables, and the slug CHECK regex equal to `slug.ts`'s.

## Acceptance checks
- [ ] Jest is green for the new suites. `npx tsc --noEmit` is clean.
- [ ] The migration is **not** applied (state it in the report).
