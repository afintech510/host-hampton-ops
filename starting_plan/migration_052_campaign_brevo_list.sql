-- Migration 052 — a campaign carries the audience it is for.
--
-- WHY:
--
-- `CampaignsTab.tsx` held `const [sendListId, setSendListId] = useState(3)`
-- and **never called `setSendListId`**. It was dead state: every Send Now
-- posted `listId: 3`, the full marketing list, no matter what the campaign
-- was. The route's fallback (`BREVO_DEFAULT_LIST_ID`) says the same thing, so
-- there was no configuration anywhere that could aim a campaign at a subset.
--
-- That became load-bearing on 2026-09-15. Brevo's free plan caps sending at
-- **300 emails/day** and list 3 holds **970** sendable contacts, so the fall
-- campaign has to go out as four batches on four days (Brevo lists 4, 5, 6, 7
-- — 243/243/243/241). With the list id living in a button instead of on the
-- row, all four drafts would each have gone to all 970 — four times over, and
-- the first would have failed on credits anyway.
--
-- The audience belongs to the campaign, not to the click. A NULL keeps the old
-- behaviour (fall back to BREVO_DEFAULT_LIST_ID), so every existing draft and
-- the cron sender are unchanged.

ALTER TABLE scheduled_campaigns
  ADD COLUMN IF NOT EXISTS brevo_list_id integer;

COMMENT ON COLUMN scheduled_campaigns.brevo_list_id IS
  'Brevo list this campaign is addressed to. NULL = BREVO_DEFAULT_LIST_ID (the full marketing list). Set it to send to a subset, e.g. the 300/day batch lists.';

-- A list id is a positive integer or nothing. Guards a 0 written by
-- `parseInt(undefined)`, which the route would otherwise read as "not
-- configured" and quietly widen to the full list.
ALTER TABLE scheduled_campaigns
  DROP CONSTRAINT IF EXISTS scheduled_campaigns_brevo_list_id_check;
ALTER TABLE scheduled_campaigns
  ADD CONSTRAINT scheduled_campaigns_brevo_list_id_check
  CHECK (brevo_list_id IS NULL OR brevo_list_id > 0);
