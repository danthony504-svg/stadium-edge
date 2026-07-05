// Close-game spread policy: prefer qualified alt spreads over main spreads.

import type { RealOddsEntry } from "./api.ts";
import type { FinalAiScore } from "./finalAiScore.ts";
import type { CoachGameSimEntry } from "./gameSimScoring.ts";
import { isMainTicketQualified } from "./parlayQualifiedGate.ts";
import { isCloseGameForTeamSpread } from "./spreadSimAlignment.ts";

export type CloseGameSpreadRow = {
  entry: RealOddsEntry;
  finalAiScore: FinalAiScore;
  winProb: number | null;
  edgePct: number | null;
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
  const na = nick(a);
  const nb = nick(b);
  if (na.length > 2 && na === nb) return true;
  const ta = new Set(x.split(" ").filter((w) => w.length > 2));
  return y
    .split(" ")
    .filter((w) => w.length > 2)
    .some((w) => ta.has(w));
}

function pickTeamName(pick: string): string | null {
  const p = String(pick ?? "");
  if (/\b(over|under)\b/i.test(p)) return null;
  return (
    p
      .replace(/\s*(ml|moneyline)\s*$/i, "")
      .replace(/\s*[+-]?\d+(?:\.\d+)?\s*$/, "")
      .trim() || null
  );
}

function teamSideFromName(game: string, team: string): "home" | "away" | null {
  const parts = game.split(" @ ");
  if (parts.length !== 2) return null;
  const away = parts[0]!.trim();
  const home = parts[1]!.trim();
  if (teamsMatch(team, home)) return "home";
  if (teamsMatch(team, away)) return "away";
  return null;
}

function isMainSpreadMarket(market: string): boolean {
  return /^spread$/i.test(String(market ?? "").trim());
}

function isAltSpreadMarket(market: string): boolean {
  return /^alt spread$/i.test(String(market ?? "").trim());
}

function isGameTotalEntry(entry: RealOddsEntry): boolean {
  return /\b(over|under)\b/i.test(entry.pick) && !/team total/i.test(entry.market);
}

function isTeamSidedFullGameEntry(entry: RealOddsEntry): boolean {
  const m = String(entry.market ?? "").trim();
  if (!/^(moneyline|spread|alt spread|total|alt total|team total)$/i.test(m)) return false;
  if (isGameTotalEntry(entry)) return false;
  return pickTeamName(entry.pick) != null;
}

function rankCloseGameAltSpread(a: CloseGameSpreadRow, b: CloseGameSpreadRow): number {
  const ae = a.edgePct ?? -999;
  const be = b.edgePct ?? -999;
  if (be !== ae) return be - ae;
  const aw = a.winProb ?? 0;
  const bw = b.winProb ?? 0;
  return bw - aw;
}

/** Pick the alt spread with the highest +EV and sim win rate. */
export function selectBestCloseGameAltSpread(
  ranked: CloseGameSpreadRow[],
): CloseGameSpreadRow | null {
  const eligible = ranked
    .filter((r) => isAltSpreadMarket(r.entry.market))
    .filter((r) => isMainTicketQualified(r.finalAiScore, r.entry.odds ?? null));
  if (!eligible.length) return null;
  return [...eligible].sort(rankCloseGameAltSpread)[0]!;
}

/**
 * On tight sim projections, only alt spreads with +EV may represent the game.
 * Drops main spreads / ML when a better alt exists; drops all team-sided lines
 * when no qualifying alt is posted.
 */
export function filterRowsForCloseGameSpread(
  rows: CloseGameSpreadRow[],
  sim: CoachGameSimEntry | null | undefined,
  evalLines: RealOddsEntry[],
): CloseGameSpreadRow[] {
  if (!sim || !rows.length) return rows;
  const byTeam = new Map<string, CloseGameSpreadRow[]>();
  for (const row of rows) {
    const team = pickTeamName(row.entry.pick);
    if (!team || !isTeamSidedFullGameEntry(row.entry)) continue;
    const key = norm(team);
    const arr = byTeam.get(key) ?? [];
    arr.push(row);
    byTeam.set(key, arr);
  }

  const drop = new Set<CloseGameSpreadRow>();
  for (const [, teamRows] of byTeam) {
    const team = pickTeamName(teamRows[0]!.entry.pick);
    if (!team) continue;
    const side = teamSideFromName(teamRows[0]!.entry.game, team);
    if (!isCloseGameForTeamSpread(sim, side, evalLines, team)) continue;

    const bestAlt = selectBestCloseGameAltSpread(teamRows);
    if (!bestAlt) {
      for (const row of teamRows) {
        if (isTeamSidedFullGameEntry(row.entry) && !isGameTotalEntry(row.entry)) drop.add(row);
      }
      continue;
    }
    for (const row of teamRows) {
      if (isMainSpreadMarket(row.entry.market) || /^moneyline$/i.test(row.entry.market.trim())) {
        drop.add(row);
        continue;
      }
      if (isAltSpreadMarket(row.entry.market) && row !== bestAlt) drop.add(row);
    }
  }

  if (!drop.size) return rows;
  return rows.filter((r) => !drop.has(r));
}
