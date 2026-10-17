/**
 * Locked per-market acceptance criteria (spreads / totals / ALTs).
 * Thresholds immutable — do not edit after seeing results.
 * Independent of ML_CRITERIA; S2 failure never auto-fails ML.
 */

import type { NcaafMarketFamily } from "./marketGates.ts";

/** Spreads / ATS — FINAL_EVAL acceptance (locked). */
export const SPREAD_CRITERIA = {
  S1_minN: 200,
  S2_brierLt: 0.25,
  S3_settlementClearedRequired: true,
  /** When close ATS juice present, report vs market; else coin-only + MISSING_DATA. */
  S4_requireMarketAtsWhenJuicePresent: true,
} as const;

/** Totals — require closing totals archive. */
export const TOTALS_CRITERIA = {
  T1_requireCloseTotalArchive: true,
  T2_minN: 200,
  T3_brierLt: 0.25,
} as const;

/** ALTs — require posted ALT prices. */
export const ALT_CRITERIA = {
  A1_requirePostedAltPrices: true,
  A2_minN: 100,
} as const;

export const MARKET_GATE_POLICY = {
  /** P3: no market enabled solely because another passes. */
  noCrossMarketUnlock: true,
  /** S2 does not auto-fail ML. */
  s2DoesNotAutoFailMl: true,
  /** Totals/ALTs missing data → INSUFFICIENT_DATA, not FAIL. */
  missingDataIsInsufficientNotFail: true,
  /** Never retune against frozen FINAL_EVAL or lower thresholds to pass. */
  finalEvalImmutable: true,
  voice: "paused",
} as const;

export type SpreadMetricInputs = {
  nAts: number;
  atsBrier: number | null;
  settlementCleared: boolean;
  marketAtsJuicePresent: boolean;
  atsBrierMarket: number | null;
};

export type SpreadCriterionResult = {
  id: "S1" | "S2" | "S3" | "S4";
  pass: boolean | null;
  detail: string;
  evidenceClass: "missing" | "failed" | "passed" | "unscored" | "insufficient";
};

export function evaluateSpreadCriteria(
  input: SpreadMetricInputs,
): SpreadCriterionResult[] {
  const s1 = input.nAts >= SPREAD_CRITERIA.S1_minN;
  const s2 =
    input.atsBrier != null
      ? input.atsBrier < SPREAD_CRITERIA.S2_brierLt
      : null;
  const s3 = SPREAD_CRITERIA.S3_settlementClearedRequired
    ? input.settlementCleared
    : true;

  let s4: boolean | null;
  let s4Class: SpreadCriterionResult["evidenceClass"];
  let s4Detail: string;
  if (!input.marketAtsJuicePresent) {
    s4 = null;
    s4Class = "insufficient";
    s4Detail = "MISSING_DATA — no close ATS juice; coin-only path";
  } else if (input.atsBrier != null && input.atsBrierMarket != null) {
    s4 = input.atsBrier <= input.atsBrierMarket + 0.02;
    s4Class = s4 ? "passed" : "failed";
    s4Detail = `atsBrier=${input.atsBrier} mkt=${input.atsBrierMarket}`;
  } else {
    s4 = null;
    s4Class = "unscored";
    s4Detail = "market juice present but briers incomplete";
  }

  function cls(
    pass: boolean | null,
  ): SpreadCriterionResult["evidenceClass"] {
    if (pass === true) return "passed";
    if (pass === false) return "failed";
    return "unscored";
  }

  return [
    {
      id: "S1",
      pass: s1,
      detail: `nAts=${input.nAts}`,
      evidenceClass: cls(s1),
    },
    {
      id: "S2",
      pass: s2,
      detail: `atsBrier=${input.atsBrier}`,
      evidenceClass: cls(s2),
    },
    {
      id: "S3",
      pass: s3,
      detail: `settlementCleared=${input.settlementCleared}`,
      evidenceClass: cls(s3),
    },
    {
      id: "S4",
      pass: s4,
      detail: s4Detail,
      evidenceClass: s4Class,
    },
  ];
}

export type TotalsMetricInputs = {
  closeTotalArchivePresent: boolean;
  nTotals: number;
  totalsBrier: number | null;
};

export type TotalsCriterionResult = {
  id: "T1" | "T2" | "T3";
  pass: boolean | null;
  detail: string;
  evidenceClass: "missing" | "failed" | "passed" | "unscored" | "insufficient";
};

export function evaluateTotalsCriteria(
  input: TotalsMetricInputs,
): TotalsCriterionResult[] {
  if (!input.closeTotalArchivePresent) {
    return [
      {
        id: "T1",
        pass: null,
        detail: "INSUFFICIENT_DATA — no closing totals archive",
        evidenceClass: "insufficient",
      },
      {
        id: "T2",
        pass: null,
        detail: "unscored — waiting on T1",
        evidenceClass: "insufficient",
      },
      {
        id: "T3",
        pass: null,
        detail: "unscored — waiting on T1",
        evidenceClass: "insufficient",
      },
    ];
  }
  const t2 = input.nTotals >= TOTALS_CRITERIA.T2_minN;
  const t3 =
    input.totalsBrier != null
      ? input.totalsBrier < TOTALS_CRITERIA.T3_brierLt
      : null;
  return [
    {
      id: "T1",
      pass: true,
      detail: "closeTotal archive present",
      evidenceClass: "passed",
    },
    {
      id: "T2",
      pass: t2,
      detail: `nTotals=${input.nTotals}`,
      evidenceClass: t2 ? "passed" : "failed",
    },
    {
      id: "T3",
      pass: t3,
      detail: `totalsBrier=${input.totalsBrier}`,
      evidenceClass:
        t3 === true ? "passed" : t3 === false ? "failed" : "unscored",
    },
  ];
}

export type AltMetricInputs = {
  postedAltPricesPresent: boolean;
  nAlts: number;
};

export type AltCriterionResult = {
  id: "A1" | "A2";
  pass: boolean | null;
  detail: string;
  evidenceClass: "missing" | "failed" | "passed" | "unscored" | "insufficient";
};

export function evaluateAltCriteria(
  input: AltMetricInputs,
): AltCriterionResult[] {
  if (!input.postedAltPricesPresent) {
    return [
      {
        id: "A1",
        pass: null,
        detail: "INSUFFICIENT_DATA — no posted ALT prices",
        evidenceClass: "insufficient",
      },
      {
        id: "A2",
        pass: null,
        detail: "unscored — waiting on A1",
        evidenceClass: "insufficient",
      },
    ];
  }
  const a2 = input.nAlts >= ALT_CRITERIA.A2_minN;
  return [
    {
      id: "A1",
      pass: true,
      detail: "posted ALT prices present",
      evidenceClass: "passed",
    },
    {
      id: "A2",
      pass: a2,
      detail: `nAlts=${input.nAlts}`,
      evidenceClass: a2 ? "passed" : "failed",
    },
  ];
}

/**
 * Product unlock label for one market — never auto-true from harness.
 * Cross-market: passing `otherMarkets` cannot set this market true.
 */
export function marketProductUnlockLabel(opts: {
  family: NcaafMarketFamily;
  criteriaAllPass: boolean;
  e4Resolved: boolean;
  humanE6: boolean;
  /** Other markets' pass bits — ignored by design (P3). */
  otherMarketsPass?: Partial<Record<NcaafMarketFamily, boolean>>;
}): {
  productUnlock: false;
  reason: string;
  criteriaAllPass: boolean;
} {
  void opts.otherMarketsPass; // P3: explicitly unused
  return {
    productUnlock: false,
    reason:
      opts.criteriaAllPass && opts.e4Resolved && opts.humanE6
        ? "Metrics clear on paper — harness never auto-unlocks; needs flag-only PR"
        : `Unmet: criteria=${opts.criteriaAllPass} e4=${opts.e4Resolved} e6=${opts.humanE6}`,
    criteriaAllPass: opts.criteriaAllPass,
  };
}
