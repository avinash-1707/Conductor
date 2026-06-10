import { Client, type Connection } from "@temporalio/client";
import {
  SIGNALS,
  TASK_QUEUE,
  type ApprovalSignalPayload,
  type ContentPipelineInput,
} from "@conductor/shared";

/**
 * The server's narrow seam to Temporal (architecture Execution Model: the
 * server owns the Temporal *client* — start workflows, send signals — never
 * execution). Routes depend on this interface so inject tests run with a mock
 * and no Temporal server; `server.ts` wires the real client over the shared
 * gRPC connection from deps.ts.
 */
export interface RunGateway {
  startContentPipeline(args: {
    workflowId: string;
    input: ContentPipelineInput;
  }): Promise<{ temporalRunId: string }>;
  /** Fires the approvalDecision signal at a suspended run (Unit 14). */
  signalApprovalDecision(args: {
    temporalWorkflowId: string;
    payload: ApprovalSignalPayload;
  }): Promise<void>;
}

export function createRunGateway(
  getConnection: () => Promise<Connection>,
  namespace: string,
  // The queue runs start on (Unit 23: env-overridable so E2E runs isolated).
  taskQueue: string = TASK_QUEUE,
): RunGateway {
  let client: Client | undefined;
  async function getClient(): Promise<Client> {
    if (!client) {
      client = new Client({ connection: await getConnection(), namespace });
    }
    return client;
  }

  return {
    async startContentPipeline({ workflowId, input }) {
      const c = await getClient();
      // Workflow type by name — the server never imports worker code (apps
      // never import from each other); the name is pinned by the worker's
      // exported workflow function.
      const handle = await c.workflow.start("contentPipeline", {
        taskQueue,
        workflowId,
        args: [input],
      });
      return { temporalRunId: handle.firstExecutionRunId };
    },

    async signalApprovalDecision({ temporalWorkflowId, payload }) {
      const c = await getClient();
      await c.workflow
        .getHandle(temporalWorkflowId)
        .signal(SIGNALS.APPROVAL_DECISION, payload);
    },
  };
}
