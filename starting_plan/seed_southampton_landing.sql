-- ══════════════════════════════════════════════════════════════
-- Seed: Southampton permanent-jewelry town landing page (DRAFT)
--
--   Hand-written first town landing page. Insert as a draft, then push
--   it draft → pending_review → approved → published from the admin
--   Marketing tab to exercise the whole graph end-to-end.
--
--   NOT child media (references_child_media stays false), so it is not
--   consent-gated. Slug is unique to the DB renderer (no static route at
--   /permanent-jewelry-southampton), so app/[...slug] serves it.
--
-- Run AFTER migration_022. Idempotent on (slug, locale).
-- ══════════════════════════════════════════════════════════════

INSERT INTO public.website_content
  (slug, page_type, title, meta_description, locale, status, created_by, structured)
VALUES (
  'permanent-jewelry-southampton',
  'landing',
  'Permanent Jewelry in Southampton, NY | Host Hampton',
  'Welded-on permanent bracelets, anklets & necklaces for Southampton, NY. No clasp, no fuss — book your permanent jewelry appointment at Host Hampton in nearby Speonk.',
  'en',
  'draft',
  'manual',
  jsonb_build_object(
    'sections', jsonb_build_array(
      jsonb_build_object(
        'heading', 'Permanent Jewelry for Southampton',
        'text', 'Looking for permanent jewelry near Southampton? Host Hampton welds custom bracelets, anklets, and necklaces that stay on — no clasp, no fuss. A quick, fun appointment just up the road in Speonk.'
      ),
      jsonb_build_object(
        'heading', 'How it works',
        'text', 'Pick your chain and charms, we measure to fit, and we micro-weld the closure closed in seconds. It is comfortable, water-safe, and made to last.'
      )
    ),
    'faq', jsonb_build_array(
      jsonb_build_object('q', 'Do you serve the Southampton area?', 'a', 'Yes — we are minutes away in Speonk and welcome walk-ins and appointments from Southampton and across the East End.'),
      jsonb_build_object('q', 'How much is permanent jewelry?', 'a', 'Chains start at $38, plus any charms you add. Final price depends on the length and style you choose.'),
      jsonb_build_object('q', 'Can I bring a group?', 'a', 'Absolutely — permanent jewelry is a great group activity. Contact us to book a private session.')
    )
  )::jsonb
)
ON CONFLICT (slug, locale) DO NOTHING;

SELECT slug, status, locale FROM public.website_content WHERE slug = 'permanent-jewelry-southampton';
