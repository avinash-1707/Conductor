#!/usr/bin/env bash
#
# Reliability demo — kill the worker mid-Research, restart it, watch the run
# recover and complete (success criterion #2 / sales asset #1).
#
# Prereqs: infra up (docker compose -f infra/docker-compose.yml up -d),
# dependencies installed (pnpm install), migrations applied, and an org with an
# OpenRouter API key configured (Unit 12: runs execute on the org's decrypted
# key — sign up on the server, create an org, PUT /orgs/api-key). Export the
# org id as CONDUCTOR_ORG_ID. Tunable: TOPIC, KILL_DELAY, RESTART_DELAY.
#
# Usage:
#   CONDUCTOR_ORG_ID=org_... ./scripts/demo-reliability.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TOPIC="${TOPIC:-How durable workflows prevent lost AI runs}"
KILL_DELAY="${KILL_DELAY:-4}"      # seconds to let research run before the crash
RESTART_DELAY="${RESTART_DELAY:-3}" # seconds the worker stays down
APPROVE_DELAY="${APPROVE_DELAY:-8}" # seconds after restart before approving the gate
TEMPORAL_ADDRESS="${TEMPORAL_ADDRESS:-localhost:7233}"
TEMPORAL_UI="${TEMPORAL_UI:-http://localhost:8080}"

# workflow id mirrors scripts/run-content-pipeline.ts: content-<slugged topic, 60 chars>
slug="$(printf '%s' "$TOPIC" | tr '[:upper:]' '[:lower:]' | tr -s ' ' '-')"
WORKFLOW_ID="content-${slug:0:60}"

log() { printf '\n\033[1;35m[demo]\033[0m %s\n' "$*"; }

# --- preflight ---------------------------------------------------------------
command -v pnpm >/dev/null 2>&1 || { echo "pnpm is required"; exit 1; }
: "${CONDUCTOR_ORG_ID:?Set CONDUCTOR_ORG_ID to an org with an OpenRouter key configured (runs execute on the org key since Unit 12)}"
host="${TEMPORAL_ADDRESS%:*}"; port="${TEMPORAL_ADDRESS##*:}"
if ! (exec 3<>"/dev/tcp/${host}/${port}") 2>/dev/null; then
  echo "Temporal not reachable at ${TEMPORAL_ADDRESS}."
  echo "Start infra first: docker compose -f infra/docker-compose.yml up -d"
  exit 1
fi
exec 3>&- 3<&- || true

WORKER_PID=""
start_worker() {
  pnpm --filter @conductor/worker start >/tmp/conductor-worker.log 2>&1 &
  WORKER_PID=$!
  log "worker started (pid ${WORKER_PID}) — logs: /tmp/conductor-worker.log"
}
cleanup() { [ -n "$WORKER_PID" ] && kill "$WORKER_PID" 2>/dev/null || true; }
trap cleanup EXIT

# --- demo --------------------------------------------------------------------
log "1/6 starting worker"
start_worker
sleep 3

log "2/6 starting run '${TOPIC}' (workflowId=${WORKFLOW_ID})"
pnpm --filter @conductor/worker run-pipeline "$TOPIC" >/tmp/conductor-run.log 2>&1 &
RUN_PID=$!

log "3/6 research in flight — hard-killing the worker (SIGKILL) in ${KILL_DELAY}s to simulate a crash"
sleep "$KILL_DELAY"
kill -9 "$WORKER_PID" 2>/dev/null || true
WORKER_PID=""
log "    worker KILLED mid-run. The run is still alive in Temporal: ${TEMPORAL_UI}"

sleep "$RESTART_DELAY"
log "4/6 restarting worker — Temporal re-dispatches the interrupted research activity"
start_worker

log "5/6 letting the run reach the approval gate, then approving (${APPROVE_DELAY}s)"
sleep "$APPROVE_DELAY"
pnpm --filter @conductor/worker signal-approval "$WORKFLOW_ID" approved || true

log "6/6 waiting for the run to finish…"
wait "$RUN_PID" || true

log "DONE — open ${TEMPORAL_UI} → workflow ${WORKFLOW_ID} to see the research activity's retry/attempts."
echo "----- last lines of /tmp/conductor-run.log -----"
tail -n 20 /tmp/conductor-run.log || true
