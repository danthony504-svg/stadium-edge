/** Simulator V2 engine identity — bump when contracts change incompatibly. */
export const SIM_V2_ENGINE_ID = "simulator-v2" as const;
export const SIM_V2_SCHEMA_VERSION = "sim.v2.1" as const;
export const SIM_V2_PACKAGE_VERSION = "0.2.0" as const;

/** Deep production draw count. Phase A fixtures may use this for contract tests. */
export const SIM_V2_DEEP_DRAWS = 10_000 as const;
export const SIM_V2_QUICK_DRAWS = 1_000 as const;
