// Workflow bundle entry — Worker.create({ workflowsPath }) points here.
// Deterministic code only (architecture invariant 1).
export { helloWorkflow } from "./hello";
export type { HelloWorkflowInput } from "./hello";
// The hardcoded contentPipeline was retired in Unit 26 — every run (template
// launch or resume) executes via the interpreter (one engine, two surfaces).
export {
  interpreterWorkflow,
  interpreterApprovalSignal,
  interpreterRunStateQuery,
} from "./interpreter";
