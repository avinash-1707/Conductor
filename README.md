# Conductor

**Run AI workflows you can trust.**

Conductor is a multi-tenant AI operations platform that executes business-critical AI
pipelines — research → human approval → write → publish — as **durable
[Temporal](https://temporal.io) workflows**. Runs survive worker crashes and restarts,
pause at human approval gates and resume on a click, stream live progress to a dashboard,
and leave a complete, replayable audit trail. Each AI step is a specialist agent: a
[LangGraph.js](https://langchain-ai.github.io/langgraphjs/) sub-graph that calls models
through [OpenRouter](https://openrouter.ai) via the
[Vercel AI SDK](https://sdk.vercel.ai), on the customer's own key.

The first target customer is **AI agencies running content and SEO operations** — teams
executing dozens of content pipelines a day who today lose runs to silent failures,
babysit them by hand, and bolt approvals on with spreadsheets and Slack. The positioning
is outcomes, not architecture.

> Multi-tenant from the first migration. OSS-only infrastructure (PostgreSQL, Redis,
> Temporal OSS) so the platform stays self-hostable — the later self-host offering is
> packaging work, not rearchitecture.

---

## Table of Contents

- [Why Conductor](#why-conductor)
- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Monorepo Layout](#monorepo-layout)
- [Quickstart](#quickstart)
- [Demos](#demos)
- [Configuration](#configuration)
- [Development](#development)
- [Data Model](#data-model)
- [Core Invariants](#core-invariants)
- [Project Status](#project-status)
- [Further Reading](#further-reading)

---

## Why Conductor

| Problem (today) | Conductor |
| --- | --- |
| AI runs die silently when a process crashes | Durable execution — a crashed worker's in-flight step is re-dispatched; the run continues from its exact position |
| Approvals bolted on with Slack + spreadsheets | First-class human-in-the-loop gates with full context, Approve/Reject, and an audit record |
| No visibility into what's running | Real-time dashboard with live status badges and streaming LLM output |
| A failed run means re-running (and re-paying for) everything | Resume-from-step replays stored outputs — finished steps never re-run, tokens never re-spent |
| One customer can see another's data | Org-scoping enforced structurally from the first migration; cross-org IDs resolve to 404 |
| Vendor lock-in | OSS-only infra (Postgres, Redis, Temporal OSS), env-driven config, BYO OpenRouter key |

---

## Features

### Organizations & Teams
- Better Auth organizations — every user belongs to one or more orgs; an active-org context scopes every page and API call.
- Two roles in v1: **owner** (manage org, members, API keys, models) and **member** (run and approve workflows).
- Email invitations with an accept-link flow; invited users auto-join the inviting org on first login.
- Per-org OpenRouter API key, **encrypted at rest**, verified live against OpenRouter before storage, used by agents for all of that org's runs.

### Durable Workflow Execution
- The Content Pipeline — research → approval gate → write → publish — each AI step a Temporal activity wrapping a LangGraph.js sub-graph.
- Per-activity retry policies with exponential backoff and explicit timeouts.
- Automatic recovery: a crashed worker's in-flight activity is re-dispatched and the workflow continues from its exact position — no lost runs.

### Workflow Templates & Visual Canvas — one engine, two surfaces
- A single generic **interpreter workflow** executes a versioned, Zod-validated `graph_spec` (nodes = registered agent steps, edges = transitions). There is no second execution path.
- **Templates** are code-curated catalog entries — Blog Post Pipeline, SEO Brief, Competitor Research — each with a typed parameter schema that generates its launch form (form and contract cannot drift).
- The **React Flow canvas** (`/canvas`) is a visual editor over the same `graph_spec`: drag-and-drop / click-to-add nodes, per-node config, live validation by the shared schema, save-as-new-version with immutable history, and launch straight from the canvas.
- Definitions are versioned in the database; in-flight runs pin the version they started with.

### Human-in-the-Loop
- Approval gates implemented as Temporal **signals + `condition()`** — zero polling, no worker slot held while suspended.
- Approval Queue with full rendered context (research findings, draft) and Approve / Reject actions; reject ends the run gracefully.
- 24-hour approval timeout → "expired"; decision, decider, and timestamp recorded for the audit trail.

### Real-Time Operations Dashboard
- Org-scoped Run Dashboard — every run with live status badges over WebSocket (Socket.IO).
- Run Detail — step timeline rail, live duration counters, **streaming LLM output** for the active step, and a per-step payload inspector.
- Onboarding checklist that walks a new account to its first live streaming run.

### Audit, Replay & Resume
- Immutable run history: every step's input, output, error, attempt count, and approval decision.
- **Resume-from-step** — restart a failed run from its last successful step using stored outputs; no re-run, no re-spent tokens.
- Per-org model selection (Settings → Models): owners pick research/writing models from a curated OpenRouter catalog.

---

## Architecture

```mermaid
flowchart LR
  web["apps/web<br/>Next.js dashboard"]
  server["apps/server<br/>Fastify API"]
  worker["apps/worker<br/>Temporal worker"]
  temporal[("Temporal<br/>execution source of truth")]
  pg[("PostgreSQL<br/>projections + domain + auth")]
  redis[("Redis<br/>pub/sub: status + token streams")]
  openrouter["OpenRouter<br/>(via Vercel AI SDK)"]

  web -- "HTTP / WebSocket (bearer JWT)" --> server
  server -- "start / signal / query" --> temporal
  server -- "subscribe" --> redis
  server -- "read projections" --> pg
  temporal -- "dispatch tasks" --> worker
  worker -- "workflows/ (deterministic sandbox)" --> worker
  worker -- "activities: LangGraph agents" --> openrouter
  worker -- "projection writes" --> pg
  worker -- "publish status + tokens" --> redis
```

Plain-text fallback:

```
apps/web ──HTTP/WS──> apps/server ──client──> Temporal ──dispatch──> apps/worker
                          │  └─subscribe─> Redis <─publish── activities ─┘
                          └─read──────────> PostgreSQL <─projection writes─┘
                                       activities ──LLM──> OpenRouter (AI SDK)
```

### Boundaries

- **`apps/web`** — Next.js dashboard. Talks only to the server over HTTP/WebSocket with a bearer JWT. Owns no business logic; never touches Temporal, Postgres, or Redis.
- **`apps/server`** — Fastify API: Better Auth (orgs), REST routes, the Temporal *client*, the WebSocket relay, and the Redis *subscriber*. Runs no AI work and no long-lived jobs.
- **`apps/worker`** — Temporal worker. `workflows/` is a deterministic sandbox (no I/O); `activities/` hold every side effect — LangGraph agents, OpenRouter LLM calls, Postgres/Redis writes.
- **`packages/shared`** — Zod schemas, inferred types, and constants shared across all three. Plus one pure helper: AES-256-GCM secret crypto at `@conductor/shared/crypto` (deliberately outside the barrel so `node:crypto` never reaches the web bundle).
- **`packages/db`** — Drizzle schema (auth + domain), a `createDb(pool)` factory, and org-scoped repository factories (`createRepos(db)`), shared by server and worker so tenancy scoping is one codebase.

Dependency direction: `web → shared`, `server → shared + db`, `worker → shared + db`, `db → shared`. **Apps never import from each other.**

### Storage model

- **Temporal event history** — the source of truth for execution state. Never duplicated as authoritative data.
- **PostgreSQL** — read-side projections (`workflow_runs`, `activity_log`), org-scoped domain records (`workflow_definitions`, `approval_requests`, `org_api_keys`, `org_model_settings`, `publish_deliveries`), and Better Auth tables.
- **Redis** — ephemeral only: pub/sub for step-status events and LLM token streams, plus a 10-minute read-through cache for org model settings. A Redis flush loses live tails and warm caches, never durable state.

---

## Tech Stack

| Layer | Technology |
| --- | --- |
| Monorepo | pnpm workspaces + Turborepo |
| Frontend | Next.js 16 (App Router) + React 19 + TypeScript |
| UI | Tailwind CSS v4, lucide-react, React Flow (`@xyflow/react`), Lenis |
| Data fetching | TanStack Query |
| API server | Fastify 5 + TypeScript |
| Auth | Better Auth (Drizzle adapter) — organizations + emailOTP + jwt + bearer plugins, Google OAuth |
| Durable execution | Temporal (TypeScript SDK), self-hosted |
| Agent runtime | LangGraph.js + Vercel AI SDK over OpenRouter |
| Database | PostgreSQL 16 + Drizzle ORM |
| Events / streaming | Redis 7 (pub/sub) + Socket.IO |
| Validation | Zod (single source of truth in `packages/shared`) |
| Logging | pino (structured JSON) |
| Testing | Vitest (unit), Playwright (E2E against the real stack) |
| Local infra | Docker Compose (Temporal + UI, Postgres, Redis) |

**Auth model:** Better Auth is mounted on Fastify at `/api/auth/*`. Clients authenticate
with a **bearer JWT** (JWKS-verified statelessly — no per-request DB hit) carrying the user
id and the active organization id. Every route except `/api/auth/*` and `/health` is
protected; org-settings routes additionally require the **owner** role.

---

## Monorepo Layout

```
Conductor/
├── apps/
│   ├── web/                  # Next.js dashboard (@conductor/web)
│   │   ├── app/
│   │   │   ├── (app)/        # runs, runs/[id], approvals, workflows, workflows/[key],
│   │   │   │                 #   canvas, settings, users
│   │   │   └── (auth)/       # login, signup, create-org, accept-invitation/[id]
│   │   ├── components/       # app/, canvas/, landing/
│   │   ├── lib/              # api client, auth client, query hooks
│   │   └── e2e/              # Playwright specs (golden path, invite, canvas, snapshot)
│   ├── server/               # Fastify API (@conductor/server)
│   │   └── src/
│   │       ├── auth/         # Better Auth config
│   │       ├── routes/       # REST routes (runs, approvals, templates, definitions, orgs…)
│   │       ├── realtime/     # Redis subscriber → Socket.IO relay
│   │       ├── repos/        # org-scoped repo bindings
│   │       ├── lib/          # templates, resume-plan, openrouter, env
│   │       └── db/migrations/# drizzle-kit migrations
│   └── worker/               # Temporal worker (@conductor/worker)
│       └── src/
│           ├── workflows/    # deterministic sandbox — interpreterWorkflow
│           ├── activities/   # side effects; agents/ = LangGraph sub-graphs
│           └── realtime/     # Redis publisher (status + token streams)
├── packages/
│   ├── shared/               # Zod schemas, types, constants, crypto (@conductor/shared)
│   └── db/                   # Drizzle schema + org-scoped repos (@conductor/db)
├── infra/                    # docker-compose (dev + prod), Temporal config, DEPLOY.md
├── scripts/                  # demo-reliability.sh, demo-approval.sh
├── context/                  # product/architecture/standards docs + unit specs
└── docs/                     # partner-onboarding.md
```

---

## Quickstart

**Prerequisites:** Node ≥ 22, pnpm 10, Docker.

```bash
# 1. Infrastructure (Temporal + UI, Postgres, Redis)
docker compose -f infra/docker-compose.yml up -d
#    Temporal UI → http://localhost:8080

# 2. Dependencies + env
pnpm install
cp .env.example .env        # set per-org OpenRouter keys in-app, not here

# 3. Run everything in watch mode (web :3000, server :4000, worker)
pnpm dev
```

Then open **http://localhost:3000**, sign up, create an org, add your OpenRouter key in
Settings, configure a template, and launch a run — the onboarding checklist walks you
through it.

### CLI-only run (no web)

```bash
# Start a worker
pnpm --filter @conductor/worker start

# Start a pipeline run (suspends at the approval gate), then approve it
pnpm --filter @conductor/worker run-pipeline "How durable workflows prevent lost AI runs"
pnpm --filter @conductor/worker signal-approval <workflowId> approved
```

**Standing gate** (must pass before any unit is complete):

```bash
pnpm build && pnpm typecheck && pnpm lint && pnpm test
```

---

## Demos

Two scripted proofs double as sales assets. Both need Docker infra up.

### Reliability — kill-the-worker

Kill the worker mid-Research, restart it, and the run completes with the retry visible in
step history.

```bash
docker compose -f infra/docker-compose.yml up -d
CONDUCTOR_ORG_ID=org_... ./scripts/demo-reliability.sh    # an org with an OpenRouter key stored
```

Starts a run, hard-kills the worker (`SIGKILL`) while Research is in flight, restarts it,
approves the gate, and prints the Temporal UI link to inspect the recovered activity's
attempts. Tunables: `TOPIC`, `KILL_DELAY`, `RESTART_DELAY`, `APPROVE_DELAY`.

### Approval — pause/resume

A run suspends at the approval gate holding no worker slot and resumes within seconds of
Approve. Drives the **real product API** end-to-end and is fully self-contained — signs up
a demo user, creates an org, stores its key (encrypted), starts a run, shows the reviewer's
research context while suspended, approves, and prints the measured decision→resume latency.

```bash
docker compose -f infra/docker-compose.yml up -d
OPENROUTER_API_KEY=sk-or-... ./scripts/demo-approval.sh
```

The key becomes the demo org's key via `PUT /orgs/api-key` and is never printed. Tunables:
`TOPIC`, `KEYWORDS`, `TONE`, `WORD_COUNT`, `APPROVE_DELAY`.

---

## Configuration

Copy `.env.example` to `.env`. Key variables:

| Variable | Purpose |
| --- | --- |
| `WEB_PORT` / `SERVER_PORT` | Dev ports (default 3000 / 4000) |
| `DATABASE_URL` | Postgres connection (server + worker, Drizzle) |
| `REDIS_URL` | Redis pub/sub + cache |
| `TEMPORAL_ADDRESS` / `TEMPORAL_NAMESPACE` | Temporal connection |
| `TEMPORAL_TASK_QUEUE` | Task-queue override; set the **same** value on server + worker |
| `RESEARCH_MODEL` / `WRITING_MODEL` | Platform-default OpenRouter model slugs (an org's own choice in Settings → Models wins) |
| `PLATFORM_ENCRYPTION_KEY` | AES-256-GCM key for encrypting org API keys at rest (`openssl rand -base64 32`) — **required in production** on server + worker |
| `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` | Better Auth (secret ≥ 32 chars) — **required in production** |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google sign-in (enabled only when both set) |
| `NEXT_PUBLIC_SERVER_URL` | Web → server origin (build-time, inlined into the web bundle) |
| `KEY_VERIFICATION` | `off` skips the live OpenRouter key check (E2E/dev only; production refuses it) |
| `LLM_MODE` | `mock` swaps OpenRouter for deterministic canned LLMs (E2E/dev only; production refuses it) |
| `WORKER_HEALTH_PORT` | Worker `/health` + `/ready` port (default 4001) |

`NODE_ENV=production` hardens boot: the dev-default secrets and `LLM_MODE=mock` are refused
with named errors. There is **no platform OpenRouter key** — agents always run on the org's
own key, decrypted only inside the worker activity at call time.

---

## Development

```bash
pnpm dev            # web + server + worker in watch mode (needs docker infra up)
pnpm build          # build all packages
pnpm typecheck      # strict TS across the monorepo
pnpm lint           # ESLint across the monorepo
pnpm test           # Vitest unit suites across packages
pnpm format         # Prettier write
```

Per-app scripts:

```bash
pnpm --filter @conductor/server migrate           # apply Drizzle migrations (release command)
pnpm --filter @conductor/worker run-pipeline ...   # start a run from the CLI
pnpm --filter @conductor/worker signal-approval    # approve/reject from the CLI
pnpm --filter @conductor/web test:e2e              # Playwright E2E against the real stack
```

### Testing

- **Unit:** Vitest in `shared`, `server`, and `worker` — including time-skipping Temporal
  workflow tests and real-Redis cache tests.
- **E2E:** Playwright drives the real stack (web + server + worker + Postgres + Redis +
  Temporal). Specs cover the golden path (sign up → key → launch → stream → approve →
  complete), member invitations, the canvas authoring loop, and a dashboard pixel snapshot.
- **CI:** GitHub Actions spins up service containers, migrates, runs the root gate, then the
  stack E2E (golden path + invite). The pixel-snapshot spec is operator-run (machine-specific
  baseline).

### Deployment

Container images (`Dockerfile.server`, `Dockerfile.worker`, `Dockerfile.web`) and a
self-host reference (`infra/docker-compose.prod.yml`) ship in-repo. Release order:
`migrate` → server + worker → web. Full env matrix, health endpoints, and a kill-the-worker
smoke test are documented in **`infra/DEPLOY.md`**.

---

## Data Model

All domain tables carry a non-null `org_id` and are reached only through org-scoped repos.

| Table | Role |
| --- | --- |
| `workflow_runs` | Run projection (status, name, params, links) — mirrors Temporal history for reads |
| `activity_log` | Per-step input/output/error/attempts — the audit trail and resume source |
| `workflow_definitions` | Versioned template / canvas `graph_spec` (immutable versions; runs pin one) |
| `approval_requests` | Gate context, decision, reviewer, timestamps |
| `org_api_keys` | Per-org OpenRouter key, encrypted at rest — never logged or returned |
| `org_model_settings` | Per-org research/writing model choice (null = platform default) |
| `publish_deliveries` | Publish idempotency ledger (written only after successful delivery) |
| Better Auth tables | user / session / account / organization / member / invitation |

---

## Core Invariants

These cause silent, catastrophic failures if violated:

1. **Workflow code is deterministic** — files in `workflows/` never do I/O, import Node built-ins, read env, or call `Date.now()` / `Math.random()`. All side effects live in activities.
2. **Activities are idempotent** — safe to re-run from the start with the same input (Temporal retries from the beginning).
3. **Human waits are signals, never activities** — gates use a signal handler + `condition()`; no activity ever blocks on a human.
4. **Temporal history is the execution source of truth** — Postgres rows are read-side projections; no execution decision reads a projection.
5. **Every domain row is org-scoped** — `org_id` from the verified JWT claims, never from a request body; cross-org IDs resolve to 404.
6. **Customer API keys are secrets everywhere** — encrypted at rest, decrypted only inside the worker activity at call time, never logged, returned, or placed in Temporal/Redis payloads.
7. **Infrastructure stays self-hostable** — no proprietary managed-cloud dependency; everything runs on Postgres, Redis, and Temporal OSS via env config.

The full list lives in `context/architecture.md`.

---

## Project Status

All planned code units (Phases 1–5, Units 01–33) are **complete**: durable execution, auth
+ orgs, the real-time dashboard, the templates/interpreter engine, the visual canvas, and
per-org model selection all ship. Remaining work is operator-gated — the host-specific
deploy, a design-partner usability test, and recording the demo videos.

See `context/progress-tracker.md` for the authoritative, up-to-date status and
`context/specs/00-build-plan.md` for the full unit decomposition.

---

## Further Reading

| Doc | What's in it |
| --- | --- |
| `context/project-overview.md` | Product definition, goals, scope, success criteria |
| `context/architecture.md` | System structure, boundaries, storage model, all invariants |
| `context/ui-context.md` | Theme, colors, typography, component conventions |
| `context/code-standards.md` | Implementation rules and conventions |
| `context/ai-workflow-rules.md` | Development workflow and delivery approach |
| `context/progress-tracker.md` | Current phase, completed work, next steps (source of truth) |
| `context/specs/` | Per-unit specs (01–33) |
| `infra/DEPLOY.md` | Deployment runbook and env matrix |
| `docs/partner-onboarding.md` | Design-partner 10-minute onboarding path |
