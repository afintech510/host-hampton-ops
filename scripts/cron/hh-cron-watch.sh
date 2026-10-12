#!/bin/sh
# Cron watchdog. Two modes, both silent unless there is something to say.
#
#   hh-cron-watch.sh            every 10 min. For each `box` job in jobs.tsv, read its newest
#                               complete line in /var/log/hh-cron.log and decide whether it FAILED
#                               (non-200 or "ok":false) or has GONE QUIET (older than max_age).
#                               A problem must be seen on TWO consecutive passes, then it is texted
#                               ONCE (not repeated, not followed by a "recovered" text). Recoveries
#                               are logged, never texted.
#   hh-cron-watch.sh --digest   once a day. ONE text: all clear with the run count, or the list of
#                               jobs that failed in the last 24h / are failing now.
#
# Texts go through /api/cron/cron-alert (the SMS credentials live in the app). If that fails the
# alert is NOT recorded, so the next pass tries again.
# Blind spot, stated: this runs on the same box as the jobs. A dead box stays silent.
DIR=$(cd "$(dirname "$0")" && pwd)
LOG=/var/log/hh-cron.log
STATE=/var/lib/hh-cron-watch
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

jobs() { grep -v '^#' "$DIR/jobs.tsv" | grep -v '^[[:space:]]*$'; }

# Newest COMPLETE line for a path (a line without a 3-digit status is half-written: skip it).
last_line() { awk -v p="$1" '$2==p && $3 ~ /^[0-9][0-9][0-9]$/ {l=$0} END {print l}' "$LOG" 2>/dev/null; }

# Prints a problem description for a job, or nothing. $1 name  $2 path  $3 maxage(min)
problem_of() {
  last=$(last_line "$2")
  if [ -z "$last" ]; then
    [ -f "$STATE/$1.seen" ] || echo "$NOW" > "$STATE/$1.seen"
    seen=$(cat "$STATE/$1.seen" 2>/dev/null || echo "$NOW")
    # a freshly added job has not had its first slot yet: complain only after a full max-age
    [ $(( (NOW - seen) / 60 )) -gt "$3" ] && echo "$1 has never run"
    return 0
  fi
  ts=$(echo "$last" | awk '{print $1}')
  code=$(echo "$last" | awk '{print $3}')
  epoch=$(date -u -d "$ts" +%s 2>/dev/null || echo 0)
  age=$(( (NOW - epoch) / 60 ))
  if [ "$age" -gt "$3" ]; then echo "$1 has gone quiet (last run ${age} min ago, allowed $3)"
  elif [ "$code" != "200" ]; then echo "$1 answered HTTP $code"
  elif echo "$last" | grep -q '"ok":false'; then echo "$1 answered ok:false"
  fi
}

if [ "$1" = "--digest" ]; then
  cutoff=$(date -u -d '24 hours ago' +%FT%TZ)
  total=$(awk -v c="$cutoff" '$1>=c && $3 ~ /^[0-9][0-9][0-9]$/' "$LOG" | wc -l)
  fails=$(awk -v c="$cutoff" '$1>=c && $3 ~ /^[0-9][0-9][0-9]$/ && ($3!="200" || /"ok":false/) {n[$2]++} END {for (p in n) printf "%s x%d; ", p, n[p]}' "$LOG" | sed 's#/api/cron/##g')
  now_bad=""
  njobs=0
  JT=$(mktemp); jobs > "$JT"
  while IFS="|" read -r name sched path maxage mode; do
    [ "$mode" = "box" ] || continue
    njobs=$((njobs + 1))
    p=$(problem_of "$name" "$path" "$maxage")
    [ -n "$p" ] && now_bad="$now_bad$p; "
  done < "$JT"
  rm -f "$JT"
  if [ -z "$fails" ] && [ -z "$now_bad" ]; then
    msg="all $njobs jobs OK, $total runs in 24h, 0 failures"
  else
    msg="PROBLEMS. Failing now: ${now_bad:-none}. Failed in last 24h: ${fails:-none}"
  fi
  if alert "daily: $msg"; then echo "$(date -u +%FT%TZ) DIGEST sent: $msg"; else echo "$(date -u +%FT%TZ) DIGEST NOT SENT: $msg"; fi
  exit 0
fi

jobs | while IFS='|' read -r name sched path maxage mode; do
  [ "$mode" = "box" ] || continue
  problem=$(problem_of "$name" "$path" "$maxage")
  f="$STATE/$name"            # exists once a break has been texted
  k="$STATE/$name.strikes"    # consecutive bad passes
  if [ -n "$problem" ]; then
    n=$(( $(cat "$k" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$k"
    [ "$n" -ge 2 ] || continue
    if [ ! -f "$f" ]; then
      if alert "BROKEN: $problem"; then echo "$NOW" > "$f"; fi
      echo "$(date -u +%FT%TZ) ALERT $problem"
    fi
  else
    rm -f "$k"
    if [ -f "$f" ]; then rm -f "$f"; echo "$(date -u +%FT%TZ) RECOVERED $name (not texted)"; fi
  fi
done

# keep the shared log bounded
if [ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt 20000 ]; then
  tail -n 10000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi
