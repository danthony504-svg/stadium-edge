/**
 * Offline / CI prop-simulation sanity audit.
 *
 * Pure, fixture-driven — never call from the live Coach request path.
 * Uses recorded simulation results, histories, and diagnostics only.
 * No network, DB, ESPN, Odds API, roster fetches, Monte Carlo, or history I/O.
 */

export type PropSimSanityStatus = "PASS" | "YELLOW" | "RED";

export type PropSimSanityFlag =
  | "wrong_stat_series"
  | "wrong_player_team_opponent"
  | "unit_mismatch"
  | "over_under_inversion"
  | "provider_line_mutation"
  | "period_fullgame_contamination"
  | "opportunity_applied_twice"
  | "efficiency_on_volume"
  | "extreme_multiplier"
  | "extreme_sim_vs_history"
  | "over_under_inconsistent";

export type PropSimSanityInput = {
  sport: string;
  athlete: string;
  athleteId?: string | null;
  team?: string | null;
  opponent?: string | null;
  providerMarket: string;
  normalizedMarket?: string | null;
  side: "Over" | "Under" | string;
  line: number;
  /** American odds / price as offered. */
  price?: number | null;
  /** Recorded provider line for mutation check (defaults to line). */
  providerLine?: number | null;
  histValues?: number[] | null;
  histMean?: number | null;
  recentMean?: number | null;
  venueSplit?: {
    home?: number | null;
    away?: number | null;
    isHome?: boolean | null;
    relevant?: number | null;
  } | null;
  histClearRate?: number | null;
  /** Projection mean before contextual / opportunity multipliers. */
  bareProjectionMean?: number | null;
  finalProjectionMean?: number | null;
  opportunityMultiplier?: number | null;
  efficiencyMultiplier?: number | null;
  combinedPreSimMultiplier?: number | null;
  simHitProbability?: number | null;
  impliedProbability?: number | null;
  edge?: number | null;
  sampleGames?: number | null;
  stdDev?: number | null;
  /** Optional paired opposite-side hit probability for OU consistency. */
  oppositeSideHitProbability?: number | null;
  /** Expected athlete/team/opponent anchors for identity checks. */
  expectedAthleteId?: string | null;
  expectedTeam?: string | null;
  expectedOpponent?: string | null;
  /** Expected stat family key when known (e.g. completions). */
  expectedStatKey?: string | null;
  resolvedStatKey?: string | null;
  /** True when period-suffixed market was graded with full-game history. */
  periodTaggedAsFullGame?: boolean | null;
  /** Explicit diagnostics from the sim pipeline when available. */
  diagnostics?: {
    opportunityAppliedCount?: number | null;
    efficiencyAppliedToVolume?: boolean | null;
    lineMutated?: boolean | null;
    sideInverted?: boolean | null;
    unitScale?: number | null;
  } | null;
};

export type PropSimSanityReport = {
  athlete: string;
  team: string | null;
  opponent: string | null;
  providerMarket: string;
  normalizedMarket: string | null;
  side: string;
  line: number;
  price: number | null;
  historicalMean: number | null;
  recentMean: number | null;
  relevantVenueSplit: number | null;
  historicalClearRate: number | null;
  bareProjectionMean: number | null;
  finalProjectionMean: number | null;
  opportunityMultiplier: number | null;
  efficiencyMultiplier: number | null;
  combinedPreSimMultiplier: number | null;
  simulatedHitProbability: number | null;
  impliedProbability: number | null;
  edge: number | null;
  flags: PropSimSanityFlag[];
  status: PropSimSanityStatus;
  reasons: string[];
};

const EXTREME_MULT_RED = 1.18;
const EXTREME_MULT_YELLOW = 1.12;
const EXTREME_SIM_RED = 0.9;
const EXTREME_SIM_YELLOW = 0.82;
/** Sim hit minus historical clear-rate — material unsupported gap. */
const HIST_CLEAR_GAP_RED = 0.2;
const HIST_CLEAR_GAP_YELLOW = 0.15;
const OU_SUM_LO = 0.85;
const OU_SUM_HI = 1.15;

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function mean(vals: number[]): number | null {
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function clearRate(vals: number[], line: number, side: string): number | null {
  if (!vals.length || !Number.isFinite(line)) return null;
  const over = side.toLowerCase().startsWith("u") ? false : true;
  let hits = 0;
  for (const v of vals) {
    if (over ? v > line : v < line) hits += 1;
  }
  return hits / vals.length;
}

function relevantVenue(
  split: PropSimSanityInput["venueSplit"],
): number | null {
  if (!split) return null;
  if (split.relevant != null && Number.isFinite(split.relevant)) return Number(split.relevant);
  if (split.isHome === true && split.home != null) return Number(split.home);
  if (split.isHome === false && split.away != null) return Number(split.away);
  return null;
}

function isPeriodMarket(market: string): boolean {
  return /_(q[1-4]|h[12]|p[123]|f5|i1)$/i.test(String(market ?? "").trim());
}

function inferCombinedMult(input: PropSimSanityInput): number | null {
  const explicit = num(input.combinedPreSimMultiplier);
  if (explicit != null) return explicit;
  const bare = num(input.bareProjectionMean);
  const final = num(input.finalProjectionMean);
  if (bare != null && bare > 0 && final != null) return final / bare;
  const opp = num(input.opportunityMultiplier) ?? 1;
  const eff = num(input.efficiencyMultiplier) ?? 1;
  if (input.opportunityMultiplier != null || input.efficiencyMultiplier != null) {
    return opp * eff;
  }
  return null;
}

function identityMismatch(input: PropSimSanityInput): boolean {
  if (
    input.expectedAthleteId &&
    input.athleteId &&
    String(input.expectedAthleteId) !== String(input.athleteId)
  ) {
    return true;
  }
  if (
    input.expectedTeam &&
    input.team &&
    !String(input.team).toLowerCase().includes(String(input.expectedTeam).toLowerCase()) &&
    !String(input.expectedTeam).toLowerCase().includes(String(input.team).toLowerCase())
  ) {
    return true;
  }
  if (
    input.expectedOpponent &&
    input.opponent &&
    !String(input.opponent).toLowerCase().includes(String(input.expectedOpponent).toLowerCase()) &&
    !String(input.expectedOpponent).toLowerCase().includes(String(input.opponent).toLowerCase())
  ) {
    return true;
  }
  return false;
}

/**
 * Audit one recorded prop simulation result.
 * Does not mutate simulation math and does not re-run Monte Carlo.
 */
export function auditPropSimResult(input: PropSimSanityInput): PropSimSanityReport {
  const flags = new Set<PropSimSanityFlag>();
  const reasons: string[] = [];

  const histVals = (input.histValues ?? []).filter((v) => Number.isFinite(v));
  const histMean = num(input.histMean) ?? mean(histVals);
  const recentMean = num(input.recentMean) ?? histMean;
  const histClear =
    num(input.histClearRate) ?? clearRate(histVals, input.line, String(input.side));
  const bare = num(input.bareProjectionMean) ?? histMean;
  const finalMean = num(input.finalProjectionMean);
  const combined = inferCombinedMult(input);
  const oppMult = num(input.opportunityMultiplier);
  const effMult = num(input.efficiencyMultiplier);
  const simHit = num(input.simHitProbability);
  const implied = num(input.impliedProbability);
  const edge =
    num(input.edge) ??
    (simHit != null && implied != null ? simHit - implied : null);
  const venue = relevantVenue(input.venueSplit);

  if (identityMismatch(input)) {
    flags.add("wrong_player_team_opponent");
    reasons.push("Athlete/team/opponent identity does not match expected anchors.");
  }

  if (
    input.expectedStatKey &&
    input.resolvedStatKey &&
    String(input.expectedStatKey) !== String(input.resolvedStatKey)
  ) {
    flags.add("wrong_stat_series");
    reasons.push(
      `Resolved stat key ${input.resolvedStatKey} ≠ expected ${input.expectedStatKey}.`,
    );
  }

  const unitScale = num(input.diagnostics?.unitScale);
  if (unitScale != null && (unitScale < 0.5 || unitScale > 2)) {
    flags.add("unit_mismatch");
    reasons.push(`Unit scale factor ${unitScale.toFixed(2)} is outside [0.5, 2].`);
  } else if (
    bare != null &&
    histMean != null &&
    histMean > 0 &&
    (bare / histMean < 0.4 || bare / histMean > 2.5)
  ) {
    flags.add("unit_mismatch");
    reasons.push(
      `Bare projection ${bare.toFixed(2)} diverges sharply from hist mean ${histMean.toFixed(2)}.`,
    );
  }

  if (input.diagnostics?.sideInverted === true) {
    flags.add("over_under_inversion");
    reasons.push("Diagnostics report Over/Under side inversion.");
  }

  const providerLine = num(input.providerLine) ?? num(input.line);
  if (
    input.diagnostics?.lineMutated === true ||
    (providerLine != null && Math.abs(providerLine - input.line) > 1e-9)
  ) {
    flags.add("provider_line_mutation");
    reasons.push("Provider line differs from the audited line.");
  }

  if (
    input.periodTaggedAsFullGame === true ||
    (isPeriodMarket(input.providerMarket) && histVals.length > 0)
  ) {
    // Period market with full-game-shaped history is contamination unless
    // periodTag filtering was applied (callers set periodTaggedAsFullGame=false).
    if (input.periodTaggedAsFullGame !== false) {
      flags.add("period_fullgame_contamination");
      reasons.push("Period market appears graded against full-game history.");
    }
  }

  const oppApplied = num(input.diagnostics?.opportunityAppliedCount);
  if (oppApplied != null && oppApplied >= 2) {
    flags.add("opportunity_applied_twice");
    reasons.push(`Opportunity multiplier applied ${oppApplied} times.`);
  } else if (
    oppMult != null &&
    combined != null &&
    bare != null &&
    finalMean != null &&
    bare > 0 &&
    Math.abs(combined - oppMult) > 0.02 &&
    Math.abs(finalMean / bare - oppMult * oppMult) < 0.03
  ) {
    flags.add("opportunity_applied_twice");
    reasons.push("Final/bare ratio matches opportunity² — likely double-applied.");
  }

  if (input.diagnostics?.efficiencyAppliedToVolume === true) {
    flags.add("efficiency_on_volume");
    reasons.push("Efficiency multiplier incorrectly applied to a volume market.");
  }

  if (combined != null) {
    if (combined >= EXTREME_MULT_RED || combined <= 1 / EXTREME_MULT_RED) {
      flags.add("extreme_multiplier");
      reasons.push(
        `Combined pre-sim multiplier ${combined.toFixed(3)} is extreme (≥${EXTREME_MULT_RED}× or ≤${(1 / EXTREME_MULT_RED).toFixed(3)}×).`,
      );
    } else if (
      combined >= EXTREME_MULT_YELLOW ||
      combined <= 1 / EXTREME_MULT_YELLOW
    ) {
      flags.add("extreme_multiplier");
      reasons.push(
        `Combined pre-sim multiplier ${combined.toFixed(3)} is elevated (≥${EXTREME_MULT_YELLOW}×).`,
      );
    }
  }

  if (simHit != null && histClear != null) {
    const gap = simHit - histClear;
    if (simHit >= EXTREME_SIM_RED && gap >= HIST_CLEAR_GAP_RED) {
      flags.add("extreme_sim_vs_history");
      reasons.push(
        `Sim hit ${(simHit * 100).toFixed(1)}% vs historical clear ${(histClear * 100).toFixed(1)}% (gap ${(gap * 100).toFixed(1)} pts).`,
      );
    } else if (simHit >= EXTREME_SIM_YELLOW && gap >= HIST_CLEAR_GAP_YELLOW) {
      flags.add("extreme_sim_vs_history");
      reasons.push(
        `Sim hit ${(simHit * 100).toFixed(1)}% materially above historical clear ${(histClear * 100).toFixed(1)}%.`,
      );
    }
  } else if (
    simHit != null &&
    simHit >= EXTREME_SIM_RED &&
    histVals.length > 0 &&
    histVals.length < 6
  ) {
    flags.add("extreme_sim_vs_history");
    reasons.push(
      `Sim hit ${(simHit * 100).toFixed(1)}% on thin sample (n=${histVals.length}) without matching historical support.`,
    );
  }

  const oppHit = num(input.oppositeSideHitProbability);
  if (simHit != null && oppHit != null) {
    const sum = simHit + oppHit;
    if (sum < OU_SUM_LO || sum > OU_SUM_HI) {
      flags.add("over_under_inconsistent");
      reasons.push(
        `Over+Under hit probabilities sum to ${sum.toFixed(3)} (expected ~1.0 ±0.15).`,
      );
    }
  }

  const status = statusFromFlags(flags, combined, simHit, histClear);
  if (!reasons.length && status === "PASS") {
    reasons.push("Identity, units, multipliers, and sim-vs-history checks within tolerance.");
  }

  return {
    athlete: input.athlete,
    team: input.team ?? null,
    opponent: input.opponent ?? null,
    providerMarket: input.providerMarket,
    normalizedMarket: input.normalizedMarket ?? null,
    side: String(input.side),
    line: input.line,
    price: num(input.price),
    historicalMean: histMean,
    recentMean,
    relevantVenueSplit: venue,
    historicalClearRate: histClear,
    bareProjectionMean: bare,
    finalProjectionMean: finalMean,
    opportunityMultiplier: oppMult,
    efficiencyMultiplier: effMult,
    combinedPreSimMultiplier: combined,
    simulatedHitProbability: simHit,
    impliedProbability: implied,
    edge,
    flags: [...flags],
    status,
    reasons,
  };
}

function statusFromFlags(
  flags: Set<PropSimSanityFlag>,
  combined: number | null,
  simHit: number | null,
  histClear: number | null,
): PropSimSanityStatus {
  const redHard: PropSimSanityFlag[] = [
    "wrong_stat_series",
    "wrong_player_team_opponent",
    "unit_mismatch",
    "over_under_inversion",
    "provider_line_mutation",
    "period_fullgame_contamination",
    "opportunity_applied_twice",
    "efficiency_on_volume",
    "over_under_inconsistent",
  ];
  for (const f of redHard) {
    if (flags.has(f)) return "RED";
  }
  if (flags.has("extreme_multiplier")) {
    if (
      combined != null &&
      (combined >= EXTREME_MULT_RED || combined <= 1 / EXTREME_MULT_RED)
    ) {
      return "RED";
    }
    return "YELLOW";
  }
  if (flags.has("extreme_sim_vs_history")) {
    if (
      simHit != null &&
      histClear != null &&
      simHit >= EXTREME_SIM_RED &&
      simHit - histClear >= HIST_CLEAR_GAP_RED
    ) {
      return "RED";
    }
    if (simHit != null && simHit >= EXTREME_SIM_RED) return "RED";
    return "YELLOW";
  }
  return "PASS";
}

export type PropSimSanitySuiteResult = {
  sport: string;
  label?: string;
  reports: PropSimSanityReport[];
  counts: { PASS: number; YELLOW: number; RED: number };
  worstStatus: PropSimSanityStatus;
};

export function auditPropSimSuite(
  sport: string,
  props: PropSimSanityInput[],
  label?: string,
): PropSimSanitySuiteResult {
  const reports = props.map((p) => auditPropSimResult({ ...p, sport: p.sport || sport }));
  const counts = { PASS: 0, YELLOW: 0, RED: 0 };
  for (const r of reports) counts[r.status] += 1;
  const worstStatus: PropSimSanityStatus =
    counts.RED > 0 ? "RED" : counts.YELLOW > 0 ? "YELLOW" : "PASS";
  return { sport, label, reports, counts, worstStatus };
}

/** Guard: this module must never be imported from hot Coach request handlers. */
export const PROP_SIM_SANITY_AUDIT_OFFLINE_ONLY = true as const;
