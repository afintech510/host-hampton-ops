# 🏗️ Host Hampton — System Architecture
**Fully Managed Feel | Under $50/Month | Docker + VPS | v1.2**

> **v1.2 Changes:** `reach` service split into `outbound` + `paid`. `build` service updated for GitHub/Vercel/Stripe (Builder Bridge retired). Launch sequence updated to marketing-first phase structure. `.env` updated accordingly.

---

## Architecture Philosophy

- **Minimize DevOps:** Docker Compose handles everything. One command launches the whole system.
- **IT Person Friendly:** Your dev/IT person deploys once, then it runs itself. Updates = `git pull && docker compose up -d`
- **Under $50/Month:** Leverages existing VPS + free tiers on Supabase, Vercel, and Cloudflare
- **Resilient:** Auto-restarts on crash, persistent volumes for data, daily backups

---

## Infrastructure Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        INTERNET                                  │
│                           │                                      │
│              ┌────────────▼────────────┐                        │
│              │   Cloudflare (FREE)     │                        │
│              │   DNS + CDN + DDoS      │                        │
│              │   SSL/TLS termination   │                        │
│              └────────────┬────────────┘                        │
│                           │                                      │
│         ┌─────────────────┼──────────────────┐                  │
│         ▼                 ▼                  ▼                   │
│   ┌──────────┐    ┌──────────────┐   ┌──────────────┐          │
│   │  Vercel  │    │  VPS Server  │   │  Supabase    │          │
│   │  (FREE)  │    │  (Existing)  │   │  (FREE tier) │          │
│   │          │    │  Docker      │   │              │          │
│   │ Next.js  │    │  Compose     │   │  PostgreSQL  │          │
│   │ Chat UI  │◄──►│  Agent Stack │◄──►  CRM + Data  │          │
│   │ Landing  │    │              │   │  Auth        │          │
│   │  Pages   │    │              │   │  Storage     │          │
│   └──────────┘    └──────────────┘   └──────────────┘          │
└──────────────────────────────────────────────────────────────────┘
```

---

## Component Breakdown

### 1. VPS Server (Your Existing Server)
**Runs:** All agent logic, MCP servers, task queue, background jobs

**Minimum Specs Needed:**
```
CPU:  2 vCPU (4 preferred)
RAM:  4GB (8GB preferred)
Disk: 40GB SSD
OS:   Ubuntu 22.04 LTS
```

**Typical VPS Costs (if you need to upgrade):**
| Provider | Specs | Cost |
|---|---|---|
| DigitalOcean | 2 vCPU / 4GB | $24/mo |
| Hetzner CX22 | 2 vCPU / 4GB | $6/mo ⭐ Best value |
| Hetzner CX32 | 4 vCPU / 8GB | $13/mo ⭐ Recommended |
| Linode | 2 vCPU / 4GB | $18/mo |

> **Recommendation:** If your existing VPS meets specs, use it. If you need to spin up a new one, Hetzner CX32 at $13/mo gives the most headroom.

---

### 2. Vercel (Frontend — FREE)
**Runs:** Next.js chat interface AND hosthampton.com website (Phase 2+)

**Why Vercel:**
- Free tier handles all traffic for a local business easily
- Auto-deploys from GitHub on every push (BUILD agent pushes branches, merges to main)
- Built-in CDN — pages load fast globally
- Zero config SSL
- Preview deployments for every branch — BUILD agent surfaces these for review

**Domains:**
```
hosthampton.com        → public website (Squarespace Phase 1 → Next.js Phase 2+)
app.hosthampton.com    → owner chat interface (HAMPTON command center)
```

---

### 3. Supabase (Database — FREE tier)
**Runs:** PostgreSQL database, file storage, authentication

**Free Tier Limits (more than enough):**
- 500MB database
- 1GB file storage
- 50,000 monthly active users
- Unlimited API requests

**Upgrade only if:** contact list exceeds ~100,000 rows or you store large image files in Supabase (we won't — images go to Cloudflare R2)

---

### 4. Cloudflare (DNS + CDN + Storage — FREE)
**Runs:** DNS, SSL, DDoS protection, R2 object storage for images

**Why Cloudflare:**
- Free DNS + CDN for hosthampton.com
- R2 storage: 10GB free (party photos, processed images, assets)
- Zero egress fees on R2 (unlike AWS S3)
- Free SSL certificates
- Handles traffic spikes without extra cost

---

## Docker Compose Stack (Full Stack on VPS)

### File Structure on VPS
```
/opt/hosthampton/
├── docker-compose.yml          ← single command launches everything
├── docker-compose.override.yml ← local dev overrides (gitignored)
├── .env                        ← all secrets (gitignored)
├── .env.example                ← template for IT person setup
│
├── services/
│   ├── hampton/                ← orchestrator agent
│   │   ├── Dockerfile
│   │   ├── src/
│   │   └── package.json
│   ├── soc/                    ← social media agent
│   ├── copy/                   ← content agent
│   ├── pixel/                  ← image processing agent
│   ├── build/                  ← website agent (GitHub + Vercel + Stripe) [Phase 2]
│   ├── list/                   ← CRM/list agent
│   ├── outbound/               ← email + SMS + direct outreach agent [was: reach]
│   ├── paid/                   ← Meta + Google ads agent [was: reach]
│   └── intel/                  ← analytics agent
│
├── mcp-servers/
│   ├── meta-api/               ← Instagram + Facebook MCP
│   ├── google-apis/            ← GBP + Ads + Analytics MCP
│   ├── image-processor/        ← Sharp image processing MCP
│   ├── task-queue/             ← inter-agent task MCP
│   └── github/                 ← GitHub MCP (BUILD agent — Phase 2) [replaces: builder-bridge]
│
├── nginx/
│   ├── nginx.conf              ← reverse proxy config
│   └── ssl/                    ← certs (managed by Cloudflare)
│
├── data/
│   ├── redis/                  ← task queue persistence
│   └── uploads/                ← temp image staging (syncs to R2)
│
└── scripts/
    ├── deploy.sh               ← one-command deploy script
    ├── backup.sh               ← daily backup to Supabase
    └── update.sh               ← git pull + restart containers
```

---

### docker-compose.yml

```yaml
version: '3.9'

services:

  # ─── REVERSE PROXY ───────────────────────────────────────────
  nginx:
    image: nginx:alpine
    container_name: hampton_nginx
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - hampton
    networks:
      - hampton_net

  # ─── REDIS (Task Queue + Caching) ────────────────────────────
  redis:
    image: redis:7-alpine
    container_name: hampton_redis
    restart: unless-stopped
    volumes:
      - ./data/redis:/data
    networks:
      - hampton_net
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 3

  # ─── ORCHESTRATOR (HAMPTON) ───────────────────────────────────
  hampton:
    build: ./services/hampton
    container_name: hampton_orchestrator
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_SERVICE_KEY=${SUPABASE_SERVICE_KEY}
      - REDIS_URL=redis://redis:6379
    depends_on:
      redis:
        condition: service_healthy
    networks:
      - hampton_net
    volumes:
      - ./data/uploads:/app/uploads

  # ─── SOCIAL MEDIA AGENT (SOC) ─────────────────────────────────
  soc:
    build: ./services/soc
    container_name: hampton_soc
    restart: unless-stopped
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - META_ACCESS_TOKEN=${META_ACCESS_TOKEN}
      - META_PAGE_ID=${META_PAGE_ID}
      - META_IG_ACCOUNT_ID=${META_IG_ACCOUNT_ID}
      - REDIS_URL=redis://redis:6379
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_SERVICE_KEY=${SUPABASE_SERVICE_KEY}
    depends_on:
      - redis
      - hampton
    networks:
      - hampton_net

  # ─── CONTENT AGENT (COPY) ─────────────────────────────────────
  copy:
    build: ./services/copy
    container_name: hampton_copy
    restart: unless-stopped
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - MAILCHIMP_API_KEY=${MAILCHIMP_API_KEY}
      - REDIS_URL=redis://redis:6379
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_SERVICE_KEY=${SUPABASE_SERVICE_KEY}
    depends_on:
      - redis
    networks:
      - hampton_net

  # ─── IMAGE AGENT (PIXEL) ──────────────────────────────────────
  pixel:
    build: ./services/pixel
    container_name: hampton_pixel
    restart: unless-stopped
    environment:
      - REPLICATE_API_KEY=${REPLICATE_API_KEY}
      - CLOUDFLARE_R2_ACCOUNT_ID=${CF_R2_ACCOUNT_ID}
      - CLOUDFLARE_R2_ACCESS_KEY=${CF_R2_ACCESS_KEY}
      - CLOUDFLARE_R2_SECRET_KEY=${CF_R2_SECRET_KEY}
      - REDIS_URL=redis://redis:6379
    volumes:
      - ./data/uploads:/app/uploads
    networks:
      - hampton_net

  # ─── WEBSITE AGENT (BUILD) ────────────────────────────────────
  # Phase 2 only — comment out until Phase 2 authorized
  build_agent:
    build: ./services/build
    container_name: hampton_build
    restart: unless-stopped
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - GITHUB_TOKEN=${GITHUB_TOKEN}
      - GITHUB_REPO=${GITHUB_REPO}
      - VERCEL_TOKEN=${VERCEL_TOKEN}
      - VERCEL_PROJECT_ID=${VERCEL_PROJECT_ID}
      - STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY}
      - STRIPE_WEBHOOK_SECRET=${STRIPE_WEBHOOK_SECRET}
      - REDIS_URL=redis://redis:6379
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_SERVICE_KEY=${SUPABASE_SERVICE_KEY}
    networks:
      - hampton_net

  # ─── CRM + LIST AGENT ─────────────────────────────────────────
  list:
    build: ./services/list
    container_name: hampton_list
    restart: unless-stopped
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_SERVICE_KEY=${SUPABASE_SERVICE_KEY}
      - MAILCHIMP_API_KEY=${MAILCHIMP_API_KEY}
      - REDIS_URL=redis://redis:6379
    networks:
      - hampton_net

  # ─── EMAIL + SMS AGENT (OUTBOUND) ────────────────────────────
  outbound:
    build: ./services/outbound
    container_name: hampton_outbound
    restart: unless-stopped
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - MAILCHIMP_API_KEY=${MAILCHIMP_API_KEY}
      - MAILCHIMP_LIST_ID=${MAILCHIMP_LIST_ID}
      - TWILIO_ACCOUNT_SID=${TWILIO_ACCOUNT_SID}
      - TWILIO_AUTH_TOKEN=${TWILIO_AUTH_TOKEN}
      - TWILIO_PHONE_NUMBER=${TWILIO_PHONE_NUMBER}
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_SERVICE_KEY=${SUPABASE_SERVICE_KEY}
      - REDIS_URL=redis://redis:6379
    networks:
      - hampton_net

  # ─── PAID ADS AGENT (PAID) ────────────────────────────────────
  # Phase 1B only — comment out until Phase 1B authorized
  paid:
    build: ./services/paid
    container_name: hampton_paid
    restart: unless-stopped
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - GOOGLE_ADS_CUSTOMER_ID=${GOOGLE_ADS_CUSTOMER_ID}
      - GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
      - GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}
      - GOOGLE_REFRESH_TOKEN=${GOOGLE_REFRESH_TOKEN}
      - META_APP_ID=${META_APP_ID}
      - META_APP_SECRET=${META_APP_SECRET}
      - META_ACCESS_TOKEN=${META_ACCESS_TOKEN}
      - REDIS_URL=redis://redis:6379
    networks:
      - hampton_net

  # ─── ANALYTICS AGENT (INTEL) ──────────────────────────────────
  intel:
    build: ./services/intel
    container_name: hampton_intel
    restart: unless-stopped
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - GA4_PROPERTY_ID=${GA4_PROPERTY_ID}
      - GOOGLE_REFRESH_TOKEN=${GOOGLE_REFRESH_TOKEN}
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_SERVICE_KEY=${SUPABASE_SERVICE_KEY}
      - REDIS_URL=redis://redis:6379
    networks:
      - hampton_net

  # ─── MCP SERVERS ──────────────────────────────────────────────
  mcp_meta:
    build: ./mcp-servers/meta-api
    container_name: hampton_mcp_meta
    restart: unless-stopped
    environment:
      - META_APP_ID=${META_APP_ID}
      - META_APP_SECRET=${META_APP_SECRET}
      - META_ACCESS_TOKEN=${META_ACCESS_TOKEN}
      - META_PAGE_ID=${META_PAGE_ID}
      - META_IG_ACCOUNT_ID=${META_IG_ACCOUNT_ID}
    networks:
      - hampton_net

  mcp_google:
    build: ./mcp-servers/google-apis
    container_name: hampton_mcp_google
    restart: unless-stopped
    environment:
      - GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
      - GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}
      - GOOGLE_REFRESH_TOKEN=${GOOGLE_REFRESH_TOKEN}
      - GBP_LOCATION_ID=${GBP_LOCATION_ID}
      - GA4_PROPERTY_ID=${GA4_PROPERTY_ID}
    networks:
      - hampton_net

  mcp_image:
    build: ./mcp-servers/image-processor
    container_name: hampton_mcp_image
    restart: unless-stopped
    volumes:
      - ./data/uploads:/app/uploads
    networks:
      - hampton_net

  mcp_tasks:
    build: ./mcp-servers/task-queue
    container_name: hampton_mcp_tasks
    restart: unless-stopped
    environment:
      - REDIS_URL=redis://redis:6379
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_SERVICE_KEY=${SUPABASE_SERVICE_KEY}
    depends_on:
      - redis
    networks:
      - hampton_net

# ─── NETWORKS ───────────────────────────────────────────────────
networks:
  hampton_net:
    driver: bridge

# ─── VOLUMES ────────────────────────────────────────────────────
volumes:
  redis_data:
  uploads:
```

---

## Cost Breakdown

| Service | What it does | Cost |
|---|---|---|
| VPS (existing or Hetzner CX32) | Runs all agents + Docker | $0 (existing) or $13/mo |
| Vercel | Next.js chat UI + hosthampton.com website (Phase 2) | FREE |
| Supabase | Database + auth + storage | FREE |
| Cloudflare | DNS + CDN + SSL + R2 images | FREE |
| Mailchimp | Email marketing (up to 500 contacts) | FREE |
| Anthropic API | Claude agent calls | ~$10–20/mo (varies by usage) |
| Meta API | Instagram + Facebook | FREE |
| Google APIs | GBP, Analytics, Ads | FREE (Ads = pay per click) |
| Replicate | AI image generation | ~$2–5/mo (light usage) |
| Twilio SMS | Text campaigns (pay per SMS) | ~$1–5/mo (light usage) |
| Stripe | Event tickets + party deposits (2.9% + 30¢ per transaction) | ~$0–5/mo |
| ~~Squarespace~~ | ~~Website hosting~~ | ~~$23–65/mo~~ **Cancelled Phase 2B** |
| **TOTAL** | | **~$15–45/month** ✅ |

> Google/Meta Ads budget is separate — that's ad spend, not infrastructure. Start at $15/day and scale based on ROI.
> Squarespace savings ($23–65/mo) offset any new infrastructure costs.

---

## Deploy Guide (For Your IT Person)

### One-Time Setup (45 minutes)

```bash
# 1. SSH into VPS
ssh user@your-vps-ip

# 2. Install Docker + Docker Compose
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# 3. Install Docker Compose v2
sudo apt install docker-compose-plugin

# 4. Clone the repo
git clone https://github.com/your-org/hosthampton-agents.git
cd hosthampton-agents

# 5. Copy env template and fill in credentials
cp .env.example .env
nano .env   # fill in all API keys

# 6. Launch everything
docker compose up -d

# 7. Verify all containers running
docker compose ps
```

### Ongoing Operations (Zero DevOps)

```bash
# Update to latest code
./scripts/update.sh
# → does: git pull → docker compose build → docker compose up -d

# View live logs
docker compose logs -f hampton

# Restart single agent
docker compose restart soc

# Full restart
docker compose restart

# Check resource usage
docker stats
```

### Auto-Restart on VPS Reboot
Docker's `restart: unless-stopped` policy handles this automatically.
All containers come back up on reboot with no manual intervention.

---

## CI/CD Pipeline (GitHub Actions)

### `.github/workflows/deploy.yml`

```yaml
name: Deploy to VPS

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to VPS
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd /opt/hosthampton
            git pull origin main
            docker compose build --no-cache
            docker compose up -d
            docker compose ps
```

**Result:** Your IT person pushes to `main` → GitHub automatically deploys to VPS in ~3 minutes. Zero manual steps after initial setup.

---

## Monitoring & Alerts (Free)

### Uptime Robot (FREE)
- Monitors all service endpoints every 5 minutes
- SMS/email alert if anything goes down
- Set up monitors for:
  - `app.hosthampton.com` (chat UI)
  - `hosthampton.com` (main site)
  - VPS API health endpoint

### Docker Health Checks
Every container has a built-in health check. Check status anytime:
```bash
docker compose ps
# Shows: Name | Status | Health
```

### Log Management
```bash
# Live logs all containers
docker compose logs -f

# Logs for specific agent
docker compose logs -f hampton --tail=100

# Save logs to file
docker compose logs > logs_$(date +%Y%m%d).txt
```

---

## Backup Strategy

### Daily Automated Backup (cron on VPS)

```bash
# Add to crontab: crontab -e
0 2 * * * /opt/hosthampton/scripts/backup.sh
```

```bash
#!/bin/bash
# scripts/backup.sh

DATE=$(date +%Y%m%d)
BACKUP_DIR="/opt/hosthampton/backups"

# Backup Redis data
docker exec hampton_redis redis-cli BGSAVE
cp /opt/hosthampton/data/redis/dump.rdb $BACKUP_DIR/redis_$DATE.rdb

# Backup uploads
tar -czf $BACKUP_DIR/uploads_$DATE.tar.gz /opt/hosthampton/data/uploads/

# Sync to Cloudflare R2 (free egress)
aws s3 sync $BACKUP_DIR s3://hosthampton-backups/ \
  --endpoint-url https://${CF_R2_ACCOUNT_ID}.r2.cloudflarestorage.com

# Keep only last 30 days locally
find $BACKUP_DIR -mtime +30 -delete

echo "Backup complete: $DATE"
```

Supabase has its own automated daily backups on free tier — no action needed.

---

## Security Checklist (For IT Person)

```
[ ] SSH key-only login (disable password auth)
[ ] UFW firewall: allow only 80, 443, 22
[ ] .env file permissions: chmod 600 .env
[ ] .env in .gitignore (never commit secrets)
[ ] Cloudflare proxy enabled for all DNS records
[ ] Fail2ban installed (blocks brute force SSH)
[ ] Docker containers run as non-root user
[ ] Supabase RLS (Row Level Security) enabled
[ ] API keys scoped to minimum permissions needed
[ ] Monthly: rotate API keys, review access logs
```

### UFW Firewall Setup
```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

---

## Environment Variables (.env.example)

```env
# ── ANTHROPIC ─────────────────────────────
ANTHROPIC_API_KEY=sk-ant-...

# ── SUPABASE ──────────────────────────────
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...

# ── META (Instagram + Facebook) ───────────
META_APP_ID=
META_APP_SECRET=
META_ACCESS_TOKEN=
META_PAGE_ID=
META_IG_ACCOUNT_ID=

# ── GOOGLE ────────────────────────────────
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
GBP_LOCATION_ID=
GOOGLE_ADS_CUSTOMER_ID=
GA4_PROPERTY_ID=

# ── EMAIL ─────────────────────────────────
MAILCHIMP_API_KEY=
MAILCHIMP_LIST_ID=

# ── SMS ───────────────────────────────────
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=

# ── IMAGES ────────────────────────────────
REPLICATE_API_KEY=
CF_R2_ACCOUNT_ID=
CF_R2_ACCESS_KEY=
CF_R2_SECRET_KEY=
CF_R2_BUCKET=hosthampton-assets

# ── BUILD AGENT (Phase 2 — add when ready) ─
GITHUB_TOKEN=
GITHUB_REPO=your-org/hosthampton.com
VERCEL_TOKEN=
VERCEL_PROJECT_ID=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

# ── REDIS ─────────────────────────────────
REDIS_URL=redis://redis:6379
```

---

## Launch Sequence — v1.2 Marketing-First Phase Structure

```
─── PHASE 1A: MARKETING FOUNDATION (Weeks 1–2) ──────────────────
Day 1–2:  VPS prep → Docker install → repo setup → .env filled
          Redis + Nginx up → Memory Server + Supabase schema deployed
          memory_bootstrap.ts + memory_bootstrap_v1.2.ts run
          HAMPTON orchestrator live with 3-tier approval matrix

Day 3–5:  Meta MCP → SOC agent posting to IG + FB + GBP (test post)
          COPY agent → 30-day content calendar generated
          PIXEL agent → all Squarespace images resized for IG/FB/Stories
          SOC → first 2 weeks of posts scheduled

Day 6–7:  COPY → welcome email (3-email series) + welcome SMS written
          Mailchimp sequences loaded (OUTBOUND agent)
          OUTBOUND → welcome sequence trigger live on new signups
          LIST → all existing contacts imported + segmented

Day 8–10: Chat UI deployed to Vercel → owner can command via chat
          OUTBOUND → FB + Nextdoor group posting cadence configured
          Review Velocity Engine → post-booking SMS trigger active

─── PHASE 1B: PAID + ANALYTICS (Weeks 3–4) ──────────────────────
Week 3:   PAID agent → Meta + Google Ads campaigns live
          Initial audiences: website visitors, IG engagers, email list
          INTEL agent → GA4 + Meta Insights + GBP connected
          INTEL → weekly report template live, baseline metrics set

Week 4:   HAMPTON → "Launch spring birthday campaign" test command
          COPY → PIXEL → SOC → OUTBOUND → PAID execute in parallel
          INTEL → first full performance report to owner

─── PHASE 2A: WEBSITE SCAFFOLD (Month 2, Weeks 1–2) ─────────────
Week 5:   BUILD agent → GitHub repo created, Next.js 14 scaffolded
          BUILD → crawls all Squarespace pages, extracts copy + images
          COPY → rewrites all copy with SEO + brand voice
          PIXEL → optimizes all images (WebP, responsive srcset)
          BUILD → builds all 12 core pages + Stripe + forms

Week 6:   BUILD → surfaces full Vercel preview URL for owner review
          Owner + HAMPTON review: mobile, booking flows, brand feel
          COPY + BUILD address all feedback

─── PHASE 2B: LAUNCH (Month 2, Weeks 3–4) ───────────────────────
Week 7:   BUILD → 10 theme pages + 4 location pages generated
          INTEL → pre-launch SEO audit (all titles, meta, schema)
          DNS cutover: Cloudflare → Vercel (15 min, zero downtime)
          Google Search Console sitemap submitted
          SOC → launch announcement across all channels
          Owner cancels Squarespace subscription ($23–65/mo saved)

─── PHASE 3: FULL AUTONOMY (Month 3+) ───────────────────────────
Month 3:  Booking Gap Detector → Monday cron fully operational
          Vendor/Partner Channel → outreach + UTM attribution live
          Human Escalation Path → Twilio SMS alerts fully live
          Memory hygiene sweep → all TODO items resolved
          All 9 agents operating autonomously
```

---

*System Architecture v1.2 | Host Hampton Agent System | Docker + VPS | February 2026*
