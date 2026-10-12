#!/bin/sh
# Cron watchdog. Every 10 minutes: for each `box` job in jobs.tsv, read its newest line in
# /var/log/hh-cron.log and decide whether it FAILED (non-200 or "ok":false) or has GONE QUIET
# (no line, or older than max_age). A problem is texted once, again after 6 hours if it is
# still there, and a recovery is texted once. State lives in /var/lib/hh-cron-watch/.
# Texts go through /api/cron/cron-alert (the SMS credentials live in the app). If that fails
# the alert is NOT recorded, so the next pass tries again.
# Blind spot, stated: this runs on the same box as the jobs. A dead box stays silent.
DIR=$(cd "$(dirname "$0")" && pwd)
LOG=/var/log/hh-cron.log
STATE=/var/lib/hh-cron-watch
REPEAT=21600
mkdir -p "$STATE"
NOW=$(date -u +%s)
IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' hampton_website 2>/dev/null | awk '{print $1}')
S=$(grep '^CRON_SECRET=' /opt/hosthampton/.env | cut -d= -f2-)

alert() { # $1 = message ; returns 0 only if a text was accepted
  [ -n "$IP" ] || return 1
  code=$(curl -s -m 30 -o /dev/null -w '%{http_code}' -G "http://$IP:3002/api/cron/cron-alert" \
    --data-urlencode "msg=$1" -H "x-cron-secret: $S")
  [ "$code" = "200" ]
}

grep -v '^#' "$DIR/jobs.tsv" | grep -v '^[[:space:]]*$' | while IFS='|' read -r name sched path maxage mode; do
  [ "$mode" = "box" ] || continue
  last=$(awk -v p="$path" '$2==p && $3 ~ /^[0-9][0-9][0-9]$/ {l=$0} END {print l}' "$LOG" 2>/dev/null)
  problem=""
  [ -f "$STATE/$name.seen" ] || echo "$NOW" > "$STATE/$name.seen"
  if [ -z "$last" ]; then
    # a freshly added job has not had its first slot yet: complain only after a full max-age
    seen=$(cat "$STATE/$name.seen" 2>/dev/null || echo "$NOW")
    [ $(( (NOW - seen) / 60 )) -gt "$maxage" ] && problem="$name has never run"
  else
    ts=$(echo "$last" | awk '{print $1}')
    code=$(echo "$last" | awk '{print $3}')
    epoch=$(date -u -d "$ts" +%s 2>/dev/null || echo 0)
    age=$(( (NOW - epoch) / 60 ))
    if [ "$age" -gt "$maxage" ]; then
      problem="$name has gone quiet: last run ${age} min ago (allowed ${maxage})"
    elif [ "$code" != "200" ]; then
      problem="$name answered HTTP $code at $ts"
    elif echo "$last" | grep -q '"ok":false'; then
      problem="$name answered ok:false at $ts"
    fi
  fi

  f="$STATE/$name"
  if [ -n "$problem" ]; then
    prev=$(cat "$f" 2>/dev/null || echo 0)
    if [ $((NOW - prev)) -ge $REPEAT ]; then
      if alert "$problem"; then echo "$NOW" > "$f"; fi
      echo "$(date -u +%FT%TZ) ALERT $problem"
    fi
  elif [ -f "$f" ]; then
    if alert "$name is running again"; then rm -f "$f"; fi
    echo "$(date -u +%FT%TZ) RECOVERED $name"
  fi
done

# keep the shared log bounded
if [ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt 20000 ]; then
  tail -n 10000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi
