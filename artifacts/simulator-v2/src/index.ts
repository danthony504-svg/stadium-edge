/**
 * @workspace/simulator-v2 — Phase B platform
 *
 * Isolated versioned simulation engine.
 * Phase B adds joint NFL/NCAAF football model (shadow-only under default flags).
 * Production Coach picks remain on V1 until acceptance gates + explicit serve flags.
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
export * from "./models/index.js";
