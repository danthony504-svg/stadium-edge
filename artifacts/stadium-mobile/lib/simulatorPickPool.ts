// Simulator-only prop pool + grading — ships with simulator.tsx so props mode never
// depends on pickScoreContext or the large api.ts barrel during partial OTAs.
import type { InjuryTeam, MatchupHistoryEntry, PlayerProp, PropPoolEntry } from "./api";
import type { GameInjuryReport } from "./injuries";
import { summarizeTeamInjuries, teamNameMatches } from "./injuries";
import { applyMarketWeighting } from "./marketWeighting";
import { propMarketLabel } from "./propMarketLabel";
import {
  combinePickScore,
  injuryFavorProp,
  matchupAlignment,
  playerTrendMomentum,
  scoreInjury,
  scoreLineShopping,
  scoreLineValue,
  scoreMatchup,
  scoreSimulation,
  scoreTrend,
  type CombinedPickScore,
  type PickSubScores,
} from "./pickScore";
import { gameValueForMarket } from "./propStats";

export type SimulatorPlayerHistorySlice = {
  player?: string;
  recent?: { date?: string; opp?: string; stats?: Record<string, unknown> }[];
};

function splitLabel(label: string): { away: string; home: string } {
  const parts = String(label || "").split(" @ ");
  return { away: (parts[0] || "").trim(), home: (parts[1] || "").trim() };
}

export function buildSimulatorPropPool(
  props: PlayerProp[],
  game: string,
  sport: string,
  teams?: {
    homeTeamId?: string | null;
    awayTeamId?: string | null;
    homeAbbr?: string | null;
    awayAbbr?: string | null;
  },
): PropPoolEntry[] {
  const out: PropPoolEntry[] = [];
  for (const p of props) {
    if (!p || p.alt || p.line == null) continue;
    const marketLabel = propMarketLabel(p.market);
    const teamAbbr =
      p.playerTeamId && teams?.homeTeamId && p.playerTeamId === teams.homeTeamId
        ? (teams.homeAbbr ?? null)
        : p.playerTeamId && teams?.awayTeamId && p.playerTeamId === teams.awayTeamId
          ? (teams.awayAbbr ?? null)
          : null;
    if (p.overPrice != null) {
      out.push({
        sport,
        game,
        marketLabel,
        player: p.player,
        line: p.line,
        side: "Over",
        odds: p.overPrice,
        edge: p.evSide === "Over" ? (p.edge ?? null) : null,
        bookSpread: p.overSpread ?? null,
        athleteId: p.athleteId,
        marketKey: p.market,
        headshot: p.headshot,
        teamAbbr,
      });
    }
    if (p.underPrice != null) {
      out.push({
        sport,
        game,
        marketLabel,
        player: p.player,
        line: p.line,
        side: "Under",
        odds: p.underPrice,
        edge: p.evSide === "Under" ? (p.edge ?? null) : null,
        bookSpread: p.underSpread ?? null,
        athleteId: p.athleteId,
        marketKey: p.market,
        headshot: p.headshot,
        teamAbbr,
      });
    }
  }
  return out;
}

export function buildSimulatorPpPropPool(
  props: PlayerProp[],
  gameLabel: string,
  sport: string,
): PropPoolEntry[] {
  return props
    .filter((p) => p.priceSource === "PrizePicks" && p.line != null)
    .map((p) => ({
      sport,
      game: gameLabel,
      marketLabel: propMarketLabel(p.market),
      player: p.player,
      line: p.line as number,
      side: "Over" as const,
      odds: 0,
      edge: null,
      bookSpread: null,
      athleteId: p.athleteId,
      marketKey: p.market,
      headshot: p.headshot,
      teamAbbr: null,
    }));
}

function resolvePropPlayerTeam(
  game: string,
  entry: PropPoolEntry | undefined,
  ph?: SimulatorPlayerHistorySlice,
): string | null {
  const { away, home } = splitLabel(game);
  const ab = entry?.teamAbbr?.toUpperCase();
  if (ab) {
    if (away.toUpperCase().includes(ab)) return away;
    if (home.toUpperCase().includes(ab)) return home;
  }
  const opps = (ph?.recent ?? [])
    .map((r) => String(r.opp ?? "").toLowerCase())
    .filter(Boolean);
  if (!opps.length || !away || !home) return null;
  const nick = (n: string) => n.toLowerCase().split(/\s+/).pop() ?? "";
  const seen = (n: string) => {
    const k = nick(n);
    return !!k && opps.some((o) => o.includes(k));
  };
  const awayIsOpp = seen(away);
  const homeIsOpp = seen(home);
  if (awayIsOpp && !homeIsOpp) return home;
  if (homeIsOpp && !awayIsOpp) return away;
  return null;
}

function playerHistoryFor(
  player: string | undefined,
  athleteId: string | null | undefined,
  map?: Record<string, SimulatorPlayerHistorySlice>,
): SimulatorPlayerHistorySlice | undefined {
  if (!map) return undefined;
  if (athleteId) {
    const hit =
      map[`${player}#${athleteId}`] ??
      Object.entries(map).find(([k]) => k.endsWith(`#${athleteId}`))?.[1];
    if (hit) return hit;
  }
  if (player) {
    const hit = Object.entries(map).find(([k]) => k.startsWith(`${player}#`))?.[1];
    if (hit) return hit;
  }
  return undefined;
}

function propTrendScore(
  ph: SimulatorPlayerHistorySlice | undefined,
  marketKey: string,
  line: number | null | undefined,
  side: string | null | undefined,
): PickSubScores["trend"] {
  if (!ph?.recent?.length || line == null) return null;
  const vals = ph.recent
    .map((g) => gameValueForMarket(marketKey, (g.stats ?? {}) as Record<string, string>, new Set()))
    .filter((v): v is number => v != null);
  return scoreTrend(playerTrendMomentum(vals, line, side));
}

function propMatchupScore(
  game: string,
  playerTeam: string | null,
  matchupHistory?: Record<string, MatchupHistoryEntry>,
): PickSubScores["matchup"] {
  if (!playerTeam) return null;
  const entry = matchupHistory?.[game];
  const { aligned, leanEdge } = matchupAlignment(entry?.mlLean, playerTeam);
  return scoreMatchup(aligned, leanEdge);
}

function propInjuryScore(
  sport: string | undefined,
  game: string,
  playerTeam: string | null,
  side: string | null | undefined,
  matchupInjuries?: Record<string, GameInjuryReport>,
  injuryTeams?: InjuryTeam[],
): PickSubScores["injury"] {
  const { away, home } = splitLabel(game);
  const opp =
    playerTeam && teamNameMatches(playerTeam, away)
      ? home
      : playerTeam && teamNameMatches(playerTeam, home)
        ? away
        : null;
  if (!opp) return null;
  const report = matchupInjuries?.[game];
  if (report) {
    const oppSide = report.sides.find((s) => teamNameMatches(s.team, opp));
    const highCount = oppSide?.keyPlayers.filter((k) => k.impact === "high").length ?? 0;
    return scoreInjury(injuryFavorProp(highCount, side));
  }
  if (injuryTeams?.length) {
    const oppTeam = injuryTeams.find((t) => teamNameMatches(t.team, opp));
    if (oppTeam) {
      return scoreInjury(injuryFavorProp(summarizeTeamInjuries(sport ?? "nba", oppTeam).highCount, side));
    }
  }
  return null;
}

function scoreOneSimulatorProp(
  args: {
    game: string;
    sport: string;
    player: string;
    market: string;
    line: number;
    side: "Over" | "Under";
    odds: number;
    athleteId: string | null;
  },
  propPool: PropPoolEntry[],
  simulationByKey?: Map<string, { hitProbability: number | null }>,
  ctx?: {
    matchupHistory?: Record<string, MatchupHistoryEntry>;
    matchupInjuries?: Record<string, GameInjuryReport>;
    playerHistory?: Record<string, SimulatorPlayerHistorySlice>;
    injuryTeams?: InjuryTeam[];
  },
): CombinedPickScore | null {
  const same = (e: PropPoolEntry) =>
    e.game === args.game && e.player === args.player && e.side === args.side;
  const entry =
    propPool.find((e) => same(e) && e.line === args.line) ?? propPool.find(same);
  if (!entry) return null;
  const edgePct = entry.edge ?? null;
  const marketKey = entry.marketKey ?? args.market;
  const ph = playerHistoryFor(args.player, args.athleteId ?? entry.athleteId, ctx?.playerHistory);
  const playerTeam = resolvePropPlayerTeam(args.game, entry, ph);
  const simKey = `${args.player}|${marketKey}|${args.line}|${args.side}`;
  const sim = simulationByKey?.get(simKey);
  const scores: PickSubScores = {
    matchup: propMatchupScore(args.game, playerTeam, ctx?.matchupHistory),
    trend: propTrendScore(ph, marketKey, args.line, args.side),
    lineValue: scoreLineValue(edgePct),
    injury: propInjuryScore(
      args.sport,
      args.game,
      playerTeam,
      args.side,
      ctx?.matchupInjuries,
      ctx?.injuryTeams,
    ),
    lineShopping: scoreLineShopping(entry.bookSpread ?? null),
    simulation: scoreSimulation(sim?.hitProbability ?? null),
  };
  const combined = combinePickScore(scores, edgePct, args.odds);
  return combined.composite == null ? null : combined;
}

export function gradeSimulatorProps(
  selected: Array<{
    player: string;
    market: string;
    line: number;
    side: "Over" | "Under";
    odds: number;
    athleteId: string | null;
  }>,
  gameLabel: string,
  sport: string,
  propPool: PropPoolEntry[],
  opts: {
    matchupHistory?: Record<string, MatchupHistoryEntry>;
    matchupInjuries?: Record<string, GameInjuryReport>;
    playerHistory?: Record<string, SimulatorPlayerHistorySlice>;
    propSimulations?: Map<string, { hitProbability: number | null }>;
    injuryTeams?: InjuryTeam[];
  },
): Map<string, CombinedPickScore> {
  const out = new Map<string, CombinedPickScore>();
  for (const s of selected) {
    const raw = scoreOneSimulatorProp(
      {
        game: gameLabel,
        sport,
        player: s.player,
        market: s.market,
        line: s.line,
        side: s.side,
        odds: s.odds,
        athleteId: s.athleteId,
      },
      propPool,
      opts.propSimulations,
      {
        matchupHistory: opts.matchupHistory,
        matchupInjuries: opts.matchupInjuries,
        playerHistory: opts.playerHistory,
        injuryTeams: opts.injuryTeams,
      },
    );
    const scores = applyMarketWeighting(raw, {
      isProp: true,
      sport,
      market: propMarketLabel(s.market),
      propMarketKey: s.market,
    });
    const key = `${s.player}|${s.market}|${s.line}|${s.side}`;
    if (scores) out.set(key, scores);
  }
  return out;
}
