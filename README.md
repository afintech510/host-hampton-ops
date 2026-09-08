# Host Hampton Ops

A self-hosted, multi-agent operations platform that runs the marketing and customer
operations for Host Hampton, an events business in the Hamptons. Seven specialised
Node/TypeScript services coordinate behind a single orchestrator, with a Next.js
dashboard for human approval of anything that reaches a customer.

## Why it exists

Small operators can't staff a marketing department. This platform automates the
repeatable parts — drafting content, monitoring social mentions, managing lists,
sending email and SMS — while keeping a person in the loop on every outbound action.

## Architecture

```
                    ┌──────────────────┐
                    │  Next.js         │  app.hosthampton.com
                    │  dashboard       │  approvals, history, content library
                    └────────┬─────────┘
                             │ WebSocket
                    ┌────────▼─────────┐
                    │  HAMPTON         │  orchestrator
                    │  Express + WS    │  task routing, approval gate
                    └────────┬─────────┘
                             │ Redis pub/sub
      ┌──────────┬───────────┼───────────┬──────────┐
   ┌──▼──┐    ┌──▼──┐    ┌───▼───┐   ┌───▼───┐  ┌───▼────┐
   │ SOC │    │COPY │    │ IMAGE │   │ LIST  │  │OUTBOUND│
   └─────┘    └─────┘    └───────┘   └───────┘  └────────┘
   social     content    Replicate    email      email/SMS
   listening  writing    image gen    lists      dispatch
```

| Service | Responsibility |
|---|---|
| `hampton` | Orchestrator — routes tasks, owns the approval gate, fans out over Redis |
| `soc` | Social listening and comment scanning |
| `copy` | Content generation into a shared content library |
| `image` | Image generation via Replicate |
| `list` | Email list segmentation and management |
| `outbound` | Email and SMS dispatch (Resend) |
| `intel` | Competitive and market intelligence gathering |
| `website` | Next.js public site and operations dashboard |

## Approval gate

Every agent action is classified before it executes:

- `AUTO_EXECUTE` — low-risk, runs immediately
- `DRAFT_AND_SHOW` — produced, held for review in the dashboard
- `ALWAYS_ASK` — blocked until a human approves

This is the core design constraint: an autonomous system that touches real customers
needs a hard boundary between what it may do alone and what it may only propose.

## Stack

TypeScript across all services · Express · WebSocket · Redis pub/sub · Next.js
(App Router) · Supabase/PostgreSQL · Docker Compose · nginx · Cloudflare (Full Strict
TLS) · deployed to a Hetzner VPS

## Testing

The website service carries a Jest suite covering email templates, admin auth,
SMS templates (including TCPA compliance rules), and the public API routes, plus
Playwright end-to-end coverage. See `services/website/TESTING.md`.

## Running locally

```bash
cp .env.example .env      # fill in credentials
docker compose up --build
```

Each service is independently buildable via its own `Dockerfile`.

## Repository layout

```
services/       the seven services, one directory each
frontend/       dashboard assets
nginx/          reverse-proxy configuration
scripts/        operational tooling
docs/           design notes and runbooks
PLAN.md         phased build plan and status
DEPLOY.md       deployment runbook
```
