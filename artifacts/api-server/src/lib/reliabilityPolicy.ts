/**
 * Pure reliability policy helpers (no DB / Redis imports — safe for node:test).
 */

/** Max summed occurrence_count updates in the trailing hour (shared via PG). */
export const RELIABILITY_HOURLY_OCCURRENCE_BUDGET = 500;

/**
 * Pure policy: never Telegram on store failure — shared dedupe is unavailable.
 */
export function allowTelegramWithoutSharedDedupe(): boolean {
  return false;
}

export function reliabilitySecurityModelSummary(env: NodeJS.ProcessEnv = process.env): {
  redisConfigured: boolean;
  ipRateLimitScope: "shared-redis" | "per-instance-memory";
  fingerprintDedupeScope: "postgresql";
  hourlyBudgetScope: "postgresql";
  multiInstanceSafeWithoutRedis: boolean;
} {
  const redisConfigured = !!(env.REDIS_URL && String(env.REDIS_URL).trim());
  return {
    redisConfigured,
    ipRateLimitScope: redisConfigured ? "shared-redis" : "per-instance-memory",
    fingerprintDedupeScope: "postgresql",
    hourlyBudgetScope: "postgresql",
    // IP limits alone are not multi-instance safe without Redis; PG budget +
    // fingerprint dedupe still bound writes/alerts across instances.
    multiInstanceSafeWithoutRedis: false,
  };
}
