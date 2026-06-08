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

## Two recurring gotchas (READ THIS — this is why deploys feel painful)

### 1. The GitHub token on the box expires
The VPS `origin` remote has a Personal Access Token baked into the URL
(`https://x-access-token:ghp_…@github.com/…`). It works until the PAT expires,
then `git pull` fails with **"Authentication failed … Password authentication is
not supported."** This is not a code problem — the token aged out.

- **Immediate workaround** (what `scripts/deploy.sh` does): pull using *your*
  laptop's token via `gh auth token`, so the box's stale token is bypassed.
- **Permanent fix (do this once):** switch the box to an **SSH deploy key** so no
  token is involved and nothing expires. See "Permanent fixes" below. Until then,
  **rotate** any committed `ghp_…` token in GitHub → Settings → Developer settings.

### 2. `docker-compose.yml` / `nginx.conf` are edited directly on the box
The server hosts several domains (maningomethod, mygravelguy, benchworksai…), so
`nginx/nginx.conf` and the nginx `volumes:` in `docker-compose.yml` carry
**server-only SSL mounts** that are NOT in git. A plain `git pull` aborts with
*"Your local changes would be overwritten."* (That's why `/opt/hosthampton` is
littered with `*.bak` files — each deploy fought this.)

- **Immediate workaround** (what the script does): `git stash` those two files,
  pull, `git stash pop`. The server edits and the repo edits live in different
  sections, so they re-merge cleanly.
- **Permanent fix:** move the server-only nginx mounts into a **gitignored
  `docker-compose.override.yml`** so the tracked file never conflicts. See below.

---

## Manual deploy (if not using the script)

```bash
ssh hampton-vps
cd /opt/hosthampton

# 1. Preserve server-only config so the pull won't abort
git stash push -m deploy -- docker-compose.yml nginx/nginx.conf

# 2. Pull main. If the box token is dead, pull with your own token from the URL:
git pull "https://x-access-token:<GH_TOKEN>@github.com/afintech510/host-hampton-ops.git" main --ff-only

# 3. Re-apply the server-only config
git stash pop

# 4. Rebuild + recreate ONLY the website (nginx stays up)
docker compose up -d --build website

# 5. Verify
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

## Permanent fixes (recommended — kills both gotchas for good)

**A. SSH deploy key (no more token expiry):**
1. On the box: `ssh-keygen -t ed25519 -f ~/.ssh/hosthampton_deploy -N ""`
2. Add the public key to the repo: GitHub → repo → Settings → Deploy keys (read-only),
   or `gh repo deploy-key add ~/.ssh/hosthampton_deploy.pub -R afintech510/host-hampton-ops`.
3. Point the remote at SSH with that key (host alias in `~/.ssh/config`), then
   `git remote set-url origin git@github.com-hosthampton:afintech510/host-hampton-ops.git`.
4. Revoke the old `ghp_…` PAT.

**B. `docker-compose.override.yml` (no more pull conflicts):**
Move the server-only nginx SSL `volumes:` out of `docker-compose.yml` into
`/opt/hosthampton/docker-compose.override.yml` (Compose merges it automatically and
it's gitignored). Then the tracked `docker-compose.yml` matches the repo and
`git pull` never conflicts — no stash/pop needed. Do the same conceptually for
`nginx.conf` if practical, or keep it stashed.
