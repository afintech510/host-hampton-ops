#!/bin/sh
# Install the Host Hampton block of root's crontab from jobs.tsv.
# Owns only the lines between the BEGIN/END markers (plus the pre-2026-10-11 hand-added
# hh-cron.sh lines, removed once). Everything else in the shared crontab is left alone.
#   sh install.sh --dry-run    show the resulting crontab, change nothing
set -eu
DIR=$(cd "$(dirname "$0")" && pwd)
BEGIN='# BEGIN host-hampton (managed by scripts/cron/install.sh - edit jobs.tsv, not this block)'
END='# END host-hampton'
BLOCK=$(mktemp); CUR=$(mktemp); NEW=$(mktemp)

{
  echo "$BEGIN"
  grep -v '^#' "$DIR/jobs.tsv" | grep -v '^[[:space:]]*$' | while IFS='|' read -r name sched path maxage mode; do
    [ "$mode" = "box" ] || continue
    echo "$sched sh $DIR/hh-cron.sh \"$path\" >> /var/log/hh-cron.log 2>&1 # $name"
  done
  # The watchdog (hh-cron-watch.sh) is NOT installed: Adam turned the texts off 2026-10-12 after it
  # sent ~89 false alerts. Re-adding it is a deliberate decision, not a side effect of install.sh.
  echo "$END"
} > "$BLOCK"

crontab -l > "$CUR" 2>/dev/null || true
# drop an existing managed block, and the legacy hand-added HH lines (and their comments)
awk -v b="$BEGIN" -v e="$END" '
  $0==b {skip=1; next}
  $0==e {skip=0; next}
  skip {next}
  /hh-cron\.sh/ {next}
  /^# Host Hampton \(2026-10-04\)/ {next}
  /^# EVITE sends \(2026-10-11/ {next}
  {print}' "$CUR" > "$NEW"
cat "$BLOCK" >> "$NEW"

if [ "${1:-}" = "--dry-run" ]; then cat "$NEW"; rm -f "$BLOCK" "$CUR" "$NEW"; exit 0; fi
cp "$CUR" "/root/crontab.backup.$(date -u +%Y%m%dT%H%M%SZ)"
crontab "$NEW"
echo "installed:"; sed -n "/^# BEGIN host-hampton/,/^# END host-hampton/p" "$NEW"
rm -f "$BLOCK" "$CUR" "$NEW"
