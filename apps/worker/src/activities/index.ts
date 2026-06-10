// Activity registry — the object Worker.create({ activities }) registers.
// All side-effecting code lives under activities/ (architecture invariant 1).
export { greet } from "./hello";
export { research, writeDraft, publish } from "./content-pipeline";
export { createApprovalRequest } from "./approvals";
export { recordRunStarted, recordRunTerminal } from "./projections";
