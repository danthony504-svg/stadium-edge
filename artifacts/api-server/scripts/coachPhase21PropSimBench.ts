/**
 * Phase 2.1 local bench — fixed payload through runPropSims (no Render deploy).
 * Captures a live Coach prop-sim body from production, then exercises local Phase 2.1.
 */
import { buildCoachParlay } from "../../stadium-mobile/lib/coach/buildParlay.ts";
import { clearCoachContextCache } from "../../stadium-mobile/lib/coachContextCache.ts";
import { runPropSims } from "../src/lib/propSimRunner.ts";
import { clearPropSimDedicatedStoresForTests, clearPropSimDistStoreForTests } from "../src/lib/propSimDedicatedStore.ts";
import { resolvePropAthleteIds } from "../src/lib/resolvePropAthleteIds.ts";
import { fetchEspnInjuries } from "../src/lib/espnInjuries.ts";
import { keyInjuryWeight } from "../src/lib/monteCarloBuild.ts";
import { teamPace } from "../src/lib/statmuse.ts";
import type { SimPropRequest } from "../src/lib/monteCarloBuild.ts";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function teamInjuryWeight(
  teams: Awaited<ReturnType<typeof fetchEspnInjuries>>,
  teamName: string,
): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim();
  const target = norm(teamName);
  const team = teams.find((t) => {
    const n = norm(t.team ?? "");
    return n.includes(target) || target.includes(n);
  });
  return keyInjuryWeight(team?.entries);
}

async function captureBody(): Promise<Record<string, unknown>> {
  clearCoachContextCache();
  let body: Record<string, unknown> | null = null;
  const orig = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    const res = await orig(input, init);
    if (
      String(url).includes("/sports/simulate/props") &&
      String(init?.method ?? "GET").toUpperCase() === "POST" &&
      !body
    ) {
      try {
        body = JSON.parse(String(init?.body ?? "{}"));
      } catch {
        body = null;
      }
    }
    return res;
  }) as typeof fetch;
  const ac = new AbortController();
  const kill = setTimeout(() => ac.abort(), 300_000);
  try {
    await buildCoachParlay({
      requestedLegs: 5,
      askText: "5 leg",
      priorUserTexts: [],
      signal: ac.signal,
    });
  } finally {
    clearTimeout(kill);
    globalThis.fetch = orig;
  }
  if (!body) throw new Error("no body");
  return body;
}

async function prepare(body: Record<string, unknown>) {
  const sport = String(body.sport ?? "").toLowerCase();
  const homeTeam = String(body.homeTeam ?? "");
  const awayTeam = String(body.awayTeam ?? "");
  const homeTeamId = String(body.homeTeamId ?? "").trim();
  const awayTeamId = String(body.awayTeamId ?? "").trim();
  const propsIn = ((body.props ?? []) as SimPropRequest[]).map((p) => ({
    ...p,
    sport: String(p.sport ?? sport).toLowerCase(),
  }));
  const propsResolved = await resolvePropAthleteIds(sport, propsIn, {
    homeTeamId,
    awayTeamId,
    homeTeam,
    awayTeam,
  });
  let oppPace: number | null = null;
  let leaguePace: number | null = 100;
  if ((sport === "nba" || sport === "wnba") && homeTeam && awayTeam) {
    try {
      const [homeP, awayP] = await Promise.all([
        teamPace(sport, homeTeam),
        teamPace(sport, awayTeam),
      ]);
      if (homeP != null && awayP != null) {
        oppPace = (homeP + awayP) / 2;
        leaguePace = 100;
      }
    } catch {
      /* optional */
    }
  }
  const injuries = await fetchEspnInjuries(sport);
  const gameCtx = {
    sport,
    oppPace,
    leaguePace,
    oppKeyInjuries: awayTeam ? teamInjuryWeight(injuries, awayTeam) : 0,
    ownKeyInjuries: homeTeam ? teamInjuryWeight(injuries, homeTeam) : 0,
    weatherImpact:
      sport === "mlb" && body.weatherImpact != null ? Number(body.weatherImpact) : null,
  };
  const isHomeByPlayer = (body.isHomeByPlayer ?? {}) as Record<string, boolean>;
  return { propsResolved, gameCtx, isHomeByPlayer, simulations: Number(body.simulations) || 10000 };
}

async function once(
  label: string,
  prep: Awaited<ReturnType<typeof prepare>>,
  clearStores: boolean,
) {
  if (clearStores) clearPropSimDedicatedStoresForTests();
  const t0 = performance.now();
  const { rows, distStats, propSimElapsedMs } = await runPropSims(
    prep.propsResolved,
    "deep",
    prep.gameCtx,
    prep.isHomeByPlayer,
    prep.simulations,
  );
  return {
    label,
    wallMs: Math.round(performance.now() - t0),
    propSimElapsedMs,
    providerLines: rows.length,
    scored: rows.filter((r) => r.hitProbability != null).length,
    ...distStats,
  };
}

async function main() {
  console.error("capturing fixed payload from production Coach…");
  const body = await captureBody();
  console.error(`captured sport=${body.sport} props=${(body.props as unknown[])?.length}`);
  const prep = await prepare(body);

  const cold = await once("cold_ctx_cold_dist", prep, true);
  console.error(
    `[cold] wall=${cold.wallMs} ctxH=${cold.ctxCacheHits} ctxM=${cold.ctxCacheMisses} distH=${cold.distributionCacheHits} gen=${cold.distributionsGenerated}`,
  );

  clearPropSimDistStoreForTests();
  const warmCtxColdDist = await once("warm_ctx_cold_dist", prep, false);
  console.error(
    `[warmCtxColdDist] wall=${warmCtxColdDist.wallMs} ctxH=${warmCtxColdDist.ctxCacheHits} distH=${warmCtxColdDist.distributionCacheHits} gen=${warmCtxColdDist.distributionsGenerated}`,
  );

  const warmBoth1 = await once("warm_ctx_warm_dist_1", prep, false);
  console.error(
    `[warm1] wall=${warmBoth1.wallMs} ctxH=${warmBoth1.ctxCacheHits} distH=${warmBoth1.distributionCacheHits} gen=${warmBoth1.distributionsGenerated}`,
  );
  const warmBoth2 = await once("warm_ctx_warm_dist_2", prep, false);
  console.error(
    `[warm2] wall=${warmBoth2.wallMs} ctxH=${warmBoth2.ctxCacheHits} distH=${warmBoth2.distributionCacheHits} gen=${warmBoth2.distributionsGenerated}`,
  );

  const t0 = performance.now();
  const parallel = await Promise.all([
    once("sim_a", prep, false),
    once("sim_b", prep, false),
    once("sim_c", prep, false),
  ]);
  const simWall = Math.round(performance.now() - t0);

  clearPropSimDedicatedStoresForTests();
  const tMiss = performance.now();
  const parallelMiss = await Promise.all([
    once("miss_a", prep, false),
    once("miss_b", prep, false),
    once("miss_c", prep, false),
  ]);
  const missWall = Math.round(performance.now() - tMiss);

  const report = {
    generatedAt: new Date().toISOString(),
    note: "Local Phase 2.1 runPropSims (not Render). Payload captured from production Coach.",
    payload: {
      sport: body.sport,
      propCount: (body.props as unknown[])?.length,
      homeTeam: body.homeTeam,
      awayTeam: body.awayTeam,
    },
    cases: {
      cold_ctx_cold_dist: cold,
      warm_ctx_cold_dist: warmCtxColdDist,
      warm_ctx_warm_dist: warmBoth2,
      warm_ctx_warm_dist_first: warmBoth1,
      simultaneous_warm: {
        wallMs: simWall,
        runs: parallel,
        totalGenerated: parallel.reduce((a, r) => a + r.distributionsGenerated, 0),
        totalDistCoalesced: parallel.reduce((a, r) => a + r.distCoalesced, 0),
        totalCtxCoalesced: parallel.reduce((a, r) => a + r.ctxCoalesced, 0),
      },
      simultaneous_cold_miss: {
        wallMs: missWall,
        runs: parallelMiss,
        totalGenerated: parallelMiss.reduce((a, r) => a + r.distributionsGenerated, 0),
        totalDistCoalesced: parallelMiss.reduce((a, r) => a + r.distCoalesced, 0),
        totalCtxCoalesced: parallelMiss.reduce((a, r) => a + r.ctxCoalesced, 0),
      },
    },
    phase2Baseline: {
      cold5Ms: 29700,
      warm5Ms: 19400,
      soccerTo5Ms: 26400,
      nfl7Ms: 12868,
    },
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
