-- Migration 095: a "hat bar" party type (trucker hat bar: hat + iron-on patches).
--
-- First customer: Turner Construction, HH-PTY-VVEWJ (175 guests, 2026-12-03).
-- The invoice for it needs its own title and its own deposit wording, and the
-- admin Type control needs a value to offer. party_type is CHECK-constrained in
-- three places, so all three are widened here. Nothing is deleted or rewritten.

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_party_type_check;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_party_type_check CHECK (
  party_type IS NULL OR party_type IN
    ('in_studio_theme', 'mobile_party', 'studio_rental', 'hat_bar', 'unknown')
);

ALTER TABLE public.inquiry_drafts DROP CONSTRAINT IF EXISTS inquiry_drafts_party_type_chk;
ALTER TABLE public.inquiry_drafts ADD CONSTRAINT inquiry_drafts_party_type_chk CHECK (
  party_type IN ('studio_rental', 'mobile_party', 'in_studio_theme', 'hat_bar', 'unknown')
);

ALTER TABLE public.plan_content DROP CONSTRAINT IF EXISTS plan_content_party_type_chk;
ALTER TABLE public.plan_content ADD CONSTRAINT plan_content_party_type_chk CHECK (
  party_type IN ('in_studio_theme', 'mobile_party', 'studio_rental', 'hat_bar', 'unknown', 'all')
);

-- The deposit wording for a hat bar quote whose options are still unchosen.
-- Mirrors FALLBACK_CONTENT_ROWS in lib/planContent.ts. UPDATE first, INSERT only
-- what is absent, so a re-run changes nothing.
UPDATE public.plan_content SET body = '50% Deposit — Required to Book', updated_at = NOW()
 WHERE party_type = 'hat_bar' AND slot = 'deposit_label' AND sort_order = 1;
INSERT INTO public.plan_content (party_type, slot, body, sort_order)
SELECT 'hat_bar', 'deposit_label', '50% Deposit — Required to Book', 1
 WHERE NOT EXISTS (SELECT 1 FROM public.plan_content WHERE party_type = 'hat_bar' AND slot = 'deposit_label' AND sort_order = 1);

UPDATE public.plan_content SET body = 'Choose Option 1 or Option 2 above. A 50% deposit of your selected option reserves your date and comes off your total, so it is not an extra charge.', updated_at = NOW()
 WHERE party_type = 'hat_bar' AND slot = 'deposit_note' AND sort_order = 1;
INSERT INTO public.plan_content (party_type, slot, body, sort_order)
SELECT 'hat_bar', 'deposit_note', 'Choose Option 1 or Option 2 above. A 50% deposit of your selected option reserves your date and comes off your total, so it is not an extra charge.', 1
 WHERE NOT EXISTS (SELECT 1 FROM public.plan_content WHERE party_type = 'hat_bar' AND slot = 'deposit_note' AND sort_order = 1);
