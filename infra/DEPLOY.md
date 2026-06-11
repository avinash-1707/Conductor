# Conductor — Deploy Runbook

Unit 28a ships everything host-agnostic: images, health surfaces, release
commands, CI. The host-specific half (Unit 28b: domain, TLS, managed vs
co-hosted data stores, secret storage) is filled in once the hosting target is
chosen. Standing constraint: OSS-only infrastructure (architecture invariant
13) — Postgres, Redis, Temporal OSS, config via env vars.

## Images

Build from the **repo root** (the Dockerfiles need the workspace context):

| Image | Dockerfile | Port | Notes |
| --- | --- | --- | --- |
| API server | `Dockerfile.server` | 4000 | Also the migration runner (release step) |
| Temporal worker | `Dockerfile.worker` | 4001 (health only) | Workflow bundle compiles at boot |
| Dashboard | `Dockerfile.web` | 3000 | `NEXT_PUBLIC_SERVER_URL` is a **build arg** — baked into the client bundle, build per environment |

```sh
docker build -f Dockerfile.server -t conductor-server .
docker build -f Dockerfile.worker -t conductor-worker .
docker build -f Dockerfile.web --build-arg NEXT_PUBLIC_SERVER_URL=https://api.example.com -t conductor-web .
```

## Environment

Production refuses the baked-in dev defaults (`env.ts` guards): a server/worker
booted with `NODE_ENV=production` and a dev secret (or `LLM_MODE=mock`) exits
immediately with a named error.

### server

| Var | Required in prod | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres |
| `REDIS_URL` | yes | Pub/sub relay source |
| `TEMPORAL_ADDRESS` | yes | gRPC host:port |
| `WEB_ORIGIN` | yes | CORS + Socket.IO origin (the dashboard URL) |
| `BETTER_AUTH_URL` | yes | The server's own public URL |
| `BETTER_AUTH_SECRET` | **yes — no dev default allowed** | `openssl rand -base64 32` |
| `PLATFORM_ENCRYPTION_KEY` | **yes — no dev default allowed** | base64 32 bytes; must equal the worker's |
| `GOOGLE_CLIENT_ID/SECRET` | optional | Google OAuth on when both set |
| `SERVER_PORT` / `HOST` / `LOG_LEVEL` / `TEMPORAL_NAMESPACE` / `TEMPORAL_TASK_QUEUE` | defaulted | |

### worker

| Var | Required in prod | Notes |
| --- | --- | --- |
| `DATABASE_URL`, `REDIS_URL`, `TEMPORAL_ADDRESS` | yes | |
| `PLATFORM_ENCRYPTION_KEY` | **yes — no dev default allowed** | must equal the server's |
| `LLM_MODE` | must be `live` (default) | `mock` refuses to boot in prod |
| `RESEARCH_MODEL` / `WRITING_MODEL` / `WORKER_HEALTH_PORT` / `TEMPORAL_*` | defaulted | |
| `PUBLISH_WEBHOOK_URL` | optional | |

### web

`NEXT_PUBLIC_SERVER_URL` at **build** time only; `PORT`/`HOSTNAME` at runtime
(defaulted 3000/0.0.0.0).

## Release order

1. **Migrate** (from the server image, against the production `DATABASE_URL`):
   `pnpm --filter @conductor/server migrate` — drizzle migrations are
   immutable, additive files; safe to re-run (no-op when current).
2. Roll **server** and **worker** (order between them doesn't matter; Temporal
   re-dispatches anything in flight — that's the product).
3. Roll **web** (built against the already-live API URL).

## Health

| Surface | Endpoint | Meaning |
| --- | --- | --- |
| server liveness | `GET :4000/health` | process up |
| server readiness | `GET :4000/ready` | Postgres + Redis + Temporal reachable |
| worker liveness | `GET :4001/health` | process up |
| worker readiness | `GET :4001/ready` | Temporal worker RUNNING + Postgres answering (Redis deliberately excluded — publishes are best-effort) |

Wire platform checks to liveness; use readiness for rollout gating.

## Post-deploy smoke test

1. Sign up → create org → add the org's OpenRouter key → launch the Blog Post
   Pipeline from `/workflows` → approve → completed (the golden path).
2. **Kill the worker container mid-run and restart it** — the run completes,
   the retry is visible in the run's step history (success criterion #2; this
   is the sales demo working in production).

## Self-host / single-VPS reference

`infra/docker-compose.prod.yml` co-hosts everything (apps + Postgres + Redis +
Temporal). `cp infra/prod.env.example infra/prod.env`, fill secrets, then:

```sh
docker compose -f infra/docker-compose.prod.yml --env-file infra/prod.env up -d --build
docker compose -f infra/docker-compose.prod.yml --env-file infra/prod.env \
  run --rm server pnpm --filter @conductor/server migrate
```

The Temporal UI is behind `--profile ops`, bound to localhost — never expose
it publicly unauthenticated.

## CI

`.github/workflows/ci.yml`: root gate (build/typecheck/lint/test against real
Postgres/Redis/Temporal service containers) + the stack E2E (golden path +
invite). The pixel-snapshot spec stays operator-run (machine-specific
baseline).

## Host-specific (Unit 28b — pending the hosting decision)

To be completed once the target (Fly.io / Railway / Render / VPS) is chosen:

- [ ] Domain + TLS termination (reverse proxy → web :3000, server :4000; the
      server speaks WebSocket on `/ws` — proxy must allow upgrades)
- [ ] Managed vs co-hosted Postgres/Redis; Temporal self-hosted sizing
- [ ] Secret storage (platform secret manager vs env files)
- [ ] Release pipeline (registry, deploy trigger from CI on `main`)
- [ ] Backups (Postgres dumps; Temporal persistence is the same Postgres)
