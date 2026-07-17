// Tiered parlay fill — elite (A+, conf≥9) → expanded (A+, conf≥8.5) → safety EV top-up.
// Never return an empty ticket when the board has legs that clear the safety floor.

import type { ParsedPick } from "../components/PickCard.tsx";
import { confidenceScoreFromSignals } from "./confidence.ts";
import {
  absoluteFloorForStyle,
  type CoachTicketStyle,
  type QualityTierGrade,
  poolRoleAtMinGrade,
} from "./coachTicketQualityTiers.ts";
import { pickLegFingerprint } from "./parlayReachCore.ts";
import {
  boardLegPoolRole,
  capThinStatMarketsOnTicket,
  selectTopBoardLegs,
  type BoardScoredLeg,
} from "./ticketStaging.ts";

export const ELITE_MIN_CONFIDENCE = 9;
export const EXPANDED_MIN_CONFIDENCE = 8.5;

const GRADE_RANK: Record<string, number> = {
  F: 0,
  D: 1,
  "C-": 2,
  C: 3,
  "C+": 4,
  "B-": 5,
  B: 6,
  "B+": 7,
  "A-": 8,
  A: 9,
  "A+": 10,
};

function gradeRank(g: string | null | undefined): number {
  if (!g) return -1;
  return GRADE_RANK[g] ?? -1;
}

export type TieredPoolChoice = "elite" | "expanded" | "strict" | "mixed";

export type TieredFillSummary = {
  eliteCount: number;
  expandedCount: number;
  strictQualifiedCount: number;
  selectedPool: TieredPoolChoice;
  safetyFillCount: number;
  expandedFillCount: number;
};

function gradeOf(leg: BoardScoredLeg): string {
  return leg.pick.finalAiScore?.grade ?? leg.grade ?? "F";
}

/** Confidence on the 0–10 rubric band (signals first, else sim confidence % / 10). */
export function confidenceOn10Scale(leg: BoardScoredLeg): number | null {
  const score = leg.pick.finalAiScore;
  const fromSignals = confidenceScoreFromSignals(
    score?.rubric?.scores ?? leg.pick.scores?.scores,
  );
  if (fromSignals != null) return fromSignals;
  const pct = score?.confidencePct ?? leg.confidencePct;
  if (pct == null || !Number.isFinite(pct)) return null;
  return Math.round(pct) / 10;
}

export function legIsStrictBoardQualified(leg: BoardScoredLeg): boolean {
  return boardLegPoolRole(leg.pick, leg.pick.finalAiScore) != null;
}

export function legMeetsEliteTier(leg: BoardScoredLeg): boolean {
  if (!legIsStrictBoardQualified(leg)) return false;
  if (gradeRank(gradeOf(leg)) < gradeRank("A+")) return false;
  const conf = confidenceOn10Scale(leg);
  return conf != null && conf >= ELITE_MIN_CONFIDENCE;
}

export function legMeetsExpandedTier(leg: BoardScoredLeg): boolean {
  if (!legIsStrictBoardQualified(leg)) return false;
  if (gradeRank(gradeOf(leg)) < gradeRank("A")) return false;
  const conf = confidenceOn10Scale(leg);
  return conf != null && conf >= EXPANDED_MIN_CONFIDENCE;
}

export function legMeetsSafetyEvTier(
  leg: BoardScoredLeg,
  ticketStyle: CoachTicketStyle,
): boolean {
  const floor = absoluteFloorForStyle(ticketStyle);
  return poolRoleAtMinGrade(leg.pick, leg.pick.finalAiScore, floor) != null;
}

function tierCounts(allScored: BoardScoredLeg[]) {
  const strict = allScored.filter(legIsStrictBoardQualified);
  return {
    strict,
    elite: strict.filter(legMeetsEliteTier),
    expanded: strict.filter(legMeetsExpandedTier),
  };
}

/** Pick the narrowest scored pool that can still fill the requested leg count. */
export function resolveQualifyingPoolForTarget(
  allScored: BoardScoredLeg[],
  target: number,
  ticketStyle: CoachTicketStyle,
): { pool: BoardScoredLeg[]; summary: TieredFillSummary } {
  const { strict, elite, expanded } = tierCounts(allScored);
  const base: TieredFillSummary = {
    eliteCount: elite.length,
    expandedCount: expanded.length,
    strictQualifiedCount: strict.length,
    selectedPool: "mixed",
    safetyFillCount: 0,
    expandedFillCount: 0,
  };

  if (elite.length >= target) {
    return { pool: elite, summary: { ...base, selectedPool: "elite" } };
  }
  if (expanded.length >= target) {
    return { pool: expanded, summary: { ...base, selectedPool: "expanded" } };
  }
  if (strict.length >= target) {
    return { pool: strict, summary: { ...base, selectedPool: "strict" } };
  }

  const safety = allScored.filter((leg) => legMeetsSafetyEvTier(leg, ticketStyle));
  const pool = expanded.length > 0 ? expanded : strict.length > 0 ? strict : safety;
  return { pool, summary: { ...base, selectedPool: "mixed" } };
}

function stagedPickFromTieredRow(
  row: BoardScoredLeg,
  fillTier?: QualityTierGrade,
): ParsedPick | null {
  const strictRole = boardLegPoolRole(row.pick, row.pick.finalAiScore);
  const role =
    strictRole ??
    poolRoleAtMinGrade(row.pick, row.pick.finalAiScore, fillTier ?? "B") ??
    null;
  if (!role) return null;
  return {
    ...row.pick,
    ticketRole: role,
    highRiskValuePlay: false,
    ...(strictRole || !fillTier ? {} : { coachFillTier: fillTier }),
  };
}

/** Top up a short ticket from expanded tier, then highest-EV safety legs. */
export function tieredFillToTarget(
  ticket: ParsedPick[],
  target: number,
  allScored: BoardScoredLeg[],
  ticketStyle: CoachTicketStyle,
  varietySeed?: string,
): { picks: ParsedPick[]; summary: TieredFillSummary } {
  const { strict, elite, expanded } = tierCounts(allScored);
  const floor = absoluteFloorForStyle(ticketStyle);
  const summary: TieredFillSummary = {
    eliteCount: elite.length,
    expandedCount: expanded.length,
    strictQualifiedCount: strict.length,
    selectedPool: "mixed",
    safetyFillCount: 0,
    expandedFillCount: 0,
  };

  let current = capThinStatMarketsOnTicket(ticket, target).slice(0, target);
  if (current.length >= target) {
    return { picks: current, summary };
  }

  const used = new Set(current.map(pickLegFingerprint));

  if (current.length < target) {
    const expandedPool = expanded.filter((leg) => !used.has(pickLegFingerprint(leg.pick)));
    const need = target - current.length;
    const additions = selectTopBoardLegs(expandedPool, need, varietySeed);
    for (const raw of additions) {
      const row = expandedPool.find((l) => pickLegFingerprint(l.pick) === pickLegFingerprint(raw));
      if (!row) continue;
      const staged = stagedPickFromTieredRow(
        row,
        boardLegPoolRole(row.pick, row.pick.finalAiScore) ? undefined : "A",
      );
      if (!staged) continue;
      const fp = pickLegFingerprint(staged);
      if (used.has(fp)) continue;
      const trial = capThinStatMarketsOnTicket([...current, staged], target);
      if (trial.length <= current.length) continue;
      current = trial;
      used.add(fp);
      if (staged.coachFillTier) summary.expandedFillCount += 1;
    }
  }

  if (current.length < target) {
    const safetyPool = allScored
      .filter((leg) => !used.has(pickLegFingerprint(leg.pick)))
      .filter((leg) => legMeetsSafetyEvTier(leg, ticketStyle))
      .sort((a, b) => (b.evPct ?? 0) - (a.evPct ?? 0));

    for (const row of safetyPool) {
      if (current.length >= target) break;
      const staged = stagedPickFromTieredRow(
        row,
        boardLegPoolRole(row.pick, row.pick.finalAiScore) ? undefined : floor,
      );
      if (!staged) continue;
      const fp = pickLegFingerprint(staged);
      if (used.has(fp)) continue;
      const trial = capThinStatMarketsOnTicket([...current, staged], target);
      if (trial.length <= current.length) continue;
      current = trial;
      used.add(fp);
      summary.safetyFillCount += 1;
    }
  }

  return { picks: current.slice(0, target), summary };
}

/** User-facing note when tiers were relaxed to reach the requested leg count. */
export function buildTieredFillLegNote(
  summary: TieredFillSummary,
  requested: number,
  delivered: number,
): string {
  if (delivered <= 0) return "";

  const parts: string[] = [];
  if (summary.eliteCount < requested) {
    parts.push(
      `Elite bar (A+, confidence ≥${ELITE_MIN_CONFIDENCE}/10): **${summary.eliteCount}** pick${summary.eliteCount === 1 ? "" : "s"}`,
    );
    if (summary.expandedCount > summary.eliteCount) {
      parts.push(
        `expanded to A or better with confidence ≥${EXPANDED_MIN_CONFIDENCE}/10 — **${summary.expandedCount}** qualified`,
      );
    }
  }
  if (summary.safetyFillCount > 0) {
    parts.push(
      `filled the remaining **${summary.safetyFillCount}** leg${summary.safetyFillCount === 1 ? "" : "s"} with the highest-EV picks that still pass minimum safety gates`,
    );
  }
  if (
    summary.selectedPool === "expanded" &&
    summary.eliteCount < requested &&
    delivered >= requested &&
    !summary.safetyFillCount
  ) {
    return `_Elite bar (A+, confidence ≥${ELITE_MIN_CONFIDENCE}/10): **${summary.eliteCount}** pick${summary.eliteCount === 1 ? "" : "s"}. Expanded to A or better with confidence ≥${EXPANDED_MIN_CONFIDENCE}/10 — **${summary.expandedCount}** qualified. Returning the best **${delivered}**._`;
  }
  if (!parts.length) return "";
  return `_${parts.join("; ")}._`;
}
