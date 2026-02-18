#!/usr/bin/env bash
# ============================================================
# HOST HAMPTON — Database Verification Script
# Queries each table for row counts and validates enum values
# Usage: ./scripts/db_verify.sh
# ============================================================

set -euo pipefail

# ── Color helpers ────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log()    { echo -e "${BLUE}[db_verify]${NC} $1"; }
pass()   { echo -e "${GREEN}  ✅ PASS${NC} $1"; }
fail()   { echo -e "${RED}  ❌ FAIL${NC} $1"; FAILURES=$((FAILURES+1)); }
info()   { echo -e "${CYAN}  →${NC} $1"; }

FAILURES=0

# ── Resolve DATABASE_URL ─────────────────────────────────────
if [[ -z "${DATABASE_URL:-}" ]]; then
  if [[ -z "${SUPABASE_DB_HOST:-}" || -z "${SUPABASE_DB_PASSWORD:-}" ]]; then
    echo -e "${RED}DATABASE_URL not set. See db_setup.sh for instructions.${NC}"
    exit 1
  fi
  DB_HOST="${SUPABASE_DB_HOST}"
  DB_PORT="${SUPABASE_DB_PORT:-5432}"
  DB_NAME="${SUPABASE_DB_NAME:-postgres}"
  DB_USER="${SUPABASE_DB_USER:-postgres}"
  DATABASE_URL="postgres://${DB_USER}:${SUPABASE_DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
fi

# ── Helper: run a query ──────────────────────────────────────
query() {
  psql "$DATABASE_URL" -t -A -c "$1" 2>/dev/null
}

# ── Helper: check table exists and get row count ─────────────
check_table() {
  local table="$1"
  local min_rows="${2:-0}"
  local description="${3:-}"

  local exists
  exists=$(query "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='$table';")

  if [[ "$exists" -eq 0 ]]; then
    fail "Table '$table' does not exist"
    return
  fi

  local count
  count=$(query "SELECT COUNT(*) FROM public.$table;")

  if [[ "$count" -ge "$min_rows" ]]; then
    if [[ -n "$description" ]]; then
      pass "public.$table — $count rows ($description)"
    else
      pass "public.$table — $count rows"
    fi
  else
    fail "public.$table — $count rows (expected ≥ $min_rows)"
  fi
}

# ── Helper: check enum values ────────────────────────────────
check_enum() {
  local enum_name="$1"
  shift
  local expected_values=("$@")

  local actual_values
  actual_values=$(query "SELECT string_agg(enumlabel, ',' ORDER BY enumsortorder) FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = '$enum_name';")

  local missing=()
  for val in "${expected_values[@]}"; do
    if [[ "$actual_values" != *"$val"* ]]; then
      missing+=("$val")
    fi
  done

  if [[ ${#missing[@]} -eq 0 ]]; then
    pass "enum '$enum_name' — all values present: $actual_values"
  else
    fail "enum '$enum_name' — missing values: ${missing[*]}"
    info "Actual values: $actual_values"
  fi
}

# ── Helper: check agent_memory namespace ─────────────────────
check_memory_namespace() {
  local namespace="$1"
  local min_keys="${2:-1}"

  local count
  count=$(query "SELECT COUNT(*) FROM public.agent_memory WHERE namespace='$namespace';")

  if [[ "$count" -ge "$min_keys" ]]; then
    pass "agent_memory namespace '$namespace' — $count keys"
  else
    fail "agent_memory namespace '$namespace' — $count keys (expected ≥ $min_keys)"
  fi
}

# ════════════════════════════════════════════════════════════
# START VERIFICATION
# ════════════════════════════════════════════════════════════

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "Host Hampton — Database Verification"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── 1. Connection test ───────────────────────────────────────
log "1. Connection"
if psql "$DATABASE_URL" -c "SELECT 1;" &>/dev/null; then
  pass "Database connection OK"
else
  fail "Cannot connect to database"
  echo -e "${RED}Cannot continue — fix connection first.${NC}"
  exit 1
fi

# ── 2. Extensions ────────────────────────────────────────────
echo ""
log "2. Extensions"
for ext in "uuid-ossp" "pgcrypto" "pg_trgm"; do
  result=$(query "SELECT COUNT(*) FROM pg_extension WHERE extname='${ext//-ossp/ossp}';")
  if [[ "$result" -gt 0 ]]; then
    pass "Extension: $ext"
  else
    fail "Extension not installed: $ext"
  fi
done

# ── 3. Custom ENUMs ──────────────────────────────────────────
echo ""
log "3. Custom ENUMs"
check_enum "contact_status" "lead" "warm_lead" "hot_lead" "customer" "vip" "inactive" "unsubscribed"
check_enum "booking_status"  "inquiry" "quote_sent" "deposit_paid" "confirmed" "completed" "cancelled" "no_show" "refunded"
check_enum "task_status"     "pending" "in_progress" "completed" "failed" "cancelled"
check_enum "task_priority"   "urgent" "high" "normal" "low" "async"
check_enum "campaign_status" "draft" "scheduled" "active" "paused" "completed" "archived"
check_enum "content_status"  "draft" "approved" "scheduled" "published" "archived"
check_enum "social_platform" "instagram" "facebook_page" "facebook_group" "google_business"
# v1.2 addendum adds OUTBOUND and PAID
check_enum "agent_name" "HAMPTON" "SOC" "COPY" "PIXEL" "BUILD" "LIST" "OUTBOUND" "PAID" "INTEL"
check_enum "lead_source" "instagram" "facebook" "google_organic" "google_ads" "referral" "walk_in"
check_enum "service_type" "kids_party" "room_rental" "permanent_jewelry" "host_your_client" "fundraiser"

# ── 4. Core tables (base schema) ────────────────────────────
echo ""
log "4. Core Tables (Base Schema)"
check_table "user_profiles"                 0 "auth table"
check_table "agent_credentials"             0 "populated during deploy"
check_table "contacts"                      0 "empty until CRM import"
check_table "contact_tags"                  0
check_table "contact_interactions"          0
check_table "bookings"                      0 "empty until booking sync"
check_table "agent_tasks"                   0 "populated at runtime"
check_table "campaigns"                     0
check_table "content_library"               0
check_table "social_posts"                  0
check_table "email_sequences"               5 "5 sequences seeded"
check_table "email_sequence_steps"          0
check_table "contact_sequence_enrollments"  0
check_table "audience_segments"            13 "13 segments seeded"
check_table "segment_contacts"              0
check_table "ad_campaigns"                  0
check_table "image_assets"                  0
check_table "agent_memory"                 10 "base seed data"
check_table "agent_memory_history"          0
check_table "reviews"                       0
check_table "landing_pages"                 0
check_table "analytics_events"              0

# ── 5. Addendum tables ───────────────────────────────────────
echo ""
log "5. Addendum Tables (v1.2)"
check_table "stripe_transactions"  0 "populated at runtime"
check_table "content_snapshots"    0 "populated by BUILD agent (Phase 2)"
check_table "escalations"          0
check_table "review_requests"      0
check_table "booking_gap_events"   0
check_table "vendor_referrals"     0 "Phase 3"

# ── 6. Verify addendum columns on landing_pages ─────────────
echo ""
log "6. Addendum Columns on landing_pages"
for col in "github_branch" "vercel_preview" "page_type" "seo_title" "seo_description" "structured_data" "is_indexed"; do
  result=$(query "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='landing_pages' AND column_name='$col';")
  if [[ "$result" -gt 0 ]]; then
    pass "landing_pages.$col exists"
  else
    fail "landing_pages.$col MISSING — run addendum SQL"
  fi
done

# ── 7. Triggers ──────────────────────────────────────────────
echo ""
log "7. Triggers"
for trigger in "trg_contacts_updated_at" "trg_bookings_updated_at" "trg_campaigns_updated_at" "trg_content_updated_at" "trg_tasks_updated_at" "trg_memory_updated_at" "trg_memory_version" "trg_booking_stats"; do
  result=$(query "SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_name='$trigger';")
  if [[ "$result" -gt 0 ]]; then
    pass "Trigger: $trigger"
  else
    fail "Trigger not found: $trigger"
  fi
done

# ── 8. RLS enabled ───────────────────────────────────────────
echo ""
log "8. Row Level Security"
rls_tables=("contacts" "bookings" "agent_tasks" "campaigns" "content_library" "social_posts" "agent_memory" "audience_segments" "image_assets" "reviews" "analytics_events" "stripe_transactions" "escalations" "review_requests" "booking_gap_events" "vendor_referrals")

for table in "${rls_tables[@]}"; do
  result=$(query "SELECT relrowsecurity FROM pg_class WHERE relname='$table' AND relnamespace=(SELECT oid FROM pg_namespace WHERE nspname='public');")
  if [[ "$result" == "t" ]]; then
    pass "RLS enabled: $table"
  else
    fail "RLS NOT enabled: $table"
  fi
done

# ── 9. Agent memory seed data ────────────────────────────────
echo ""
log "9. Agent Memory — Seeded Namespaces"
check_memory_namespace "brand"      4   # identity, voice, visual, hashtags
check_memory_namespace "services"   7   # priority_order + 6 service types
check_memory_namespace "operations" 3   # location, target_areas, booking_rules
check_memory_namespace "calendar"   1   # seasonal_priorities
check_memory_namespace "market"     2   # positioning, target_keywords
check_memory_namespace "social"     2   # posting_schedule, facebook_groups

echo ""
log "9b. Agent Memory — v1.2 Addendum Namespaces (run after memory_bootstrap_v1.2.ts)"
check_memory_namespace "website"         3
check_memory_namespace "review_velocity" 1
check_memory_namespace "gap_fill_rules"  1
check_memory_namespace "vendor_referrals" 1

# ── 10. Email sequences ──────────────────────────────────────
echo ""
log "10. Email Sequences"
sequences=$(query "SELECT name FROM public.email_sequences ORDER BY name;")
expected_sequences=("Annual Birthday Reminder" "New Inquiry Welcome" "Post-Booking Prep Series" "Post-Event Follow-Up" "6-Month Re-Engagement")
for seq in "${expected_sequences[@]}"; do
  if echo "$sequences" | grep -q "$seq"; then
    pass "Sequence: $seq"
  else
    fail "Missing sequence: $seq"
  fi
done

# ── 11. Audience segments ────────────────────────────────────
echo ""
log "11. Audience Segments"
seg_count=$(query "SELECT COUNT(*) FROM public.audience_segments;")
if [[ "$seg_count" -ge 13 ]]; then
  pass "$seg_count audience segments loaded"
else
  fail "Only $seg_count segments (expected 13)"
fi

# ── Final summary ─────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [[ "$FAILURES" -eq 0 ]]; then
  echo -e "${GREEN}✅ All checks passed — database is ready.${NC}"
  echo ""
  log "Next step: Run memory bootstrap scripts:"
  echo "  npx ts-node scripts/memory_bootstrap.ts"
  echo "  npx ts-node scripts/memory_bootstrap_v1.2.ts"
else
  echo -e "${RED}❌ $FAILURES check(s) failed — fix errors before proceeding.${NC}"
  echo ""
  log "If addendum checks fail: re-run ./scripts/db_setup.sh"
  log "If memory namespace checks fail: run ./scripts/memory_bootstrap.ts"
  exit 1
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
