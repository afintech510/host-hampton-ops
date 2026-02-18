-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION 001: Reconcile agent_tasks schema with HAMPTON orchestrator code
-- Run in Supabase SQL Editor
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Extend task_status enum with values the code uses
alter type task_status add value if not exists 'awaiting_approval';
alter type task_status add value if not exists 'approved';
alter type task_status add value if not exists 'rejected';

-- 2. Add task_id column (code uses this as the external identifier, schema uses id)
alter table public.agent_tasks
  add column if not exists task_id uuid unique default uuid_generate_v4();

-- Backfill existing rows so task_id = id
update public.agent_tasks set task_id = id where task_id is null;

-- 3. Rename inputs → input to match code
alter table public.agent_tasks rename column inputs to input;

-- 4. Add missing approval columns
alter table public.agent_tasks
  add column if not exists approval_tier  text not null default 'DRAFT_AND_SHOW',
  add column if not exists approved_at    timestamptz,
  add column if not exists rejected_at    timestamptz,
  add column if not exists rejection_reason text;

-- 5. Create escalations table (used by HAMPTON and BookingGapDetector)
create table if not exists public.escalations (
  id            uuid primary key default uuid_generate_v4(),
  triggered_by  agent_name not null,
  reason        text not null,
  context       jsonb default '{}',
  priority      text not null default 'normal',
  status        text not null default 'open',
  sms_alert_sent boolean not null default false,
  resolved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- RLS for escalations
alter table public.escalations enable row level security;

create policy "ops_full_access_escalations"
  on public.escalations for all
  using (is_owner_or_admin())
  with check (is_owner_or_admin());

-- Index for task_id lookups
create index if not exists idx_agent_tasks_task_id on public.agent_tasks(task_id);
