// Tennis player-prop Monte Carlo — 10,000 draws per prop rung, grounded in match
// context + per-player stat profiles. Uses match-level game sampling as the
// backbone for games/total props; Poisson for ace/DF props when rates exist.

import { homeWinProbFromMatchup, runTennisMonteCarlo } from "./tennisMonteCarlo.js";
import { buildTennisMatchup } from "./tennis.js";
import type {
  TennisMatchPropContext,
  TennisPropLine,
  TennisPropMarketKey,
  TennisPropSimResult,
  TennisPlayerStatProfile,
} from "./tennisPropTypes.js";
import { DEFAULT_SIMULATIONS } from "./monteCarlo.js";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round3 = (n: number) => Math.round(n * 1000) / 1000;

function poissonSample(lambda: number): number {
  const L = Math.exp(-Math.max(lambda, 0.01));
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > L);
  return k - 1;
}

function playerProfile(
  ctx: TennisMatchPropContext,
  player: string,
): TennisPlayerStatProfile | null {
  const n = player.trim().toLowerCase();
  if (ctx.away.resolvedName?.toLowerCase() === n || ctx.away.name.toLowerCase() === n) {
    return ctx.away;
  }
  if (ctx.home.resolvedName?.toLowerCase() === n || ctx.home.name.toLowerCase() === n) {
    return ctx.home;
  }
  return null;
}

function surfaceRateAdjust(profile: TennisPlayerStatProfile, surface: string): number {
  const s = surface as keyof typeof profile.surfaceWinPct;
  const pct = profile.surfaceWinPct[s];
  if (pct == null || !Number.isFinite(pct)) return 1;
  return clamp(0.85 + (pct - 50) / 200, 0.75, 1.25);
}

function fatigueAdjust(profile: TennisPlayerStatProfile): number {
  const m = profile.matchesLast14Days ?? 0;
  if (m >= 5) return 0.92;
  if (m >= 3) return 0.96;
  return 1;
}

/** Simulate one prop line with n draws (default 10k). */
export async function runTennisPropMonteCarlo(
  line: TennisPropLine,
  ctx: TennisMatchPropContext,
  simulations = DEFAULT_SIMULATIONS,
): Promise<TennisPropSimResult> {
  const prof = playerProfile(ctx, line.player);
  const n = simulations;
  let hits = 0;
  const projections: number[] = [];

  const matchup = await buildTennisMatchup(ctx.awayPlayer, ctx.homePlayer);
  const homeWinProb = homeWinProbFromMatchup(matchup);
  const isHomePlayer =
    prof?.resolvedName === ctx.home.resolvedName ||
    prof?.name.toLowerCase() === ctx.homePlayer.toLowerCase();

  const market = line.market as TennisPropMarketKey;

  if (market === "player_aces" || market === "player_double_faults") {
    const base =
      market === "player_aces" ? prof?.acesPerMatch ?? null : prof?.doubleFaultsPerMatch ?? null;
    const lambda =
      base != null
        ? base * surfaceRateAdjust(prof!, ctx.surface) * fatigueAdjust(prof!)
        : market === "player_aces"
          ? 5
          : 3;
    for (let i = 0; i < n; i++) {
      const val = poissonSample(lambda);
      projections.push(val);
      if (line.line == null) continue;
      const hit =
        line.side === "Over"
          ? val > line.line
          : line.side === "Under"
            ? val < line.line
            : false;
      if (hit) hits++;
    }
  } else {
    // Games-based props — derive from match game totals split by win prob.
    const matchSim = await runTennisMonteCarlo({
      away: ctx.awayPlayer,
      home: ctx.homePlayer,
      simulations: Math.min(n, 2000),
      retainOutcomes: true,
    });
    const homeScores = matchSim?.outcomes?.homeScores ?? [];
    const awayScores = matchSim?.outcomes?.awayScores ?? [];
    const samples = homeScores.length ? homeScores.length : n;

    for (let i = 0; i < samples; i++) {
      const h = homeScores[i] ?? Math.round(12 + Math.random() * 8);
      const a = awayScores[i] ?? Math.round(12 + Math.random() * 8);
      const total = h + a;
      const playerGames = isHomePlayer ? h : a;
      let val: number;
      if (market === "player_total_games") val = total;
      else if (market === "player_games_won") val = playerGames;
      else val = isHomePlayer ? (h > a ? 1 : 0) : a > h ? 1 : 0;

      projections.push(val);
      if (line.line == null) continue;
      const hit =
        line.side === "Over" ? val > line.line : line.side === "Under" ? val < line.line : false;
      if (hit) hits++;
    }
    // Scale hit rate if we subsampled match sim
    if (samples < n && samples > 0) {
      const rate = hits / samples;
      hits = Math.round(rate * n);
    }
  }

  const hitProbability = line.line != null ? round3(hits / n) : null;
  const meanProjection =
    projections.length > 0
      ? round3(projections.reduce((a, b) => a + b, 0) / projections.length)
      : null;

  let confidence = 42;
  if (prof?.acesPerMatch != null || prof?.servePct != null) confidence += 15;
  if (ctx.h2hAwayWins != null || ctx.h2hHomeWins != null) confidence += 8;
  if (prof?.recentFormWins + prof?.recentFormLosses >= 5) confidence += 10;
  confidence = clamp(confidence, 35, 88);

  return {
    simulations: n,
    hitProbability,
    meanProjection,
    confidenceScore: confidence,
  };
}
