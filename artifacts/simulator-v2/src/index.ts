/**
 * @workspace/simulator-v2 — Phase A platform
 *
 * Isolated versioned simulation engine. No production sport models yet.
 * Shadow mode cannot influence Coach picks under default flags.
 */

export * from "./version.js";
export * from "./schemas/index.js";
export * from "./seed/mulberry32.js";
export * from "./validation/index.js";
export * from "./engine/fixtureTensor.js";
export * from "./engine/settle.js";
export * from "./engine/batchAlts.js";
export * from "./shadow/ledger.js";
export * from "./shadow/compare.js";
export * from "./shadow/isolation.js";
export * from "./metrics/calibration.js";
export * from "./metrics/coverage.js";
export * from "./metrics/latency.js";
export * from "./flags/featureFlags.js";
export * from "./flags/acceptanceGates.js";
