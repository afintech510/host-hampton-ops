-- ══════════════════════════════════════════════════════════════
-- seed_voice_profile_v1.sql
--
--   Inserts voice profile v1 (seed) as the active row. Run AFTER
--   migration_027_voice_profile.sql. The human-readable twin is
--   docs/marketing/voice-profile.md — keep them in sync.
--
--   v1 CONFIDENCE = LOW: built from the Gmail outbound mine only, of which
--   only ~10 rows are verbatim Allie replies (mostly mobile-party + hat-bar
--   inquiries); the rest were ingestion-agent summaries. No SMS/Grasshopper
--   corpus yet. Do not over-fit drafts to this. Idempotent on (version).
-- ══════════════════════════════════════════════════════════════

INSERT INTO public.voice_profile (version, is_active, confidence, doc_path, corpus_notes, created_by, profile)
VALUES (
  1,
  true,
  'low',
  'docs/marketing/voice-profile.md',
  'Gmail outbound mine (ingested_messages, direction=out). ~107 outbound rows, but most are ingestion-agent summaries or invoice-history notes; only ~10 verbatim replies (mobile-party + Atelier Brim hat-bar inquiries). No Grasshopper/SMS corpus yet. Under-sampled — a hypothesis for Allie to correct, not a finished model.',
  'manual',
  jsonb_build_object(
    'tone_rules', jsonb_build_array(
      'Warm and brief; answer the question and stop, no corporate padding.',
      'Lead with a qualifying question before quoting (what service, what budget, where).',
      'Collaborative and flexible: frame offerings as adjustable to fit the customer.',
      'Plain-spoken about price: real numbers inline with "starting at" and per-person add-ons; never "email for pricing".',
      'Honest about limits; say no kindly and refer out when you cannot help.',
      'Use "we", not "I".',
      'Light genuine enthusiasm (one exclamation to open), not emoji-heavy.'
    ),
    'greeting', 'Hi [First Name], thanks so much for reaching out!',
    'signoff', 'No consistent formal sign-off in email; sometimes shares cell for direct contact. (Unconfirmed — thin corpus.)',
    'pricing_style', 'State a real starting number fast with the shape of the deal; per-guest/per-extra add-ons; anchor a minimum for large B2B activations; tie the deposit to holding the date.',
    'dos', jsonb_build_array(
      'Open with a warm one-liner, then a qualifying question.',
      'Quote a real starting price with "depending on…".',
      'Offer flexible alternatives ("we can adjust…").',
      'Keep it to a few short sentences.',
      'Say "we".'
    ),
    'donts', jsonb_build_array(
      'Open with a canned marketing paragraph.',
      'Say "contact us for pricing".',
      'Over-promise or ignore service-area limits.',
      'Write long, formal, or emoji-heavy copy.',
      'Say "I" or use a stiff corporate voice.'
    ),
    'exemplars', jsonb_build_array(
      jsonb_build_object('context','First-touch, mobile party inquiry','text','Hi [Name], thanks so much for reaching out! What type of service are you looking for? We typically provide arts and crafts activities for the children, can be themed. https://www.hosthampton.com/mobile-party'),
      jsonb_build_object('context','Qualifying + soft quote, mobile party','text','We have another party ending in Southampton at 3:30 — where in the Hamptons is this? Could do wreath crowns / garden stones / fairy gardens. Starting at $1,100 depending on activities chosen. Cell [redacted].'),
      jsonb_build_object('context','Budget-first flexibility','text','What is the budget? We can adjust to activities that fit, like hair tinsel and jewelry making that need fewer supplies.'),
      jsonb_build_object('context','Inline pricing with add-ons','text','Canvas Paint mobile party $950 (10 guests + birthday child, +$40/extra), lip-gloss charm table +$25/person. For 12 girls: mobile party $990 + lip-gloss $300. $250 deposit to reserve June 19 @ 10am.'),
      jsonb_build_object('context','Honest limit + referral','text','Sorry, we are based on Long Island NY and cannot service Chicago.'),
      jsonb_build_object('context','Scoping a B2B hat-bar activation','text','Yes we can create custom patches and staff on-site for 100 guests. Per-hat package $35/guest baseline, plus custom patch setup/production.'),
      jsonb_build_object('context','Setting expectations plainly','text','Mobile parties don''t typically include food. Will send quote later today.')
    )
  )
)
ON CONFLICT (version) DO NOTHING;

SELECT version, is_active, confidence, jsonb_array_length(profile->'exemplars') AS exemplars
FROM public.voice_profile ORDER BY version;
