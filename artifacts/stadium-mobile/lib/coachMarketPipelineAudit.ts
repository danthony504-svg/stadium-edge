// Per-request market pipeline audit — counts by sport + family at each funnel stage.

import type { ParsedPick } from "../components/PickCard.tsx";
import {
  coachMarketFamily,
  countsByMarketFamily,
  type CoachMarketFamily,
  type CoachMarketStage,
} from "./coachMarketDiagnostics.ts";
import { explainBoardLegQualification, type BoardLegGateCode } from "./boardLegQualification.ts";
import { marketSupportsSimulation } from "./simMarketSupport.ts";
import { isRealisticBoardPropCandidate } from "./boardPropSimExpansion.ts";
import { isGameLinePick } from "./gameSimScoring.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";
import { boardLegPoolRole } from "./ticketStaging.ts";
import type { TicketFamilyVarietyAudit } from "./coachTicketCombinations.ts";
import { persistCoachMarketPipelineAudit } from "./coachRequestTrace.ts";
import { isYesNoPropMarket } from "./propYesNoMarkets.ts";
import type { FinalAiScore } from "./finalAiScore.ts";

export type PipelineAuditStage =
  | "raw_feed"
  | "normalized"
  | "simulation_eligible"
  | "qualified"
  | "ranked"
  | "final_selected";

export type AuditMarketFamily = "playerProps" | "moneyline" | "spread" | "gameTotal" | "teamTotal" | "alternateGameLine" | "touchdownBinary" | "other";
export type SportMarketCounts = Record<string, Record<AuditMarketFamily, number>>;

export type NonPropRejection = {
  sport: string;
  stage: PipelineAuditStage;
  event: string;
  marketFamily: CoachMarketFamily;
  selection: string;
  gate: BoardLegGateCode | "missing_odds" | "unresolved_event" | "simulation_failure" | "duplicate_correlation";
  reason: string;
};

export type CoachMarketPipelineSnapshot = {
  requestId: string;
  stages: Partial<Record<PipelineAuditStage, SportMarketCounts>>;
  /** Candidate funnel; each counter is separated by sport and market family. */
  funnel?: Partial<Record<MarketFunnelStage, SportMarketCounts>>;
  /** Exact final qualification gate reached by every scored candidate. */
  qualificationGateCounts?: Partial<Record<BoardLegGateCode, SportMarketCounts>>;
  nonPropRejections: NonPropRejection[];
  nonPropRejectionAggregates?: Record<string, number>;
  qualifiedCandidates?: QualifiedCandidateAudit[];
  ticketVariety?: TicketFamilyVarietyAudit;
};

export type MarketFunnelStage =
  | "normalized"
  | "simulationAttempted"
  | "simulationReturned"
  | "simulationGradable"
  | "positiveEdge"
  | "simAligned"
  | "riskGatePassed"
  | "qualified"
  | "ranked";

const MAX_NON_PROP_REJECTIONS = 100;

export type GameSimulationAudit = {
  sport: string; event: string; marketFamily: AuditMarketFamily; selection: string;
  line: number | null; odds: number | null; homeTeam: string; awayTeam: string;
  simulationShape: string[]; homeScoreSource: string; awayScoreSource: string;
  submittedCoverQueryIds: string[]; submittedCoverQueryCount: number;
  returnedCoverHitRateIds: string[]; returnedCoverHitRateCount: number;
  outcomesReturned: boolean; homeScoreDrawCount: number; awayScoreDrawCount: number;
  sampleHomeScore: number | null; sampleAwayScore: number | null;
  winnerSource: string | null; totalSource: string | null;
  parsedTeam: string | null; parsedSide: string | null; parsedLine: number | null;
  wins: number; losses: number; pushes: number; simHitRate: number | null;
  nullReason: string | null;
};

export type QualifiedCandidateAudit = {
  sport: string; marketFamily: AuditMarketFamily; selection: string; odds: number | null;
  confidence: number | null; edge: number | null; grade: string | null; simHitRate: number | null;
  rankScore: number; correlationAdjustment: number | null; finalRankPosition: number | null;
  selected: boolean; exclusionReason: string | null;
};

function normSport(s: string | null | undefined): string {
  return String(s ?? "unknown").toLowerCase();
}

function bump(counts: SportMarketCounts, pick: ParsedPick): void {
  const sport = normSport(pick.sport);
  const family = auditMarketFamily(pick);
  counts[sport] ??= {
    playerProps: 0, moneyline: 0, spread: 0, gameTotal: 0,
    teamTotal: 0, alternateGameLine: 0, touchdownBinary: 0, other: 0,
  };
  counts[sport]![family] += 1;
}

export function auditMarketFamily(pick: ParsedPick): AuditMarketFamily {
  const market = String(pick.market ?? "").toLowerCase();
  if (pick.isProp) {
    return isYesNoPropMarket(market) || /touchdown|anytime.*td/.test(market)
      ? "touchdownBinary"
      : "playerProps";
  }
  if (/\balt\b/.test(market)) return "alternateGameLine";
  if (/team total/.test(market)) return "teamTotal";
  if (/moneyline|\bml\b/.test(market)) return "moneyline";
  if (/spread|run line|puck line/.test(market)) return "spread";
  if (/\btotal\b/.test(market)) return "gameTotal";
  return "other";
}

function countsFromPicks(picks: readonly ParsedPick[]): SportMarketCounts {
  const out: SportMarketCounts = {};
  for (const pick of picks) bump(out, pick);
  return out;
}

function nonPropRejectionFromQualification(
  pick: ParsedPick,
  stage: PipelineAuditStage,
  gate: BoardLegGateCode,
  reason: string,
): NonPropRejection {
  return {
    sport: normSport(pick.sport),
    stage,
    event: pick.game,
    marketFamily: coachMarketFamily(pick),
    selection: pick.pick,
    gate,
    reason,
  };
}

export function createCoachMarketPipelineAudit(requestId: string): {
  snapshot: () => CoachMarketPipelineSnapshot;
  recordRawFeed: (picks: readonly ParsedPick[]) => void;
  recordNormalized: (picks: readonly ParsedPick[]) => void;
  recordSimulationEligible: (picks: readonly ParsedPick[]) => void;
  recordQualified: (legs: readonly BoardScoredLeg[]) => void;
  recordRanked: (legs: readonly BoardScoredLeg[]) => void;
  recordFunnel: (stage: MarketFunnelStage, picks: readonly ParsedPick[]) => void;
  recordScoredFunnel: (pick: ParsedPick, score: FinalAiScore | null | undefined) => void;
  recordGameSimulation: (row: GameSimulationAudit) => void;
  recordTicketVariety: (audit: TicketFamilyVarietyAudit) => void;
  recordFinalSelected: (picks: readonly ParsedPick[]) => void;
  recordNonPropQualificationFailure: (pick: ParsedPick, stage: PipelineAuditStage) => void;
  recordNonPropCandidate: (
    pick: ParsedPick,
    stage: PipelineAuditStage,
    opts: {
      unresolvedEvent?: boolean;
      missingOdds?: boolean;
      simFailure?: boolean;
      simulationFailureReason?: string;
    },
  ) => void;
  emitTrace: () => void;
} {
  const stages: Partial<Record<PipelineAuditStage, SportMarketCounts>> = {};
  const funnel: Partial<Record<MarketFunnelStage, SportMarketCounts>> = {};
  const qualificationGateCounts: Partial<Record<BoardLegGateCode, SportMarketCounts>> = {};
  const gameSimulations: GameSimulationAudit[] = [];
  const seenGameSimulationExamples = new Set<string>();
  const nonPropRejections: NonPropRejection[] = [];
  let qualifiedCandidates: QualifiedCandidateAudit[] = [];
  let ticketVariety: TicketFamilyVarietyAudit | undefined;
  const seenNonPropRejection = new Set<string>();

  const bumpFunnel = (stage: MarketFunnelStage, pick: ParsedPick) => {
    const counts = funnel[stage] ?? (funnel[stage] = {});
    bump(counts, pick);
  };

  const pushNonPropRejection = (row: NonPropRejection) => {
    const key = `${row.stage}|${row.event}|${row.selection}|${row.gate}`;
    if (seenNonPropRejection.has(key)) return;
    seenNonPropRejection.add(key);
    if (nonPropRejections.length >= MAX_NON_PROP_REJECTIONS) return;
    nonPropRejections.push(row);
  };

  const recordStage = (stage: PipelineAuditStage, picks: readonly ParsedPick[]) => {
    stages[stage] = countsFromPicks(picks);
  };

  return {
    snapshot: () => ({
      requestId, stages, funnel, qualificationGateCounts, gameSimulations, nonPropRejections, qualifiedCandidates, ticketVariety,
    }),
    recordRawFeed: (picks) => recordStage("raw_feed", picks),
    recordNormalized: (picks) => {
      recordStage("normalized", picks);
      funnel.normalized = countsFromPicks(picks);
    },
    recordSimulationEligible: (picks) => recordStage("simulation_eligible", picks),
    recordFunnel: (stage, picks) => {
      for (const pick of picks) bumpFunnel(stage, pick);
    },
    recordScoredFunnel: (pick, score) => {
      if (!score) return;
      if ((score.simHit ?? null) != null && Number.isFinite(score.simHit)) {
        bumpFunnel("simulationGradable", pick);
      }
      if ((score.edgePct ?? 0) > 0) bumpFunnel("positiveEdge", pick);
      if (score.simAligned) bumpFunnel("simAligned", pick);
      if (!score.highRiskValuePlay) bumpFunnel("riskGatePassed", pick);
      const gate = explainBoardLegQualification(pick, score).gate;
      const counts = qualificationGateCounts[gate] ?? (qualificationGateCounts[gate] = {});
      bump(counts, pick);
    },
    recordGameSimulation: (row) => {
      const key = `${row.sport}|${row.marketFamily}`;
      if (seenGameSimulationExamples.has(key) || gameSimulations.length >= 10) return;
      seenGameSimulationExamples.add(key);
      gameSimulations.push(row);
    },
    recordTicketVariety: (audit) => {
      ticketVariety = audit;
    },
    recordQualified: (legs) => {
      recordStage("qualified", legs.map((l) => l.pick));
      funnel.qualified = countsFromPicks(legs.map((l) => l.pick));
      qualifiedCandidates = legs.map((leg) => ({
        sport: normSport(leg.pick.sport), marketFamily: auditMarketFamily(leg.pick),
        selection: leg.pick.pick, odds: leg.pick.odds ?? null, confidence: leg.confidencePct,
        edge: leg.edgePct, grade: leg.grade, simHitRate: leg.simHit, rankScore: leg.rankScore,
        correlationAdjustment: null, finalRankPosition: null, selected: false, exclusionReason: "not ranked",
      }));
    },
    recordRanked: (legs) => {
      recordStage("ranked", legs.map((l) => l.pick));
      funnel.ranked = countsFromPicks(legs.map((l) => l.pick));
      const positions = new Map(legs.map((leg, index) => [leg.pick.pick, index + 1]));
      qualifiedCandidates = qualifiedCandidates.map((candidate) => ({
        ...candidate,
        finalRankPosition: positions.get(candidate.selection) ?? null,
        exclusionReason: positions.has(candidate.selection)
          ? "excluded by correlation-aware ticket staging/ranking"
          : "collapsed by ladder/dedup before ranking",
      }));
    },
    recordFinalSelected: (picks) => {
      recordStage("final_selected", picks);
      const selected = new Set(picks.map((pick) => pick.pick));
      qualifiedCandidates = qualifiedCandidates.map((candidate) => ({
        ...candidate,
        selected: selected.has(candidate.selection),
        exclusionReason: selected.has(candidate.selection) ? null : candidate.exclusionReason,
      }));
    },
    recordNonPropQualificationFailure: (pick: ParsedPick, stage: PipelineAuditStage) => {
      if (pick.isProp) return;
      const q = explainBoardLegQualification(pick, pick.finalAiScore);
      if (q.qualifies) return;
      pushNonPropRejection(nonPropRejectionFromQualification(pick, stage, q.gate, q.reason));
    },
    recordNonPropCandidate: (pick, stage, opts) => {
      if (pick.isProp) return;
      if (opts.unresolvedEvent || !pick.game?.trim()) {
        pushNonPropRejection({
          sport: normSport(pick.sport),
          stage,
          event: pick.game || "—",
          marketFamily: coachMarketFamily(pick),
          selection: pick.pick,
          gate: "unresolved_event",
          reason: "Missing or unresolved game/event label",
        });
        return;
      }
      if (opts.missingOdds || pick.odds == null || !Number.isFinite(pick.odds) || pick.odds === 0) {
        pushNonPropRejection({
          sport: normSport(pick.sport),
          stage,
          event: pick.game,
          marketFamily: coachMarketFamily(pick),
          selection: pick.pick,
          gate: "missing_odds",
          reason: "No posted odds on feed row",
        });
        return;
      }
      if (opts.simFailure) {
        pushNonPropRejection({
          sport: normSport(pick.sport),
          stage,
          event: pick.game,
          marketFamily: coachMarketFamily(pick),
          selection: pick.pick,
          gate: "simulation_failure",
          reason: opts.simulationFailureReason ?? "Simulation did not produce a gradable hit rate",
        });
      }
    },
    emitTrace: () => {
      const nonPropRejectionAggregates: Record<string, number> = {};
      for (const row of nonPropRejections) {
        const key =
          row.gate === "missing_odds" ? "missing odds"
            : row.gate === "simulation_failure" ? "simulation unavailable"
              : row.gate === "not_sim_aligned" || row.gate === "sim_below_implied" ? "simAligned false"
                : row.gate === "confidence_below_minimum" ? "confidence"
                  : row.gate === "grade_below_minimum" ? "grade"
                    : row.gate === "negative_edge" || row.gate === "negative_ev" ? "EV/edge"
                      : row.gate === "high_risk_value_play" ? "high risk"
                        : row.gate === "unresolved_event" ? "unsupported normalization"
                          : "other explicit reason";
        nonPropRejectionAggregates[key] = (nonPropRejectionAggregates[key] ?? 0) + 1;
      }
      const snapshot = {
        requestId, stages, funnel, qualificationGateCounts, gameSimulations, nonPropRejections, nonPropRejectionAggregates, qualifiedCandidates, ticketVariety, familyTotals: summarizeFamilies(stages),
      };
      persistCoachMarketPipelineAudit(snapshot);
      console.log(
        "[coach-market-pipeline-audit]",
        JSON.stringify(snapshot),
      );
    },
  };
}

function summarizeFamilies(stages: Partial<Record<PipelineAuditStage, SportMarketCounts>>): Record<string, unknown> {
  const out: Record<string, Record<AuditMarketFamily, number>> = {};
  for (const [stage, bySport] of Object.entries(stages)) {
    const totals: Record<AuditMarketFamily, number> = {
      playerProps: 0, moneyline: 0, spread: 0, gameTotal: 0,
      teamTotal: 0, alternateGameLine: 0, touchdownBinary: 0, other: 0,
    };
    for (const families of Object.values(bySport ?? {})) {
      for (const [fam, n] of Object.entries(families) as [AuditMarketFamily, number][]) {
        totals[fam] += n;
      }
    }
    out[stage] = totals;
  }
  return out;
}

/** Filter picks that can enter MC for their market type. */
export function picksSimulationEligible(picks: readonly ParsedPick[]): ParsedPick[] {
  return picks.filter((pick) => {
    if (pick.isProp) return isRealisticBoardPropCandidate(pick);
    if (!isGameLinePick(pick)) return false;
    return marketSupportsSimulation(pick.market ?? "", pick);
  });
}

/** Legs that cleared staging pool roles. */
export function legsQualifiedForStaging(legs: readonly BoardScoredLeg[]): BoardScoredLeg[] {
  return legs.filter((leg) => boardLegPoolRole(leg.pick, leg.pick.finalAiScore) != null);
}

/** Record explicit non-prop qualification failures with gate codes. */
export function auditNonPropQualificationFailures(
  audit: ReturnType<typeof createCoachMarketPipelineAudit>,
  picks: readonly ParsedPick[],
  stage: PipelineAuditStage,
): void {
  for (const pick of picks) {
    audit.recordNonPropQualificationFailure(pick, stage);
  }
}

export function traceCoachMarketStageWithAudit(
  stage: CoachMarketStage,
  picks: readonly ParsedPick[],
  auditStage: PipelineAuditStage | null,
  audit: ReturnType<typeof createCoachMarketPipelineAudit> | null,
): void {
  if (audit && auditStage) {
    if (auditStage === "raw_feed") audit.recordRawFeed(picks);
    else if (auditStage === "normalized") audit.recordNormalized(picks);
    else if (auditStage === "simulation_eligible") audit.recordSimulationEligible(picks);
    else if (auditStage === "final_selected") audit.recordFinalSelected(picks);
  }
  console.log(
    "[coach-market-diagnostics]",
    JSON.stringify({ stage, counts: countsByMarketFamily(picks) }),
  );
}
