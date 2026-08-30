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

export type PipelineAuditStage =
  | "raw_feed"
  | "normalized"
  | "simulation_eligible"
  | "qualified"
  | "ranked"
  | "final_selected";

export type SportMarketCounts = Record<string, Record<CoachMarketFamily, number>>;

export type FootballRejection = {
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
  footballRejections: FootballRejection[];
};

const FOOTBALL_SPORTS = new Set(["nfl", "ncaaf"]);

function normSport(s: string | null | undefined): string {
  return String(s ?? "unknown").toLowerCase();
}

function bump(counts: SportMarketCounts, pick: ParsedPick): void {
  const sport = normSport(pick.sport);
  const family = coachMarketFamily(pick);
  counts[sport] ??= {
    moneyline: 0,
    spread: 0,
    gameTotal: 0,
    teamTotal: 0,
    playerOu: 0,
    milestone: 0,
    alternate: 0,
  };
  counts[sport]![family] += 1;
}

function countsFromPicks(picks: readonly ParsedPick[]): SportMarketCounts {
  const out: SportMarketCounts = {};
  for (const pick of picks) bump(out, pick);
  return out;
}

function isFootballPick(pick: ParsedPick): boolean {
  return FOOTBALL_SPORTS.has(normSport(pick.sport));
}

function footballRejectionFromQualification(
  pick: ParsedPick,
  stage: PipelineAuditStage,
  gate: BoardLegGateCode,
  reason: string,
): FootballRejection {
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
  recordFinalSelected: (picks: readonly ParsedPick[]) => void;
  recordFootballQualificationFailure: (pick: ParsedPick, stage: PipelineAuditStage) => void;
  recordFootballCandidate: (
    pick: ParsedPick,
    stage: PipelineAuditStage,
    opts: { unresolvedEvent?: boolean; missingOdds?: boolean; simFailure?: boolean },
  ) => void;
  emitTrace: () => void;
} {
  const stages: Partial<Record<PipelineAuditStage, SportMarketCounts>> = {};
  const footballRejections: FootballRejection[] = [];
  const seenFootballRejection = new Set<string>();

  const pushFootballRejection = (row: FootballRejection) => {
    const key = `${row.stage}|${row.event}|${row.selection}|${row.gate}`;
    if (seenFootballRejection.has(key)) return;
    seenFootballRejection.add(key);
    footballRejections.push(row);
  };

  const recordStage = (stage: PipelineAuditStage, picks: readonly ParsedPick[]) => {
    stages[stage] = countsFromPicks(picks);
  };

  return {
    snapshot: () => ({ requestId, stages, footballRejections }),
    recordRawFeed: (picks) => recordStage("raw_feed", picks),
    recordNormalized: (picks) => recordStage("normalized", picks),
    recordSimulationEligible: (picks) => recordStage("simulation_eligible", picks),
    recordQualified: (legs) => recordStage("qualified", legs.map((l) => l.pick)),
    recordRanked: (legs) => recordStage("ranked", legs.map((l) => l.pick)),
    recordFinalSelected: (picks) => recordStage("final_selected", picks),
    recordFootballQualificationFailure: (pick: ParsedPick, stage: PipelineAuditStage) => {
      if (!isFootballPick(pick)) return;
      const q = explainBoardLegQualification(pick, pick.finalAiScore);
      if (q.qualifies) return;
      pushFootballRejection(footballRejectionFromQualification(pick, stage, q.gate, q.reason));
    },
    recordFootballCandidate: (pick, stage, opts) => {
      if (!isFootballPick(pick)) return;
      if (opts.unresolvedEvent || !pick.game?.trim()) {
        pushFootballRejection({
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
        pushFootballRejection({
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
        pushFootballRejection({
          sport: normSport(pick.sport),
          stage,
          event: pick.game,
          marketFamily: coachMarketFamily(pick),
          selection: pick.pick,
          gate: "simulation_failure",
          reason: "Simulation did not produce a gradable hit rate",
        });
      }
    },
    emitTrace: () => {
      console.log(
        "[coach-market-pipeline-audit]",
        JSON.stringify({ requestId, stages, footballRejections, familyTotals: summarizeFamilies(stages) }),
      );
    },
  };
}

function summarizeFamilies(stages: Partial<Record<PipelineAuditStage, SportMarketCounts>>): Record<string, unknown> {
  const out: Record<string, Record<CoachMarketFamily, number>> = {};
  for (const [stage, bySport] of Object.entries(stages)) {
    const totals = countsByMarketFamily([]);
    for (const families of Object.values(bySport ?? {})) {
      for (const [fam, n] of Object.entries(families) as [CoachMarketFamily, number][]) {
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

/** Record explicit football qualification failures with gate codes. */
export function auditFootballQualificationFailures(
  audit: ReturnType<typeof createCoachMarketPipelineAudit>,
  picks: readonly ParsedPick[],
  stage: PipelineAuditStage,
): void {
  for (const pick of picks) {
    audit.recordFootballQualificationFailure(pick, stage);
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
