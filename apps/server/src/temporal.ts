import { Client, type Connection } from "@temporalio/client";
import { TASK_QUEUE, type ContentPipelineInput } from "@conductor/shared";

/**
 * The server's narrow seam to Temporal (architecture Execution Model: the
 * server owns the Temporal *client* — start workflows, send signals — never
 * execution). Routes depend on this interface so inject tests run with a mock
 * and no Temporal server; `server.ts` wires the real client over the shared
 * gRPC connection from deps.ts.
 */
export interface RunStarter {
  startContentPipeline(args: {
    workflowId: string;
    input: ContentPipelineInput;
  }): Promise<{ temporalRunId: string }>;
}

export function createRunStarter(
  getConnection: () => Promise<Connection>,
  namespace: string,
): RunStarter {
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
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [input],
      });
      return { temporalRunId: handle.firstExecutionRunId };
    },
  };
}
