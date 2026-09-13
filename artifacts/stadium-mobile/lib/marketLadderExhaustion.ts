// Per-market ladder exhaustion — one qualifying rung per ladder.
// Game lines: prefer the main posted line, then alt rungs by rank.
// Player props: prefer the best-scoring posted line (main or alt number) so
// rush/pass yards, attempts, and completions can land on 150 / 175 / etc. when
// that rung outranks the main O/U — without changing Coach hold/delivery.

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

function isYardsPropMarketLabel(market: string | null | undefined): boolean {
  const m = norm(market ?? "");
  return (
    /\brush yds\b/.test(m) ||
    /\bpass yds\b/.test(m) ||
    /\brec yds\b/.test(m) ||
    /\breceiving yards\b/.test(m) ||
    /\brushing yards\b/.test(m) ||
    /\bpassing yards\b/.test(m)
  );
}

/** Near-tie on yards ladders: prefer higher posted milestone numbers. */
const YARDS_LADDER_SCORE_TIE_EPS = 0.5;

function comparePropLadderRungs(a: BoardScoredLeg, b: BoardScoredLeg): number {
  const scoreDiff = b.rankScore - a.rankScore;
  if (Math.abs(scoreDiff) > YARDS_LADDER_SCORE_TIE_EPS) return scoreDiff;
  if (isYardsPropMarketLabel(a.pick.market)) {
    const lineA = a.pick.propLine ?? 0;
    const lineB = b.pick.propLine ?? 0;
    if (lineB !== lineA) return lineB - lineA;
  }
  if (scoreDiff !== 0) return scoreDiff;
  return ladderSortRank(a) - ladderSortRank(b);
}

/**
 * Within each market ladder, keep the first qualifying rung.
 * - Game lines: mains first, then alts by rank (unchanged).
 * - Player props: best rankScore wins among qualifying rungs so posted alt
 *   yard/attempt/completion numbers (150, 175, …) can beat the main O/U when
 *   they score higher — without putting two rungs of the same ladder on a ticket.
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
    const propLadder = ladder.some((leg) => !!leg.pick.isProp);
    ladder.sort((a, b) => {
      if (propLadder) {
        return comparePropLadderRungs(a, b);
      }
      const tierA = ladderSortRank(a);
      const tierB = ladderSortRank(b);
      if (tierA !== tierB) return tierA - tierB;
      return b.rankScore - a.rankScore;
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
