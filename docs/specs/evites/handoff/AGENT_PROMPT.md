# Prompt for the local agent (Nimbalyst, in host-hampton-ops)

Copy everything below the line into the agent. Put this `evite-handoff/` folder at `docs/specs/evites/handoff/` in the repo first.

---

You are working in the `host-hampton-ops` repository (Next.js 14 App Router, Supabase, Stripe, Resend, Twilio, Docker on Hetzner). We are adding a **digital invitation + RSVP** feature for kids' parties.

Read `docs/specs/evites/handoff/HANDOFF.md` fully before doing anything. It is the source of truth: section 2 lists settled decisions that you must not change. Also read `SESSION_LOG.md` and `HostHampton_ClaudeCode_TODO.md` if present, and follow the repo's existing conventions.

Work in these stages and **stop for my approval at each gate**:

**Stage 1: Codebase review (no code changes).**
- Map how leads, quotes (`/kids-party-menu`), bookings, the Stripe `checkout.session.completed` webhook, Resend emails, the admin dashboard, and any customer-portal / magic-link auth currently work. Cite file paths.
- Compare the live Supabase schema to HANDOFF.md section 8 and propose the exact migration.
- List conflicts, risks, and anything in HANDOFF.md that does not fit the codebase.
- Write findings to `docs/specs/evites/01-codebase-review.md`. **Gate: wait for my OK.**

**Stage 2: Spec (spec-pipeline method).**
- Write `docs/specs/evites/02-SOW.md` (scope, out of scope, acceptance criteria from HANDOFF section 11).
- Write `docs/specs/evites/03-architecture-spec.md`: tables + RLS, routes (`/i/[slug]`, host page, RSVP API), render pipeline (preview image 1200×630 JPEG < 300 KB and portrait invite, versioned in Supabase Storage), template layout schema (generalize `templates/glow.layout.json`), lead-stage preview → deposit unlock state machine, emails, analytics events, security.
- Run an adversarial self-review of the spec, fix it, and mark it **LOCKED** with a changelog. **Gate: wait for my OK.**

**Stage 3: Build plan.**
- Break the MVP (HANDOFF section 10, item 1) into phased operator prompts in `docs/specs/evites/phases/` (each phase small, testable, with its own acceptance checks). **Gate: wait for my OK.**

**Stage 4: Build MVP on staging.**
- Implement phase by phase on a feature branch; migrations first; commit per phase; update `SESSION_LOG.md`.
- Port the Glow template using `assets/glow/` and match `mocks/invite_mia.png` and `mocks/og_card_mia.jpg`. Self-host fonts (Monoton, Bungee Outline, Neonderthaw, Poppins via `@fontsource`); no runtime calls to Google Fonts or Canva.
- Verify the acceptance criteria. Then give me a test checklist for the link-preview matrix (iMessage, iPhone→Android SMS, Pixel RCS, Samsung, WhatsApp) using a staging link.

Rules: do not add discounts, referral codes, credits, waivers, a "Maybe" RSVP option, or any texting of guest lists. Never expose one guest's data to another. Ask before any destructive migration or production deploy.
