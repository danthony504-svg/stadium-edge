/**
 * Coach QA public barrel — audit harness only.
 */
export * from "./types.ts";
export * from "./matrix.ts";
export * from "./parseSnapshot.ts";
export * from "./invariants.ts";
export * from "./fuzz.ts";
export * from "./fixtures.ts";
export * from "./pipelineAudit.ts";
export * from "./report.ts";
export { runCoachQaHarness, COACH_QA_SEED, screenshotSequenceAudit } from "./runCoachQa.ts";
