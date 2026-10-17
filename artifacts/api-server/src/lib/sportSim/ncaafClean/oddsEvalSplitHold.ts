/**
 * Odds retrieval hold — FINAL_EVAL preserved for frozen spread/totals candidate;
 * TUNING only for development. Do not inspect FINAL_EVAL results to guide fixes.
 * ALTs deferred. No fetch authorized.
 */

export const ODDS_RETRIEVAL_HOLD = {
  status: "HELD" as const,
  fetchAuthorized: false,
  paidPurchaseAuthorized: false,
  altPullAuthorized: false,
  voice: "paused" as const,
  splits: {
    FINAL_EVAL: {
      role: "frozen_acceptance_only",
      preserveFor: "frozen spread/totals candidate (immutable once scored)",
      useForDevelopment: false,
      inspectResultsToGuideFixes: false,
      manifestPath:
        "test/fixtures/ncaaf-spreads-totals-alt-odds-manifest.json",
      note: "Manifest targets FINAL_EVAL membership — hold until explicit freeze+fetch authorization",
    },
    TUNING: {
      role: "development_and_screening_only",
      useForDevelopment: true,
      closesPresent: {
        spreads: true,
        totals: false,
        path: "test/fixtures/ncaaf-tuning-2025-w1-7-closing-lines.json",
      },
      note: "Develop ATS/rest-tilt against TUNING nested folds only; never retune thresholds against FINAL_EVAL",
    },
  },
  alts: {
    deferred: true,
    reason: "Full ALT cohort over 4200 credit cap; not authorized",
  },
} as const;
