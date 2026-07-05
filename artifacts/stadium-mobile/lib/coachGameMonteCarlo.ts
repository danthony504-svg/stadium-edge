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
import {
  classifySimAlignment,
  HIGH_RISK_EDGE_MIN,
  simHitForPick,
} from "./finalAiScore.ts";
import type { RealOddsEntry } from "./api.ts";

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

function uniqueCoverQueries(picks: ParsedPick[], realOdds?: RealOddsEntry[]): GameCoverQuery[] {
  const seen = new Set<string>();
  const out: GameCoverQuery[] = [];
  const addPick = (p: ParsedPick) => {
    const q = buildGameCoverQuery(p);
    if (!q || seen.has(q.id)) return;
    seen.add(q.id);
    out.push(q);
  };
  for (const p of picks) addPick(p);
  if (realOdds) {
    for (const ro of realOdds) {
      addPick({
        game: ro.game,
        market: ro.market,
        pick: ro.pick,
        odds: ro.odds,
        isProp: false,
        sport: ro.sport,
      });
    }
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
  realOdds?: RealOddsEntry[],
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
      const coverQueries = uniqueCoverQueries(legs, realOdds?.filter((r) => r.game === gameLabel));
      const result = await fetchGameOutcomeSimulation(
        {
          sport: ids.sport || sport || "mlb",
          homeTeamId: ids.homeTeamId,
          awayTeamId: ids.awayTeamId,
          homeTeam: ids.homeTeam,
          awayTeam: ids.awayTeam,
          simulations: COACH_GAME_SIMS,
          coverQueries,
          retainOutcomes: true,
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
    const hit = simHitForPick(p, sim, null);
    const edge = p.scores?.edgePct ?? null;
    const { simAligned, highRiskValuePlay } = classifySimAlignment(hit, edge);

    if (!sim) {
      const disagree = gameSimDisagreement(p, sim);
      if (disagree) {
        coverRemoved += 1;
        warnings.push(`Dropped **${p.pick}** (${p.game}): ${disagree.reason}`);
        continue;
      }
    } else if (!simAligned && !highRiskValuePlay) {
      coverRemoved += 1;
      const pct = hit != null ? Math.round(hit * 100) : 0;
      warnings.push(
        `Dropped **${p.pick}** (${p.game}): simulator ${pct}% hit — needs ≥52% or +${HIGH_RISK_EDGE_MIN}% edge for a High-Risk Value Play.`,
      );
      continue;
    }

    kept.push({
      ...p,
      highRiskValuePlay: highRiskValuePlay || undefined,
    });
  }

  const highRiskCount = kept.filter((p) => p.highRiskValuePlay).length;
  const noteParts: string[] = [];
  if (sideAligned.note) noteParts.push(sideAligned.note);
  if (coverRemoved > 0) {
    noteParts.push(
      `_Removed ${coverRemoved} game line${coverRemoved === 1 ? "" : "s"} that failed the four-question sim check (win, cover, cover rate, or price vs the 10,000-run draw)._`,
    );
  }
  if (highRiskCount > 0) {
    noteParts.push(
      `_⚠️ ${highRiskCount} leg${highRiskCount === 1 ? "" : "s"} labeled **High-Risk Value Play** — the simulator disagrees but the line-value edge is large (≥+${HIGH_RISK_EDGE_MIN}%)._`,
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

/** Drop or label prop legs that contradict their 10k-run sim (same rules as game lines). */
export function filterCoachPicksWithPropSim(
  picks: ParsedPick[],
  propSims: Map<string, { hitProbability: number | null }>,
): GameSimFilterResult {
  const kept: ParsedPick[] = [];
  const warnings: string[] = [];
  let removed = 0;

  for (const p of picks) {
    if (!p.isProp) {
      kept.push(p);
      continue;
    }
    const marketKey = p.propMarketKey ?? p.market;
    const key =
      p.player && p.propLine != null && p.propSide
        ? `${p.player}|${marketKey}|${p.propLine}|${p.propSide}`
        : null;
    const hit = key ? (propSims.get(key)?.hitProbability ?? null) : null;
    const edge = p.scores?.edgePct ?? p.finalAiScore?.edgePct ?? null;
    const { simAligned, highRiskValuePlay } = classifySimAlignment(hit, edge);

    if (hit != null && !simAligned && !highRiskValuePlay) {
      removed += 1;
      const pct = Math.round(hit * 100);
      warnings.push(
        `Dropped **${p.pick}**: prop simulator ${pct}% hit — needs ≥52% or +${HIGH_RISK_EDGE_MIN}% edge for a High-Risk Value Play.`,
      );
      continue;
    }

    kept.push({
      ...p,
      highRiskValuePlay: highRiskValuePlay || p.highRiskValuePlay,
    });
  }

  const highRiskCount = kept.filter((p) => p.highRiskValuePlay).length;
  const noteParts: string[] = [];
  if (removed > 0) {
    noteParts.push(
      `_Removed ${removed} prop leg${removed === 1 ? "" : "s"} that conflicted with the 10,000-run prop simulator._`,
    );
  }
  if (highRiskCount > 0) {
    noteParts.push(
      `_⚠️ ${highRiskCount} prop leg${highRiskCount === 1 ? "" : "s"} labeled **High-Risk Value Play** — simulator disagrees but line-value edge is large (≥+${HIGH_RISK_EDGE_MIN}%)._`,
    );
  }

  return { picks: kept, removed, warnings, note: noteParts.join("\n\n") };
}
