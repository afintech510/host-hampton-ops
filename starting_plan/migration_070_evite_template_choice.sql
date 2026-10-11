-- Migration 070: the host picks their invitation's design
--
-- SCHEMA. Adam, 2026-10-11: seventeen Canva invitations become EVITE templates
-- and "the host picks from a gallery". Until now a party's design was decided
-- by its theme alone (lib/evites/themes.ts THEME_TEMPLATES); `template_slug`
-- cannot carry a choice, because it defaults to 'glow' on every row and is
-- honoured only beside an admin theme-word override (facts.ts).
--
-- WHAT. One nullable column. NULL = "the design for this party's theme", which
-- is every existing row, so nothing that exists changes. A value is a template
-- slug chosen by the host (PATCH /api/portal/invitation) or by an admin; an
-- unknown slug (a template since removed) is ignored by the code and the theme
-- default draws instead. The registry of slugs lives in code
-- (lib/evites/templates/index.ts), so the CHECK screens only the SHAPE.
--
-- Additive and nullable: code deployed before this migration never selects it.

ALTER TABLE evites
  ADD COLUMN IF NOT EXISTS template_choice text
  CONSTRAINT evites_template_choice_shape CHECK (template_choice ~ '^[a-z0-9-]{1,40}$');

COMMENT ON COLUMN evites.template_choice IS
  'The invitation design the host (or an admin) chose, a slug from lib/evites/templates. '
  'NULL = the design for the party''s theme (migration 070).';
