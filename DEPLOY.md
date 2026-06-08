# Deploy Runbook — Host Hampton

Production is a single Hetzner VPS running Docker Compose. The live website,
dashboard, and API are all served by the `hampton_website` container behind
`hampton_nginx`. There is **no CI/CD** — deploys are a manual `git pull` + rebuild
on the box.

- **VPS:** `5.161.88.134` · SSH alias `hampton-vps` (root, key `id_ed25519_headless`)
- **Repo on box:** `/opt/hosthampton` (tracks `main`)
- **Live URLs:** https://www.hosthampton.com · https://app.hosthampton.com · https://api.hosthampton.com
- **Stripe is LIVE** (`sk_live`) — deposits are real money.

---

## TL;DR — deploy `main` to production

From your laptop (needs `gh` logged in + SSH access):

```bash
bash scripts/deploy.sh            # rebuilds the website container
bash scripts/deploy.sh website    # same, explicit
```

That script does the safe sequence below automatically (stash drift → pull →
pop → rebuild → health check). If you'd rather do it by hand, see "Manual deploy."

---

## Why deploys used to be painful (now fixed)

Two pieces of server drift broke `git pull` on the box every time. Both are now
permanently resolved (2026-06-08), so a plain pull is clean:

1. **Expired GitHub token.** The `origin` remote had a `ghp_…` PAT baked into the
   URL; it worked until the token aged out, then `git pull` failed with
   "Authentication failed." → **Fixed:** the box now uses an **SSH deploy key**
   (`~/.ssh/hosthampton_deploy`, read-only) via the `github-hosthampton` SSH alias;
   `origin` is `git@github-hosthampton:afintech510/host-hampton-ops.git`. No token,
   no expiry. (Rotate/revoke the old `ghp_…` PAT in GitHub settings if not already.)

2. **Server-only edits to `docker-compose.yml` / `nginx.conf`** (multi-domain SSL
   mounts for maningomethod, mygravelguy, benchworksai…) conflicted with every pull.
   → **Fixed:** the SSL mounts now live in **`/opt/hosthampton/docker-compose.override.yml`**
   (gitignored; Compose auto-merges it), and `nginx/nginx.conf` is marked
   `git update-index --skip-worktree` so the box owns it. The tracked files match
   the repo, so pulls never conflict.

If you ever need to edit the server-only mounts, edit `docker-compose.override.yml`
on the box. If you need to change `nginx.conf`, edit it on the box directly (it's
skip-worktree; to let git manage it again: `git update-index --no-skip-worktree nginx/nginx.conf`).

---

## Manual deploy (if not using the script)

```bash
ssh hampton-vps
cd /opt/hosthampton
git pull --ff-only                       # clean — deploy key + override handle drift
docker compose up -d --build website     # rebuild + recreate (nginx stays up)
docker compose ps
curl -s -o /dev/null -w "%{http_code}\n" https://www.hosthampton.com/
```

> Rebuild with `up -d --build`, **never** `restart` — `restart` does not reload
> `.env` changes or new images.

---

## Environment variables

Runtime secrets live in **`/opt/hosthampton/.env`** (gitignored). `docker-compose.yml`
maps them into the container's `environment:`. Public build-time vars
(`NEXT_PUBLIC_*`, e.g. the Stripe publishable key) are `build.args` and only take
effect on `--build`.

**When you add a new env var:** add it to `docker-compose.yml` (`environment:` for
runtime, `build.args` for `NEXT_PUBLIC_*`) **and** to `/opt/hosthampton/.env` on the
box, then `docker compose up -d --build website`.

Current SignWell vars (studio rental e-sign): `SIGNWELL_API_KEY`,
`SIGNWELL_TEMPLATE_ID`, `SIGNWELL_TEST_MODE` (false = live), `SIGNWELL_SIGNER_PLACEHOLDER`.

---

## Database migrations

SQL migrations in `starting_plan/migration_*.sql` are applied via the Supabase MCP /
SQL editor **before/independently of** the container deploy — they are not run by
the deploy. Apply the migration first, then deploy the code that depends on it.

---

## Smoke tests after deploy

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://www.hosthampton.com/            # 200
docker exec hampton_website sh -c 'echo $SIGNWELL_TEMPLATE_ID'                    # expected value
docker compose -f /opt/hosthampton/docker-compose.yml ps                          # all Up
```

For a specific route, curl it and confirm 200 + that an API route returns its
validation error (e.g. `POST /api/.../checkout` → 400, not 404).

---

## Rollback

```bash
ssh hampton-vps 'cd /opt/hosthampton && git log --oneline -5'
ssh hampton-vps 'cd /opt/hosthampton && git checkout <good_sha> -- . && docker compose up -d --build website'
# or revert the merge commit on GitHub and re-run scripts/deploy.sh
```

---

## Infrastructure setup (already applied 2026-06-08)

For reference / disaster recovery — how the box is wired so deploys stay clean:

**SSH deploy key:**
- `~/.ssh/hosthampton_deploy` on the VPS (read-only deploy key on the repo, titled
  `hosthampton-vps-deploy`).
- `~/.ssh/config` has a `github-hosthampton` Host alias → `HostName github.com`,
  `IdentityFile ~/.ssh/hosthampton_deploy`, `IdentitiesOnly yes` (the box also holds
  other repos' keys, so `IdentitiesOnly` is required to pick the right one).
- `origin` = `git@github-hosthampton:afintech510/host-hampton-ops.git`.

**Config drift:**
- `/opt/hosthampton/docker-compose.override.yml` (gitignored) holds the nginx
  server-only SSL volume mounts.
- `nginx/nginx.conf` is `skip-worktree` on the box.
