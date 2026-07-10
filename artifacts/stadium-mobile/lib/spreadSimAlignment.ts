// When the 10k sim projects a tight margin, prefer +points on the backed team
// instead of laying -1.5 / -2.5 (e.g. Braves +1.5 when Mets edge is ~0.02 runs).

import type { GameMeta, RealOddsEntry } from "./api.ts";
import { isGameLinePick, type CoachGameSimEntry } from "./gameSimScoring.ts";

export type SpreadPick = {
  game: string;
  market: string;
  pick: string;
  odds: number;
  isProp?: boolean;
  sport?: string;
};

const SPREAD_FAM = /spread|run ?line|puck ?line/i;

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

function gameMarketFamily(market: string): string {
  const m = String(market ?? "").toLowerCase();
  let period = "";
  if (/\b1h\b|first half|1st half/.test(m)) period = "1h:";
  else if (/\b2h\b|second half|2nd half/.test(m)) period = "2h:";
  else if (/\bf5\b|first 5|1st 5/.test(m)) period = "f5:";
  let fam: string;
  if (/spread|run ?line|puck ?line/.test(m)) fam = "spread";
  else if (/total|over|under|o\/u/.test(m)) fam = "total";
  else if (/money|h2h|\bml\b/.test(m)) fam = "moneyline";
  else fam = m;
  return period + fam;
}

function spreadLineFromPick(pick: string): number | null {
  const m = String(pick).match(/([+-]?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function pickTeamName(pick: string): string | null {
  const p = String(pick ?? "");
  if (/\b(over|under)\b/i.test(p)) return null;
  const team = p
    .replace(/\s*(ml|moneyline)\s*$/i, "")
    .replace(/\s*[+-]?\d+(?:\.\d+)?\s*$/, "")
    .trim();
  return team || null;
}

function isSpreadPick(pick: SpreadPick): boolean {
  if (pick.isProp) return false;
  if (!isGameLinePick(pick as Parameters<typeof isGameLinePick>[0])) return false;
  return SPREAD_FAM.test(pick.market);
}

function projectedMarginForTeam(
  sim: CoachGameSimEntry,
  teamSide: "home" | "away",
): number {
  const home = sim.homeProjectedScore ?? 0;
  const away = sim.awayProjectedScore ?? 0;
  return teamSide === "home" ? home - away : away - home;
}

function teamSideFromPick(pick: SpreadPick): "home" | "away" | null {
  const team = pickTeamName(pick.pick);
  if (!team) return null;
  const parts = pick.game.split(" @ ");
  if (parts.length !== 2) return null;
  const away = parts[0]!.trim();
  const home = parts[1]!.trim();
  if (teamsMatch(team, home)) return "home";
  if (teamsMatch(team, away)) return "away";
  return null;
}

/** True when sim does not project enough margin to cover laying `line` points. */
export function simPrefersPlusPoints(
  sim: CoachGameSimEntry | null | undefined,
  teamSide: "home" | "away",
  spreadLine: number,
): boolean {
  if (!sim || spreadLine >= 0) return false;
  const margin = projectedMarginForTeam(sim, teamSide);
  return margin < Math.abs(spreadLine) - 0.15;
}

function findPlusPointsRung(
  pick: SpreadPick,
  teamName: string,
  realOdds: RealOddsEntry[],
): RealOddsEntry | null {
  const fam = gameMarketFamily(pick.market);
  const candidates = realOdds.filter(
    (r) =>
      r.game === pick.game &&
      gameMarketFamily(r.market) === fam &&
      teamsMatch(pickTeamName(r.pick) ?? "", teamName),
  );
  const plus = candidates
    .map((r) => ({ r, line: spreadLineFromPick(r.pick) }))
    .filter((x): x is { r: RealOddsEntry; line: number } => x.line != null && x.line > 0)
    .sort((a, b) => b.line - a.line);
  return plus[0]?.r ?? null;
}

export type SpreadSimAlignResult = {
  picks: SpreadPick[];
  swapped: number;
  note: string;
};

/**
 * Swap spread legs that lay points (-1.5, -2.5) to the same team's +points rung
 * when the shared game sim does not project enough margin to cover.
 */
export function enforceSimAlignedSpreadPicks<T extends SpreadPick>(
  picks: T[],
  simByGame: Map<string, CoachGameSimEntry>,
  _opts: {
    realOdds?: RealOddsEntry[];
    gameMeta?: GameMeta[];
  } = {},
): SpreadSimAlignResult & { picks: T[] } {
  const realOdds = _opts.realOdds ?? [];
  let swapped = 0;
  const out: T[] = [];

  for (const pick of picks) {
    if (!isSpreadPick(pick)) {
      out.push(pick);
      continue;
    }
    const line = spreadLineFromPick(pick.pick);
    const teamSide = teamSideFromPick(pick);
    const sim = simByGame.get(pick.game);
    if (line == null || teamSide == null || !sim || line >= 0) {
      out.push(pick);
      continue;
    }
    if (!simPrefersPlusPoints(sim, teamSide, line)) {
      out.push(pick);
      continue;
    }
    const teamName = pickTeamName(pick.pick);
    if (!teamName) {
      out.push(pick);
      continue;
    }
    const plusRung = findPlusPointsRung(pick, teamName, realOdds);
    if (!plusRung) {
      out.push(pick);
      continue;
    }
    swapped += 1;
    out.push({
      ...pick,
      market: plusRung.market,
      pick: plusRung.pick,
      odds: plusRung.odds,
      sport: plusRung.sport ?? pick.sport,
    } as T);
  }

  const note =
    swapped > 0
      ? `_Swapped ${swapped} spread leg${swapped === 1 ? "" : "s"} to **+points** — the 10k sim projects a tight margin, so laying runs/lines is a poor fit (e.g. Braves +1.5 instead of -1.5)._`
      : "";

  return { picks: out, swapped, note };
}
