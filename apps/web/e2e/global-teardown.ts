import { readFileSync, rmSync } from "node:fs";
import { WORKER_PID_FILE } from "./global-setup";

/** Kills the E2E worker's whole process group (see global-setup). */
export default function globalTeardown(): void {
  try {
    const pid = Number(readFileSync(WORKER_PID_FILE, "utf8"));
    if (Number.isInteger(pid) && pid > 0) process.kill(-pid, "SIGTERM");
  } catch {
    /* never started or already gone */
  }
  try {
    rmSync(WORKER_PID_FILE);
  } catch {
    /* already gone */
  }
}
