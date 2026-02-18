-- ============================================================
-- HOST HAMPTON — SUPABASE SCHEMA ADDENDUM v1.2
-- Apply after initial schema (HostHampton_Supabase_Schema.sql)
-- Incorporates: Plan Addendum v1.2 | February 2026
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. UPDATE agent_name ENUM
--    Add OUTBOUND and PAID (REACH split)
-- ────────────────────────────────────────────────────────────

-- Note: PostgreSQL requires a transaction to add enum values
ALTER TYPE agent_name ADD VALUE IF NOT EXISTS 'OUTBOUND';
ALTER TYPE agent_name ADD VALUE IF NOT EXISTS 'PAID';
-- REACH is deprecated — kept in enum for historical records, not used for new rows


-- ────────────────────────────────────────────────────────────
-- 2. STRIPE TRANSACTIONS TABLE
--    Event ticket sales + party deposits via Stripe Checkout
-- ────────────────────────────────────────────────────────────

create table if not exists public.stripe_transactions (
  id                    uuid primary key default uuid_generate_v4(),
  stripe_payment_intent text unique,
  stripe_session_id     text unique,
  contact_id            uuid references public.contacts(id) on delete set null,
  booking_id            uuid references public.bookings(id) on delete set null,
  transaction_type      text not null check (transaction_type in (
                          'event_ticket',       -- workshop/class/market ticket
                          'party_deposit',      -- $200 hold for party booking
                          'refund'
                        )),
  amount_cents          int not null,           -- in cents (e.g. 20000 = $200)
  currency              text not null default 'usd',
  status                text not null check (status in (
                          'pending',
                          'succeeded',
                          'failed',
                          'refunded',
                          'partially_refunded'
                        )),
  event_name            text,                  -- event title if ticket purchase
  event_date            date,
  metadata              jsonb default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index idx_stripe_contact    on public.stripe_transactions(contact_id);
create index idx_stripe_booking    on public.stripe_transactions(booking_id);
create index idx_stripe_type       on public.stripe_transactions(transaction_type);
create index idx_stripe_status     on public.stripe_transactions(status);
create index idx_stripe_date       on public.stripe_transactions(created_at);

-- RLS
alter table public.stripe_transactions enable row level security;

create policy "ops_full_access_stripe"
  on public.stripe_transactions for all
  using (is_owner_or_admin());


-- ────────────────────────────────────────────────────────────
-- 3. CONTENT SNAPSHOTS TABLE
--    BUILD agent stores crawled Squarespace page content
--    for migration reference
-- ────────────────────────────────────────────────────────────

create table if not exists public.content_snapshots (
  id              uuid primary key default uuid_generate_v4(),
  source_url      text not null,
  page_title      text,
  raw_html        text,
  extracted_copy  text,
  images          jsonb default '[]',   -- [{url, alt, width, height}]
  migration_status text not null default 'pending' check (migration_status in (
                    'pending',
                    'copy_in_review',
                    'copy_approved',
                    'images_optimized',
                    'built',
                    'live',
                    'skipped'
                  )),
  new_route       text,                 -- e.g. '/kids-parties/swiftie-party'
  notes           text,
  crawled_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_snapshots_status on public.content_snapshots(migration_status);
create index idx_snapshots_route  on public.content_snapshots(new_route);

alter table public.content_snapshots enable row level security;

create policy "ops_full_access_snapshots"
  on public.content_snapshots for all
  using (is_owner_or_admin());


-- ────────────────────────────────────────────────────────────
-- 4. ESCALATIONS TABLE
--    HAMPTON logs situations requiring human decision
-- ────────────────────────────────────────────────────────────

create table if not exists public.escalations (
  id              uuid primary key default uuid_generate_v4(),
  triggered_by    agent_name not null,
  reason          text not null,
  context         jsonb default '{}',   -- relevant task/contact/campaign data
  priority        text not null default 'normal' check (priority in (
                    'urgent',   -- requires response within 1 hour
                    'high',     -- requires response within 4 hours
                    'normal',   -- requires response within 24 hours
                    'low'       -- informational, no time pressure
                  )),
  status          text not null default 'open' check (status in (
                    'open',
                    'acknowledged',
                    'resolved',
                    'dismissed'
                  )),
  sms_alert_sent  boolean not null default false,
  resolved_by     uuid references public.user_profiles(id),
  resolution_note text,
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz
);

create index idx_escalations_status   on public.escalations(status);
create index idx_escalations_priority on public.escalations(priority);
create index idx_escalations_agent    on public.escalations(triggered_by);

alter table public.escalations enable row level security;

create policy "ops_full_access_escalations"
  on public.escalations for all
  using (is_owner_or_admin());


-- ────────────────────────────────────────────────────────────
-- 5. REVIEW REQUESTS TABLE
--    Review Velocity Engine tracking
-- ────────────────────────────────────────────────────────────

create table if not exists public.review_requests (
  id              uuid primary key default uuid_generate_v4(),
  contact_id      uuid not null references public.contacts(id) on delete cascade,
  booking_id      uuid references public.bookings(id) on delete set null,
  sms_sent_at     timestamptz,
  email_sent_at   timestamptz,
  review_posted   boolean not null default false,
  review_platform text check (review_platform in ('google', 'facebook', 'yelp', 'other')),
  review_id       uuid references public.reviews(id) on delete set null,
  sequence_step   int not null default 1,  -- 1=first touch, 2=follow-up
  opted_out       boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_review_req_contact  on public.review_requests(contact_id);
create index idx_review_req_booking  on public.review_requests(booking_id);
create index idx_review_req_posted   on public.review_requests(review_posted);
create index idx_review_req_date     on public.review_requests(created_at);

alter table public.review_requests enable row level security;

create policy "ops_full_access_review_requests"
  on public.review_requests for all
  using (is_owner_or_admin());


-- ────────────────────────────────────────────────────────────
-- 6. BOOKING GAP EVENTS TABLE
--    Booking Gap Detector — HAMPTON Monday cron
-- ────────────────────────────────────────────────────────────

create table if not exists public.booking_gap_events (
  id                uuid primary key default uuid_generate_v4(),
  gap_start_date    date not null,
  gap_end_date      date not null,
  gap_days          int generated always as (gap_end_date - gap_start_date) stored,
  detected_at       timestamptz not null default now(),
  campaign_triggered boolean not null default false,
  campaign_id       uuid references public.campaigns(id) on delete set null,
  resolution_status text not null default 'open' check (resolution_status in (
                      'open',
                      'campaign_launched',
                      'gap_filled',
                      'dismissed'
                    )),
  notes             text,
  updated_at        timestamptz not null default now()
);

create index idx_gap_events_dates  on public.booking_gap_events(gap_start_date, gap_end_date);
create index idx_gap_events_status on public.booking_gap_events(resolution_status);

alter table public.booking_gap_events enable row level security;

create policy "ops_full_access_gap_events"
  on public.booking_gap_events for all
  using (is_owner_or_admin());


-- ────────────────────────────────────────────────────────────
-- 7. LANDING PAGES TABLE — UPDATE for BUILD agent
--    Replaces the old "builder bridge" workflow
--    BUILD now owns this directly via GitHub + Vercel
-- ────────────────────────────────────────────────────────────

-- Add columns to existing landing_pages table
alter table public.landing_pages
  add column if not exists github_branch    text,           -- branch name in repo
  add column if not exists vercel_preview   text,           -- preview URL
  add column if not exists page_type        text check (page_type in (
                              'service',
                              'theme',        -- /kids-parties/[theme]
                              'location',     -- /southampton etc.
                              'campaign',     -- ad-specific landing page
                              'blog',
                              'core'          -- homepage, /book, etc.
                            )),
  add column if not exists seo_title        text,
  add column if not exists seo_description  text,
  add column if not exists structured_data  jsonb default '{}',
  add column if not exists is_indexed       boolean default false,
  add column if not exists indexing_requested_at timestamptz;


-- ────────────────────────────────────────────────────────────
-- 8. VENDOR REFERRALS TABLE (Phase 3)
--    Track partner referral relationships and attribution
-- ────────────────────────────────────────────────────────────

create table if not exists public.vendor_referrals (
  id                  uuid primary key default uuid_generate_v4(),
  vendor_contact_id   uuid references public.contacts(id) on delete set null,
  vendor_name         text not null,
  vendor_type         text,                 -- 'wedding_planner', 'pta', 'dance_studio', etc.
  utm_campaign        text,                 -- UTM tag to track referral attribution
  referral_link       text,
  referrals_sent      int not null default 0,
  bookings_attributed int not null default 0,
  revenue_attributed  numeric(10,2) not null default 0,
  partnership_status  text not null default 'active' check (partnership_status in (
                        'prospect',
                        'outreach_sent',
                        'active',
                        'paused',
                        'ended'
                      )),
  last_referral_at    timestamptz,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index idx_vendor_status on public.vendor_referrals(partnership_status);

alter table public.vendor_referrals enable row level security;

create policy "ops_full_access_vendor_referrals"
  on public.vendor_referrals for all
  using (is_owner_or_admin());


-- ────────────────────────────────────────────────────────────
-- 9. MEMORY BOOTSTRAP — v1.2 New Namespace Keys
--    Run after main bootstrap to load additional keys
-- ────────────────────────────────────────────────────────────

-- These are loaded via memory_bootstrap.ts, not raw SQL.
-- The following keys must be added to the bootstrap script:
--
-- vendor_referrals.program_rules
--   → referral program terms, commission structure, UTM convention
--
-- review_velocity.sequence_config
--   → timing: +24hr SMS, +5day email, opt-out rules
--   → review platform priority: Google first, then Facebook
--
-- gap_fill_rules.thresholds
--   → gap_days >= 3: trigger awareness content
--   → gap_days >= 7: trigger flash offer campaign
--   → gap_days >= 14: escalate to owner + PAID campaign
--
-- website.migration_status
--   → current_site: squarespace
--   → target_stack: next.js + vercel + github + stripe
--   → migration_phase: pending (updated by BUILD as work progresses)
--   → squarespace_cancel_date: null (set when ready)
--
-- website.seo_targets
--   → 12 core page SEO assignments (title + target keyword per page)
--   → 10 party theme page SEO assignments
--   → 4 location page SEO assignments


-- ────────────────────────────────────────────────────────────
-- SUMMARY OF v1.2 ADDITIONS
-- ────────────────────────────────────────────────────────────
--
-- New tables:
--   stripe_transactions     — Stripe event ticket + deposit tracking
--   content_snapshots       — Squarespace migration content inventory
--   escalations             — HAMPTON human escalation log
--   review_requests         — Review Velocity Engine tracking
--   booking_gap_events      — Booking Gap Detector records
--   vendor_referrals        — Partner referral attribution (Phase 3)
--
-- Modified tables:
--   landing_pages           — Added BUILD agent fields (github_branch, vercel_preview, etc.)
--
-- Modified types:
--   agent_name              — Added OUTBOUND, PAID (REACH deprecated)
--
-- New memory namespaces (loaded via bootstrap script):
--   vendor_referrals.*
--   review_velocity.*
--   gap_fill_rules.*
--   website.*

-- ============================================================
-- END OF ADDENDUM v1.2
-- ============================================================
