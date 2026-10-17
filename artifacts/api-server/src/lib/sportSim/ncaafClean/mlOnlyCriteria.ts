/**
 * Locked moneyline + Coach CLV criteria — thresholds immutable here.
 * Spreads/S2 are out of scope for the ML-only harness (separate market gate).
 */

/** Engine ML — FINAL_EVAL acceptance (locked). */
export const ML_CRITERIA = {
  M1_minN: 200,
  M2_brierLt: 0.25,
  M3_maxDeltaVsMarket: 0.02,
  M4_maxAbsBias: 0.08,
} as const;

/** Coach pick CLV — locked C1–C6. */
export const CLV_CRITERIA = {
  C1_minN: 50,
  C2_meanClvMin: 0,
  C3_pctBeatCloseMin: 0.45,
  C4_minHomeSelections: 20,
  C4_minAwaySelections: 20,
} as const;

export const ML_ONLY_POLICY = {
  spreadsMarket: "BLOCKED_SEPARATE_GATE",
  totalsMarket: "BLOCKED_SEPARATE_GATE",
  altsMarket: "BLOCKED_SEPARATE_GATE",
  s2DoesNotAutoFailMl: true,
  /** P3: ML metrics clear must not unlock spreads/totals/ALTs. */
  noCrossMarketUnlock: true,
  tuningM3IsNotFinalPass: true,
  closesForbiddenInFeatures: true,
  finalEvalScoringRequiresExplicitFlag: true,
  /** Injury adjusts never attach to frozen M_base FINAL_EVAL. */
  injuryAdjustForbiddenOnFrozenMl: true,
  voice: "paused",
  ncaafGate: false,
} as const;

export type MlMetricInputs = {
  nMl: number;
  mlBrier: number | null;
  mktBrier: number | null;
  meanP: number | null;
  meanY: number | null;
};

export type MlCriterionResult = {
  id: "M1" | "M2" | "M3" | "M4";
  pass: boolean | null;
  detail: string;
  measured: number | null;
  threshold: number | string;
};

export function evaluateMlCriteria(input: MlMetricInputs): MlCriterionResult[] {
  const delta =
    input.mlBrier != null && input.mktBrier != null
      ? input.mlBrier - input.mktBrier
      : null;
  const bias =
    input.meanP != null && input.meanY != null
      ? input.meanP - input.meanY
      : null;

  return [
    {
      id: "M1",
      pass: input.nMl >= ML_CRITERIA.M1_minN,
      detail: `nMl=${input.nMl}`,
      measured: input.nMl,
      threshold: ML_CRITERIA.M1_minN,
    },
    {
      id: "M2",
      pass: input.mlBrier != null ? input.mlBrier < ML_CRITERIA.M2_brierLt : null,
      detail: `mlBrier=${input.mlBrier}`,
      measured: input.mlBrier,
      threshold: ML_CRITERIA.M2_brierLt,
    },
    {
      id: "M3",
      pass:
        delta != null ? delta <= ML_CRITERIA.M3_maxDeltaVsMarket : null,
      detail: `deltaVsMarket=${delta}`,
      measured: delta,
      threshold: `<= market + ${ML_CRITERIA.M3_maxDeltaVsMarket}`,
    },
    {
      id: "M4",
      pass:
        bias != null ? Math.abs(bias) <= ML_CRITERIA.M4_maxAbsBias : null,
      detail: `bias=${bias}`,
      measured: bias,
      threshold: ML_CRITERIA.M4_maxAbsBias,
    },
  ];
}

export type ClvMetricInputs = {
  available: boolean;
  nMlWithClv: number | null;
  meanClvProbPoints: number | null;
  pctSelectionsBeatClose: number | null;
  homeSelections: number | null;
  awaySelections: number | null;
  softGatesOk: boolean | null;
  earlyCachePicks: number | null;
  note?: string;
};

export type ClvCriterionResult = {
  id: "C1" | "C2" | "C3" | "C4" | "C5" | "C6";
  pass: boolean | null;
  detail: string;
  evidenceClass: "missing" | "failed" | "passed" | "unscored";
};

export function evaluateClvCriteria(input: ClvMetricInputs): ClvCriterionResult[] {
  if (!input.available) {
    return (["C1", "C2", "C3", "C4", "C5", "C6"] as const).map((id) => ({
      id,
      pass: null,
      detail: input.note ?? "CLV evidence missing for clean E1 (no early two-sided cache)",
      evidenceClass: "missing" as const,
    }));
  }

  const c1 =
    input.nMlWithClv != null
      ? input.nMlWithClv >= CLV_CRITERIA.C1_minN
      : null;
  const c2 =
    input.meanClvProbPoints != null
      ? input.meanClvProbPoints >= CLV_CRITERIA.C2_meanClvMin
      : null;
  const c3 =
    input.pctSelectionsBeatClose != null
      ? input.pctSelectionsBeatClose >= CLV_CRITERIA.C3_pctBeatCloseMin
      : null;
  const c4 =
    input.homeSelections != null && input.awaySelections != null
      ? input.homeSelections >= CLV_CRITERIA.C4_minHomeSelections &&
        input.awaySelections >= CLV_CRITERIA.C4_minAwaySelections
      : null;
  const c5 = input.softGatesOk;
  const allPrior =
    c1 === true && c2 === true && c3 === true && c4 === true && c5 === true;

  function cls(pass: boolean | null): "missing" | "failed" | "passed" | "unscored" {
    if (pass === true) return "passed";
    if (pass === false) return "failed";
    return "unscored";
  }

  return [
    {
      id: "C1",
      pass: c1,
      detail: `nMlWithClv=${input.nMlWithClv}`,
      evidenceClass: cls(c1),
    },
    {
      id: "C2",
      pass: c2,
      detail: `meanClv=${input.meanClvProbPoints}`,
      evidenceClass: cls(c2),
    },
    {
      id: "C3",
      pass: c3,
      detail: `pctBeatClose=${input.pctSelectionsBeatClose}`,
      evidenceClass: cls(c3),
    },
    {
      id: "C4",
      pass: c4,
      detail: `home=${input.homeSelections} away=${input.awaySelections}`,
      evidenceClass: cls(c4),
    },
    {
      id: "C5",
      pass: c5,
      detail: `softGatesOk=${input.softGatesOk}`,
      evidenceClass: cls(c5),
    },
    {
      id: "C6",
      pass: allPrior,
      detail: allPrior
        ? "E2b_coachPickClv=PASS eligible"
        : "COMPUTED_NO_PASS_LABEL — prior C1–C5 not all true",
      evidenceClass: allPrior ? "passed" : "failed",
    },
  ];
}

/**
 * FINAL_EVAL acceptance label — only when split is FINAL_EVAL and all M + CLV + policy hold.
 * TUNING screens must never return finalPass=true.
 */
export function finalMlAcceptanceLabel(opts: {
  split: "TUNING" | "FINAL_EVAL";
  allowFinalEvalScoring: boolean;
  ml: MlCriterionResult[];
  clv: ClvCriterionResult[];
  e4InjuryValidated: boolean;
}): {
  finalPass: false;
  reason: string;
  mlAllPass: boolean | null;
  clvAllPass: boolean | null;
} {
  if (opts.split === "TUNING") {
    return {
      finalPass: false,
      reason: "TUNING screen cannot issue FINAL_EVAL PASS (locked policy)",
      mlAllPass: opts.ml.every((c) => c.pass === true),
      clvAllPass: null,
    };
  }
  if (!opts.allowFinalEvalScoring) {
    return {
      finalPass: false,
      reason: "FINAL_EVAL scoring not authorized (allowFinalEvalScoring=false)",
      mlAllPass: null,
      clvAllPass: null,
    };
  }
  const mlAll = opts.ml.every((c) => c.pass === true);
  const clvAll = opts.clv.every((c) => c.pass === true);
  // Even if all true, this helper still returns finalPass false until human E6 —
  // automatic PASS label is never emitted by the harness.
  return {
    finalPass: false,
    reason:
      mlAll && clvAll && opts.e4InjuryValidated
        ? "Metrics clear on paper — still requires human E6; harness never auto-passes"
        : `Unmet: mlAll=${mlAll} clvAll=${clvAll} e4=${opts.e4InjuryValidated}`,
    mlAllPass: mlAll,
    clvAllPass: clvAll,
  };
}
