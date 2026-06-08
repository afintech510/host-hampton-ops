#!/usr/bin/env bash
#
# Deploy main -> production VPS (rebuilds one Docker service, default: website).
# Handles the two recurring gotchas automatically:
#   1. Box's embedded GitHub token may be expired -> pull with YOUR `gh` token.
#   2. Server-only edits to docker-compose.yml / nginx.conf -> stash, pull, pop.
#
# Usage:   bash scripts/deploy.sh [service]
# Needs:   gh (logged in), ssh access to `hampton-vps`.
# See:     DEPLOY.md
set -euo pipefail

SERVICE="${1:-website}"
HOST="hampton-vps"
DIR="/opt/hosthampton"
REPO="github.com/afintech510/host-hampton-ops.git"

echo "==> Deploying '${SERVICE}' to ${HOST}:${DIR}"
TOKEN="$(gh auth token)"
if [ -z "${TOKEN}" ]; then echo "ERROR: 'gh auth token' returned empty — run 'gh auth login'." >&2; exit 1; fi

# Remote script. <<'REMOTE' would not expand locals; we use an unquoted heredoc and
# escape every var that must evaluate ON the box with \$.
ssh "${HOST}" "TOKEN='${TOKEN}' SERVICE='${SERVICE}' DIR='${DIR}' REPO='${REPO}' bash -s" <<'REMOTE' 2>&1 | sed "s/${TOKEN}/***TOKEN***/g"
set -euo pipefail
cd "${DIR}"

STASHED=0
if ! git diff --quiet -- docker-compose.yml nginx/nginx.conf 2>/dev/null; then
  echo "==> Stashing server-only edits (docker-compose.yml, nginx.conf)"
  git stash push -m "deploy-autostash" -- docker-compose.yml nginx/nginx.conf
  STASHED=1
fi

echo "==> git pull --ff-only main"
git pull "https://x-access-token:${TOKEN}@${REPO}" main --ff-only

if [ "${STASHED}" = "1" ]; then
  echo "==> Re-applying server-only edits"
  git stash pop
fi

echo "==> docker compose up -d --build ${SERVICE}"
docker compose up -d --build "${SERVICE}"

echo "==> Containers:"
docker compose ps --format "{{.Name}} {{.Status}}"
REMOTE

echo "==> Smoke test:"
curl -s -o /dev/null -w "    https://www.hosthampton.com/ -> HTTP %{http_code}\n" https://www.hosthampton.com/
echo "==> Done."
