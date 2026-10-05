/**
 * Phase 2.2 — forced stripped-ID athlete resolve bench + concurrency verify.
 */
import { writeFileSync } from "node:fs";
import { buildCoachParlay } from "../../stadium-mobile/lib/coach/buildParlay.ts";
import { clearCoachContextCache, resetCoachCacheStats } from "../../stadium-mobile/lib/coachContextCache.ts";
import {
  ATHLETE_IDENTITY_CONCURRENCY,
  clearAthleteIdentityStoreForTests,
} from "../src/lib/athleteIdentityStore.ts";
import { clearPropSimDedicatedStoresForTests } from "../src/lib/propSimDedicatedStore.ts";
import { resolvePropAthleteIdsDetailed } from "../src/lib/resolvePropAthleteIds.ts";
import type { SimPropRequest } from "../src/lib/monteCarloBuild.ts";
import { mapWithConcurrency } from "../src/lib/propSimCtxCache.ts";

const PROD = "https://stadium-edge.onrender.com/api";

type Captured = {
  sport: string;
  props: SimPropRequest[];
  homeTeamId?: string;
  awayTeamId?: string;
  homeTeam?: string;
  awayTeam?: string;
};

async function captureDeepSimBody(): Promise<Captured | null> {
  let captured: Captured | null = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/sports/simulate/props") && init?.method === "POST" && !captured) {
      try {
        const body = JSON.parse(String(init.body ?? "{}")) as Captured;
        if (Array.isArray(body.props) && body.props.length) captured = body;
      } catch {
        /* ignore */
      }
    }
    if (url.startsWith("http")) return originalFetch(url, init);
    const path = url.replace(/^\/api/, "");
    return originalFetch(`${PROD}${path.startsWith("/") ? path : `/${path}`}`, init);
  }) as typeof fetch;

  try {
    clearCoachContextCache();
    resetCoachCacheStats();
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
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
  return captured;
}

async function main() {
  const captured = await captureDeepSimBody();
  if (!captured?.props?.length) {
    console.error("Failed to capture deep-sim body");
    process.exit(1);
  }

  const sport = String(captured.sport || captured.props[0]?.sport || "mlb").toLowerCase();
  const opts = {
    homeTeamId: String(captured.homeTeamId ?? "").trim(),
    awayTeamId: String(captured.awayTeamId ?? "").trim(),
    homeTeam: String(captured.homeTeam ?? ""),
    awayTeam: String(captured.awayTeam ?? ""),
  };

  const stamped = captured.props.map((p) => ({ ...p, sport }));
  const stripped = captured.props.map((p) => {
    const { athleteId: _a, ...rest } = p;
    return { ...rest, sport } as SimPropRequest;
  });
  const strippedNoTeam = stripped.map((p) => {
    const copy = { ...p };
    delete copy.homeTeamId;
    delete copy.awayTeamId;
    return copy;
  });
  const uniquePlayers = [...new Set(stripped.map((p) => p.player))];

  clearAthleteIdentityStoreForTests();
  clearPropSimDedicatedStoresForTests();
  let t0 = performance.now();
  const natural = await resolvePropAthleteIdsDetailed(sport, stamped, opts);
  const naturalReport = {
    label: "natural_stamped",
    wallMs: Math.round(performance.now() - t0),
    players: stamped.length,
    uniquePlayers: uniquePlayers.length,
    alreadyHadId: stamped.filter((p) => p.athleteId).length,
    stillMissing: natural.props.filter((p) => !p.athleteId).length,
    stats: natural.stats,
  };

  clearAthleteIdentityStoreForTests();
  clearPropSimDedicatedStoresForTests();
  t0 = performance.now();
  const forced = await resolvePropAthleteIdsDetailed(sport, stripped, opts);
  const forcedTeam = {
    label: "forced_strip_with_team_ids",
    wallMs: Math.round(performance.now() - t0),
    players: stripped.length,
    uniquePlayers: uniquePlayers.length,
    alreadyHadId: 0,
    stillMissing: forced.props.filter((p) => !p.athleteId).length,
    stats: forced.stats,
  };

  t0 = performance.now();
  const warm = await resolvePropAthleteIdsDetailed(sport, stripped, opts);
  const forcedWarm = {
    label: "forced_strip_identity_cache_warm",
    wallMs: Math.round(performance.now() - t0),
    stillMissing: warm.props.filter((p) => !p.athleteId).length,
    stats: warm.stats,
  };

  clearAthleteIdentityStoreForTests();
  clearPropSimDedicatedStoresForTests();
  t0 = performance.now();
  const search = await resolvePropAthleteIdsDetailed(sport, strippedNoTeam, {
    homeTeam: opts.homeTeam,
    awayTeam: opts.awayTeam,
  });
  const forcedSearch = {
    label: "forced_strip_no_team_ids_search",
    wallMs: Math.round(performance.now() - t0),
    players: strippedNoTeam.length,
    uniquePlayers: uniquePlayers.length,
    stillMissing: search.props.filter((p) => !p.athleteId).length,
    stats: search.stats,
  };

  // Concurrency probe on search path (no team ids) — compare 1/2/4/6.
  const concurrencyProbe = [];
  for (const conc of [1, 2, 4, 6]) {
    clearAthleteIdentityStoreForTests();
    clearPropSimDedicatedStoresForTests();
    const props: SimPropRequest[] = uniquePlayers.map((player) => ({
      player,
      market: "batter_hits",
      line: 0.5,
      side: "Over",
      sport,
    }));
    t0 = performance.now();
    if (conc === ATHLETE_IDENTITY_CONCURRENCY) {
      const { stats } = await resolvePropAthleteIdsDetailed(sport, props, {
        homeTeam: opts.homeTeam,
        awayTeam: opts.awayTeam,
      });
      concurrencyProbe.push({
        concurrency: conc,
        wallMs: Math.round(performance.now() - t0),
        searchCalls: stats.searchCalls,
        providerCalls: stats.providerCalls,
        via: "production_resolver",
      });
    } else {
      // Simulate alternate concurrency by resolving unique players in parallel batches.
      await mapWithConcurrency(props, conc, async (p) => {
        await resolvePropAthleteIdsDetailed(sport, [p], {
          homeTeam: opts.homeTeam,
          awayTeam: opts.awayTeam,
        });
      });
      concurrencyProbe.push({
        concurrency: conc,
        wallMs: Math.round(performance.now() - t0),
        via: "parallel_single_player",
      });
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    phase: "2.2",
    ATHLETE_IDENTITY_CONCURRENCY,
    apiBase: PROD,
    captured: {
      sport,
      propCount: captured.props.length,
      withAthleteId: captured.props.filter((p) => p.athleteId).length,
      uniquePlayers: uniquePlayers.length,
      homeTeamId: opts.homeTeamId,
      awayTeamId: opts.awayTeamId,
      homeTeam: opts.homeTeam,
      awayTeam: opts.awayTeam,
    },
    naturalReport,
    forcedTeam,
    forcedWarm,
    forcedSearch,
    concurrencyProbe,
  };

  const outPath = "/opt/cursor/artifacts/coach-phase22-athlete-forced-bench.json";
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
