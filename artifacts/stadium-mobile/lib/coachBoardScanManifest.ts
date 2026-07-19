// Full-board scan manifest — proves every market family was discovered, simulated, and gated.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { BoardMarketCategory } from "./balancedTicketMix.ts";
import { boardMarketCategory } from "./boardMarketPools.ts";
import {
  type BoardLegGateCode,
  explainBoardLegQualification,
  pickLabelForManifest,
} from "./boardLegQualification.ts";
import type { FinalAiScore } from "./finalAiScore.ts";
import { isRealisticBoardPropCandidate } from "./boardPropSimExpansion.ts";
import { isAltPropPick } from "./altLinePool.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";
import type {
  CoachPipelineRejectedMarket,
  CoachPipelineSnapshot,
  CoachPipelineStageKey,
} from "./coachPipelineTrace.ts";
import {
  buildPipelineStagesFromManifest,
  COACH_PIPELINE_STAGE_LABELS,
  formatPipelineRejectionLine,
  rejectionFromQualification,
} from "./coachPipelineTrace.ts";

export type ManifestMarketFamily =
  | "playerProps"
  | "altPlayerProps"
  | "comboProps"
  | "moneyline"
  | "spread"
  | "total"
  | "altSpread"
  | "altTotal"
  | "teamTotal"
  | "periodHalfQuarterInning"
  | "raceTo"
  | "otherGameLine";

export type CoachBoardScanManifest = {
  scanComplete: boolean;
  boardExhausted: boolean;
  requestedLegs: number;
  deliveredLegs: number;
  gameSimDraws: number;
  propSimDraws: number;
  propSimTier: "deep" | "quick";

  marketsFound: number;
  marketsFoundByFamily: Record<ManifestMarketFamily, number>;
  propsFound: number;
  propsEligibleForSim: number;
  propsSkippedUnsupported: number;
  alternateGameLinesFound: number;
  alternatePropsFound: number;

  marketsSimulated: number;
  gameLinesSimulated: number;
  propsSimulated: number;
  propsSimBatches: number;
  propsSimTimeouts: number;

  /** Sim finished but pick never entered scored[] (null MC hit, timeout, etc.). */
  preScoreEvaluated: number;
  totalEvaluated: number;
  totalQualified: number;
  qualifiedMain: number;
  qualifiedAlt: number;
  qualifiedByCategory: Record<BoardMarketCategory, number>;

  gamesLoaded: number;
  candidatesBeforeGrading: number;
  rejectedMissingOdds: number;
  rejectedMissingStats: number;
  rejectedMissingInjury: number;
  rejectedLowConfidence: number;
  rejectedLowEdge: number;
  rejectedCorrelation: number;
  rejectedDuplicates: number;
  finalSelectedCount: number;
  coverageBySport: Record<string, number>;
  coverageByMarket: Record<string, number>;
  tierFillCounts: Record<1 | 2 | 3, number>;

  gateFailureCounts: Partial<Record<BoardLegGateCode, number>>;
  rejectedSamples: Array<{
    game: string;
    market: string;
    pick: string;
    category: BoardMarketCategory;
    family: ManifestMarketFamily;
    gate: BoardLegGateCode;
    reason: string;
  }>;

  /** Post-score filter pipeline stage counts (1–9). */
  pipelineStages: Partial<Record<CoachPipelineStageKey, number>>;
  /** Detailed per-market rejections with edge/confidence/EV/sim. */
  pipelineRejections: CoachPipelineRejectedMarket[];
  /** Delivery salvage relaxations applied (confidence → correlation → alts → medium). */
  relaxationsApplied: string[];
};

export function emptyCoachBoardScanManifest(requestedLegs = 0): CoachBoardScanManifest {
  const zeroFamilies = (): Record<ManifestMarketFamily, number> => ({
    playerProps: 0,
    altPlayerProps: 0,
    comboProps: 0,
    moneyline: 0,
    spread: 0,
    total: 0,
    altSpread: 0,
    altTotal: 0,
    teamTotal: 0,
    periodHalfQuarterInning: 0,
    raceTo: 0,
    otherGameLine: 0,
  });
  return {
    scanComplete: false,
    boardExhausted: false,
    requestedLegs,
    deliveredLegs: 0,
    gameSimDraws: 10_000,
    propSimDraws: 10_000,
    propSimTier: "deep",
    marketsFound: 0,
    marketsFoundByFamily: zeroFamilies(),
    propsFound: 0,
    propsEligibleForSim: 0,
    propsSkippedUnsupported: 0,
    alternateGameLinesFound: 0,
    alternatePropsFound: 0,
    marketsSimulated: 0,
    gameLinesSimulated: 0,
    propsSimulated: 0,
    propsSimBatches: 0,
    propsSimTimeouts: 0,
    preScoreEvaluated: 0,
    totalEvaluated: 0,
    totalQualified: 0,
    qualifiedMain: 0,
    qualifiedAlt: 0,
    qualifiedByCategory: { props: 0, gameLines: 0, teamTotals: 0, alternateLines: 0 },
    gamesLoaded: 0,
    candidatesBeforeGrading: 0,
    rejectedMissingOdds: 0,
    rejectedMissingStats: 0,
    rejectedMissingInjury: 0,
    rejectedLowConfidence: 0,
    rejectedLowEdge: 0,
    rejectedCorrelation: 0,
    rejectedDuplicates: 0,
    finalSelectedCount: 0,
    coverageBySport: {},
    coverageByMarket: {},
    tierFillCounts: { 1: 0, 2: 0, 3: 0 },
    gateFailureCounts: {},
    rejectedSamples: [],
    pipelineStages: {},
    pipelineRejections: [],
    relaxationsApplied: [],
  };
}

/** Backward-compatible defaults for manifests saved before pipeline fields existed. */
export function normalizeCoachBoardScanManifest(
  manifest: Partial<CoachBoardScanManifest> & { requestedLegs?: number },
): CoachBoardScanManifest {
  const base = emptyCoachBoardScanManifest(manifest.requestedLegs ?? 0);
  return {
    ...base,
    ...manifest,
    marketsFoundByFamily: {
      ...base.marketsFoundByFamily,
      ...(manifest.marketsFoundByFamily ?? {}),
    },
    qualifiedByCategory: {
      ...base.qualifiedByCategory,
      ...(manifest.qualifiedByCategory ?? {}),
    },
    tierFillCounts: {
      ...base.tierFillCounts,
      ...(manifest.tierFillCounts ?? {}),
    },
    coverageBySport: { ...base.coverageBySport, ...(manifest.coverageBySport ?? {}) },
    coverageByMarket: { ...base.coverageByMarket, ...(manifest.coverageByMarket ?? {}) },
    gateFailureCounts: { ...base.gateFailureCounts, ...(manifest.gateFailureCounts ?? {}) },
    rejectedSamples: manifest.rejectedSamples ?? base.rejectedSamples,
    pipelineStages: { ...base.pipelineStages, ...(manifest.pipelineStages ?? {}) },
    pipelineRejections: manifest.pipelineRejections ?? base.pipelineRejections,
    relaxationsApplied: manifest.relaxationsApplied ?? base.relaxationsApplied,
  };
}

export function classifyManifestMarketFamily(pick: ParsedPick): ManifestMarketFamily {
  const market = String(pick.market ?? "").trim();
  const lower = market.toLowerCase();
  if (pick.isProp) {
    if (isAltPropPick(pick) || pick.propIsAlt) return "altPlayerProps";
    if (/\+|&|combo|double|triple/i.test(lower) || /pts.*reb|reb.*ast|pra/i.test(lower)) {
      return "comboProps";
    }
    return "playerProps";
  }
  if (/team total/i.test(lower)) return "teamTotal";
  if (/alt spread/i.test(lower)) return "altSpread";
  if (/alt total/i.test(lower)) return "altTotal";
  if (/moneyline|\bml\b/i.test(lower)) return "moneyline";
  if (/spread/i.test(lower)) return "spread";
  if (/total/i.test(lower)) return "total";
  if (/race to/i.test(lower)) return "raceTo";
  if (
    /q[1-4]|quarter|half|period|inning|f5|1st/i.test(lower) ||
    /\b(h1|h2|p[1-3])\b/i.test(lower)
  ) {
    return "periodHalfQuarterInning";
  }
  return "otherGameLine";
}

export type CoachBoardScanManifestRecorder = CoachBoardScanManifest & {
  recordGamesLoaded(count: number): void;
  recordCandidatesBeforeGrading(count: number): void;
  recordCorrelationRejections(count: number): void;
  recordDuplicateRejections(count: number): void;
  recordTierFillCounts(counts: Record<1 | 2 | 3, number>): void;
  recordDeliveryCoverage(picks: ParsedPick[]): void;
  recordPipelineSnapshot(snapshot: CoachPipelineSnapshot): void;
  recordMarketFound(pick: ParsedPick): void;
  recordPropPoolRow(pick: ParsedPick): void;
  recordGameLineSimulated(): void;
  recordPropSimBatch(size: number, timedOut: boolean): void;
  /** Sim ran but the pick could not be graded (null MC hit, batch timeout, etc.). */
  recordPreScoreGateFailure(pick: ParsedPick, score?: Partial<FinalAiScore> | null): void;
  recordEvaluatedLeg(leg: BoardScoredLeg): void;
  recordEvaluatedPick(pick: ParsedPick, score: ParsedPick["finalAiScore"]): void;
  recomputeQualificationFromScored(scored: BoardScoredLeg[]): void;
  finalize(opts: { scanComplete: boolean; boardExhausted: boolean; deliveredLegs: number }): CoachBoardScanManifest;
};

const MAX_REJECTED_SAMPLES = 80;

function gateToManifestRejections(
  gate: BoardLegGateCode,
  reason: string,
): Partial<
  Pick<
    CoachBoardScanManifest,
    | "rejectedMissingOdds"
    | "rejectedMissingStats"
    | "rejectedMissingInjury"
    | "rejectedLowConfidence"
    | "rejectedLowEdge"
  >
> {
  if (gate === "missing_odds") return { rejectedMissingOdds: 1 };
  if (gate === "missing_prop_line" || gate === "no_score" || gate === "no_sim_grade" || gate === "unsupported_market") {
    return { rejectedMissingStats: 1 };
  }
  if (gate === "holistic_not_recommended" && /injury/i.test(reason)) {
    return { rejectedMissingInjury: 1 };
  }
  if (gate === "confidence_below_minimum") return { rejectedLowConfidence: 1 };
  if (gate === "negative_edge" || gate === "negative_ev" || gate === "sim_below_implied") {
    return { rejectedLowEdge: 1 };
  }
  return {};
}

function mergeManifestRejections(
  manifest: CoachBoardScanManifest,
  partial: ReturnType<typeof gateToManifestRejections>,
): void {
  if (partial.rejectedMissingOdds) manifest.rejectedMissingOdds += partial.rejectedMissingOdds;
  if (partial.rejectedMissingStats) manifest.rejectedMissingStats += partial.rejectedMissingStats;
  if (partial.rejectedMissingInjury) manifest.rejectedMissingInjury += partial.rejectedMissingInjury;
  if (partial.rejectedLowConfidence) manifest.rejectedLowConfidence += partial.rejectedLowConfidence;
  if (partial.rejectedLowEdge) manifest.rejectedLowEdge += partial.rejectedLowEdge;
}

function summarizeGateFailures(manifest: CoachBoardScanManifest): void {
  manifest.rejectedMissingOdds = 0;
  manifest.rejectedMissingStats = 0;
  manifest.rejectedMissingInjury = 0;
  manifest.rejectedLowConfidence = 0;
  manifest.rejectedLowEdge = 0;
  for (const [gate, count] of Object.entries(manifest.gateFailureCounts)) {
    if (!count) continue;
    const sample = manifest.rejectedSamples.find((r) => r.gate === gate);
    const partial = gateToManifestRejections(gate as BoardLegGateCode, sample?.reason ?? "");
    for (let i = 0; i < count; i++) mergeManifestRejections(manifest, partial);
  }
}

function mergeGateFailureCounts(
  a: Partial<Record<BoardLegGateCode, number>>,
  b: Partial<Record<BoardLegGateCode, number>>,
): Partial<Record<BoardLegGateCode, number>> {
  const out: Partial<Record<BoardLegGateCode, number>> = { ...a };
  for (const [gate, count] of Object.entries(b)) {
    if (!count) continue;
    const code = gate as BoardLegGateCode;
    out[code] = (out[code] ?? 0) + count;
  }
  return out;
}

export function createCoachBoardScanManifestRecorder(requestedLegs: number): CoachBoardScanManifestRecorder {
  const manifest = emptyCoachBoardScanManifest(requestedLegs);
  const seenRejectFp = new Set<string>();
  const seenPreScoreFp = new Set<string>();
  let preScoreGateFailures: Partial<Record<BoardLegGateCode, number>> = {};
  let preScoreRejectedSamples: CoachBoardScanManifest["rejectedSamples"] = [];

  const bumpGate = (gate: BoardLegGateCode, target: Partial<Record<BoardLegGateCode, number>>) => {
    target[gate] = (target[gate] ?? 0) + 1;
  };

  const pushRejectedSample = (
    pick: ParsedPick,
    gate: BoardLegGateCode,
    reason: string,
    bucket: CoachBoardScanManifest["rejectedSamples"],
    seen: Set<string>,
  ) => {
    const fp = `${pick.game}|${pick.market}|${pick.pick}|${pick.odds}|${gate}`;
    if (seen.has(fp) || bucket.length >= MAX_REJECTED_SAMPLES) return;
    seen.add(fp);
    bucket.push({
      game: pick.game,
      market: String(pick.market ?? ""),
      pick: pickLabelForManifest(pick),
      category: boardMarketCategory(pick),
      family: classifyManifestMarketFamily(pick),
      gate,
      reason,
    });
  };

  const recorder: CoachBoardScanManifestRecorder = Object.assign(manifest, {
    recordGamesLoaded(count: number) {
      manifest.gamesLoaded = count;
    },
    recordCandidatesBeforeGrading(count) {
      manifest.candidatesBeforeGrading = count;
    },
    recordCorrelationRejections(count) {
      manifest.rejectedCorrelation += count;
    },
    recordDuplicateRejections(count) {
      manifest.rejectedDuplicates += count;
    },
    recordTierFillCounts(counts) {
      manifest.tierFillCounts = { ...counts };
    },
    recordDeliveryCoverage(picks) {
      manifest.finalSelectedCount = picks.length;
      manifest.coverageBySport = {};
      manifest.coverageByMarket = {};
      for (const p of picks) {
        const sport = String(p.sport ?? "unknown").toLowerCase();
        manifest.coverageBySport[sport] = (manifest.coverageBySport[sport] ?? 0) + 1;
        const market = String(p.market ?? "unknown");
        manifest.coverageByMarket[market] = (manifest.coverageByMarket[market] ?? 0) + 1;
      }
    },
    recordPipelineSnapshot(snapshot) {
      manifest.pipelineStages = { ...manifest.pipelineStages, ...snapshot.stages };
      manifest.relaxationsApplied = [
        ...new Set([...(manifest.relaxationsApplied ?? []), ...(snapshot.relaxationsApplied ?? [])]),
      ];
      for (const r of snapshot.rejections ?? []) {
        if ((manifest.pipelineRejections ?? []).length >= MAX_REJECTED_SAMPLES) break;
        manifest.pipelineRejections.push(r);
      }
    },
    recordMarketFound(pick) {
      manifest.marketsFound += 1;
      const family = classifyManifestMarketFamily(pick);
      manifest.marketsFoundByFamily[family] += 1;
      if (!pick.isProp) {
        const cat = boardMarketCategory(pick);
        if (cat === "alternateLines") manifest.alternateGameLinesFound += 1;
      }
    },
    recordPropPoolRow(pick) {
      manifest.propsFound += 1;
      recorder.recordMarketFound(pick);
      if (isAltPropPick(pick) || pick.propIsAlt) manifest.alternatePropsFound += 1;
      if (isRealisticBoardPropCandidate(pick)) {
        manifest.propsEligibleForSim += 1;
      } else {
        manifest.propsSkippedUnsupported += 1;
      }
    },
    recordGameLineSimulated() {
      manifest.gameLinesSimulated += 1;
      manifest.marketsSimulated += 1;
    },
    recordPropSimBatch(size, timedOut) {
      manifest.propsSimBatches += 1;
      manifest.propsSimulated += size;
      manifest.marketsSimulated += size;
      if (timedOut) manifest.propsSimTimeouts += 1;
    },
    recordPreScoreGateFailure(pick, score) {
      const fp = `${pick.game}|${pick.market}|${pick.pick}|${pick.odds}|pre_score`;
      if (seenPreScoreFp.has(fp)) return;
      seenPreScoreFp.add(fp);
      manifest.preScoreEvaluated += 1;
      const q = explainBoardLegQualification(pick, (score as FinalAiScore | null | undefined) ?? null);
      bumpGate(q.gate, preScoreGateFailures);
      mergeManifestRejections(manifest, gateToManifestRejections(q.gate, q.reason));
      pushRejectedSample(pick, q.gate, q.reason, preScoreRejectedSamples, seenRejectFp);
    },
    recordEvaluatedLeg(leg) {
      recorder.recordEvaluatedPick(leg.pick, leg.pick.finalAiScore);
    },
    recordEvaluatedPick(pick, score) {
      const q = explainBoardLegQualification(pick, score);
      if (q.qualifies) {
        manifest.totalQualified += 1;
        if (q.role === "main") manifest.qualifiedMain += 1;
        if (q.role === "alt") manifest.qualifiedAlt += 1;
        const cat = boardMarketCategory(pick);
        manifest.qualifiedByCategory[cat] += 1;
        return;
      }
      bumpGate(q.gate, manifest.gateFailureCounts);
      mergeManifestRejections(manifest, gateToManifestRejections(q.gate, q.reason));
      pushRejectedSample(pick, q.gate, q.reason, manifest.rejectedSamples, seenRejectFp);
      const rejection = rejectionFromQualification(pick, score, "afterConfidence");
      if (rejection && manifest.pipelineRejections.length < MAX_REJECTED_SAMPLES) {
        manifest.pipelineRejections.push(rejection);
      }
    },
    recomputeQualificationFromScored(scored) {
      manifest.totalQualified = 0;
      manifest.qualifiedMain = 0;
      manifest.qualifiedAlt = 0;
      manifest.qualifiedByCategory = { props: 0, gameLines: 0, teamTotals: 0, alternateLines: 0 };
      manifest.gateFailureCounts = {};
      manifest.rejectedSamples = [];
      manifest.rejectedMissingOdds = 0;
      manifest.rejectedMissingStats = 0;
      manifest.rejectedMissingInjury = 0;
      manifest.rejectedLowConfidence = 0;
      manifest.rejectedLowEdge = 0;
      seenRejectFp.clear();

      for (const leg of scored) {
        recorder.recordEvaluatedPick(leg.pick, leg.pick.finalAiScore);
      }

      manifest.totalEvaluated = manifest.preScoreEvaluated + scored.length;
    },
    finalize(opts) {
      manifest.scanComplete = opts.scanComplete;
      manifest.boardExhausted = opts.boardExhausted;
      manifest.deliveredLegs = opts.deliveredLegs;
      manifest.finalSelectedCount = opts.deliveredLegs;
      if (!manifest.totalEvaluated) {
        manifest.totalEvaluated = manifest.preScoreEvaluated;
      }
      if (
        opts.scanComplete &&
        manifest.marketsSimulated > manifest.totalEvaluated
      ) {
        const gap = manifest.marketsSimulated - manifest.totalEvaluated;
        preScoreGateFailures.no_sim_grade = (preScoreGateFailures.no_sim_grade ?? 0) + gap;
        manifest.preScoreEvaluated += gap;
        manifest.totalEvaluated = manifest.marketsSimulated;
      }
      manifest.pipelineStages = {
        ...buildPipelineStagesFromManifest(manifest),
        ...manifest.pipelineStages,
      };
      return {
        ...manifest,
        gateFailureCounts: mergeGateFailureCounts(preScoreGateFailures, manifest.gateFailureCounts),
        rejectedSamples: [...preScoreRejectedSamples, ...manifest.rejectedSamples].slice(
          0,
          MAX_REJECTED_SAMPLES,
        ),
      };
    },
  });

  return recorder;
}

function gateLabel(gate: BoardLegGateCode): string {
  const labels: Record<BoardLegGateCode, string> = {
    qualified_main: "Qualified (main)",
    qualified_alt: "Qualified (alt)",
    no_score: "No score",
    high_risk_value_play: "High-risk value",
    unsupported_market: "Unsupported market",
    missing_odds: "Missing odds",
    missing_prop_line: "Missing prop line",
    no_sim_grade: "No sim grade",
    negative_edge: "Edge ≤ 0",
    negative_ev: "EV ≤ 0",
    sim_below_implied: "Sim ≤ implied",
    grade_below_minimum: "Grade below C+",
    confidence_below_minimum: "Confidence below 52%",
    not_sim_aligned: "Sim not aligned",
    holistic_not_recommended: "Holistic failed",
    not_ai_recommended: "Not AI recommended",
    not_staged: "Not staged",
  };
  return labels[gate] ?? gate;
}

/** User-facing scan manifest block (markdown). */
export function formatCoachBoardScanManifest(
  manifestInput: CoachBoardScanManifest | (Partial<CoachBoardScanManifest> & { requestedLegs?: number }),
): string {
  const manifest = normalizeCoachBoardScanManifest(manifestInput);
  const lines: string[] = [];
  lines.push("### Scan manifest");
  lines.push(
    manifest.scanComplete && manifest.boardExhausted
      ? "**Status:** Full board evaluated — every posted market family scanned."
      : manifest.scanComplete
        ? "**Status:** Scan finished."
        : "**Status:** Scan in progress…",
  );
  lines.push("");
  lines.push("**Coverage**");
  lines.push(`- Markets found: **${manifest.marketsFound.toLocaleString()}**`);
  lines.push(`- Markets simulated (10k MC): **${manifest.marketsSimulated.toLocaleString()}**`);
  lines.push(`- Game lines simulated: **${manifest.gameLinesSimulated.toLocaleString()}**`);
  lines.push(
    `- Player props simulated: **${manifest.propsSimulated.toLocaleString()}** of **${manifest.propsEligibleForSim.toLocaleString()}** eligible (${manifest.propsFound.toLocaleString()} in pool)`,
  );
  lines.push(`- Alternate game lines found: **${manifest.alternateGameLinesFound.toLocaleString()}**`);
  lines.push(`- Alternate player props found: **${manifest.alternatePropsFound.toLocaleString()}**`);
  if (manifest.propsSkippedUnsupported > 0) {
    lines.push(`- Props skipped (no sim model / missing line): **${manifest.propsSkippedUnsupported.toLocaleString()}**`);
  }
  if (manifest.propsSimTimeouts > 0) {
    lines.push(`- Prop sim batch timeouts: **${manifest.propsSimTimeouts}**`);
  }

  lines.push("");
  lines.push("**Market families discovered**");
  const families: Array<[ManifestMarketFamily, string]> = [
    ["playerProps", "Player props"],
    ["altPlayerProps", "Alternate player props"],
    ["comboProps", "Combo props"],
    ["moneyline", "Moneylines"],
    ["spread", "Spreads"],
    ["total", "Totals"],
    ["altSpread", "Alternate spreads"],
    ["altTotal", "Alternate totals"],
    ["teamTotal", "Team totals"],
    ["periodHalfQuarterInning", "Quarter / half / period / inning"],
    ["raceTo", "Race-to markets"],
    ["otherGameLine", "Other posted game lines"],
  ];
  for (const [key, label] of families) {
    const n = manifest.marketsFoundByFamily[key];
    if (n > 0) lines.push(`- ${label}: **${n.toLocaleString()}**`);
  }

  lines.push("");
  lines.push("**Pipeline counts**");
  if (manifest.gamesLoaded > 0) {
    lines.push(`- Games loaded: **${manifest.gamesLoaded.toLocaleString()}**`);
  }
  lines.push(`- Total markets loaded: **${manifest.marketsFound.toLocaleString()}**`);
  lines.push(`- Total player props loaded: **${manifest.propsFound.toLocaleString()}**`);
  if (manifest.candidatesBeforeGrading > 0) {
    lines.push(`- Candidates before grading: **${manifest.candidatesBeforeGrading.toLocaleString()}**`);
  }
  lines.push(`- Candidates evaluated (with sim): **${manifest.totalEvaluated.toLocaleString()}**`);
  if (manifest.rejectedMissingOdds > 0) {
    lines.push(`- Rejected (missing odds): **${manifest.rejectedMissingOdds.toLocaleString()}**`);
  }
  if (manifest.rejectedMissingStats > 0) {
    lines.push(`- Rejected (missing stats / line / sim): **${manifest.rejectedMissingStats.toLocaleString()}**`);
  }
  if (manifest.rejectedMissingInjury > 0) {
    lines.push(`- Rejected (injury data conflict): **${manifest.rejectedMissingInjury.toLocaleString()}**`);
  }
  if (manifest.rejectedLowConfidence > 0) {
    lines.push(`- Rejected (low confidence): **${manifest.rejectedLowConfidence.toLocaleString()}**`);
  }
  if (manifest.rejectedLowEdge > 0) {
    lines.push(`- Rejected (low / negative edge): **${manifest.rejectedLowEdge.toLocaleString()}**`);
  }
  if (manifest.rejectedCorrelation > 0) {
    lines.push(`- Rejected (correlation): **${manifest.rejectedCorrelation.toLocaleString()}**`);
  }
  if (manifest.rejectedDuplicates > 0) {
    lines.push(`- Rejected (duplicates): **${manifest.rejectedDuplicates.toLocaleString()}**`);
  }
  lines.push(`- Final selected: **${manifest.finalSelectedCount || manifest.deliveredLegs}**`);

  const pipelineKeys = Object.keys(COACH_PIPELINE_STAGE_LABELS) as CoachPipelineStageKey[];
  const hasPipeline = pipelineKeys.some((k) => manifest.pipelineStages[k] != null);
  if (hasPipeline) {
    lines.push("");
    lines.push("**Filter pipeline**");
    for (const key of pipelineKeys) {
      const count = manifest.pipelineStages[key];
      if (count == null) continue;
      lines.push(`- ${COACH_PIPELINE_STAGE_LABELS[key]}: **${count.toLocaleString()}**`);
    }
  }
  if (manifest.relaxationsApplied.length > 0) {
    lines.push(`- Threshold relaxations applied: **${manifest.relaxationsApplied.join(" → ")}**`);
  }

  lines.push("");
  lines.push("**Qualification**");
  if (manifest.preScoreEvaluated > 0) {
    lines.push(
      `- Sim completed but not gradable: **${manifest.preScoreEvaluated.toLocaleString()}** (null MC hit, timeout, or missing score)`,
    );
  }
  lines.push(`- Qualified (main): **${manifest.qualifiedMain}**`);
  lines.push(`- Qualified (alt): **${manifest.qualifiedAlt}**`);
  lines.push(
    `- On ticket categories — props: **${manifest.qualifiedByCategory.props}**, game lines: **${manifest.qualifiedByCategory.gameLines}**, team totals: **${manifest.qualifiedByCategory.teamTotals}**, alts: **${manifest.qualifiedByCategory.alternateLines}**`,
  );

  const failureEntries = Object.entries(manifest.gateFailureCounts).filter(
    ([gate]) => gate !== "qualified_main" && gate !== "qualified_alt",
  );
  if (failureEntries.length > 0) {
    lines.push("");
    lines.push("**Gate failures**");
    for (const [gate, count] of failureEntries.sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))) {
      lines.push(`- ${gateLabel(gate as BoardLegGateCode)}: **${count?.toLocaleString()}**`);
    }
  }

  if (manifest.rejectedSamples.length > 0) {
    lines.push("");
    lines.push(`**Sample rejections** (top ${manifest.rejectedSamples.length} by scan order)`);
    for (const r of manifest.rejectedSamples.slice(0, 25)) {
      lines.push(`- ${r.game} · ${r.pick} — _${r.reason}_`);
    }
    if (manifest.rejectedSamples.length > 25) {
      lines.push(`- _…and ${manifest.rejectedSamples.length - 25} more logged rejections_`);
    }
  }

  if (manifest.pipelineRejections.length > 0) {
    lines.push("");
    lines.push(`**Detailed rejections** (edge / confidence / EV / sim)`);
    for (const r of manifest.pipelineRejections.slice(0, 30)) {
      lines.push(`- ${formatPipelineRejectionLine(r)}`);
    }
    if (manifest.pipelineRejections.length > 30) {
      lines.push(`- _…and ${manifest.pipelineRejections.length - 30} more detailed rejections_`);
    }
  }

  if (manifest.tierFillCounts[2] > 0 || manifest.tierFillCounts[3] > 0) {
    lines.push("");
    lines.push("**Fallback tiers used**");
    if (manifest.tierFillCounts[1] > 0) lines.push(`- Tier 1 (strict): **${manifest.tierFillCounts[1]}**`);
    if (manifest.tierFillCounts[2] > 0) lines.push(`- Tier 2 (alt lines): **${manifest.tierFillCounts[2]}**`);
    if (manifest.tierFillCounts[3] > 0) lines.push(`- Tier 3 (medium confidence): **${manifest.tierFillCounts[3]}**`);
  }

  const sportEntries = Object.entries(manifest.coverageBySport);
  if (sportEntries.length > 0) {
    lines.push("");
    lines.push("**Delivered coverage by sport**");
    for (const [sport, count] of sportEntries.sort((a, b) => b[1] - a[1])) {
      lines.push(`- ${sport}: **${count}**`);
    }
  }
  const marketEntries = Object.entries(manifest.coverageByMarket);
  if (marketEntries.length > 0) {
    lines.push("");
    lines.push("**Delivered coverage by market**");
    for (const [market, count] of marketEntries.sort((a, b) => b[1] - a[1]).slice(0, 12)) {
      lines.push(`- ${market}: **${count}**`);
    }
  }

  lines.push("");
  lines.push("**Delivery**");
  if (manifest.scanComplete && manifest.boardExhausted) {
    if (manifest.deliveredLegs > 0) {
      lines.push(
        `- Delivered **${manifest.deliveredLegs}** of **${manifest.requestedLegs || manifest.deliveredLegs}** requested legs after horizon + dedupe gates.`,
      );
    } else if (manifest.qualifiedMain + manifest.qualifiedAlt > 0) {
      lines.push(
        `- **0 legs delivered** — **${manifest.qualifiedMain + manifest.qualifiedAlt}** passed sim/AI gates but none survived final delivery (horizon, dedupe, or in-flight rescoring).`,
      );
    } else if (manifest.marketsSimulated > 0 && manifest.totalEvaluated > 0) {
      lines.push(
        `- **0 legs delivered** — **${manifest.marketsSimulated.toLocaleString()}** markets got 10k MC sims; **${manifest.totalEvaluated.toLocaleString()}** were graded but none passed edge, EV, and confidence gates. See gate failures above.`,
      );
    } else if (manifest.marketsSimulated > 0) {
      lines.push(
        `- **0 legs delivered** — **${manifest.marketsSimulated.toLocaleString()}** markets were simulated but none produced a gradable sim result on this slate.`,
      );
    } else {
      lines.push(
        `- **0 legs delivered** — no candidates passed sim, edge, EV, and confidence thresholds on this slate.`,
      );
    }
  } else if (manifest.deliveredLegs > 0) {
    lines.push(`- In progress: **${manifest.deliveredLegs}** leg(s) ready so far.`);
  }

  lines.push("");
  lines.push(
    `_Simulation: ${manifest.gameSimDraws.toLocaleString()} draws per game line; prop tier **${manifest.propSimTier}** (${manifest.propSimDraws.toLocaleString()} draws per prop)._`,
  );
  lines.push("_Pipeline: **board scan → staging gates → single delivery** (no preview/filler fallback)._");

  return lines.join("\n");
}

const SCAN_MANIFEST_HEADING_RE = /### Scan manifest/i;

export function coachReplyHasScanManifest(
  boardScanManifestDetail?: string,
  coachDetailNote?: string,
): boolean {
  return (
    SCAN_MANIFEST_HEADING_RE.test(boardScanManifestDetail ?? "") ||
    SCAN_MANIFEST_HEADING_RE.test(coachDetailNote ?? "")
  );
}
