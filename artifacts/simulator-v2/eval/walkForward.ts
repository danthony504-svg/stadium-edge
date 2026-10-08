/**
 * Leak-free walk-forward team form: only games with kickoff < target kickoff.
 */

import type { FootballSport, HistoricalGame, QuarterTuple, TeamForm } from "./types.js";

function zeros(): QuarterTuple {
  return [0, 0, 0, 0];
}

function avgQuarter(rows: QuarterTuple[]): QuarterTuple {
  if (!rows.length) return zeros();
  const out: QuarterTuple = [0, 0, 0, 0];
  for (let q = 0; q < 4; q++) {
    let s = 0;
    for (const r of rows) s += r[q]!;
    out[q] = s / rows.length;
  }
  return out;
}

export type TeamGameLog = {
  kickoffMs: number;
  eventId: string;
  scoredQuarters: QuarterTuple;
  allowedQuarters: QuarterTuple;
  ptsFor: number;
  ptsAgainst: number;
};

/** Build chronological per-team logs from the full dataset. */
export function buildTeamLogs(games: HistoricalGame[]): Map<string, TeamGameLog[]> {
  const map = new Map<string, TeamGameLog[]>();
  const push = (teamId: string, row: TeamGameLog) => {
    const arr = map.get(teamId) ?? [];
    arr.push(row);
    map.set(teamId, arr);
  };
  for (const g of games) {
    const kickoffMs = new Date(g.kickoffIso).getTime();
    push(g.homeTeamId, {
      kickoffMs,
      eventId: g.eventId,
      scoredQuarters: g.homeQuarters,
      allowedQuarters: g.awayQuarters,
      ptsFor: g.homeFg,
      ptsAgainst: g.awayFg,
    });
    push(g.awayTeamId, {
      kickoffMs,
      eventId: g.eventId,
      scoredQuarters: g.awayQuarters,
      allowedQuarters: g.homeQuarters,
      ptsFor: g.awayFg,
      ptsAgainst: g.homeFg,
    });
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => a.kickoffMs - b.kickoffMs || a.eventId.localeCompare(b.eventId));
  }
  return map;
}

/**
 * Form available strictly before kickoff. Uses up to `window` most-recent prior games.
 * Returns null when either side lacks `minGames` history (skip — avoid cold-start leakage).
 */
export function formBeforeKickoff(
  logs: Map<string, TeamGameLog[]>,
  teamId: string,
  kickoffMs: number,
  opts?: { window?: number; minGames?: number },
): TeamForm | null {
  const window = opts?.window ?? 4;
  const minGames = opts?.minGames ?? 4;
  const all = logs.get(teamId) ?? [];
  const prior = all.filter((r) => r.kickoffMs < kickoffMs);
  if (prior.length < minGames) return null;
  const used = prior.slice(-window);
  const scoredByQuarter = avgQuarter(used.map((r) => r.scoredQuarters));
  const allowedByQuarter = avgQuarter(used.map((r) => r.allowedQuarters));
  const ptsFor = used.reduce((s, r) => s + r.ptsFor, 0) / used.length;
  const ptsAgainst = used.reduce((s, r) => s + r.ptsAgainst, 0) / used.length;
  return {
    teamId,
    gamesUsed: used.length,
    scoredByQuarter,
    allowedByQuarter,
    ptsFor,
    ptsAgainst,
    recentFgScores: used.map((r) => r.ptsFor),
  };
}

export type EligibleGame = {
  game: HistoricalGame;
  homeForm: TeamForm;
  awayForm: TeamForm;
};

export function selectEligibleGames(
  games: HistoricalGame[],
  opts?: { window?: number; minGames?: number },
): {
  eligible: EligibleGame[];
  skippedColdStart: number;
  coverageBySeason: Record<string, { total: number; eligible: number }>;
} {
  const logs = buildTeamLogs(games);
  const eligible: EligibleGame[] = [];
  let skippedColdStart = 0;
  const coverageBySeason: Record<string, { total: number; eligible: number }> = {};

  for (const game of games) {
    const key = `${game.sport}:${game.season}`;
    if (!coverageBySeason[key]) coverageBySeason[key] = { total: 0, eligible: 0 };
    coverageBySeason[key].total += 1;

    const kickoffMs = new Date(game.kickoffIso).getTime();
    const homeForm = formBeforeKickoff(logs, game.homeTeamId, kickoffMs, opts);
    const awayForm = formBeforeKickoff(logs, game.awayTeamId, kickoffMs, opts);
    if (!homeForm || !awayForm) {
      skippedColdStart += 1;
      continue;
    }
    eligible.push({ game, homeForm, awayForm });
    coverageBySeason[key].eligible += 1;
  }

  return { eligible, skippedColdStart, coverageBySeason };
}

export function actualPeriodScores(
  game: HistoricalGame,
  period: "fg" | "q1" | "q2" | "q3" | "q4" | "h1" | "h2",
): { home: number; away: number } {
  if (period === "fg") return { home: game.homeFg, away: game.awayFg };
  if (period === "q1") return { home: game.homeQuarters[0], away: game.awayQuarters[0] };
  if (period === "q2") return { home: game.homeQuarters[1], away: game.awayQuarters[1] };
  if (period === "q3") return { home: game.homeQuarters[2], away: game.awayQuarters[2] };
  if (period === "q4") return { home: game.homeQuarters[3], away: game.awayQuarters[3] };
  if (period === "h1") {
    return {
      home: game.homeQuarters[0] + game.homeQuarters[1],
      away: game.awayQuarters[0] + game.awayQuarters[1],
    };
  }
  return {
    home: game.homeQuarters[2] + game.homeQuarters[3],
    away: game.awayQuarters[2] + game.awayQuarters[3],
  };
}

export function leaguePriorTotals(sport: FootballSport): number {
  return sport === "nfl" ? 44.5 : 52.5;
}
