#!/usr/bin/env bash
#
# Deploy main -> production VPS (rebuilds one Docker service, default: website).
#
# Auth + config drift are handled permanently on the box now:
#   - git auth: SSH deploy key (no token, no expiry)
#   - docker-compose.yml: server-only nginx SSL mounts live in
#     docker-compose.override.yml (gitignored) so the tracked file never conflicts
#   - nginx/nginx.conf: marked skip-worktree on the box (server owns it)
# So this is just: pull -> rebuild -> health check.
#
# Usage:   bash scripts/deploy.sh [service]
# Needs:   ssh access to `hampton-vps`.
# See:     DEPLOY.md
set -euo pipefail

SERVICE="${1:-website}"
HOST="hampton-vps"
DIR="/opt/hosthampton"

HEALTH_URL="${HEALTH_URL:-https://www.hosthampton.com/}"
HEALTH_TRIES="${HEALTH_TRIES:-20}"     # x 3s = up to 60s for the app to boot
HEALTH_SLEEP="${HEALTH_SLEEP:-3}"

FORCE="${FORCE:-0}"   # FORCE=1 rebuilds even if this commit is already live (e.g. after an .env change)

echo "==> Deploying '${SERVICE}' to ${HOST}:${DIR}"
ssh "${HOST}" "SERVICE='${SERVICE}' DIR='${DIR}' FORCE='${FORCE}' bash -s" <<'REMOTE'
set -euo pipefail
cd "${DIR}"

# ONE deploy at a time, box-wide.
#
# Every push to main ALSO deploys, via .github/workflows/deploy.yml, which runs
# the same `docker compose up -d --build website` over SSH once the tests pass.
# Pushing and then running this script started two recreates of the same
# container ~a second apart; on 2026-10-01 that happened twice and both times
# the loser left the old container Dead and the new one stuck in Created —
# www.hosthampton.com answered 502 until someone removed the corpse by hand.
# The workflow takes this same lock, so whichever arrives second waits.
exec 9>/run/lock/hosthampton-deploy.lock
if ! flock -n 9; then
  echo "==> Another deploy (probably the GitHub Action) holds the lock — waiting for it"
  flock -w 900 9 || { echo "==> Gave up waiting for the deploy lock after 15 min" >&2; exit 1; }
fi

echo "==> git pull --ff-only (via deploy key)"
git pull --ff-only

# Skip a rebuild of a commit that is already live — normally because the
# Action deployed it while we waited on the lock. Recreating again would only
# cost a second blip of downtime for an identical image.
MARK="/var/lib/hosthampton/deployed-${SERVICE}"
HEAD_SHA=$(git rev-parse HEAD)
if [ "${FORCE}" != "1" ] && [ "$(cat "${MARK}" 2>/dev/null || true)" = "${HEAD_SHA}" ] \
   && [ -n "$(docker compose ps -q --status running "${SERVICE}")" ]; then
  echo "==> ${HEAD_SHA:0:7} is already deployed and running — skipping rebuild (FORCE=1 to override)"
  docker compose ps --format "{{.Name}} {{.Status}}"
  exit 0
fi

# Clear stale compose rename-backups before bringing the service up.
#
# On recreate, `docker compose` renames the outgoing container to
# `<12-hex-id>_<name>` before starting the replacement. If an earlier run died
# between those two steps the backup survives, and the NEXT deploy aborts with
# "Conflict. The container name ... is already in use" -- even though the new
# container started fine. That is what happened on 2026-09-22: the deploy was
# reported as failed, and had actually succeeded.
#
# Only names matching the compose backup shape are touched, and only when not
# running, so a live container can never match.
#
# NOTE the `.*` before the service name: the compose SERVICE is `website` but
# the container is named `hampton_website`, so the backup reads
# `1f8a409ecb0c_hampton_website`. Anchoring on `^<hex>_website` matches nothing
# at all -- a silent no-op guard, which is worse than no guard.
STALE=$(docker ps -a --filter "status=exited" --filter "status=created" \
          --format '{{.Names}}' | grep -E "^[0-9a-f]{8,}_.*${SERVICE:-}" || true)
if [ -n "${STALE}" ]; then
  echo "==> Removing stale compose rename-backups:"
  echo "${STALE}" | sed 's/^/      /'
  echo "${STALE}" | xargs -r docker rm -f >/dev/null
fi

echo "==> docker compose up -d --build ${SERVICE}"
docker compose up -d --build "${SERVICE}"
{ mkdir -p /var/lib/hosthampton && echo "${HEAD_SHA}" > "${MARK}"; } || echo "WARN: could not write ${MARK}"
echo "==> Containers:"
docker compose ps --format "{{.Name}} {{.Status}}"
REMOTE

# Poll rather than curl once.
#
# The old single curl fired the instant the container was recreated, before
# Next had finished booting, so a perfectly good deploy routinely reported 502.
# A smoke test that cries wolf trains you to ignore deploy output, which is
# worse than having none. Retry until the app answers 2xx/3xx, and exit
# NON-ZERO if it never does -- the old version always exited 0, so a genuinely
# dead site still looked like a clean deploy.
echo "==> Smoke test: ${HEALTH_URL}"
code=000
for i in $(seq 1 "${HEALTH_TRIES}"); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${HEALTH_URL}" || echo 000)
  case "${code}" in
    2??|3??) echo "    HTTP ${code} after ${i} attempt(s) -- healthy"; echo "==> Done."; exit 0 ;;
  esac
  printf '    attempt %s/%s -> HTTP %s, retrying in %ss\n' "${i}" "${HEALTH_TRIES}" "${code}" "${HEALTH_SLEEP}"
  sleep "${HEALTH_SLEEP}"
done

echo "==> FAILED: ${HEALTH_URL} never became healthy (last HTTP ${code})" >&2
echo "    Check:  ssh ${HOST} 'cd ${DIR} && docker compose logs --tail=50 ${SERVICE}'" >&2
exit 1
