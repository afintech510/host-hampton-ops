#!/usr/bin/env bash
# ============================================================
# HOST HAMPTON — Database Setup Script
# Runs base schema + v1.2 addendum against Supabase
# Usage: ./scripts/db_setup.sh
# ============================================================

set -euo pipefail

# ── Color helpers ────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log()    { echo -e "${BLUE}[db_setup]${NC} $1"; }
success(){ echo -e "${GREEN}[db_setup] ✅ $1${NC}"; }
warn()   { echo -e "${YELLOW}[db_setup] ⚠️  $1${NC}"; }
error()  { echo -e "${RED}[db_setup] ❌ $1${NC}" >&2; }

# ── Resolve script and project root paths ───────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SCHEMA_DIR="$PROJECT_ROOT/starting_plan"
BASE_SCHEMA="$SCHEMA_DIR/HostHampton_Supabase_Schema.sql"
ADDENDUM_SCHEMA="$SCHEMA_DIR/HostHampton_Supabase_Schema_Addendum_v1.2.sql"

# ── Validate required environment variables ──────────────────
log "Checking required environment variables..."

if [[ -z "${DATABASE_URL:-}" ]]; then
  # Try to build from component vars
  if [[ -z "${SUPABASE_DB_HOST:-}" || -z "${SUPABASE_DB_PASSWORD:-}" ]]; then
    error "DATABASE_URL is not set."
    error ""
    error "Set one of:"
    error "  export DATABASE_URL='postgres://postgres:[password]@db.[project-ref].supabase.co:5432/postgres'"
    error "  — OR —"
    error "  export SUPABASE_DB_HOST='db.[project-ref].supabase.co'"
    error "  export SUPABASE_DB_PASSWORD='[your-db-password]'"
    error ""
    error "Find these in: Supabase Dashboard → Project Settings → Database"
    exit 1
  fi
  DB_HOST="${SUPABASE_DB_HOST}"
  DB_PORT="${SUPABASE_DB_PORT:-5432}"
  DB_NAME="${SUPABASE_DB_NAME:-postgres}"
  DB_USER="${SUPABASE_DB_USER:-postgres}"
  DATABASE_URL="postgres://${DB_USER}:${SUPABASE_DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
fi

# ── Validate psql is available ───────────────────────────────
if ! command -v psql &>/dev/null; then
  error "psql not found. Install PostgreSQL client tools:"
  error "  Ubuntu/Debian: sudo apt install postgresql-client"
  error "  macOS:         brew install postgresql"
  exit 1
fi

# ── Validate SQL files exist ─────────────────────────────────
for f in "$BASE_SCHEMA" "$ADDENDUM_SCHEMA"; do
  if [[ ! -f "$f" ]]; then
    error "SQL file not found: $f"
    exit 1
  fi
done

# ── Test connection ──────────────────────────────────────────
log "Testing database connection..."
if ! psql "$DATABASE_URL" -c "SELECT 1;" &>/dev/null; then
  error "Cannot connect to database."
  error "Verify DATABASE_URL and that your IP is allowed in Supabase Network Restrictions."
  exit 1
fi
success "Database connection OK"

# ── Run base schema ──────────────────────────────────────────
echo ""
log "Running base schema: HostHampton_Supabase_Schema.sql"
log "This creates all core tables, enums, triggers, RLS policies, and seeds initial data."
echo ""

if psql "$DATABASE_URL" \
    --set ON_ERROR_STOP=1 \
    --single-transaction \
    -v VERBOSITY=terse \
    -f "$BASE_SCHEMA"; then
  success "Base schema applied successfully"
else
  error "Base schema failed. Check errors above."
  error "If tables already exist, this is safe to re-run (uses IF NOT EXISTS)."
  error "If you need a clean reset, drop all tables first (run db_reset.sh — DESTRUCTIVE)."
  exit 1
fi

# ── Run addendum schema ──────────────────────────────────────
echo ""
log "Running addendum: HostHampton_Supabase_Schema_Addendum_v1.2.sql"
log "This adds: OUTBOUND/PAID enums, stripe_transactions, escalations, review_requests,"
log "           booking_gap_events, content_snapshots, vendor_referrals, landing_pages updates."
echo ""

if psql "$DATABASE_URL" \
    --set ON_ERROR_STOP=1 \
    --single-transaction \
    -v VERBOSITY=terse \
    -f "$ADDENDUM_SCHEMA"; then
  success "Addendum schema applied successfully"
else
  error "Addendum schema failed. Check errors above."
  error "Ensure base schema was applied first — addendum depends on base tables."
  exit 1
fi

# ── Summary ──────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
success "Database setup complete!"
echo ""
log "Tables created (base):"
echo "  contacts, contact_tags, contact_interactions"
echo "  bookings, agent_tasks, campaigns"
echo "  content_library, social_posts, email_sequences, email_sequence_steps"
echo "  contact_sequence_enrollments, audience_segments, segment_contacts"
echo "  ad_campaigns, image_assets, agent_memory, agent_memory_history"
echo "  reviews, landing_pages, analytics_events"
echo "  user_profiles, agent_credentials"
echo ""
log "Tables created (addendum):"
echo "  stripe_transactions, content_snapshots, escalations"
echo "  review_requests, booking_gap_events, vendor_referrals"
echo ""
log "Seeded:"
echo "  agent_memory — brand.*, services.*, operations.*, calendar.*, market.*"
echo "  audience_segments — 13 segments"
echo "  email_sequences — 5 sequences"
echo ""
log "Next step: Run memory bootstrap scripts"
echo "  npx ts-node scripts/memory_bootstrap.ts"
echo "  npx ts-node scripts/memory_bootstrap_v1.2.ts"
echo ""
log "Then verify: ./scripts/db_verify.sh"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
