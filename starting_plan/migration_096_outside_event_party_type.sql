-- Migration 096: an "outside event" party type.
--
-- A client's event held at a venue that is not ours (first use: a baby shower at
-- James Joyce, Patchogue), for which Host Hampton supplies only the digital
-- invitation and RSVP page. It is a booking row because an invitation hangs off
-- one, but it is NOT a party we run: it is kept off the studio calendar, the crew
-- roster and the money reports by its party_type (lib/calendarSync.ts,
-- lib/crew/sync.ts). Nothing is deleted or rewritten; only the CHECK is widened.
--
-- Same shape as migration 095 (hat_bar). inquiry_drafts and plan_content are
-- widened too so a Type control that offers the value can never be refused by a
-- sibling table's CHECK later.

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_party_type_check;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_party_type_check CHECK (
  party_type IS NULL OR party_type IN
    ('in_studio_theme', 'mobile_party', 'studio_rental', 'hat_bar', 'outside_event', 'unknown')
);

ALTER TABLE public.inquiry_drafts DROP CONSTRAINT IF EXISTS inquiry_drafts_party_type_chk;
ALTER TABLE public.inquiry_drafts ADD CONSTRAINT inquiry_drafts_party_type_chk CHECK (
  party_type IN ('studio_rental', 'mobile_party', 'in_studio_theme', 'hat_bar', 'outside_event', 'unknown')
);

ALTER TABLE public.plan_content DROP CONSTRAINT IF EXISTS plan_content_party_type_chk;
ALTER TABLE public.plan_content ADD CONSTRAINT plan_content_party_type_chk CHECK (
  party_type IN ('in_studio_theme', 'mobile_party', 'studio_rental', 'hat_bar', 'outside_event', 'unknown', 'all')
);
