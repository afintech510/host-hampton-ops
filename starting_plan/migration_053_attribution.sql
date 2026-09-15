-- Migration 053 — where an inquiry came from, kept on the row.
--
-- WHY:
--
-- `lib/utm.ts` has captured `utm_*` into sessionStorage since it was written,
-- and four forms POST it. It was never stored anywhere a question could be
-- asked of: the route dropped it into `contact_interactions.metadata->>'utm'`,
-- a JSON blob no screen reads, and `/api/checkout` did `void utm` outright.
--
-- Meanwhile `upsertContactResult` wrote `source: 'direct'` as a LITERAL for
-- every website contact — on insert AND on every later update — so the one
-- column the admin Contacts tab actually displays said "direct" for all 1217
-- people regardless of what brought them.
--
-- Measured on production 2026-09-15: 95 form submissions in six months, **3**
-- carrying any UTM at all, and all three `utm_source=chatgpt.com` (2026-08-31,
-- 09-02, 09-03). The reason it is 3 and not 95 is that `captureUtm()` ran only
-- inside the four form components, so a visitor who landed anywhere else first
-- — the homepage, a blog page — arrived at the form with a clean URL and the
-- tag was already gone. That half is fixed in the app (site-wide capture at the
-- layout); this migration is the place to PUT the answer once it survives.
--
-- Two columns, one shape, both tables:
--
--   attribution jsonb  — the raw first touch, verbatim: utm_*, the referrer
--                        host, the landing path, the capture time. Verbatim
--                        matters because the derived enum below has no label
--                        for `chatgpt.com` and never will; `other` is honest
--                        but it is not the answer, and the answer is in here.
--
-- and `contacts.source` (the existing `lead_source` enum) stops being a
-- literal and starts being derived from that blob — see `deriveLeadSource` in
-- lib/attribution.ts, which can only ever return a label this enum holds.
--
-- FIRST TOUCH, NOT LAST. `source` is written on INSERT, and on UPDATE only to
-- replace a `direct`/NULL with a real signal. Otherwise the fourth visit — the
-- one where they type hosthampton.com directly because they already know us —
-- overwrites the Instagram ad that actually earned the lead. Same reason
-- `status` is insert-only two lines above it.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS attribution jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN contacts.attribution IS
  'First-touch marketing attribution, verbatim: utm_source/medium/campaign/content/term, referrer (host only), landing_path, captured_at. Screened by screenAttribution() in lib/attribution.ts. {} = no signal was captured (direct, or a pre-2026-09-15 row). The derived channel is contacts.source.';

COMMENT ON COLUMN contacts.source IS
  'First-touch channel, derived from contacts.attribution by deriveLeadSource(). Written on INSERT; on UPDATE only when the stored value is direct/NULL and a real signal has arrived. Was a hardcoded ''direct'' literal for every website contact before migration 053.';

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS attribution jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN bookings.attribution IS
  'First-touch marketing attribution for the inquiry that became this plan — same shape as contacts.attribution. Distinct from bookings.source, which says which INTAKE wrote the row (website_form, quo, admin), not which channel sent the customer.';

-- The two reporting reads. `attribution->>'utm_source'` is the question the
-- admin Marketing tab asks ("what is sending us inquiries this month"), and a
-- jsonb column with no index answers it by sequential scan forever.
CREATE INDEX IF NOT EXISTS contacts_attribution_utm_source_idx
  ON contacts ((attribution->>'utm_source'))
  WHERE attribution->>'utm_source' IS NOT NULL;

CREATE INDEX IF NOT EXISTS bookings_attribution_utm_source_idx
  ON bookings ((attribution->>'utm_source'))
  WHERE attribution->>'utm_source' IS NOT NULL;

-- Backfill: the three real UTMs we did manage to keep, plus every other form
-- submission whose interaction metadata carries one. `contact_interactions`
-- is where the blob has been landing since the forms were written, so this is
-- not invention — it is moving an answer we already had onto the row that can
-- be asked. Oldest interaction per contact wins: first touch.
WITH first_utm AS (
  SELECT DISTINCT ON (ci.contact_id)
         ci.contact_id,
         ci.metadata->'utm'  AS utm,
         ci.metadata->>'page' AS page,
         ci.created_at
    FROM contact_interactions ci
   WHERE ci.contact_id IS NOT NULL
     AND jsonb_typeof(ci.metadata->'utm') = 'object'
     AND ci.metadata->'utm' <> '{}'::jsonb
   ORDER BY ci.contact_id, ci.created_at ASC
)
UPDATE contacts c
   SET attribution = first_utm.utm
                     || jsonb_build_object(
                          'landing_path', COALESCE('/' || first_utm.page, ''),
                          'captured_at',  to_char(first_utm.created_at AT TIME ZONE 'UTC',
                                                  'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                          'backfilled',   true)
  FROM first_utm
 WHERE c.id = first_utm.contact_id
   AND c.attribution = '{}'::jsonb;

-- The derived channel for exactly those backfilled rows. Deliberately narrow:
-- it maps only what `deriveLeadSource` maps, and leaves everything it does not
-- recognise alone rather than guessing. `chatgpt.com` lands in `other` — which
-- is why the verbatim blob above is the column that matters.
UPDATE contacts
   SET source = CASE
         WHEN lower(attribution->>'utm_source') IN ('instagram', 'instagram.com', 'ig') THEN 'instagram'
         WHEN lower(attribution->>'utm_source') IN ('facebook', 'facebook.com', 'fb')   THEN 'facebook'
         WHEN lower(attribution->>'utm_source') IN ('nextdoor', 'nextdoor.com')         THEN 'nextdoor'
         WHEN lower(attribution->>'utm_source') IN ('yelp', 'yelp.com')                 THEN 'yelp'
         WHEN lower(attribution->>'utm_source') IN ('email', 'brevo', 'newsletter')     THEN 'email'
         WHEN lower(attribution->>'utm_source') IN ('sms', 'text')                      THEN 'sms'
         WHEN lower(attribution->>'utm_source') = 'google'
              AND lower(COALESCE(attribution->>'utm_medium', '')) IN ('cpc', 'ppc', 'paid', 'paid_search')
                                                                                        THEN 'google_ads'
         WHEN lower(attribution->>'utm_source') = 'google'                              THEN 'google_organic'
         ELSE 'other'
       END::lead_source
 WHERE attribution->>'utm_source' IS NOT NULL
   AND source IN ('direct', 'other');
