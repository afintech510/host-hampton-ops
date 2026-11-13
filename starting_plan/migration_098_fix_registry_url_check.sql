-- Migration 098: fix 097's registry_url CHECK. Postgres caps a regex repetition count at 255, so
-- `{3,290}` made every UPDATE of an evites row fail ("invalid repetition count(s)") and the host could
-- not save any setting. Same rule, expressed as a pattern plus a length. Applied 2026-11-13.
ALTER TABLE evites DROP CONSTRAINT IF EXISTS evites_registry_url_shape;
ALTER TABLE evites ADD CONSTRAINT evites_registry_url_shape CHECK (registry_url ~ '^https://[^[:space:]]+$' AND char_length(registry_url) <= 300);
