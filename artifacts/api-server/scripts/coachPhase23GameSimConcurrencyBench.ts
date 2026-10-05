/**
 * Phase 2.3 prep — AUDIT ONLY.
 * Benchmark identical game-simulation workload at outer concurrency 2 / 4 / 6.
 * Does not change simulation count or equations.
 */
import { writeFileSync } from "node:fs";
import { API_BASE } from "../../stadium-mobile/lib/apiBase.ts";
import {
  fetchSlateGameSimulationsWithStatus,
  type GameTeamIds,
} from "../../stadium-mobile/lib/coachGameMonteCarlo.ts";
import { clearCoachContextCache } from "../../stadium-mobile/lib/coachContextCache.ts";
import type { RealOddsEntry } from "../../stadium-mobile/lib/api.ts";

type GameRow = {
  sport: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamId: string;
  awayTeamId: string;
  label: string;
};

async function loadBoardGames(limit = 12): Promise<GameRow[]> {
  const sports = ["mlb", "nfl", "nba", "nhl", "ncaaf"];
  const out: GameRow[] = [];
  const seenPair = new Set<string>();
  for (const sport of sports) {
    const res = await fetch(`${API_BASE}/sports/games?sport=${encodeURIComponent(sport)}`);
    if (!res.ok) continue;
    const games = (await res.json()) as Array<Record<string, unknown>>;
    for (const g of games) {
      const homeTeam = String(g.homeTeam ?? g.home ?? "").trim();
      const awayTeam = String(g.awayTeam ?? g.away ?? "").trim();
      const homeTeamId = String(g.homeTeamId ?? g.homeId ?? "").trim();
      const awayTeamId = String(g.awayTeamId ?? g.awayId ?? "").trim();
      if (!homeTeam || !awayTeam || !homeTeamId || !awayTeamId) continue;
      if (homeTeam === "TBD" || awayTeam === "TBD") continue;
      if (!/^\d+$/.test(homeTeamId) || !/^\d+$/.test(awayTeamId)) continue;
      // Dedupe by unordered team-id pair — ESPN sometimes lists both orientations.
      const pairKey = `${sport}:${[homeTeamId, awayTeamId].sort().join("|")}`;
      if (seenPair.has(pairKey)) continue;
      seenPair.add(pairKey);
      out.push({
        sport,
        homeTeam,
        awayTeam,
        homeTeamId,
        awayTeamId,
        label: `${awayTeam} @ ${homeTeam}`,
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

function linesFor(g: GameRow): RealOddsEntry[] {
  return [
    {
      game: g.label,
      market: "Moneyline",
      pick: `${g.homeTeam} ML`,
      odds: -110,
      sport: g.sport,
      isProp: false,
    } as RealOddsEntry,
    {
      game: g.label,
      market: "Total",
      pick: "Over 45.5",
      odds: -110,
      sport: g.sport,
      isProp: false,
    } as RealOddsEntry,
    {
      game: g.label,
      market: "Spread",
      pick: `${g.homeTeam} -3.5`,
      odds: -110,
      sport: g.sport,
      isProp: false,
    } as RealOddsEntry,
  ];
}

async function runAtConcurrency(games: GameRow[], concurrency: number) {
  clearCoachContextCache();
  const teamIdMap = new Map<string, GameTeamIds>();
  for (const g of games) {
    teamIdMap.set(g.label, {
      homeTeamId: g.homeTeamId,
      awayTeamId: g.awayTeamId,
      homeTeam: g.homeTeam,
      awayTeam: g.awayTeam,
      sport: g.sport,
    });
  }

  let httpCalls = 0;
  let errors = 0;
  let rateLimited = 0;
  const statuses: number[] = [];
  const orig = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    const isSim =
      url.includes("/sports/simulate") && !url.includes("/sports/simulate/props");
    try {
      const res = await orig(input, init);
      if (isSim) {
        httpCalls += 1;
        statuses.push(res.status);
        if (res.status === 429) rateLimited += 1;
        if (!res.ok) errors += 1;
      }
      return res;
    } catch (e) {
      if (isSim) errors += 1;
      throw e;
    }
  }) as typeof fetch;

  const t0 = performance.now();
  const snapshots: Array<{
    game: string;
    homeWin: number | null;
    totalMean: number | null;
    coverKeys: string[];
  }> = [];
  let simsLoaded = 0;
  let fetchNull = 0;

  try {
    const chunks: GameRow[][] = [];
    for (let i = 0; i < games.length; i += concurrency) {
      chunks.push(games.slice(i, i + concurrency));
    }
    // Serial outer await of each chunk — mirrors production SLATE_SIM_BATCH loop.
    for (const chunk of chunks) {
      const evalMap = new Map<string, RealOddsEntry[]>();
      for (const g of chunk) evalMap.set(g.label, linesFor(g));
      const result = await fetchSlateGameSimulationsWithStatus(evalMap, teamIdMap);
      simsLoaded += result.sims.size;
      fetchNull += result.fetchNull.length;
      for (const [label, entry] of result.sims) {
        snapshots.push({
          game: label,
          homeWin: entry.homeWinProbability ?? null,
          totalMean: null,
          coverKeys: Object.keys(entry.coverHitRates ?? {}).sort(),
        });
      }
    }
  } finally {
    globalThis.fetch = orig;
  }

  snapshots.sort((a, b) => a.game.localeCompare(b.game));
  return {
    concurrency,
    simulations: games.length,
    simsLoaded,
    wallMs: Math.round(performance.now() - t0),
    httpCalls,
    errors: errors + fetchNull,
    rateLimited429: rateLimited,
    statusHistogram: statuses.reduce<Record<string, number>>((acc, s) => {
      acc[String(s)] = (acc[String(s)] ?? 0) + 1;
      return acc;
    }, {}),
    snapshots,
  };
}

function fingerprint(
  snaps: Array<{ game: string; homeWin: number | null; coverKeys: string[] }>,
): string {
  return snaps
    .map((s) => `${s.game}|${s.homeWin == null ? "null" : s.homeWin.toFixed(6)}|${s.coverKeys.join(",")}`)
    .join(";");
}

async function main() {
  console.error("API_BASE", API_BASE);
  const games = await loadBoardGames(12);
  console.error(
    `[games] n=${games.length}`,
    games.map((g) => `${g.sport}:${g.label}`).join(" | "),
  );
  if (games.length < 2) {
    const report = {
      skipped: true,
      reason: "fewer than 2 board games available",
      games: games.length,
    };
    writeFileSync(
      "/opt/cursor/artifacts/coach-phase23-game-sim-concurrency.json",
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // Fix identical workload across levels: same game list, same 3 cover queries,
  // same COACH_GAME_SIMS. Only outer chunk size (concurrency) changes.
  // Clear client game-sim cache between levels so walls are comparable cold.
  const c2 = await runAtConcurrency(games, 2);
  console.error(`[conc=2] wall=${c2.wallMs} http=${c2.httpCalls} err=${c2.errors} 429=${c2.rateLimited429}`);
  const c4 = await runAtConcurrency(games, 4);
  console.error(`[conc=4] wall=${c4.wallMs} http=${c4.httpCalls} err=${c4.errors} 429=${c4.rateLimited429}`);
  const c6 = await runAtConcurrency(games, 6);
  console.error(`[conc=6] wall=${c6.wallMs} http=${c6.httpCalls} err=${c6.errors} 429=${c6.rateLimited429}`);

  const fp2 = fingerprint(c2.snapshots);
  const fp4 = fingerprint(c4.snapshots);
  const fp6 = fingerprint(c6.snapshots);

  // Soft numeric compare: homeWin within 1e-9 (or both null)
  function numericDiff(
    a: typeof c2.snapshots,
    b: typeof c2.snapshots,
  ): number {
    const am = new Map(a.map((s) => [s.game, s]));
    let diffs = 0;
    for (const sb of b) {
      const sa = am.get(sb.game);
      if (!sa) {
        diffs += 1;
        continue;
      }
      if (sa.homeWin == null && sb.homeWin == null) continue;
      if (sa.homeWin == null || sb.homeWin == null) {
        diffs += 1;
        continue;
      }
      if (Math.abs(sa.homeWin - sb.homeWin) > 1e-9) diffs += 1;
      if (sa.coverKeys.join(",") !== sb.coverKeys.join(",")) diffs += 1;
    }
    return diffs;
  }

  function homeWinOnlyFp(
    snaps: typeof c2.snapshots,
  ): string {
    return snaps
      .map((s) => `${s.game}|${s.homeWin == null ? "null" : s.homeWin.toFixed(8)}`)
      .join(";");
  }
  const hw2 = homeWinOnlyFp(c2.snapshots);
  const hw4 = homeWinOnlyFp(c4.snapshots);
  const hw6 = homeWinOnlyFp(c6.snapshots);

  // Per-game homeWin delta table for audit
  const byGame: Record<
    string,
    { c2: number | null; c4: number | null; c6: number | null; maxAbsDelta: number }
  > = {};
  for (const g of games) {
    const a = c2.snapshots.find((s) => s.game === g.label)?.homeWin ?? null;
    const b = c4.snapshots.find((s) => s.game === g.label)?.homeWin ?? null;
    const c = c6.snapshots.find((s) => s.game === g.label)?.homeWin ?? null;
    const nums = [a, b, c].filter((x): x is number => x != null);
    const maxAbsDelta =
      nums.length >= 2 ? Math.max(...nums) - Math.min(...nums) : nums.length === 0 ? NaN : 0;
    byGame[g.label] = { c2: a, c4: b, c6: c, maxAbsDelta };
  }

  const report = {
    generatedAt: new Date().toISOString(),
    note: "AUDIT ONLY — identical game list + cover queries; outer batch size only. Cache cleared between levels. Inner SLATE_SIM_CONCURRENCY remains 4 (so outer 6 ≈ outer 4).",
    apiBase: API_BASE,
    games: games.map((g) => ({
      sport: g.sport,
      label: g.label,
      homeTeamId: g.homeTeamId,
      awayTeamId: g.awayTeamId,
    })),
    rows: [
      {
        concurrency: 2,
        simulations: c2.simulations,
        simsLoaded: c2.simsLoaded,
        wallMs: c2.wallMs,
        httpCalls: c2.httpCalls,
        errors: c2.errors,
        rateLimited429: c2.rateLimited429,
        statusHistogram: c2.statusHistogram,
      },
      {
        concurrency: 4,
        simulations: c4.simulations,
        simsLoaded: c4.simsLoaded,
        wallMs: c4.wallMs,
        httpCalls: c4.httpCalls,
        errors: c4.errors,
        rateLimited429: c4.rateLimited429,
        statusHistogram: c4.statusHistogram,
      },
      {
        concurrency: 6,
        simulations: c6.simulations,
        simsLoaded: c6.simsLoaded,
        wallMs: c6.wallMs,
        httpCalls: c6.httpCalls,
        errors: c6.errors,
        rateLimited429: c6.rateLimited429,
        statusHistogram: c6.statusHistogram,
      },
    ],
    deterministic: {
      fullFingerprintEqual: {
        c2_vs_c4: fp2 === fp4,
        c2_vs_c6: fp2 === fp6,
        c4_vs_c6: fp4 === fp6,
      },
      homeWinOnlyEqual: {
        c2_vs_c4: hw2 === hw4,
        c2_vs_c6: hw2 === hw6,
        c4_vs_c6: hw4 === hw6,
      },
      numericHomeWinCoverDiffs: {
        c2_vs_c4: numericDiff(c2.snapshots, c4.snapshots),
        c2_vs_c6: numericDiff(c2.snapshots, c6.snapshots),
        c4_vs_c6: numericDiff(c4.snapshots, c6.snapshots),
      },
      perGameHomeWin: byGame,
      note: "homeWinOnly isolates MC draw; coverKeys may differ when NFL/NCAAF period-stats fan-in races independently of concurrency batching.",
    },
  };

  const out = "/opt/cursor/artifacts/coach-phase23-game-sim-concurrency.json";
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.error(`wrote ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
