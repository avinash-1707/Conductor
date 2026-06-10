// Activity registry — the object Worker.create({ activities }) registers.
// All side-effecting code lives under activities/ (architecture invariant 1).
export { greet } from "./hello";
export { research, requestApproval, writeDraft, publish } from "./content-pipeline";
export { recordRunStarted, recordRunTerminal } from "./projections";
