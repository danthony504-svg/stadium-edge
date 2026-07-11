// Step 2: fill with highest-rated mains. Step 3: qualifying alts to reach N.

import type { ParsedPick } from "../components/PickCard.tsx";
import { isAltBoardPick, isMainBoardPick } from "./altLinePool.ts";
import type { TicketStagingBreakdown } from "./fullBoardMarketCopy.ts";
import { gameLineLegBucket, isGameLinePick } from "./gameSimScoring.ts";
import { selectCorrelationAwareBoardLegs } from "./parlayCorrelationScore.ts";
import { pickLegFingerprint } from "./parlayReachCore.ts";
import { pickIsAiRecommended, qualifiesAltPick } from "./pickRecommendation.ts";

function pickRank(p: ParsedPick): number {
  return p.finalAiScore?.composite ?? p.scores?.composite ?? 0;
}

/** Lightweight same-team game-line dedupe without React/PickCard runtime imports. */
function dedupeSameTeamGameLegsLite(picks: ParsedPick[]): ParsedPick[] {
  const bucketIndex = new Map<string, number>();
  const out: ParsedPick[] = [];
  for (const p of picks) {
    if (!isGameLinePick(p) || p.isProp) {
      out.push(p);
      continue;
    }
    const bucket = gameLineLegBucket(p.game, p.market, p.pick);
    const idx = bucketIndex.get(bucket);
    if (idx == null) {
      bucketIndex.set(bucket, out.length);
      out.push(p);
      continue;
    }
    if (pickRank(p) > pickRank(out[idx]!)) out[idx] = p;
  }
  return out;
}

export type BoardScoredLeg = {
  pick: ParsedPick;
  evPct: number | null;
  edgePct: number | null;
  confidencePct: number | null;
  impliedProbPct: number | null;
  lineShoppingScore: number | null;
  grade: string | null;
  simHit: number | null;
  composite: number | null;
  rankScore: number;
};

export function boardLegPoolRole(
  pick: ParsedPick,
  score: ParsedPick["finalAiScore"],
): "main" | "alt" | null {
  if (isMainBoardPick(pick)) {
    return pickIsAiRecommended(pick, score ?? undefined) ? "main" : null;
  }
  if (isAltBoardPick(pick)) {
    return qualifiesAltPick(pick, score ?? undefined) ? "alt" : null;
  }
  if (pickIsAiRecommended(pick, score ?? undefined)) return "main";
  if (qualifiesAltPick(pick, score ?? undefined)) return "alt";
  return null;
}

/** Greedy top-N by rank — correlation-aware when building multi-leg tickets. */
export function selectTopBoardLegs(ranked: BoardScoredLeg[], target: number): ParsedPick[] {
  if (target >= 3) {
    return dedupeSameTeamGameLegsLite(selectCorrelationAwareBoardLegs(ranked, target)).slice(0, target);
  }
  const seen = new Set<string>();
  const out: ParsedPick[] = [];
  for (const row of ranked) {
    const fp = pickLegFingerprint(row.pick);
    if (seen.has(fp)) continue;
    seen.add(fp);
    out.push(row.pick);
    if (out.length >= target) break;
  }
  return dedupeSameTeamGameLegsLite(out).slice(0, target);
}

/** Step 2: highest-rated mains first. Step 3: qualifying alts to reach target. */
export function buildStagedTicketFromScan(
  scored: BoardScoredLeg[],
  target: number,
): { picks: ParsedPick[]; breakdown: TicketStagingBreakdown } {
  const mains: BoardScoredLeg[] = [];
  const alts: BoardScoredLeg[] = [];

  for (const leg of scored) {
    const role = boardLegPoolRole(leg.pick, leg.pick.finalAiScore);
    if (role === "main") mains.push(leg);
    else if (role === "alt") alts.push(leg);
  }

  mains.sort((a, b) => b.rankScore - a.rankScore);
  alts.sort((a, b) => b.rankScore - a.rankScore);

  const mainPicks = selectTopBoardLegs(mains, target).map((p) => ({
    ...p,
    ticketRole: "main" as const,
  }));
  const gap = Math.max(0, target - mainPicks.length);
  const used = new Set(mainPicks.map(pickLegFingerprint));
  const altPool = alts.filter((l) => !used.has(pickLegFingerprint(l.pick)));
  const altPicks = selectTopBoardLegs(altPool, gap).map((p) => ({
    ...p,
    ticketRole: "alt" as const,
  }));

  return {
    picks: [...mainPicks, ...altPicks],
    breakdown: {
      mainQualified: mains.length,
      altQualified: alts.length,
      mainOnTicket: mainPicks.length,
      altOnTicket: altPicks.length,
    },
  };
}
