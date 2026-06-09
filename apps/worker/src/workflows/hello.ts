import { proxyActivities } from "@temporalio/workflow";
// Type-only import: activity implementations must never be bundled into the
// deterministic workflow sandbox (code-standards Temporal; invariant 1).
import type * as activities from "../activities";

// Explicit timeout + retry — no defaults (code-standards Temporal).
const { greet } = proxyActivities<typeof activities>({
  startToCloseTimeout: "10 seconds",
  retry: {
    initialInterval: "1 second",
    backoffCoefficient: 2,
    maximumInterval: "10 seconds",
    maximumAttempts: 5,
  },
});

export interface HelloWorkflowInput {
  name: string;
}

/**
 * Trivial durable workflow: delegates to the `greet` activity and returns its
 * greeting. Deterministic — holds no clocks, randomness, env, or I/O.
 */
export async function helloWorkflow(input: HelloWorkflowInput): Promise<string> {
  const { greeting } = await greet({ name: input.name });
  return greeting;
}
