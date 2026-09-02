// Fetch game-outcome Monte Carlo for Coach game-line legs — same endpoint as Simulator.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { EspnGame } from "./api.ts";
import { fetchGameOutcomeSimulation } from "./api.ts";
import {
  buildGameCoverQuery,
  deriveCoverHitRatesFromOutcomes,
  gamePickCoverQueryId,
  gameSimHitForPick,
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
import { gameLabelsMatch } from "./gameLineOptimizer.ts";
import type { RealOddsEntry } from "./api.ts";
import { passesCoachSimQualityGate } from "./gameSimQualityGates.ts";

export type { CoachGameSimEntry, GameCoverQuery };

export type GameTeamIds = {
  sport: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeam: string;
  awayTeam: string;
  homeAliases?: readonly string[];
  awayAliases?: readonly string[];
};

const teamKey = (team: string) =>
  String(team ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\bthe\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const nickname = (team: string) => {
  const t = teamKey(team).split(" ");
  return t[t.length - 1] ?? "";
};

function teamAliases(team: string, abbr?: string): string[] {
  return [...new Set([teamKey(team), teamKey(abbr ?? ""), nickname(team)].filter(Boolean))];
}

/** Map "Away @ Home" labels to ESPN team ids from a games fetch. */
export function buildGameTeamIdMap(games: EspnGame[]): Map<string, GameTeamIds> {
  const map = new Map<string, GameTeamIds>();
  for (const g of games) {
    const home = g.homeTeam || g.homeAbbr || "";
    const away = g.awayTeam || g.awayAbbr || "";
    if (!home || !away || !g.homeTeamId || !g.awayTeamId) continue;
    const ids: GameTeamIds = {
      sport: g.sport,
      homeTeamId: g.homeTeamId,
      awayTeamId: g.awayTeamId,
      homeTeam: home,
      awayTeam: away,
      homeAliases: teamAliases(home, g.homeAbbr ?? undefined),
      awayAliases: teamAliases(away, g.awayAbbr ?? undefined),
    };
    for (const awayAlias of ids.awayAliases ?? []) {
      for (const homeAlias of ids.homeAliases ?? []) {
        map.set(`${awayAlias} @ ${homeAlias}`, ids);
      }
    }
  }
  return map;
}

export type TeamIdResolution = {
  ids: GameTeamIds | null;
  reason: "resolved" | "invalid_event_label" | "no_matching_event" | "ambiguous_event";
};

export function resolveTeamIdsWithReason(
  gameLabel: string,
  sport: string | undefined,
  map: Map<string, GameTeamIds>,
): TeamIdResolution {
  const parts = gameLabel.split(" @ ");
  if (parts.length !== 2) return { ids: null, reason: "invalid_event_label" };
  const away = teamKey(parts[0]!);
  const home = teamKey(parts[1]!);
  const candidates = [...new Map(
    [...map.values()]
      .filter((entry) => !sport || !entry.sport || entry.sport.toLowerCase() === sport.toLowerCase())
      .map((entry) => [`${entry.awayTeamId}|${entry.homeTeamId}`, entry] as const),
  ).values()];
  const exact = candidates.filter(
    (entry) => entry.awayAliases?.includes(away) && entry.homeAliases?.includes(home),
  );
  if (exact.length === 1) return { ids: exact[0]!, reason: "resolved" };
  if (exact.length > 1) return { ids: null, reason: "ambiguous_event" };
  const byNickname = candidates.filter(
    (entry) => nickname(entry.awayTeam) === nickname(away) && nickname(entry.homeTeam) === nickname(home),
  );
  if (byNickname.length === 1) return { ids: byNickname[0]!, reason: "resolved" };
  return { ids: null, reason: byNickname.length > 1 ? "ambiguous_event" : "no_matching_event" };
}

export function resolveTeamIds(
  gameLabel: string,
  sport: string | undefined,
  map: Map<string, GameTeamIds>,
): GameTeamIds | null {
  return resolveTeamIdsWithReason(gameLabel, sport, map).ids;
}

function uniqueCoverQueries(
  picks: ParsedPick[],
  realOdds?: RealOddsEntry[],
  evalLinesByGame?: Map<string, RealOddsEntry[]>,
): GameCoverQuery[] {
  const seen = new Set<string>();
  const out: GameCoverQuery[] = [];
  const games = new Set(picks.filter(isGameLinePick).map((p) => p.game));
  const gameOnTicket = (label: string) => {
    if (games.has(label)) return true;
    for (const g of games) {
      if (gameLabelsMatch(g, label)) return true;
    }
    return false;
  };
  const addPick = (p: ParsedPick) => {
    const q = buildGameCoverQuery(p);
    if (!q || seen.has(q.id)) return;
    seen.add(q.id);
    out.push(q);
  };
  for (const p of picks) addPick(p);
  if (evalLinesByGame) {
    for (const [game, lines] of evalLinesByGame) {
      if (!gameOnTicket(game)) continue;
      for (const e of lines) {
        addPick({
          game: e.game,
          market: e.market,
          pick: e.pick,
          odds: e.odds,
          isProp: false,
          sport: e.sport,
        });
      }
    }
  } else if (realOdds) {
    for (const ro of realOdds) {
      if (!gameOnTicket(ro.game)) continue;
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
  evalLinesByGame?: Map<string, RealOddsEntry[]>,
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
      const resolution = resolveTeamIdsWithReason(gameLabel, sport, teamIdsByGame);
      const ids = resolution.ids;
      if (!ids) {
        console.warn("[coach-market-diagnostics]", JSON.stringify({
          stage: "SIMULATION_SKIPPED", game: gameLabel, reason: resolution.reason,
        }));
        return;
      }
      const coverQueries = uniqueCoverQueries(legs, realOdds, evalLinesByGame);
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
      if (result) {
        const rawSim = result as CoachGameSimEntry;
        const derivedRates = rawSim.outcomes
          ? deriveCoverHitRatesFromOutcomes(rawSim.outcomes, coverQueries, sport ?? "nba")
          : {};
        const sim: CoachGameSimEntry = {
          ...rawSim,
          coverHitRates: { ...rawSim.coverHitRates, ...derivedRates },
        };
        out.set(gameLabel, sim);
        for (const leg of legs) {
          if (leg.game !== gameLabel) out.set(leg.game, sim);
        }
      }
    }),
  );

  return out;
}

/** 10k sim for every game on the slate — all eval-ladder rungs scored in one draw per game. */
export async function fetchSlateGameSimulations(
  evalLinesByGame: Map<string, RealOddsEntry[]>,
  teamIdsByGame: Map<string, GameTeamIds>,
  signal?: AbortSignal,
): Promise<Map<string, CoachGameSimEntry>> {
  const out = new Map<string, CoachGameSimEntry>();
  const entries = [...evalLinesByGame.entries()];
  const SLATE_SIM_CONCURRENCY = 4;

  async function simGame([gameLabel, lines]: [string, RealOddsEntry[]]) {
    if (!lines.length) return;
    const sport = lines[0]?.sport;
    const resolution = resolveTeamIdsWithReason(gameLabel, sport, teamIdsByGame);
    const ids = resolution.ids;
    if (!ids) {
      console.warn("[coach-market-diagnostics]", JSON.stringify({
        stage: "SIMULATION_SKIPPED", game: gameLabel, reason: resolution.reason,
      }));
      return;
    }

    const seen = new Set<string>();
    const coverQueries: GameCoverQuery[] = [];
    for (const e of lines) {
      const q = buildGameCoverQuery({
        game: e.game,
        market: e.market,
        pick: e.pick,
        odds: e.odds,
        isProp: false,
        sport: e.sport,
      });
      if (!q || seen.has(q.id)) continue;
      seen.add(q.id);
      coverQueries.push(q);
    }
    if (!coverQueries.length) return;

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
    if (result) {
      const sim = result as CoachGameSimEntry;
      // Grade every posted line from the returned draws. This makes the board
      // independent of response cover-query key formatting and uses no
      // synthetic probability: each rate comes from this game's 10k outcomes.
      const derivedRates = sim.outcomes
        ? deriveCoverHitRatesFromOutcomes(sim.outcomes, coverQueries, sport ?? "nba")
        : {};
      out.set(gameLabel, {
        ...sim,
        coverHitRates: { ...sim.coverHitRates, ...derivedRates },
      });
    }
  }

  for (let i = 0; i < entries.length; i += SLATE_SIM_CONCURRENCY) {
    if (signal?.aborted) break;
    await Promise.all(entries.slice(i, i + SLATE_SIM_CONCURRENCY).map(simGame));
  }

  return out;
}

/** Fetch 10k sim for game-line legs whose games are missing from an existing map. */
export async function supplementCoachGameSimulations(
  picks: ParsedPick[],
  existing: Map<string, CoachGameSimEntry>,
  teamIdsByGame: Map<string, GameTeamIds>,
  signal?: AbortSignal,
  realOdds?: RealOddsEntry[],
  evalLinesByGame?: Map<string, RealOddsEntry[]>,
): Promise<Map<string, CoachGameSimEntry>> {
  const missing = picks.filter(
    (p) => isGameLinePick(p) && !coachGameSimForPick(p, existing),
  );
  if (!missing.length) return existing;
  const extra = await fetchCoachGameSimulationsForPicks(
    missing,
    teamIdsByGame,
    signal,
    realOdds,
    evalLinesByGame,
  );
  if (!extra.size) return existing;
  const merged = new Map(existing);
  for (const [k, v] of extra) merged.set(k, v);
  for (const p of picks.filter(isGameLinePick)) {
    const sim = coachGameSimForPick(p, merged);
    if (sim) merged.set(p.game, sim);
  }
  return merged;
}

/** Register every game-line label on the ticket against its fuzzy-matched sim row. */
export function aliasCoachGameSimLabels(
  picks: ParsedPick[],
  simByGame: Map<string, CoachGameSimEntry>,
): Map<string, CoachGameSimEntry> {
  const out = new Map(simByGame);
  for (const p of picks.filter(isGameLinePick)) {
    const sim = coachGameSimForPick(p, out);
    if (sim) out.set(p.game, sim);
  }
  return out;
}

export function coachGameSimForPick(
  pick: ParsedPick,
  simByGame: Map<string, CoachGameSimEntry>,
): CoachGameSimEntry | undefined {
  const direct = simByGame.get(pick.game);
  if (direct) return direct;
  for (const [label, sim] of simByGame) {
    if (gameLabelsMatch(label, pick.game)) return sim;
  }
  return undefined;
}

/** Drop game-line legs with negative no-vig edge unless High-Risk Value Play. */
export function filterNegativeEdgeGameLines(
  picks: ParsedPick[],
  oddsForEdge: RealOddsEntry[] = [],
  rejectsOut?: import("./parlayReachCore.ts").ParlayLegReject[],
): GameSimFilterResult {
  const kept: ParsedPick[] = [];
  const warnings: string[] = [];
  let removed = 0;

  const edgeForPick = (p: ParsedPick): number | null => {
    if (p.scores?.edgePct != null) return p.scores.edgePct;
    const ro = oddsForEdge.find(
      (r) =>
        gameLabelsMatch(r.game, p.game) &&
        r.market === p.market &&
        r.pick === p.pick,
    );
    return ro?.edge ?? null;
  };

  for (const p of picks) {
    if (!isGameLinePick(p) || p.isProp) {
      kept.push(p);
      continue;
    }
    const edge = edgeForPick(p);
    const hit = null;
    const { highRiskValuePlay } = classifySimAlignment(hit, edge);
    if (edge != null && edge < 0 && !highRiskValuePlay) {
      removed += 1;
      warnings.push(
        `Dropped **${p.pick}** (${p.game}): ${edge}% edge — keeping only non-negative or High-Risk Value (≥+${HIGH_RISK_EDGE_MIN}%) lines after the 10k sim ranking.`,
      );
      rejectsOut?.push({
        pick: p,
        reason: `${edge}% edge after Final AI Score`,
        nearScore: 50 + edge + (highRiskValuePlay ? 20 : 0),
      });
      continue;
    }
    kept.push(p);
  }

  const note =
    removed > 0
      ? `_Removed ${removed} game line${removed === 1 ? "" : "s"} with negative edge after Final AI Score optimization._`
      : "";

  return { picks: kept, removed, warnings, note };
}

export type GameSimFilterResult = {
  picks: ParsedPick[];
  removed: number;
  warnings: string[];
  note: string;
  rejects?: import("./parlayReachCore.ts").ParlayLegReject[];
};

/**
 * Drop game-line legs the simulator does not support; attach alignment notes on survivors.
 */
export function filterCoachPicksWithGameSim(
  picks: ParsedPick[],
  simByGame: Map<string, CoachGameSimEntry>,
  opts: {
    matchupHistory?: Record<string, import("./api.ts").MatchupHistoryEntry>;
    /** Merged real + eval odds so optimized alt lines still have edge for high-risk checks. */
    oddsForEdge?: RealOddsEntry[];
    rejectsOut?: import("./parlayReachCore.ts").ParlayLegReject[];
  } = {},
): GameSimFilterResult {
  const sideAligned = enforceConsistentGameSides(picks, {
    simByGame,
    matchupHistory: opts.matchupHistory,
  });
  picks = sideAligned.picks;

  const edgeForPick = (p: ParsedPick): number | null => {
    if (p.scores?.edgePct != null) return p.scores.edgePct;
    const ro = opts.oddsForEdge?.find(
      (r) => r.game === p.game && r.market === p.market && r.pick === p.pick,
    );
    return ro?.edge ?? null;
  };

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
    const edge = edgeForPick(p);
    const { simAligned } = classifySimAlignment(hit, edge);

    if (!sim) {
      coverRemoved += 1;
      warnings.push(`Dropped **${p.pick}** (${p.game}): no 10k game simulation data.`);
      opts.rejectsOut?.push({
        pick: p,
        reason: "No 10k game simulation data",
        nearScore: Math.max(0, edge ?? 0) * 2,
      });
      continue;
    }
    if (hit != null && !simAligned) {
      coverRemoved += 1;
      const pct = Math.round(hit * 100);
      const grade = p.finalAiScore?.grade ?? "—";
      const edgeStr = edge != null ? `${edge > 0 ? "+" : ""}${edge}%` : "—";
      warnings.push(
        `Dropped **${p.pick}** (${p.game}): 10k sim ${pct}% hit — needs ≥52% cover (edge ${edgeStr}, grade ${grade}).`,
      );
      opts.rejectsOut?.push({
        pick: p,
        reason: `10k sim ${pct}% hit — needs ≥52% cover`,
        nearScore: (hit ?? 0) * 50 + Math.max(0, edge ?? 0) * 2,
      });
      continue;
    }
    if (
      !passesCoachSimQualityGate(p, sim, {
        edge,
        finalAi: p.finalAiScore,
        odds: p.odds,
      })
    ) {
      coverRemoved += 1;
      const pct = hit != null ? Math.round(hit * 100) : 0;
      const grade = p.finalAiScore?.grade ?? "—";
      const conf = p.finalAiScore?.confidencePct ?? "—";
      const edgeStr = edge != null ? `${edge > 0 ? "+" : ""}${edge}%` : "—";
      warnings.push(
        `Dropped **${p.pick}** (${p.game}): simulator gate failed — ${pct}% hit, ${edgeStr} edge, Final AI ${grade}, conf ${conf} (needs edge > 0, grade ≥ C+, conf ≥ 52, sim above implied).`,
      );
      opts.rejectsOut?.push({
        pick: p,
        reason: `Simulator quality gate — ${pct}% hit, ${edgeStr} edge, grade ${grade}`,
        nearScore: (hit ?? 0) * 50 + Math.max(0, edge ?? 0) * 2,
      });
      continue;
    }

    kept.push(p);
  }

  const noteParts: string[] = [];
  if (sideAligned.note) noteParts.push(sideAligned.note);
  if (coverRemoved > 0) {
    noteParts.push(
      `_Removed ${coverRemoved} game line${coverRemoved === 1 ? "" : "s"} that failed the four-question sim check (win, cover, cover rate, or price vs the 10,000-run draw)._`,
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
  opts: { minLegs?: number; excludedSports?: Set<string> } = {},
): GameSimFilterResult {
  const minLegs = opts.minLegs ?? 0;
  const kept: ParsedPick[] = [];
  const dropped: ParsedPick[] = [];
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
    const { simAligned } = classifySimAlignment(hit, edge);

    if (hit != null && !simAligned) {
      removed += 1;
      const pct = Math.round(hit * 100);
      warnings.push(
        `Dropped **${p.pick}**: prop simulator ${pct}% hit — needs ≥52% cover.`,
      );
      dropped.push(p);
      continue;
    }

    kept.push(p);
  }

  const noteParts: string[] = [];
  if (removed > 0) {
    noteParts.push(
      `_Removed ${removed} prop leg${removed === 1 ? "" : "s"} that conflicted with the 10,000-run prop simulator._`,
    );
  }

  return { picks: kept, removed, warnings, note: noteParts.join("\n\n") };
}
