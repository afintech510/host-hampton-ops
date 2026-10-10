-- Migration 067 — the student's teacher on a fundraiser order.
--
-- ESM Sharks orders are handed to the child IN CLASS, and the PTO sorts the
-- handout pile by classroom. "Child's name" alone does not say which room a box
-- goes to, so `/esm-sharks` now asks for the teacher.
--
-- NULLABLE, with no CHECK tying it to `team`, on purpose:
--   - the 7 ESM orders placed before this field existed have no teacher, and
--     inventing one would be worse than showing the gap;
--   - CM Cheer is a squad, not a school class, and never sends it.
-- The requirement ("an ESM order names a teacher") is enforced by the API
-- (`screenTeacherName` in lib/fundraiserTeams.ts), going forward only.
--
-- Safe to re-run.

BEGIN;

ALTER TABLE public.cm_cheer_orders
  ADD COLUMN IF NOT EXISTS teacher_name text;

-- Bounded so a pasted essay cannot land in a volunteer's CSV. The API caps it
-- lower (80); this is the backstop.
ALTER TABLE public.cm_cheer_orders
  DROP CONSTRAINT IF EXISTS cm_cheer_orders_teacher_name_check;
ALTER TABLE public.cm_cheer_orders
  ADD CONSTRAINT cm_cheer_orders_teacher_name_check
  CHECK (teacher_name IS NULL OR (btrim(teacher_name) <> '' AND char_length(teacher_name) <= 120));

COMMIT;

-- Proof: the column exists, and no existing row was touched.
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'cm_cheer_orders' AND column_name = 'teacher_name';
SELECT team, count(*) AS orders, count(teacher_name) AS with_teacher
  FROM public.cm_cheer_orders GROUP BY team ORDER BY team;
