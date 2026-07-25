// Per-market ladder selection — every posted standard and alternate rung competes
// using its own simulation, price, EV, edge, confidence, and AI score.

import type { ParsedPick } from "../components/PickCard.tsx";
import { isAltPropPick, isMainBoardPick, isMainLineGameLeg, marketFamily } from "./altLinePool.ts";
import { boardLegPoolRole, type BoardScoredLeg } from "./ticketStaging.ts";

const norm = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function pickSideKey(pick: string): string {
  const p = norm(pick);
  if (/\bover\b/.test(p)) return "over";
  if (/\bunder\b/.test(p)) return "under";
  const t = pick
    .replace(/\s*(ml|moneyline)\s*$/i, "")
    .replace(/\s*[+-]?\d+(?:\.\d+)?\s*$/, "")
    .trim();
  return norm(t);
}

/** Stable key for one posted market ladder (game line family or player prop market). */
export function marketLadderKey(pick: ParsedPick): string {
  if (pick.isProp) {
    const player = norm(pick.player ?? pick.pick.split(/\s+/)[0] ?? "");
    const market = norm(pick.market);
    const side = pick.propSide ?? (/\bover\b/i.test(pick.pick) ? "Over" : /\bunder\b/i.test(pick.pick) ? "Under" : "");
    return `${norm(pick.game)}|prop|${player}|${market}|${side}`.toLowerCase();
  }
  return `${norm(pick.game)}|${marketFamily(pick.market)}|${pickSideKey(pick.pick)}`.toLowerCase();
}

function ladderSortRank(leg: BoardScoredLeg): number {
  const pick = leg.pick;
  if (pick.isProp) {
    if (!isAltPropPick(pick)) return 0;
    return 1;
  }
  if (isMainLineGameLeg(pick)) return 0;
  return 1;
}

/**
 * Qualify every rung in a market ladder, then select the highest ranked
 * positive-EV candidate. A main line only wins an exact score tie, preventing
 * an alternate run line with better value from being hidden behind the standard.
 */
export function collapseScoredLegsByMarketLadder(scored: BoardScoredLeg[]): BoardScoredLeg[] {
  const byLadder = new Map<string, BoardScoredLeg[]>();
  for (const leg of scored) {
    const key = marketLadderKey(leg.pick);
    const arr = byLadder.get(key) ?? [];
    arr.push(leg);
    byLadder.set(key, arr);
  }

  const out: BoardScoredLeg[] = [];
  for (const ladder of byLadder.values()) {
    ladder.sort((a, b) => {
      if (a.rankScore !== b.rankScore) return b.rankScore - a.rankScore;
      const tierA = ladderSortRank(a);
      const tierB = ladderSortRank(b);
      if (tierA !== tierB) return tierA - tierB;
      return 0;
    });
    for (const leg of ladder) {
      const role = boardLegPoolRole(leg.pick, leg.pick.finalAiScore);
      if (role === "main" || role === "alt") {
        out.push(leg);
        break;
      }
    }
  }
  return out;
}

/** Classify a pick's ladder tier for server/mobile parity. */
export function isMainLadderRung(pick: ParsedPick): boolean {
  if (pick.isProp) return !isAltPropPick(pick);
  return isMainLineGameLeg(pick) || isMainBoardPick(pick);
}
