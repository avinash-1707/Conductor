import { spawn } from "node:child_process";
import { mkdirSync, openSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Spawns the Temporal worker for the golden-path E2E (Unit 23). The worker has
 * no HTTP surface yet (that arrives with the deploy unit), so it can't be a
 * Playwright webServer entry — it is started here in its own process group
 * (mock model, isolated task queue) and killed in global-teardown. No
 * readiness wait is needed: Temporal queues the run's tasks until the worker
 * registers (backpressure by design).
 */

// Playwright runs from apps/web (the config directory).
const WORKER_DIR = path.resolve(process.cwd(), "../worker");
const RESULTS_DIR = path.resolve(process.cwd(), "test-results");
export const WORKER_PID_FILE = path.join(RESULTS_DIR, "e2e-worker.pid");

export default function globalSetup(): void {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const log = openSync(path.join(RESULTS_DIR, "e2e-worker.log"), "w");
  const child = spawn("pnpm", ["start"], {
    cwd: WORKER_DIR,
    env: {
      ...process.env,
      LLM_MODE: "mock",
      TEMPORAL_TASK_QUEUE: "conductor-e2e",
    },
    stdio: ["ignore", log, log],
    detached: true,
  });
  child.unref();
  if (child.pid) writeFileSync(WORKER_PID_FILE, String(child.pid));
}
