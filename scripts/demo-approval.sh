#!/usr/bin/env bash
#
# Approval demo — pause/resume through the real product API (success
# criterion #3 / sales asset #2).
#
# Drives the public surface end-to-end: sign up a fresh demo user, create an
# org, store its OpenRouter key, start a run, watch it suspend at the approval
# gate, approve it, and measure how fast the Writing step starts (the <=2s
# guarantee). Self-contained: no CONDUCTOR_ORG_ID, no worker scripts — the only
# secret is OPENROUTER_API_KEY, which becomes the demo org's key and is never
# echoed.
#
# Prereqs: infra up (docker compose -f infra/docker-compose.yml up -d),
# dependencies installed (pnpm install), migrations applied. A server already
# answering /health at SERVER_URL is reused; otherwise one is started. A worker
# is always started (extra workers on the task queue are harmless).
#
# Usage:
#   OPENROUTER_API_KEY=sk-or-... ./scripts/demo-approval.sh
#
# Tunables: SERVER_URL, TEMPORAL_UI, TOPIC, KEYWORDS (comma-separated), TONE,
# WORD_COUNT, APPROVE_DELAY, SUSPEND_TIMEOUT, COMPLETE_TIMEOUT.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SERVER_URL="${SERVER_URL:-http://localhost:4000}"
TEMPORAL_UI="${TEMPORAL_UI:-http://localhost:8080}"
TOPIC="${TOPIC:-Why human approval gates belong in AI content pipelines}"
KEYWORDS="${KEYWORDS:-ai workflows,human in the loop,content operations}"
TONE="${TONE:-professional}"
WORD_COUNT="${WORD_COUNT:-900}"
APPROVE_DELAY="${APPROVE_DELAY:-6}"        # camera time on the suspended gate
SUSPEND_TIMEOUT="${SUSPEND_TIMEOUT:-300}"  # research is a real LLM call
COMPLETE_TIMEOUT="${COMPLETE_TIMEOUT:-300}"

BODY_FILE="$(mktemp /tmp/conductor-demo-body.XXXXXX)"
HDRS_FILE="$(mktemp /tmp/conductor-demo-headers.XXXXXX)"

log()  { printf '\n\033[1;35m[demo]\033[0m %s\n' "$*"; }
note() { printf '       %s\n' "$*"; }

# --- preflight ----------------------------------------------------------------
command -v curl >/dev/null 2>&1 || { echo "curl is required"; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq is required"; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "pnpm is required"; exit 1; }
: "${OPENROUTER_API_KEY:?Set OPENROUTER_API_KEY — it becomes the demo org key via PUT /orgs/api-key (never printed)}"

# --- api helper ----------------------------------------------------------------
# api METHOD PATH [JSON_BODY] [BEARER_TOKEN] — prints the response body on 2xx,
# prints the typed error body and fails otherwise.
api() {
  local method="$1" path="$2" body="${3:-}" token="${4:-}" code
  local -a args=(-sS -o "$BODY_FILE" -w '%{http_code}' -X "$method" \
    "${SERVER_URL}${path}" -H 'content-type: application/json')
  [ -n "$token" ] && args+=(-H "authorization: Bearer ${token}")
  [ -n "$body" ] && args+=(-d "$body")
  code="$(curl "${args[@]}")"
  if [ "${code:0:1}" != "2" ]; then
    echo "API ${method} ${path} failed (${code}): $(cat "$BODY_FILE")" >&2
    return 1
  fi
  cat "$BODY_FILE"
}

# --- boot ----------------------------------------------------------------------
SERVER_PID=""
WORKER_PID=""
cleanup() {
  [ -n "$WORKER_PID" ] && kill "$WORKER_PID" 2>/dev/null || true
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
  rm -f "$BODY_FILE" "$HDRS_FILE"
}
trap cleanup EXIT

log "1/7 booting Conductor"
if curl -sf "${SERVER_URL}/health" >/dev/null 2>&1; then
  note "server already running at ${SERVER_URL} — reusing it"
else
  pnpm --filter @conductor/server start >/tmp/conductor-demo-server.log 2>&1 &
  SERVER_PID=$!
  note "server started (pid ${SERVER_PID}) — logs: /tmp/conductor-demo-server.log"
fi
pnpm --filter @conductor/worker start >/tmp/conductor-demo-worker.log 2>&1 &
WORKER_PID=$!
note "worker started (pid ${WORKER_PID}) — logs: /tmp/conductor-demo-worker.log"

waited=0
until curl -sf "${SERVER_URL}/ready" >/dev/null 2>&1; do
  sleep 1
  waited=$((waited + 1))
  if [ "$waited" -ge 60 ]; then
    echo "server never became ready at ${SERVER_URL}/ready — is infra up?" >&2
    echo "  docker compose -f infra/docker-compose.yml up -d" >&2
    exit 1
  fi
done
note "server ready (Postgres + Redis + Temporal reachable)"

# --- provision: user, org, key --------------------------------------------------
log "2/7 provisioning a fresh demo org through the API"
demo_nonce="$(date +%s)-${RANDOM}"
email="demo-${demo_nonce}@conductor.demo"
signup_code="$(curl -sS -D "$HDRS_FILE" -o "$BODY_FILE" -w '%{http_code}' \
  -X POST "${SERVER_URL}/api/auth/sign-up/email" \
  -H 'content-type: application/json' \
  -d "$(jq -nc --arg e "$email" '{email:$e, password:"Demo-pass-123456", name:"Demo Operator"}')")"
if [ "${signup_code:0:1}" != "2" ]; then
  echo "sign-up failed (${signup_code}): $(cat "$BODY_FILE")" >&2
  exit 1
fi
SESSION_TOKEN="$(awk -F': ' 'tolower($1)=="set-auth-token" {print $2}' "$HDRS_FILE" | tr -d '\r')"
[ -n "$SESSION_TOKEN" ] || SESSION_TOKEN="$(jq -r '.token // empty' "$BODY_FILE")"
[ -n "$SESSION_TOKEN" ] || { echo "sign-up returned no session token" >&2; exit 1; }
USER_ID="$(jq -r '.user.id' "$BODY_FILE")"
note "signed up ${email}"

org="$(api POST /api/auth/organization/create \
  "$(jq -nc --arg slug "demo-${demo_nonce}" '{name:"Demo Agency", slug:$slug}')" \
  "$SESSION_TOKEN")"
ORG_ID="$(jq -r '.id' <<<"$org")"
api POST /api/auth/organization/set-active \
  "$(jq -nc --arg id "$ORG_ID" '{organizationId:$id}')" "$SESSION_TOKEN" >/dev/null
JWT="$(api GET /api/auth/token '' "$SESSION_TOKEN" | jq -r '.token')"
note "org ${ORG_ID} created and active"

key_status="$(api PUT /orgs/api-key \
  "$(jq -nc --arg k "$OPENROUTER_API_KEY" '{apiKey:$k}')" "$JWT")"
note "OpenRouter key stored (…$(jq -r '.last4' <<<"$key_status")) — encrypted at rest, never returned"

# --- start the run ---------------------------------------------------------------
log "3/7 starting a Blog Post Pipeline run: '${TOPIC}'"
keywords_json="$(jq -nc --arg k "$KEYWORDS" \
  '$k | split(",") | map(gsub("^\\s+|\\s+$"; "")) | map(select(length > 0))')"
run="$(api POST /runs "$(jq -nc \
  --arg topic "$TOPIC" --argjson keywords "$keywords_json" --arg tone "$TONE" \
  --argjson wc "$WORD_COUNT" --arg approver "$USER_ID" \
  '{topic:$topic, keywords:$keywords, tone:$tone, wordCount:$wc, approverId:$approver}')" \
  "$JWT")"
RUN_ID="$(jq -r '.id' <<<"$run")"
WORKFLOW_ID="$(jq -r '.temporalWorkflowId' <<<"$run")"
note "run ${RUN_ID} started (workflow ${WORKFLOW_ID})"

run_status() { api GET "/runs/${RUN_ID}" '' "$JWT" | jq -r '.run.status'; }

# wait_for_run_status TARGET TIMEOUT_SECONDS
wait_for_run_status() {
  local target="$1" timeout="$2" waited=0 status
  while true; do
    status="$(run_status)"
    [ "$status" = "$target" ] && return 0
    case "$status" in
      failed|rejected|expired)
        echo "run ended '${status}' while waiting for '${target}' — see GET /runs/${RUN_ID} and /tmp/conductor-demo-worker.log" >&2
        return 1
        ;;
    esac
    sleep 2
    waited=$((waited + 2))
    if [ "$waited" -ge "$timeout" ]; then
      echo "timed out after ${timeout}s waiting for '${target}' (last status: ${status})" >&2
      return 1
    fi
  done
}

# --- suspend at the gate ----------------------------------------------------------
log "4/7 research running — waiting for the run to suspend at the approval gate"
wait_for_run_status suspended "$SUSPEND_TIMEOUT"
note "run is SUSPENDED — no worker slot held, no polling: the workflow waits on a signal"

approval="$(api GET '/approvals?limit=100' '' "$JWT" \
  | jq -c --arg run "$RUN_ID" '.items[] | select(.runId == $run)')"
[ -n "$approval" ] || { echo "no pending approval found for run ${RUN_ID}" >&2; exit 1; }
APPROVAL_ID="$(jq -r '.id' <<<"$approval")"
echo
echo "----- what the reviewer sees (approval ${APPROVAL_ID}) -----"
jq -r '.context.research | "SUMMARY: \(.summary)\n\nKEY POINTS:\n" + (.keyPoints | map("  • " + .) | join("\n"))' <<<"$approval"
echo "------------------------------------------------------------"

# --- approve and measure the resume -----------------------------------------------
log "5/7 approving in ${APPROVE_DELAY}s (camera time on the suspended gate)…"
sleep "$APPROVE_DELAY"
t0="$(date +%s%3N)"
api POST "/approvals/${APPROVAL_ID}/approve" '' "$JWT" >/dev/null
note "decision delivered (signal sent to the suspended workflow)"

log "6/7 measuring decision → Writing-step resume latency"
while true; do
  write_status="$(api GET "/runs/${RUN_ID}" '' "$JWT" \
    | jq -r '[.steps[] | select(.stepKind == "write") | .status] | first // "absent"')"
  case "$write_status" in running|completed) break ;; esac
  if [ "$(($(date +%s%3N) - t0))" -gt 30000 ]; then
    echo "Writing step did not start within 30s of the approval" >&2
    exit 1
  fi
  sleep 0.2
done
elapsed_ms="$(($(date +%s%3N) - t0))"
note "Writing step ${write_status} $(awk "BEGIN { printf \"%.1f\", ${elapsed_ms}/1000 }")s after the Approve call (guarantee: ≤2s + LLM spin-up)"

# --- completion --------------------------------------------------------------------
log "7/7 waiting for the run to complete…"
wait_for_run_status completed "$COMPLETE_TIMEOUT"
final="$(api GET "/runs/${RUN_ID}" '' "$JWT")"
echo
jq -r '.run.output | "DELIVERED: \"\(.draft.title // "(untitled)")\" — \(.draft.wordCount // "?") words"' <<<"$final" 2>/dev/null || true
note "full audit trail: GET /runs/${RUN_ID} (steps, attempts, durations) + ${TEMPORAL_UI} → ${WORKFLOW_ID}"
log "DONE — suspended at the gate, resumed on Approve, completed. That's the product."
