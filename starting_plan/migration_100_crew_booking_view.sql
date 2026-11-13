-- 100: crew booking view - a read-only "Bookings" and "Schedule" in the crew app for the members
-- Adam switches it on for (Lexi first).
--
-- crew_booking_view_members : WHO may see the booked parties and the staffing schedule inside /crew.
--                             A row with enabled = true is the whole switch; nobody else sees the tabs
--                             or can call /api/crew/bookings, /api/crew/booking/*, /api/crew/schedule.
--                             What they see is an allow-list (no money, no contact details, no links);
--                             see lib/crew/bookingView.ts.
--
-- Idempotent. RLS on, service role only, like every crew table.

CREATE TABLE IF NOT EXISTS public.crew_booking_view_members (
  member_id  uuid PRIMARY KEY REFERENCES public.crew_members(id) ON DELETE CASCADE,
  enabled    boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crew_booking_view_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crew_booking_view_members FROM anon, authenticated;
GRANT ALL ON public.crew_booking_view_members TO service_role;

-- Lexi. By name, active, non-test, non-owner (the same match migration 094 used for her time clock).
INSERT INTO public.crew_booking_view_members (member_id)
SELECT id FROM public.crew_members
WHERE first_name ILIKE 'lexi' AND NOT is_owner AND NOT is_test AND status = 'active'
ON CONFLICT (member_id) DO NOTHING;
