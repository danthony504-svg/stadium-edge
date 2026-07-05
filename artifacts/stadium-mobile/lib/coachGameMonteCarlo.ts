// Fetch game-outcome Monte Carlo for Coach game-line legs — same endpoint as Simulator.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { EspnGame } from "./api.ts";
import { fetchGameOutcomeSimulation } from "./api.ts";
import {
  buildGameCoverQuery,
  gamePickCoverQueryId,
  gameSimDisagreement,
  isGameLinePick,
  type CoachGameSimEntry,
  type GameCoverQuery,
} from "./gameSimScoring.ts";
import { enforceConsistentGameSides } from "./gameSideConsistency.ts";

export type { CoachGameSimEntry, GameCoverQuery };

export type GameTeamIds = {
  sport: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeam: string;
  awayTeam: string;
};

const nickname = (team: string) => {
  const t = String(team ?? "").trim().split(/\s+/);
  return (t[t.length - 1] ?? team).toLowerCase();
};

/** Map "Away @ Home" labels to ESPN team ids from a games fetch. */
export function buildGameTeamIdMap(games: EspnGame[]): Map<string, GameTeamIds> {
  const map = new Map<string, GameTeamIds>();
  for (const g of games) {
    const home = g.homeTeam || g.homeAbbr || "";
    const away = g.awayTeam || g.awayAbbr || "";
    if (!home || !away || !g.homeTeamId || !g.awayTeamId) continue;
    const label = `${away} @ ${home}`;
    map.set(label.toLowerCase(), {
      sport: g.sport,
      homeTeamId: g.homeTeamId,
      awayTeamId: g.awayTeamId,
      homeTeam: home,
      awayTeam: away,
    });
    map.set(`${nickname(away)}|${nickname(home)}`, {
      sport: g.sport,
      homeTeamId: g.homeTeamId,
      awayTeamId: g.awayTeamId,
      homeTeam: home,
      awayTeam: away,
    });
  }
  return map;
}

function resolveTeamIds(
  gameLabel: string,
  sport: string | undefined,
  map: Map<string, GameTeamIds>,
): GameTeamIds | null {
  const direct = map.get(gameLabel.toLowerCase());
  if (direct) return direct;
  const parts = gameLabel.split(" @ ");
  if (parts.length === 2) {
    const nick = `${nickname(parts[0]!)}|${nickname(parts[1]!)}`;
    const hit = map.get(nick);
    if (hit) return hit;
  }
  return null;
}

function uniqueCoverQueries(picks: ParsedPick[]): GameCoverQuery[] {
  const seen = new Set<string>();
  const out: GameCoverQuery[] = [];
  for (const p of picks) {
    const q = buildGameCoverQuery(p);
    if (!q || seen.has(q.id)) continue;
    seen.add(q.id);
    out.push(q);
  }
  return out;
}

const COACH_GAME_SIMS = 10_000;

/**
 * Run the same game-outcome Monte Carlo the Simulator uses for every unique
 * game that has a game-line leg in the ticket.
 */
export async function fetchCoachGameSimulationsForPicks(
  picks: ParsedPick[],
  teamIdsByGame: Map<string, GameTeamIds>,
  signal?: AbortSignal,
): Promise<Map<string, CoachGameSimEntry>> {
  const gameLegs = picks.filter(isGameLinePick);
  const byGame = new Map<string, ParsedPick[]>();
  for (const p of gameLegs) {
    const arr = byGame.get(p.game) ?? [];
    arr.push(p);
    byGame.set(p.game, arr);
  }

  const out = new Map<string, CoachGameSimEntry>();
  const entries = [...byGame.entries()];

  await Promise.all(
    entries.map(async ([gameLabel, legs]) => {
      const sport = legs[0]?.sport;
      const ids = resolveTeamIds(gameLabel, sport, teamIdsByGame);
      if (!ids) return;
      const coverQueries = uniqueCoverQueries(legs);
      const result = await fetchGameOutcomeSimulation(
        {
          sport: ids.sport || sport || "mlb",
          homeTeamId: ids.homeTeamId,
          awayTeamId: ids.awayTeamId,
          homeTeam: ids.homeTeam,
          awayTeam: ids.awayTeam,
          simulations: COACH_GAME_SIMS,
          coverQueries,
        },
        signal,
      );
      if (result) out.set(gameLabel, result as CoachGameSimEntry);
    }),
  );

  return out;
}

export function coachGameSimForPick(
  pick: ParsedPick,
  simByGame: Map<string, CoachGameSimEntry>,
): CoachGameSimEntry | undefined {
  return simByGame.get(pick.game);
}

export type GameSimFilterResult = {
  picks: ParsedPick[];
  removed: number;
  warnings: string[];
  note: string;
};

/**
 * Drop game-line legs the simulator does not support; attach alignment notes on survivors.
 */
export function filterCoachPicksWithGameSim(
  picks: ParsedPick[],
  simByGame: Map<string, CoachGameSimEntry>,
  opts: {
    matchupHistory?: Record<string, import("./api.ts").MatchupHistoryEntry>;
  } = {},
): GameSimFilterResult {
  const sideAligned = enforceConsistentGameSides(picks, {
    simByGame,
    matchupHistory: opts.matchupHistory,
  });
  picks = sideAligned.picks;

  const kept: ParsedPick[] = [];
  const warnings: string[] = [];
  let coverRemoved = 0;

  for (const p of picks) {
    if (!isGameLinePick(p)) {
      kept.push(p);
      continue;
    }
    const sim = coachGameSimForPick(p, simByGame);
    const disagree = gameSimDisagreement(p, sim);
    if (disagree) {
      coverRemoved += 1;
      warnings.push(`Dropped **${p.pick}** (${p.game}): ${disagree.reason}`);
      continue;
    }
    kept.push(p);
  }

  const noteParts: string[] = [];
  if (sideAligned.note) noteParts.push(sideAligned.note);
  if (coverRemoved > 0) {
    noteParts.push(
      `_Removed ${coverRemoved} game line${coverRemoved === 1 ? "" : "s"} the simulator did not support (cover rate below 52%)._`,
    );
  }
  const note = noteParts.join("\n\n");

  return {
    picks: kept,
    removed: sideAligned.dropped + coverRemoved,
    warnings,
    note,
  };
}

export { gamePickCoverQueryId, isGameLinePick };
