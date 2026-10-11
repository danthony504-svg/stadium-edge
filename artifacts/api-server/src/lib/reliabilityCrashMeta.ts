/**
 * Pure helpers for crash-row metadata enrichment (no DB / Telegram imports).
 */

export function isBlankReliabilityMeta(
  value: string | null | undefined,
): boolean {
  if (value == null) return true;
  const t = String(value).trim();
  return t === "" || t === "—" || t === "-" || t === "unknown" || t === "…";
}

export type CrashMetaFields = {
  updateId: string | null | undefined;
  runtimeVersion: string | null | undefined;
  channel: string | null | undefined;
  appVersion: string | null | undefined;
  bundleSource: string | null | undefined;
  componentStack: string | null | undefined;
};

export type CrashMetaPatch = Partial<{
  updateId: string;
  runtimeVersion: string;
  channel: string;
  appVersion: string;
  bundleSource: string;
  componentStack: string;
}>;

/**
 * Fill only blank existing fields from a richer incoming event.
 * Never overwrites a real updateId/runtime/channel/app with placeholders.
 */
export function mergeCrashMetadata(
  existing: CrashMetaFields,
  incoming: CrashMetaFields,
): { patch: CrashMetaPatch; enriched: boolean } {
  const patch: CrashMetaPatch = {};
  const keys = [
    "updateId",
    "runtimeVersion",
    "channel",
    "appVersion",
    "bundleSource",
    "componentStack",
  ] as const;

  for (const key of keys) {
    const prev = existing[key];
    const next = incoming[key];
    if (isBlankReliabilityMeta(prev) && !isBlankReliabilityMeta(next)) {
      patch[key] = String(next).trim();
    }
  }

  return { patch, enriched: Object.keys(patch).length > 0 };
}

/**
 * Defense-in-depth: known unit-test fixture payloads that must never page Telegram
 * or pollute production reliability_events if a test harness leaks a POST.
 */
export function isKnownCrashTestFixture(
  errorMessage: string,
  errorStack: string,
): boolean {
  const msg = (errorMessage || "").trim();
  const stack = (errorStack || "").trim();
  if (msg === "startup-render-fail" && stack === "Error: startup-render-fail") {
    return true;
  }
  if (msg === "boom-test-unique") return true;
  return false;
}
