-- ============================================================
-- HOST HAMPTON — SUPABASE SCHEMA
-- Full CRM, Agent Operations, Content, Analytics
-- Row Level Security (RLS) enabled on all tables
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- EXTENSIONS
-- ────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";    -- fuzzy text search on contacts


-- ────────────────────────────────────────────────────────────
-- CUSTOM TYPES / ENUMS
-- ────────────────────────────────────────────────────────────

create type contact_status as enum (
  'lead',           -- never booked, showed interest
  'warm_lead',      -- engaged multiple times, not booked
  'hot_lead',       -- inquired recently, high intent
  'customer',       -- has booked at least once
  'vip',            -- repeat customer, high LTV
  'inactive',       -- no engagement 6+ months
  'unsubscribed'    -- opted out of all comms
);

create type lead_source as enum (
  'instagram',
  'facebook',
  'facebook_group',
  'facebook_marketplace',
  'google_organic',
  'google_ads',
  'nextdoor',
  'yelp',
  'referral',
  'walk_in',
  'pop_up_market',
  'email',
  'sms',
  'direct',
  'other'
);

create type service_type as enum (
  'kids_party',
  'room_rental',
  'permanent_jewelry',
  'host_your_client',
  'trucker_hat_bar',
  'workshop',
  'fundraiser',
  'craft_event',
  'photography_studio',
  'pop_up_vendor',
  'seasonal_retail',
  'other'
);

create type booking_status as enum (
  'inquiry',
  'quote_sent',
  'deposit_paid',
  'confirmed',
  'completed',
  'cancelled',
  'no_show',
  'refunded'
);

create type campaign_status as enum (
  'draft',
  'scheduled',
  'active',
  'paused',
  'completed',
  'archived'
);

create type task_status as enum (
  'pending',
  'in_progress',
  'completed',
  'failed',
  'cancelled'
);

create type task_priority as enum (
  'urgent',
  'high',
  'normal',
  'low',
  'async'
);

create type agent_name as enum (
  'HAMPTON',
  'SOC',
  'COPY',
  'PIXEL',
  'BUILD',
  'LIST',
  'REACH',
  'INTEL'
);

create type social_platform as enum (
  'instagram',
  'facebook_page',
  'facebook_group',
  'facebook_marketplace',
  'nextdoor',
  'google_business',
  'yelp',
  'pinterest',
  'tiktok',
  'email',
  'sms'
);

create type content_status as enum (
  'draft',
  'approved',
  'scheduled',
  'published',
  'archived'
);

create type email_sequence_status as enum (
  'active',
  'paused',
  'completed',
  'unsubscribed'
);


-- ────────────────────────────────────────────────────────────
-- SECTION 1: AUTH & USER MANAGEMENT
-- ────────────────────────────────────────────────────────────

-- Extends Supabase auth.users with role info
create table public.user_profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  full_name       text,
  role            text not null default 'owner'
                  check (role in ('owner', 'admin', 'agent_system', 'readonly')),
  avatar_url      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.user_profiles is 'Extended profile for authenticated users. owner = business owner, agent_system = service account used by Docker agents.';

-- Agent service accounts (one row per agent, holds its JWT/API key hash)
create table public.agent_credentials (
  id              uuid primary key default uuid_generate_v4(),
  agent           agent_name not null unique,
  api_key_hash    text not null,          -- bcrypt hash, never store plaintext
  last_active     timestamptz,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

comment on table public.agent_credentials is 'Service account credentials for each agent. api_key_hash is bcrypt — verify at runtime, never compare plaintext.';


-- ────────────────────────────────────────────────────────────
-- SECTION 2: CRM — CONTACTS
-- ────────────────────────────────────────────────────────────

create table public.contacts (
  id                  uuid primary key default uuid_generate_v4(),
  email               text unique,
  phone               text,
  first_name          text,
  last_name           text,
  full_name           text generated always as (
                        trim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))
                      ) stored,
  status              contact_status not null default 'lead',
  source              lead_source,
  source_detail       text,                    -- e.g. "Westhampton Moms FB Group"
  zip_code            text,
  city                text,
  child_ages          int[],                   -- array of child ages e.g. {5, 8}
  child_birthdays     date[],                  -- for birthday reminder automation
  service_interests   service_type[],
  email_opt_in        boolean not null default false,
  sms_opt_in          boolean not null default false,
  email_opt_in_at     timestamptz,
  sms_opt_in_at       timestamptz,
  lifetime_value      numeric(10,2) not null default 0,
  booking_count       int not null default 0,
  last_booked_at      timestamptz,
  last_contacted_at   timestamptz,
  last_engaged_at     timestamptz,            -- any interaction (open email, click, etc)
  notes               text,
  is_business         boolean not null default false,  -- for Host Your Client leads
  business_name       text,
  business_type       text,
  instagram_handle    text,
  facebook_profile    text,
  referral_source     uuid references public.contacts(id),  -- who referred them
  mailchimp_id        text,                   -- external ID sync
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index idx_contacts_email        on public.contacts(email);
create index idx_contacts_phone        on public.contacts(phone);
create index idx_contacts_status       on public.contacts(status);
create index idx_contacts_source       on public.contacts(source);
create index idx_contacts_zip          on public.contacts(zip_code);
create index idx_contacts_ltv          on public.contacts(lifetime_value desc);
create index idx_contacts_created      on public.contacts(created_at desc);
create index idx_contacts_fullname_trgm on public.contacts using gin(full_name gin_trgm_ops);


-- Tags (many-to-many)
create table public.contact_tags (
  contact_id  uuid not null references public.contacts(id) on delete cascade,
  tag         text not null,
  added_by    agent_name,
  added_at    timestamptz not null default now(),
  primary key (contact_id, tag)
);

create index idx_contact_tags_tag on public.contact_tags(tag);


-- Contact interaction log
create table public.contact_interactions (
  id            uuid primary key default uuid_generate_v4(),
  contact_id    uuid not null references public.contacts(id) on delete cascade,
  type          text not null check (type in (
                  'email_sent','email_opened','email_clicked',
                  'sms_sent','sms_replied',
                  'ig_dm','fb_dm',
                  'phone_call','in_person',
                  'booking_inquiry','booking_confirmed',
                  'review_requested','review_left',
                  'ad_click','form_submission','other'
                )),
  channel       social_platform,
  summary       text,
  metadata      jsonb default '{}',
  agent         agent_name,
  created_at    timestamptz not null default now()
);

create index idx_interactions_contact on public.contact_interactions(contact_id, created_at desc);
create index idx_interactions_type    on public.contact_interactions(type);


-- ────────────────────────────────────────────────────────────
-- SECTION 3: BOOKINGS
-- ────────────────────────────────────────────────────────────

create table public.bookings (
  id                uuid primary key default uuid_generate_v4(),
  contact_id        uuid references public.contacts(id) on delete set null,
  service           service_type not null,
  status            booking_status not null default 'inquiry',
  event_date        date,
  event_time        time,
  event_duration    interval,                    -- e.g. '2 hours'
  guest_count       int,
  theme             text,                         -- e.g. "Swiftie Party"
  package_name      text,
  package_price     numeric(10,2),
  addons            jsonb default '[]',           -- [{name, price}, ...]
  addons_total      numeric(10,2) default 0,
  deposit_amount    numeric(10,2),
  deposit_paid_at   timestamptz,
  total_amount      numeric(10,2),
  balance_due       numeric(10,2),
  paid_in_full_at   timestamptz,
  notes             text,
  internal_notes    text,
  source            lead_source,
  booking_system_id text,                         -- external ID (Vagaro/Square)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_bookings_contact    on public.bookings(contact_id);
create index idx_bookings_event_date on public.bookings(event_date);
create index idx_bookings_status     on public.bookings(status);
create index idx_bookings_service    on public.bookings(service);
create index idx_bookings_created    on public.bookings(created_at desc);


-- ────────────────────────────────────────────────────────────
-- SECTION 4: AGENT TASK QUEUE
-- ────────────────────────────────────────────────────────────

create table public.agent_tasks (
  id                  uuid primary key default uuid_generate_v4(),
  created_by          agent_name not null default 'HAMPTON',
  assigned_to         agent_name not null,
  status              task_status not null default 'pending',
  priority            task_priority not null default 'normal',
  task_type           text not null,              -- e.g. "publish_content", "create_campaign"
  title               text not null,
  description         text,
  context             jsonb default '{}',         -- business context payload
  inputs              jsonb default '{}',         -- task-specific input data
  deliverable         jsonb default '{}',         -- expected output spec
  output              jsonb,                      -- agent's completed output
  error_message       text,
  retry_count         int not null default 0,
  max_retries         int not null default 2,
  depends_on          uuid[],                     -- task IDs that must complete first
  downstream_tasks    uuid[],                     -- task IDs to trigger on completion
  scheduled_for       timestamptz,                -- if null = run immediately
  started_at          timestamptz,
  completed_at        timestamptz,
  deadline            timestamptz,
  campaign_id         uuid,                       -- link to campaign if applicable
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index idx_tasks_assigned    on public.agent_tasks(assigned_to, status);
create index idx_tasks_status      on public.agent_tasks(status, priority);
create index idx_tasks_scheduled   on public.agent_tasks(scheduled_for) where status = 'pending';
create index idx_tasks_campaign    on public.agent_tasks(campaign_id);
create index idx_tasks_created     on public.agent_tasks(created_at desc);


-- ────────────────────────────────────────────────────────────
-- SECTION 5: CAMPAIGNS
-- ────────────────────────────────────────────────────────────

create table public.campaigns (
  id                  uuid primary key default uuid_generate_v4(),
  name                text not null,
  description         text,
  status              campaign_status not null default 'draft',
  service             service_type,
  target_segment      text,                       -- e.g. "parents_kids_5_14_hamptons"
  channels            social_platform[],
  goal                text,                       -- e.g. "Generate 20 party bookings"
  budget_total        numeric(10,2),
  budget_spent        numeric(10,2) default 0,
  starts_at           timestamptz,
  ends_at             timestamptz,
  leads_generated     int default 0,
  bookings_generated  int default 0,
  revenue_attributed  numeric(10,2) default 0,
  utm_campaign        text,
  metadata            jsonb default '{}',
  created_by          agent_name default 'HAMPTON',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index idx_campaigns_status  on public.campaigns(status);
create index idx_campaigns_service on public.campaigns(service);
create index idx_campaigns_dates   on public.campaigns(starts_at, ends_at);


-- ────────────────────────────────────────────────────────────
-- SECTION 6: CONTENT LIBRARY
-- ────────────────────────────────────────────────────────────

create table public.content_library (
  id              uuid primary key default uuid_generate_v4(),
  title           text not null,
  content_type    text not null check (content_type in (
                    'caption','email_subject','email_body',
                    'ad_headline','ad_description',
                    'sms','blog_post','hashtag_set',
                    'review_response','dm_reply','other'
                  )),
  platform        social_platform,
  service         service_type,
  status          content_status not null default 'draft',
  body            text not null,
  subject_line    text,                           -- for emails
  hashtags        text[],
  character_count int generated always as (char_length(body)) stored,
  campaign_id     uuid references public.campaigns(id) on delete set null,
  approved_by     uuid references public.user_profiles(id),
  approved_at     timestamptz,
  published_at    timestamptz,
  performance     jsonb default '{}',             -- {likes, reach, clicks, opens, etc}
  tags            text[],
  notes           text,
  created_by      agent_name,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_content_type     on public.content_library(content_type);
create index idx_content_platform on public.content_library(platform);
create index idx_content_status   on public.content_library(status);
create index idx_content_service  on public.content_library(service);
create index idx_content_campaign on public.content_library(campaign_id);


-- ────────────────────────────────────────────────────────────
-- SECTION 7: SOCIAL MEDIA POSTS
-- ────────────────────────────────────────────────────────────

create table public.social_posts (
  id                  uuid primary key default uuid_generate_v4(),
  platform            social_platform not null,
  platform_post_id    text,                       -- ID returned by platform API
  content_id          uuid references public.content_library(id),
  campaign_id         uuid references public.campaigns(id) on delete set null,
  caption             text,
  hashtags            text[],
  media_urls          text[],                     -- Cloudflare R2 URLs
  status              content_status not null default 'draft',
  scheduled_for       timestamptz,
  published_at        timestamptz,
  reach               int,
  impressions         int,
  likes               int,
  comments            int,
  shares              int,
  saves               int,
  link_clicks         int,
  profile_visits      int,
  raw_insights        jsonb default '{}',
  error_message       text,
  created_by          agent_name,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index idx_posts_platform    on public.social_posts(platform, status);
create index idx_posts_scheduled   on public.social_posts(scheduled_for) where status = 'scheduled';
create index idx_posts_published   on public.social_posts(published_at desc);
create index idx_posts_campaign    on public.social_posts(campaign_id);


-- ────────────────────────────────────────────────────────────
-- SECTION 8: EMAIL SEQUENCES
-- ────────────────────────────────────────────────────────────

create table public.email_sequences (
  id              uuid primary key default uuid_generate_v4(),
  name            text not null,
  trigger_event   text not null,              -- e.g. "new_inquiry", "post_booking"
  service         service_type,
  is_active       boolean not null default true,
  total_emails    int not null default 0,
  mailchimp_id    text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.email_sequence_steps (
  id              uuid primary key default uuid_generate_v4(),
  sequence_id     uuid not null references public.email_sequences(id) on delete cascade,
  step_number     int not null,
  delay_days      int not null default 0,         -- days after previous step
  subject         text not null,
  body_html       text not null,
  body_text       text,
  cta_text        text,
  cta_url         text,
  mailchimp_step_id text,
  unique (sequence_id, step_number)
);

create table public.contact_sequence_enrollments (
  id              uuid primary key default uuid_generate_v4(),
  contact_id      uuid not null references public.contacts(id) on delete cascade,
  sequence_id     uuid not null references public.email_sequences(id) on delete cascade,
  status          email_sequence_status not null default 'active',
  current_step    int not null default 0,
  enrolled_at     timestamptz not null default now(),
  completed_at    timestamptz,
  last_sent_at    timestamptz,
  unique (contact_id, sequence_id)
);

create index idx_enrollments_contact  on public.contact_sequence_enrollments(contact_id);
create index idx_enrollments_status   on public.contact_sequence_enrollments(status);
create index idx_enrollments_sequence on public.contact_sequence_enrollments(sequence_id);


-- ────────────────────────────────────────────────────────────
-- SECTION 9: AUDIENCE SEGMENTS
-- ────────────────────────────────────────────────────────────

create table public.audience_segments (
  id              uuid primary key default uuid_generate_v4(),
  name            text not null unique,
  description     text,
  filter_rules    jsonb not null default '{}',    -- dynamic query rules
  contact_count   int default 0,
  last_synced_at  timestamptz,
  mailchimp_segment_id text,
  meta_audience_id     text,                      -- Facebook Custom Audience ID
  is_active       boolean not null default true,
  created_by      agent_name,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Which contacts belong to which static segments
create table public.segment_contacts (
  segment_id  uuid not null references public.audience_segments(id) on delete cascade,
  contact_id  uuid not null references public.contacts(id) on delete cascade,
  added_at    timestamptz not null default now(),
  primary key (segment_id, contact_id)
);


-- ────────────────────────────────────────────────────────────
-- SECTION 10: AD PERFORMANCE
-- ────────────────────────────────────────────────────────────

create table public.ad_campaigns (
  id                  uuid primary key default uuid_generate_v4(),
  campaign_id         uuid references public.campaigns(id) on delete set null,
  platform            text not null check (platform in ('google','meta','nextdoor','other')),
  external_id         text not null,              -- Google/Meta campaign ID
  name                text not null,
  status              text,
  daily_budget        numeric(10,2),
  total_spend         numeric(10,2) default 0,
  impressions         int default 0,
  clicks              int default 0,
  conversions         int default 0,
  cost_per_click      numeric(10,4),
  cost_per_lead       numeric(10,2),
  roas                numeric(10,4),
  last_synced_at      timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index idx_ad_campaigns_platform on public.ad_campaigns(platform);
create index idx_ad_campaigns_status   on public.ad_campaigns(status);


-- ────────────────────────────────────────────────────────────
-- SECTION 11: IMAGE ASSETS
-- ────────────────────────────────────────────────────────────

create table public.image_assets (
  id              uuid primary key default uuid_generate_v4(),
  filename        text not null,
  r2_key          text not null unique,           -- Cloudflare R2 object key
  r2_url          text not null,
  service         service_type,
  theme           text,
  platform        social_platform,
  width           int,
  height          int,
  file_size_kb    int,
  format          text,
  tags            text[],
  is_approved     boolean not null default false,
  processed_variants jsonb default '{}',          -- {ig_post: url, ig_story: url, ...}
  campaign_id     uuid references public.campaigns(id) on delete set null,
  created_by      agent_name,
  created_at      timestamptz not null default now()
);

create index idx_images_service   on public.image_assets(service);
create index idx_images_theme     on public.image_assets(theme);
create index idx_images_platform  on public.image_assets(platform);
create index idx_images_approved  on public.image_assets(is_approved);


-- ────────────────────────────────────────────────────────────
-- SECTION 12: AGENT MEMORY (persistent KV store)
-- ────────────────────────────────────────────────────────────

create table public.agent_memory (
  id          uuid primary key default uuid_generate_v4(),
  namespace   text not null,                      -- e.g. "brand", "services", "campaigns"
  key         text not null,                      -- e.g. "brand.guidelines"
  value       jsonb not null,
  description text,
  version     int not null default 1,
  updated_by  agent_name,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (namespace, key)
);

create index idx_memory_namespace on public.agent_memory(namespace);
create index idx_memory_key       on public.agent_memory(namespace, key);

-- Memory version history (audit trail of all changes)
create table public.agent_memory_history (
  id          uuid primary key default uuid_generate_v4(),
  memory_id   uuid not null references public.agent_memory(id) on delete cascade,
  namespace   text not null,
  key         text not null,
  old_value   jsonb,
  new_value   jsonb not null,
  changed_by  agent_name,
  changed_at  timestamptz not null default now()
);

create index idx_memory_history_id on public.agent_memory_history(memory_id, changed_at desc);


-- ────────────────────────────────────────────────────────────
-- SECTION 13: REVIEWS
-- ────────────────────────────────────────────────────────────

create table public.reviews (
  id                uuid primary key default uuid_generate_v4(),
  platform          text not null check (platform in ('google','yelp','facebook','other')),
  external_id       text unique,
  contact_id        uuid references public.contacts(id) on delete set null,
  reviewer_name     text,
  rating            int check (rating between 1 and 5),
  body              text,
  response          text,                         -- owner reply
  responded_at      timestamptz,
  responded_by      agent_name,
  sentiment         text check (sentiment in ('positive','neutral','negative')),
  published_at      timestamptz,
  flagged           boolean not null default false,
  flag_reason       text,
  created_at        timestamptz not null default now()
);

create index idx_reviews_platform  on public.reviews(platform);
create index idx_reviews_rating    on public.reviews(rating);
create index idx_reviews_responded on public.reviews(responded_at) where response is null;


-- ────────────────────────────────────────────────────────────
-- SECTION 14: LANDING PAGES (Builder Agent)
-- ────────────────────────────────────────────────────────────

create table public.landing_pages (
  id              uuid primary key default uuid_generate_v4(),
  slug            text not null unique,           -- e.g. "/kids-birthday-parties"
  title           text not null,
  service         service_type,
  status          text not null default 'brief'
                  check (status in ('brief','in_progress','live','archived')),
  brief           jsonb not null default '{}',    -- full page brief sent to builder
  live_url        text,
  utm_campaign    text,
  page_views      int default 0,
  form_submissions int default 0,
  conversion_rate numeric(5,2),
  built_by        text,                           -- builder agent identifier
  created_by      agent_name,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);


-- ────────────────────────────────────────────────────────────
-- SECTION 15: ANALYTICS EVENTS
-- ────────────────────────────────────────────────────────────

create table public.analytics_events (
  id          uuid primary key default uuid_generate_v4(),
  event_type  text not null,                      -- e.g. "page_view", "form_submit", "ad_click"
  source      lead_source,
  medium      text,                               -- organic, paid, email, etc.
  campaign    text,
  content     text,
  contact_id  uuid references public.contacts(id) on delete set null,
  session_id  text,
  page_url    text,
  metadata    jsonb default '{}',
  created_at  timestamptz not null default now()
);

create index idx_analytics_type     on public.analytics_events(event_type, created_at desc);
create index idx_analytics_source   on public.analytics_events(source);
create index idx_analytics_campaign on public.analytics_events(campaign);
create index idx_analytics_contact  on public.analytics_events(contact_id);


-- ────────────────────────────────────────────────────────────
-- TRIGGERS — auto-update updated_at timestamps
-- ────────────────────────────────────────────────────────────

create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_contacts_updated_at
  before update on public.contacts
  for each row execute function public.handle_updated_at();

create trigger trg_bookings_updated_at
  before update on public.bookings
  for each row execute function public.handle_updated_at();

create trigger trg_campaigns_updated_at
  before update on public.campaigns
  for each row execute function public.handle_updated_at();

create trigger trg_content_updated_at
  before update on public.content_library
  for each row execute function public.handle_updated_at();

create trigger trg_posts_updated_at
  before update on public.social_posts
  for each row execute function public.handle_updated_at();

create trigger trg_tasks_updated_at
  before update on public.agent_tasks
  for each row execute function public.handle_updated_at();

create trigger trg_memory_updated_at
  before update on public.agent_memory
  for each row execute function public.handle_updated_at();


-- ────────────────────────────────────────────────────────────
-- TRIGGER — memory version history auto-log
-- ────────────────────────────────────────────────────────────

create or replace function public.log_memory_change()
returns trigger language plpgsql security definer as $$
begin
  if (old.value is distinct from new.value) then
    insert into public.agent_memory_history
      (memory_id, namespace, key, old_value, new_value, changed_by)
    values
      (new.id, new.namespace, new.key, old.value, new.value, new.updated_by);
    new.version = old.version + 1;
  end if;
  return new;
end;
$$;

create trigger trg_memory_version
  before update on public.agent_memory
  for each row execute function public.log_memory_change();


-- ────────────────────────────────────────────────────────────
-- TRIGGER — auto update contact lifetime_value + booking_count
-- ────────────────────────────────────────────────────────────

create or replace function public.sync_contact_booking_stats()
returns trigger language plpgsql security definer as $$
begin
  update public.contacts
  set
    booking_count   = (
      select count(*) from public.bookings
      where contact_id = coalesce(new.contact_id, old.contact_id)
      and   status in ('confirmed','completed')
    ),
    lifetime_value  = (
      select coalesce(sum(total_amount), 0) from public.bookings
      where contact_id = coalesce(new.contact_id, old.contact_id)
      and   status = 'completed'
    ),
    last_booked_at  = (
      select max(created_at) from public.bookings
      where contact_id = coalesce(new.contact_id, old.contact_id)
      and   status in ('confirmed','completed')
    )
  where id = coalesce(new.contact_id, old.contact_id);
  return null;
end;
$$;

create trigger trg_booking_stats
  after insert or update or delete on public.bookings
  for each row execute function public.sync_contact_booking_stats();


-- ════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (RLS)
-- ════════════════════════════════════════════════════════════

-- Enable RLS on every table
alter table public.user_profiles                  enable row level security;
alter table public.agent_credentials              enable row level security;
alter table public.contacts                       enable row level security;
alter table public.contact_tags                   enable row level security;
alter table public.contact_interactions           enable row level security;
alter table public.bookings                       enable row level security;
alter table public.agent_tasks                    enable row level security;
alter table public.campaigns                      enable row level security;
alter table public.content_library                enable row level security;
alter table public.social_posts                   enable row level security;
alter table public.email_sequences                enable row level security;
alter table public.email_sequence_steps           enable row level security;
alter table public.contact_sequence_enrollments   enable row level security;
alter table public.audience_segments              enable row level security;
alter table public.segment_contacts               enable row level security;
alter table public.ad_campaigns                   enable row level security;
alter table public.image_assets                   enable row level security;
alter table public.agent_memory                   enable row level security;
alter table public.agent_memory_history           enable row level security;
alter table public.reviews                        enable row level security;
alter table public.landing_pages                  enable row level security;
alter table public.analytics_events               enable row level security;


-- ────────────────────────────────────────────────────────────
-- HELPER: role-check functions
-- ────────────────────────────────────────────────────────────

create or replace function public.current_user_role()
returns text language sql security definer stable as $$
  select role from public.user_profiles where id = auth.uid();
$$;

create or replace function public.is_owner_or_admin()
returns boolean language sql security definer stable as $$
  select current_user_role() in ('owner', 'admin', 'agent_system');
$$;


-- ────────────────────────────────────────────────────────────
-- RLS POLICIES
--
-- Three access tiers:
--   1. owner / admin       → full read+write on everything
--   2. agent_system        → read+write on operational tables, no auth tables
--   3. readonly            → read-only on non-sensitive tables
--   4. anon / public       → blocked from everything (no public data exposure)
-- ────────────────────────────────────────────────────────────


-- user_profiles: users can see their own; owner/admin see all
create policy "users_see_own_profile"
  on public.user_profiles for select
  using (id = auth.uid() or is_owner_or_admin());

create policy "users_update_own_profile"
  on public.user_profiles for update
  using (id = auth.uid() or is_owner_or_admin());


-- agent_credentials: only owner/admin can manage
create policy "only_owner_manages_credentials"
  on public.agent_credentials for all
  using (current_user_role() in ('owner', 'admin'));


-- contacts: all authenticated ops users
create policy "ops_full_access_contacts"
  on public.contacts for all
  using (is_owner_or_admin());

create policy "readonly_can_view_contacts"
  on public.contacts for select
  using (current_user_role() = 'readonly');


-- contact_tags
create policy "ops_full_access_contact_tags"
  on public.contact_tags for all
  using (is_owner_or_admin());


-- contact_interactions
create policy "ops_full_access_interactions"
  on public.contact_interactions for all
  using (is_owner_or_admin());


-- bookings
create policy "ops_full_access_bookings"
  on public.bookings for all
  using (is_owner_or_admin());

create policy "readonly_view_bookings"
  on public.bookings for select
  using (current_user_role() = 'readonly');


-- agent_tasks
create policy "ops_full_access_tasks"
  on public.agent_tasks for all
  using (is_owner_or_admin());


-- campaigns
create policy "ops_full_access_campaigns"
  on public.campaigns for all
  using (is_owner_or_admin());

create policy "readonly_view_campaigns"
  on public.campaigns for select
  using (current_user_role() = 'readonly');


-- content_library
create policy "ops_full_access_content"
  on public.content_library for all
  using (is_owner_or_admin());

create policy "readonly_view_content"
  on public.content_library for select
  using (current_user_role() = 'readonly');


-- social_posts
create policy "ops_full_access_posts"
  on public.social_posts for all
  using (is_owner_or_admin());

create policy "readonly_view_posts"
  on public.social_posts for select
  using (current_user_role() = 'readonly');


-- email_sequences + steps
create policy "ops_full_access_sequences"
  on public.email_sequences for all
  using (is_owner_or_admin());

create policy "ops_full_access_sequence_steps"
  on public.email_sequence_steps for all
  using (is_owner_or_admin());


-- contact_sequence_enrollments
create policy "ops_full_access_enrollments"
  on public.contact_sequence_enrollments for all
  using (is_owner_or_admin());


-- audience_segments
create policy "ops_full_access_segments"
  on public.audience_segments for all
  using (is_owner_or_admin());

create policy "ops_full_access_segment_contacts"
  on public.segment_contacts for all
  using (is_owner_or_admin());


-- ad_campaigns
create policy "ops_full_access_ads"
  on public.ad_campaigns for all
  using (is_owner_or_admin());

create policy "readonly_view_ads"
  on public.ad_campaigns for select
  using (current_user_role() = 'readonly');


-- image_assets
create policy "ops_full_access_images"
  on public.image_assets for all
  using (is_owner_or_admin());

create policy "readonly_view_approved_images"
  on public.image_assets for select
  using (current_user_role() = 'readonly' and is_approved = true);


-- agent_memory: agents can read all; only owner/admin writes
create policy "all_ops_read_memory"
  on public.agent_memory for select
  using (is_owner_or_admin());

create policy "owner_admin_write_memory"
  on public.agent_memory for insert
  using (current_user_role() in ('owner', 'admin', 'agent_system'));

create policy "owner_admin_update_memory"
  on public.agent_memory for update
  using (current_user_role() in ('owner', 'admin', 'agent_system'));


-- agent_memory_history: read-only for all ops
create policy "all_ops_read_memory_history"
  on public.agent_memory_history for select
  using (is_owner_or_admin());

-- only the trigger (security definer) inserts — no user policy needed


-- reviews
create policy "ops_full_access_reviews"
  on public.reviews for all
  using (is_owner_or_admin());

create policy "readonly_view_reviews"
  on public.reviews for select
  using (current_user_role() = 'readonly');


-- landing_pages
create policy "ops_full_access_landing_pages"
  on public.landing_pages for all
  using (is_owner_or_admin());

create policy "readonly_view_landing_pages"
  on public.landing_pages for select
  using (current_user_role() = 'readonly');


-- analytics_events: agents write; ops read
create policy "ops_insert_analytics"
  on public.analytics_events for insert
  using (is_owner_or_admin());

create policy "ops_read_analytics"
  on public.analytics_events for select
  using (is_owner_or_admin());


-- ════════════════════════════════════════════════════════════
-- SEED: INITIAL AGENT MEMORY NAMESPACES
-- Load brand + service knowledge into agent_memory
-- ════════════════════════════════════════════════════════════

insert into public.agent_memory (namespace, key, value, description) values

-- Brand
('brand', 'identity', '{
  "business_name": "Host Hampton",
  "tagline": "Celebrate Here.",
  "type": "Boutique event studio and multi-revenue celebration space",
  "location": "295 Montauk Highway, Speonk, NY",
  "google_maps": "https://g.co/kgs/3iWi7CM",
  "website": "https://www.hosthampton.com",
  "instagram": "https://www.instagram.com/hosthampton/",
  "facebook": "https://www.facebook.com/p/Host-Hampton-61564504617893",
  "years_open": 1,
  "first_year_revenue": 100000
}', 'Core business identity'),

('brand', 'voice', '{
  "tone": ["warm", "fun", "community-first", "approachable", "knowledgeable"],
  "never": ["corporate", "pushy", "salesy", "cold", "formal"],
  "persona": "Like a friend who throws amazing parties — stylish but real, helpful but not overwhelming",
  "emoji_usage": "freely but not excessively",
  "matrix": {
    "kids_party": "Exciting, colorful, parent-relief focused",
    "adult_events": "Sophisticated, fun, you-deserve-this energy",
    "business_rental": "Professional, flexible, ROI-aware",
    "community": "Warm, giving, neighborhood pride",
    "permanent_jewelry": "Trendy, feminine, gift-worthy"
  }
}', 'Brand voice and tone guidelines'),

('brand', 'visual', '{
  "style": ["bright", "warm-toned", "candid", "design-forward", "clean"],
  "photography": "Real party moments, warm tones, kids faces only with consent",
  "overlays": "Logo watermark preferred on published assets",
  "platform_sizes": {
    "ig_post": "1080x1080",
    "ig_portrait": "1080x1350",
    "ig_story": "1080x1920",
    "fb_post": "1200x630",
    "email_header": "600x200",
    "pinterest": "1000x1500"
  }
}', 'Visual brand guidelines'),

('brand', 'hashtags', '{
  "kids_birthday": ["#HostHampton","#HamptonsBirthday","#LongIslandKids","#SpeonkNY","#WesthamptonMoms","#KidsBirthdayParty","#BirthdayVenueLI","#LongIslandMoms","#HamptonsKids","#PartyVenueNY","#KidsPartyIdeas","#BirthdayPartyInspo"],
  "permanent_jewelry": ["#PermanentJewelry","#WeldedBracelet","#HamptonsJewelry","#LongIslandJewelry","#PermanentBracelet","#JewelryHamptons","#GirlsNightLI"],
  "room_rental": ["#EventSpaceHamptons","#VenueRentalLI","#PartyRoomLongIsland","#EventVenue","#DIYParty"],
  "community": ["#Speonk","#WesthamptonBeach","#Southampton","#HamptonBays","#LongIslandLocal","#HamptonsLife","#SuffolkCounty"],
  "adult_events": ["#AdultWorkshop","#CraftNight","#GirlsNightOut","#HamptonsEvents","#LongIslandEvents","#AdultCrafts"]
}', 'Hashtag sets by category'),

-- Services
('services', 'kids_parties', '{
  "name": "Kids Themed Birthday Parties",
  "description": "All-inclusive themed children birthday parties — turnkey for parents",
  "positioning": "Show up and celebrate — we handle everything",
  "duration": "2 hours",
  "included": ["themed decor", "activity stations", "food (pizza or bagels + juice/water)", "music", "structured flow", "custom digital invitation", "cupcake presentation setup", "staff-led activities"],
  "capacity": {"base": 10, "additional_fee": true},
  "themes": ["Spa Party","Swiftie Party","Barbie Party","Unicorn Party","Slime Party","Glow Party","Toddler Soft Play","Trucker Hat Party","Sweets & Treats Decorating"],
  "revenue_strategy": ["base package pricing", "add-on upsells", "additional guest fees", "premium upgrades"],
  "add_ons": ["photo booth","glitter tattoos","hair tinsel","balloons","candy wall","slime station","DJ upgrade","glow upgrade"],
  "priority": "PRIMARY REVENUE DRIVER"
}', 'Kids birthday party service details'),

('services', 'room_rental', '{
  "name": "Private Room Rentals",
  "description": "Self-host DIY events in our studio space",
  "target_uses": ["baby showers","bridal showers","Sweet 16s","small celebrations","family gatherings","DIY kids parties","community meetings"],
  "rental_blocks": "3-6 hour blocks",
  "pricing_model": "tiered hourly (weekday vs weekend)",
  "deposit": 200,
  "add_ons_available": true
}', 'Room rental service details'),

('services', 'permanent_jewelry', '{
  "name": "Permanent Jewelry",
  "description": "Custom-fit welded bracelets, anklets, necklaces — high margin service",
  "services": ["custom-fit welded bracelets","anklets","necklaces"],
  "formats": ["in-store appointments","group bookings","mobile services"],
  "target_markets": ["teens","brides","moms","adult social groups"],
  "revenue_strategy": ["per-piece pricing","group discounts","add-ons (charms, upgrades)","event upsells"],
  "cross_sells": ["adult workshops","party add-ons","fundraisers"]
}', 'Permanent jewelry service details'),

('services', 'host_your_client', '{
  "name": "Host Your Client",
  "description": "Client-ready pop-up studio for local service providers",
  "tagline": "You bring the service. We provide the setting.",
  "target_professionals": ["cosmetic injectors","estheticians","lash/brow techs","hairstylists","makeup artists","photographers","stylists","boutique pop-ups","wellness practitioners"],
  "included": ["clean modern studio","WiFi","private bathroom","easy parking","professional backdrop"],
  "optional": "Promotion to Host Hampton audience",
  "pricing_model": "flexible hourly/day rental",
  "strategic_value": "Monetizes weekday mornings/afternoons with low operational load"
}', 'Host Your Client B2B rental service'),

('services', 'trucker_hat_bar', '{
  "name": "Mobile Trucker Hat Bar",
  "description": "Experiential customization station — hats + iron-on patches",
  "includes": ["hat selection","iron-on patches","design assistance","mobile setup"],
  "target_events": ["birthday parties","teen events","Sweet 16s","school events","corporate family days","vendor markets"],
  "formats": ["in-studio","off-site","fundraiser activation"]
}', 'Trucker hat bar service details'),

('services', 'workshops', '{
  "name": "Adult Workshops & Social Events",
  "description": "Evening programming for adults to expand audience beyond kids",
  "event_types": ["Bingo nights","Psychic medium events","Cake decorating classes","Mahjong classes","Sourdough workshops","Craft nights","Networking mixers"],
  "purpose": ["expand beyond kids market","fill off-peak hours","increase brand footprint","create recurring monthly traffic"]
}', 'Adult workshop service details'),

('services', 'fundraisers', '{
  "name": "Fundraiser Program",
  "description": "Community partnerships with schools, teams, and organizations",
  "partners": ["schools","PTAs","sports teams","cheer teams","dance studios","local organizations"],
  "models": ["custom hat bars","custom tote/pouch programs","permanent jewelry fundraiser nights","percentage-of-sales shopping events"],
  "strategic_value": "Drives large group traffic, builds community loyalty, creates repeat family exposure"
}', 'Fundraiser program details'),

-- Operations
('operations', 'location', '{
  "address": "295 Montauk Highway, Speonk, NY",
  "monthly_rent": 2100,
  "monthly_utilities": 400,
  "total_fixed_costs": 2500,
  "scheduling": "primarily appointment and event booking — not retail walk-in",
  "recurring": "Tuesday mornings: Moms in the Morning open soft play ($10)"
}', 'Location and operating costs'),

('operations', 'target_areas', '{
  "primary": ["Speonk","Remsenburg","Westhampton Beach"],
  "secondary": ["Southampton","Hampton Bays","Quogue","East Quogue"],
  "extended": ["Riverhead","Mastic","Shirley","Center Moriches"],
  "zip_codes": ["11960","11961","11976","11977","11978","11946","11959","11942"]
}', 'Local target geographic areas'),

-- Calendar
('calendar', 'seasonal_priorities', '{
  "january": ["new year booking push","Valentines Day party planning"],
  "february": ["Valentines permanent jewelry","Galentines workshops"],
  "march": ["spring break camps","Easter party push"],
  "april": ["spring market","spring birthday season starts"],
  "may": ["Mothers Day jewelry push","spring birthday peak"],
  "june": ["summer camp launch","end of school parties","summer birthday peak"],
  "july": ["summer birthday peak","beach-theme parties"],
  "august": ["back to school push","fall booking launch"],
  "september": ["fall birthday season","fundraiser outreach to schools/PTAs starts"],
  "october": ["Halloween workshops","fall markets","fundraiser peak"],
  "november": ["holiday market planning","holiday party bookings open"],
  "december": ["holiday market","holiday party peak","gift card push","New Year preview"]
}', 'Annual seasonal marketing calendar'),

-- Market intel
('market', 'positioning', '{
  "against": "traditional party venues, Chuck E Cheese, bowling alleys, generic halls",
  "advantages": ["design-forward aesthetic","fully themed turnkey","boutique/personal","multi-revenue flexibility","community hub","entrepreneur-friendly"],
  "emotional_drivers": ["convenience for parents","memorable for kids","stylish aesthetic","community-focused","entrepreneur-friendly"],
  "positioning_statement": "A modern celebration studio and creative event hub — stylish alternative to traditional party venues"
}', 'Competitive positioning and advantages');


-- ════════════════════════════════════════════════════════════
-- SEED: AUDIENCE SEGMENTS
-- ════════════════════════════════════════════════════════════

insert into public.audience_segments (name, description, filter_rules) values
('parents_young_kids',     'Parents with children ages 3-8',
 '{"child_ages_overlap": [3,4,5,6,7,8], "status_in": ["lead","warm_lead","hot_lead","customer","vip"]}'),

('parents_tween_kids',     'Parents with children ages 9-14',
 '{"child_ages_overlap": [9,10,11,12,13,14], "status_in": ["lead","warm_lead","hot_lead","customer","vip"]}'),

('brides_bridal_market',   'Brides, bridal parties, bridal shower planners',
 '{"tags_include": ["bridal","bride","bridal_shower","engagement"], "email_opt_in": true}'),

('girls_night_market',     'Women interested in adult workshops and jewelry nights',
 '{"service_interests_include": ["permanent_jewelry","workshop"], "email_opt_in": true}'),

('small_business_owners',  'Local business owners for Host Your Client',
 '{"is_business": true, "service_interests_include": ["host_your_client"]}'),

('school_orgs',            'PTAs, sports teams, dance studios for fundraisers',
 '{"tags_include": ["pta","school","sports_team","dance_studio","fundraiser_prospect"]}'),

('past_bookers_all',       'Everyone who has completed at least one booking',
 '{"booking_count_gte": 1, "status_in": ["customer","vip"]}'),

('past_bookers_1yr',       'Booked within the last 12 months',
 '{"booking_count_gte": 1, "last_booked_days_lte": 365}'),

('hot_leads',              'Inquired but not booked within last 30 days',
 '{"status": "hot_lead", "last_contacted_days_lte": 30}'),

('warm_leads',             'Inquired but not booked 30-90 days ago',
 '{"status": "warm_lead", "last_contacted_days_between": [30,90]}'),

('cold_leads',             'No engagement in 90+ days',
 '{"last_engaged_days_gte": 90, "status_not_in": ["unsubscribed","inactive"]}'),

('email_opted_in',         'All contacts opted in to email marketing',
 '{"email_opt_in": true, "status_not_in": ["unsubscribed"]}'),

('sms_opted_in',           'All contacts opted in to SMS marketing',
 '{"sms_opt_in": true, "status_not_in": ["unsubscribed"]}');


-- ════════════════════════════════════════════════════════════
-- SEED: EMAIL SEQUENCES
-- ════════════════════════════════════════════════════════════

insert into public.email_sequences (name, trigger_event, total_emails) values
('New Inquiry Welcome',        'new_inquiry',        5),
('Post-Booking Prep Series',   'booking_confirmed',  3),
('Post-Event Follow-Up',       'event_completed',    3),
('6-Month Re-Engagement',      'dormant_6_months',   3),
('Annual Birthday Reminder',   'birthday_60_days',   2);
