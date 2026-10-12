#!/bin/sh
# Host Hampton cron caller. Usage: hh-cron.sh "/api/cron/<route>?query"
# Calls the container directly (never through Cloudflare/nginx) and appends ONE line to
# stdout, which the crontab redirects to /var/log/hh-cron.log:
#   <iso time> <path> <http code> <first 300 bytes of the body>
# hh-cron-watch.sh reads that line. CRON_SECRET is grepped, never sourced.
IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' hampton_website 2>/dev/null | awk '{print $1}')
S=$(grep '^CRON_SECRET=' /opt/hosthampton/.env | cut -d= -f2-)
OUT=$(mktemp)
printf '%s %s ' "$(date -u +%FT%TZ)" "$1"
if [ -z "$IP" ]; then echo "000 container-not-found"; rm -f "$OUT"; exit 0; fi
curl -s -m 280 -o "$OUT" -w '%{http_code} ' "http://$IP:3002$1" -H "x-cron-secret: $S"
head -c 300 "$OUT" | tr '\r\n' '  '; echo
rm -f "$OUT"
