/** Prop-pool load policy for greenfield Coach builds. */

/** Prefer skipping a second full prop fan-out when the pool is already loaded. */
export function shouldSkipScannerPropExpand(propPoolSize: number): boolean {
  return propPoolSize >= 40;
}
