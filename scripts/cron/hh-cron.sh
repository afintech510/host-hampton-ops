#!/bin/sh
# Host Hampton cron caller. Usage: hh-cron.sh "/api/cron/<route>?query"
# Calls the container directly (never through Cloudflare/nginx) and prints exactly ONE line,
# which the crontab appends to /var/log/hh-cron.log:
#   <iso time> <path> <http code> <first 300 bytes of the body>
# hh-cron-watch.sh reads that line. CRON_SECRET is grepped, never sourced.
# The line is built first and written once: two jobs that start in the same second (every
# 6 minutes agent-dispatch, gmail-sync and send-reminders coincide) must not interleave.
IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' hampton_website 2>/dev/null | awk '{print $1}')
S=$(grep '^CRON_SECRET=' /opt/hosthampton/.env | cut -d= -f2-)
OUT=$(mktemp)
TS=$(date -u +%FT%TZ)
if [ -z "$IP" ]; then
  echo "$TS $1 000 container-not-found"
else
  CODE=$(curl -s -m 280 -o "$OUT" -w '%{http_code}' "http://$IP:3002$1" -H "x-cron-secret: $S")
  BODY=$(head -c 300 "$OUT" | tr '\r\n' '  ')
  echo "$TS $1 $CODE $BODY"
fi
rm -f "$OUT"
