// Merge sportsbook-posted game lines into the eval ladder for full-board scan.

import { isGameLevelMarket } from "./propLegParse.ts";

export type PostedGameLine = {
  sport: string;
  game: string;
  market: string;
  pick: string;
  odds: number;
  startsAt?: string;
  edge?: number | null;
  noVigFair?: number | null;
  bookSpread?: number | null;
};

const norm = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function teamsMatch(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  const nick = (s: string) => {
    const t = norm(s).split(" ").filter(Boolean);
    return t[t.length - 1] ?? "";
  };
  return nick(a).length > 2 && nick(a) === nick(b);
}

function gameLabelsMatch(a: string, b: string): boolean {
  const pa = String(a ?? "").split(" @ ");
  const pb = String(b ?? "").split(" @ ");
  if (pa.length !== 2 || pb.length !== 2) return norm(a) === norm(b);
  return teamsMatch(pa[0]!, pb[0]!) && teamsMatch(pa[1]!, pb[1]!);
}

const oddsEntryKey = (e: PostedGameLine) =>
  `${e.game}|${e.market.toLowerCase()}|${e.pick}`.toLowerCase();

/** Merge any sportsbook-posted game lines from realOdds that the eval ladder missed. */
export function augmentEvalLinesWithPostedOdds<T extends PostedGameLine>(
  evalLinesByGame: Map<string, T[]>,
  realOdds: T[],
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const [game, lines] of evalLinesByGame) {
    out.set(game, [...lines]);
  }

  for (const e of realOdds) {
    if (!isGameLevelMarket(e.market)) continue;
    let targetGame: string | null = null;
    if (out.has(e.game)) {
      targetGame = e.game;
    } else {
      for (const game of out.keys()) {
        if (gameLabelsMatch(game, e.game)) {
          targetGame = game;
          break;
        }
      }
    }
    if (!targetGame) continue;
    const lines = out.get(targetGame) ?? [];
    const keys = new Set(lines.map(oddsEntryKey));
    if (keys.has(oddsEntryKey(e))) continue;
    lines.push(e);
    out.set(targetGame, lines);
  }

  return out;
}
