/**
 * Secure ScoreTape Explorer ($0) key setup — instructions only.
 * CFB coverage is NOT usable evidence until live CFB rows with captured_ms
 * are verified under a key. Never log or persist raw key values.
 */

export const SCORETAPE_EXPLORER_SETUP = {
  plan: "Explorer",
  costUsd: 0,
  historyDays: 7,
  rateLimit: "1 req/s",
  baseUrl: "https://api.scoretape.com/v1",
  envName: "SCORETAPE_API_KEY",
  keyPrefix: "st_",
  purchaseAuthorized: false,
  deskPurchaseAuthorized: false,
} as const;

/** Operator steps — human performs key mint; agent must not paste keys. */
export const SCORETAPE_SECURE_SETUP_STEPS = [
  "Open https://scoretape.com and request an Explorer ($0) API key (same-day email).",
  "Copy the st_… key once when shown — it is not re-displayed.",
  "Add Cursor Cloud / environment secret named SCORETAPE_API_KEY (or Render secret of the same name).",
  "Do not paste the key into chat, git, fixtures, logs, or PR descriptions.",
  "Start a new agent/run so the secret is injected into process.env.",
  "Verify with: node --import ./test/register-hooks.mjs ./scripts/ncaafScoreTapeCfbCoverageCheck.ts",
  "Treat CFB as usable evidence only when the check reports cfbUsableEvidence=true.",
  "Do not purchase Desk/Quant until CFB captured_ms as-of ≤ kickoff is proven on Explorer.",
] as const;

export type CfbCoverageVerdict = {
  checkedAt: string;
  keyConfigured: boolean;
  /** True only when CFB injury rows with finite captured_ms/captured were observed. */
  cfbUsableEvidence: boolean;
  httpStatus: number | null;
  rowCount: number;
  rowsWithTimestamp: number;
  earliestCapturedIso: string | null;
  latestCapturedIso: string | null;
  sampleAthleteFields: string[];
  blockers: string[];
  secureSetup: typeof SCORETAPE_SECURE_SETUP_STEPS;
};

export function scoreTapeKeyConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.SCORETAPE_API_KEY ?? "").trim();
  return v.length > 0 && !v.includes(" ");
}

/** Redacted presence check — never returns the key. */
export function scoreTapeKeyPresence(env: NodeJS.ProcessEnv = process.env): "SET" | "UNSET" {
  return scoreTapeKeyConfigured(env) ? "SET" : "UNSET";
}

export function buildCfbCoverageBlockedReport(opts: {
  keyConfigured: boolean;
  httpStatus?: number | null;
  message?: string;
}): CfbCoverageVerdict {
  const blockers: string[] = [];
  if (!opts.keyConfigured) {
    blockers.push("SCORETAPE_API_KEY unset — cannot query /v1/cfb/injuries");
  }
  if (opts.httpStatus === 401 || opts.httpStatus === 403) {
    blockers.push(`API rejected key (HTTP ${opts.httpStatus})`);
  }
  if (opts.message) blockers.push(opts.message);
  blockers.push(
    "Do not treat ScoreTape as usable E4 historical evidence until cfbUsableEvidence=true",
  );
  return {
    checkedAt: new Date().toISOString(),
    keyConfigured: opts.keyConfigured,
    cfbUsableEvidence: false,
    httpStatus: opts.httpStatus ?? null,
    rowCount: 0,
    rowsWithTimestamp: 0,
    earliestCapturedIso: null,
    latestCapturedIso: null,
    sampleAthleteFields: [],
    blockers,
    secureSetup: SCORETAPE_SECURE_SETUP_STEPS,
  };
}

export function evaluateCfbInjuryRows(rows: Array<Record<string, unknown>>): {
  rowsWithTimestamp: number;
  earliestCapturedIso: string | null;
  latestCapturedIso: string | null;
  sampleAthleteFields: string[];
  cfbUsableEvidence: boolean;
} {
  const stamps: number[] = [];
  for (const row of rows) {
    const ms = row.captured_ms;
    const captured = row.captured;
    if (typeof ms === "number" && Number.isFinite(ms) && ms > 0) {
      stamps.push(ms);
    } else if (typeof captured === "string" && Number.isFinite(Date.parse(captured))) {
      stamps.push(Date.parse(captured));
    }
  }
  stamps.sort((a, b) => a - b);
  const fields = rows[0] ? Object.keys(rows[0]).sort() : [];
  return {
    rowsWithTimestamp: stamps.length,
    earliestCapturedIso: stamps.length ? new Date(stamps[0]!).toISOString() : null,
    latestCapturedIso: stamps.length
      ? new Date(stamps[stamps.length - 1]!).toISOString()
      : null,
    sampleAthleteFields: fields,
    cfbUsableEvidence: stamps.length > 0,
  };
}
