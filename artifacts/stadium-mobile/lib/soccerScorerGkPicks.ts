import type { PropPoolEntry } from "./api.ts";

const ANYTIME_GOAL = "player_goal_scorer_anytime";
const SOT = "player_shots_on_target";

function impliedProb(american: number): number {
  return american < 0 ? -american / (-american + 100) : 100 / (american + 100);
}

/** Rank soccer scorer/GK prop pool entries — anytime goal first, main SOT rungs only. */
export function selectSoccerScorerGkPropEntries(
  propPool: PropPoolEntry[],
  opts?: { target?: number },
): PropPoolEntry[] {
  const target = Math.min(6, Math.max(4, opts?.target ?? 6));
  const soccer = propPool.filter((e) => e.sport === "soccer");
  if (!soccer.length) return [];

  const seenPlayerGame = new Set<string>();
  const perGame = new Map<string, number>();
  const out: PropPoolEntry[] = [];

  const tryAdd = (e: PropPoolEntry): boolean => {
    if (out.length >= target) return false;
    const key = `${e.game}|${e.player}`.toLowerCase();
    if (seenPlayerGame.has(key)) return false;
    if ((perGame.get(e.game) ?? 0) >= 2) return false;
    seenPlayerGame.add(key);
    perGame.set(e.game, (perGame.get(e.game) ?? 0) + 1);
    out.push(e);
    return true;
  };

  const anytime = soccer
    .filter(
      (e) =>
        e.marketKey === ANYTIME_GOAL &&
        e.side === "Over" &&
        typeof e.odds === "number" &&
        e.odds >= 110 &&
        e.odds <= 900,
    )
    .sort((a, b) => impliedProb(b.odds) - impliedProb(a.odds));

  for (const e of anytime) {
    if (out.length >= target) break;
    tryAdd(e);
  }

  const sot = soccer
    .filter(
      (e) =>
        e.marketKey === SOT &&
        e.side === "Over" &&
        e.line != null &&
        e.line <= 1.5 &&
        typeof e.odds === "number",
    )
    .sort((a, b) => impliedProb(b.odds) - impliedProb(a.odds));

  for (const e of sot) {
    if (out.length >= target) break;
    tryAdd(e);
  }

  return out.slice(0, target);
}
