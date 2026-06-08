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

echo "==> Deploying '${SERVICE}' to ${HOST}:${DIR}"
ssh "${HOST}" "SERVICE='${SERVICE}' DIR='${DIR}' bash -s" <<'REMOTE'
set -euo pipefail
cd "${DIR}"
echo "==> git pull --ff-only (via deploy key)"
git pull --ff-only
echo "==> docker compose up -d --build ${SERVICE}"
docker compose up -d --build "${SERVICE}"
echo "==> Containers:"
docker compose ps --format "{{.Name}} {{.Status}}"
REMOTE

echo "==> Smoke test:"
curl -s -o /dev/null -w "    https://www.hosthampton.com/ -> HTTP %{http_code}\n" https://www.hosthampton.com/
echo "==> Done."
