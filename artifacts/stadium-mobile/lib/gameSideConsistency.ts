// One committed team per game for ML/spread legs — prevents Mets ML + Braves -1.5
// on the same ticket and aligns side picks to the shared game simulator.

import type { ParsedPick } from "./parsedPick.ts";
import type { MatchupHistoryEntry } from "./api.ts";
import {
  gameLabelsMatch,
  gameSimHasValidRun,
  isGameLinePick,
  lookupGameSim,
  type CoachGameSimEntry,
} from "./gameSimScoring.ts";

const norm = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const teamNick = (team: string) => {
  const t = norm(team).split(" ").filter(Boolean);
  return t[t.length - 1] || "";
};

function teamsMatch(pickTeam: string, leanSide: string): boolean {
  const a = norm(pickTeam);
  const b = norm(leanSide);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const na = teamNick(pickTeam);
  const nb = teamNick(leanSide);
  if (na.length > 2 && na === nb) return true;
  const ta = new Set(a.split(" ").filter((w) => w.length > 2));
  return b
    .split(" ")
    .filter((w) => w.length > 2)
    .some((w) => ta.has(w));
}

const SIM_SIDE_MARGIN = 0.03;

function splitLabel(label: string): { away: string; home: string } {
  const parts = String(label || "").split(" @ ");
  return { away: (parts[0] || "").trim(), home: (parts[1] || "").trim() };
}

function isMlOrSpreadPick(pick: ParsedPick): boolean {
  if (!isGameLinePick(pick)) return false;
  const m = String(pick.market ?? "").toLowerCase();
  if (/total|over|under|o\/u/.test(m) || /\b(over|under)\b/i.test(pick.pick)) return false;
  return true;
}

/** Which side the game sim favors when the edge is meaningful. */
export function simFavoredTeamSide(
  sim: CoachGameSimEntry | null | undefined,
): "home" | "away" | null {
  if (!gameSimHasValidRun(sim)) return null;
  const diff = Math.abs(sim!.homeWinProbability - sim!.awayWinProbability);
  if (diff < SIM_SIDE_MARGIN) return null;
  return sim!.homeWinProbability > sim!.awayWinProbability ? "home" : "away";
}

function lookupMatchupHistory(
  game: string,
  matchupHistory?: Record<string, MatchupHistoryEntry>,
): MatchupHistoryEntry | undefined {
  if (!matchupHistory) return undefined;
  const direct = matchupHistory[game];
  if (direct) return direct;
  for (const [label, entry] of Object.entries(matchupHistory)) {
    if (gameLabelsMatch(label, game)) return entry;
  }
  return undefined;
}

function leanSideForGame(
  game: string,
  away: string,
  home: string,
  matchupHistory?: Record<string, MatchupHistoryEntry>,
): "home" | "away" | null {
  const entry = lookupMatchupHistory(game, matchupHistory);
  const lean = entry?.mlLean?.side;
  if (!lean) return null;
  if (teamsMatch(home, lean)) return "home";
  if (teamsMatch(away, lean)) return "away";
  return null;
}

/** Group ML/spread legs by matchup — pick and sim labels may differ by nickname. */
function groupMlSpreadLegsByGame(picks: ParsedPick[]): Map<string, ParsedPick[]> {
  const groups: { game: string; legs: ParsedPick[] }[] = [];
  for (const p of picks) {
    if (!isMlOrSpreadPick(p)) continue;
    const existing = groups.find((g) => gameLabelsMatch(g.game, p.game));
    if (existing) existing.legs.push(p);
    else groups.push({ game: p.game, legs: [p] });
  }
  const byGame = new Map<string, ParsedPick[]>();
  for (const { game, legs } of groups) byGame.set(game, legs);
  return byGame;
}

function pickTeamName(pick: ParsedPick): string | null {
  const p = pick.pick || "";
  if (/\b(over|under)\b/i.test(p)) return null;
  return (
    p
      .replace(/\s*(ml|moneyline)\s*$/i, "")
      .replace(/\s*[+-]?\d+(?:\.\d+)?\s*$/, "")
      .trim() || null
  );
}

function pickTeamSide(
  pick: ParsedPick,
  away: string,
  home: string,
): "home" | "away" | null {
  const team = pickTeamName(pick);
  if (!team) return null;
  if (teamsMatch(team, home)) return "home";
  if (teamsMatch(team, away)) return "away";
  return null;
}

export type GameSideConsistencyResult = {
  picks: ParsedPick[];
  dropped: number;
  note: string;
};

/**
 * For each game, allow ML/spread legs on only ONE team. When the simulator (or
 * mlLean tiebreaker) names a side, drop legs on the opponent.
 */
export function enforceConsistentGameSides(
  picks: ParsedPick[],
  opts: {
    simByGame?: Map<string, CoachGameSimEntry>;
    matchupHistory?: Record<string, MatchupHistoryEntry>;
  } = {},
): GameSideConsistencyResult {
  const byGame = groupMlSpreadLegsByGame(picks);

  const dropKeys = new Set<string>();
  let dropped = 0;

  for (const [game, legs] of byGame) {
    const { away, home } = splitLabel(game);
    const sides = new Set(
      legs.map((l) => pickTeamSide(l, away, home)).filter((s): s is "home" | "away" => !!s),
    );
    if (sides.size <= 1) continue;

    const sim = lookupGameSim(game, opts.simByGame);
    let keep: "home" | "away" | null = simFavoredTeamSide(sim);
    if (!keep) keep = leanSideForGame(game, away, home, opts.matchupHistory);
    if (!keep) {
      // First leg wins when no authoritative signal — still better than both sides.
      keep = pickTeamSide(legs[0]!, away, home);
    }
    if (!keep) continue;

    for (const leg of legs) {
      const side = pickTeamSide(leg, away, home);
      if (side && side !== keep) {
        const k = `${leg.game}|${leg.market}|${leg.pick}`.toLowerCase();
        dropKeys.add(k);
      }
    }
  }

  const kept: ParsedPick[] = [];
  for (const p of picks) {
    const k = `${p.game}|${p.market}|${p.pick}`.toLowerCase();
    if (dropKeys.has(k)) {
      dropped += 1;
      continue;
    }
    kept.push(p);
  }

  let note = "";
  if (dropped > 0) {
    note = `_Dropped ${dropped} leg${dropped === 1 ? "" : "s"} that backed the opposing team on the same game — one side per matchup (aligned to the game simulator when available)._`;
  }

  return { picks: kept, dropped, note };
}
