import { describe, it, expect } from "vitest";
import {
  runStatusSchema,
  stepStatusSchema,
  stepKindSchema,
  approvalStatusSchema,
} from "@conductor/shared";
import {
  runStatusEnum,
  stepStatusEnum,
  stepKindEnum,
  approvalStatusEnum,
} from "./domain";

/**
 * The Postgres enum tuples are inlined in domain.ts (so drizzle-kit needs no
 * workspace-package resolution). This guard fails if they ever drift from the
 * shared Zod enums that are the cross-boundary source of truth.
 */
describe("domain enums match shared Zod options", () => {
  it("run_status", () => {
    expect(runStatusEnum.enumValues).toEqual(runStatusSchema.options);
  });
  it("step_status", () => {
    expect(stepStatusEnum.enumValues).toEqual(stepStatusSchema.options);
  });
  it("step_kind", () => {
    expect(stepKindEnum.enumValues).toEqual(stepKindSchema.options);
  });
  it("approval_status", () => {
    expect(approvalStatusEnum.enumValues).toEqual(approvalStatusSchema.options);
  });
});
