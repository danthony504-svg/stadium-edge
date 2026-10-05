/**
 * Phase 2.2 — E2E + warm-repeat async waterfall.
 * Local resolvePropAthleteIds + runPropSims; odds/context → production.
 */
import { writeFileSync } from "node:fs";
import { buildCoachParlay } from "../../stadium-mobile/lib/coach/buildParlay.ts";
import {
  clearCoachContextCache,
  coachCacheSnapshot,
  resetCoachCacheStats,
} from "../../stadium-mobile/lib/coachContextCache.ts";
import { API_BASE } from "../../stadium-mobile/lib/apiBase.ts";
import { runPropSims, tierSimCount } from "../src/lib/propSimRunner.ts";
import { clearPropSimDedicatedStoresForTests } from "../src/lib/propSimDedicatedStore.ts";
import { clearAthleteIdentityStoreForTests } from "../src/lib/athleteIdentityStore.ts";
import {
  resolvePropAthleteIdsDetailed,
} from "../src/lib/resolvePropAthleteIds.ts";
import { fetchEspnInjuries } from "../src/lib/espnInjuries.ts";
import { keyInjuryWeight, type SimPropRequest } from "../src/lib/monteCarloBuild.ts";
import { teamPace } from "../src/lib/statmuse.ts";
import type { SimTier } from "../src/lib/simCache.ts";

const HARD_MS = 300_000;
const PRE22 = { cold5: 29800, warm5: 19800, soccerTo5: 26600, nfl7: 12200 };

type Span = {
  name: string;
  startMs: number;
  endMs: number;
  durMs: number;
  detail?: Record<string, unknown>;
};

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

type PropSimAgg = {
  calls: number;
  propSimWallMs: number;
  propSimElapsedMs: number;
  athleteMs: number;
  injuryMs: number;
  ctxCacheHits: number;
  ctxCacheMisses: number;
  ctxCoalesced: number;
  historyLoads: number;
  distributionCacheHits: number;
  distributionCacheMisses: number;
  distributionsGenerated: number;
  distCoalesced: number;
  providerLines: number;
  scored: number;
  stampedFastPath: number;
  athleteCacheHits: number;
  athleteProviderCalls: number;
};

function emptyAgg(): PropSimAgg {
  return {
    calls: 0,
    propSimWallMs: 0,
    propSimElapsedMs: 0,
    athleteMs: 0,
    injuryMs: 0,
    ctxCacheHits: 0,
    ctxCacheMisses: 0,
    ctxCoalesced: 0,
    historyLoads: 0,
    distributionCacheHits: 0,
    distributionCacheMisses: 0,
    distributionsGenerated: 0,
    distCoalesced: 0,
    providerLines: 0,
    scored: 0,
    stampedFastPath: 0,
    athleteCacheHits: 0,
    athleteProviderCalls: 0,
  };
}

async function handleLocalPropSim(
  body: Record<string, unknown>,
  agg: PropSimAgg,
  spans: Span[] | null,
  callId: string,
): Promise<Record<string, unknown>> {
  const coachStartedAt = performance.now();
  const sport = String(body.sport ?? "").toLowerCase();
  const tier = (String(body.tier ?? "deep").toLowerCase() === "quick" ? "quick" : "deep") as SimTier;
  const simulations = body.simulations != null ? Number(body.simulations) : undefined;
  const props = (body.props ?? []) as SimPropRequest[];
  const homeTeam = String(body.homeTeam ?? "");
  const awayTeam = String(body.awayTeam ?? "");
  const isHomeByPlayer = (body.isHomeByPlayer ?? {}) as Record<string, boolean>;
  const homeTeamId = String(body.homeTeamId ?? "").trim();
  const awayTeamId = String(body.awayTeamId ?? "").trim();

  const propsIn = props.map((p) => ({
    ...p,
    sport: String(p.sport ?? sport).toLowerCase(),
  }));

  const tAth0 = performance.now();
  const { props: propsResolved, stats: athStats } = await resolvePropAthleteIdsDetailed(
    sport,
    propsIn,
    { homeTeamId, awayTeamId, homeTeam, awayTeam },
  );
  const tAth1 = performance.now();
  const athleteMs = Math.round(tAth1 - tAth0);
  if (spans) {
    spans.push({
      name: `${callId}:resolvePropAthleteIds`,
      startMs: Math.round(tAth0 - coachStartedAt),
      endMs: Math.round(tAth1 - coachStartedAt),
      durMs: athleteMs,
      detail: {
        ...athStats,
        propCount: props.length,
        alreadyHadId: props.filter((p) => p.athleteId).length,
      },
    });
  }

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

  const tInj0 = performance.now();
  const injuries = await fetchEspnInjuries(sport);
  const tInj1 = performance.now();
  const injuryMs = Math.round(tInj1 - tInj0);
  if (spans) {
    spans.push({
      name: `${callId}:fetchEspnInjuries`,
      startMs: Math.round(tInj0 - coachStartedAt),
      endMs: Math.round(tInj1 - coachStartedAt),
      durMs: injuryMs,
    });
  }

  const gameCtx = {
    sport,
    oppPace,
    leaguePace,
    oppKeyInjuries: awayTeam ? teamInjuryWeight(injuries, awayTeam) : 0,
    ownKeyInjuries: homeTeam ? teamInjuryWeight(injuries, homeTeam) : 0,
    weatherImpact:
      sport === "mlb" && body.weatherImpact != null ? Number(body.weatherImpact) : null,
  };

  const tSim0 = performance.now();
  const { rows, deepPending, distStats, propSimElapsedMs } = await runPropSims(
    propsResolved,
    tier,
    gameCtx,
    isHomeByPlayer,
    simulations,
  );
  const tSim1 = performance.now();
  if (spans) {
    spans.push({
      name: `${callId}:runPropSims`,
      startMs: Math.round(tSim0 - coachStartedAt),
      endMs: Math.round(tSim1 - coachStartedAt),
      durMs: Math.round(tSim1 - tSim0),
      detail: { propSimElapsedMs, ...distStats },
    });
  }

  agg.athleteMs += athleteMs;
  agg.injuryMs += injuryMs;
  agg.stampedFastPath += athStats.stampedFastPath;
  agg.athleteCacheHits += athStats.cacheHits;
  agg.athleteProviderCalls += athStats.providerCalls;
  agg.ctxCacheHits += distStats.ctxCacheHits;
  agg.ctxCacheMisses += distStats.ctxCacheMisses;
  agg.ctxCoalesced += distStats.ctxCoalesced;
  agg.historyLoads += distStats.historyLoads;
  agg.distributionCacheHits += distStats.distributionCacheHits;
  agg.distributionCacheMisses += distStats.distributionCacheMisses;
  agg.distributionsGenerated += distStats.distributionsGenerated;
  agg.distCoalesced += distStats.distCoalesced;
  agg.providerLines += rows.length;
  agg.scored += rows.filter((p) => p.hitProbability != null).length;
  agg.propSimElapsedMs += propSimElapsedMs;

  return {
    sport,
    tier,
    simulations: tierSimCount(tier, simulations),
    deepPending: tier === "quick" ? deepPending : false,
    providerLinesEvaluated: rows.length,
    distributionCacheHits: distStats.distributionCacheHits,
    distributionCacheMisses: distStats.distributionCacheMisses,
    distributionsGenerated: distStats.distributionsGenerated,
    thresholdsEvaluatedFromCache: distStats.thresholdsEvaluatedFromCache,
    thresholdsEvaluatedFromFreshDraw: distStats.thresholdsEvaluatedFromFreshDraw,
    monteCarloDrawsAvoided: distStats.monteCarloDrawsAvoided,
    monteCarloDrawsExecuted: distStats.monteCarloDrawsExecuted,
    ctxCacheHits: distStats.ctxCacheHits,
    ctxCacheMisses: distStats.ctxCacheMisses,
    ctxCoalesced: distStats.ctxCoalesced,
    historyLoads: distStats.historyLoads,
    distCoalesced: distStats.distCoalesced,
    propSimElapsedMs,
    coachElapsedMs: Math.round(performance.now() - coachStartedAt),
    athleteResolveMs: athleteMs,
    athleteStats: athStats,
    props: rows,
  };
}

async function runAsk(
  label: string,
  ask: string,
  priors: string[],
  opts: { clearClientCache: boolean; clearPropSimStores: boolean; waterfall: boolean },
) {
  if (opts.clearClientCache) clearCoachContextCache();
  if (opts.clearPropSimStores) {
    clearPropSimDedicatedStoresForTests();
    clearAthleteIdentityStoreForTests();
  }
  resetCoachCacheStats();

  const agg = emptyAgg();
  const spans: Span[] = [];
  const httpByPrefix: Record<string, { count: number; ms: number }> = {};
  let httpCalls = 0;
  const origin = performance.now();
  const orig = globalThis.fetch.bind(globalThis);

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    httpCalls += 1;
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    const method = String(init?.method ?? "GET").toUpperCase();
    const t0 = performance.now();

    if (url.includes("/sports/simulate/props") && method === "POST") {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(String(init?.body ?? "{}"));
      } catch {
        body = {};
      }
      const callId = `propSim#${agg.calls + 1}`;
      const json = await handleLocalPropSim(body, agg, opts.waterfall ? spans : null, callId);
      const wall = Math.round(performance.now() - t0);
      agg.calls += 1;
      agg.propSimWallMs += wall;
      if (opts.waterfall) {
        spans.push({
          name: `http:${callId}`,
          startMs: Math.round(t0 - origin),
          endMs: Math.round(performance.now() - origin),
          durMs: wall,
        });
      }
      return new Response(JSON.stringify(json), {
        status: 200,
        headers: { "Content-Type": "application/json", "X-Phase22-Local": "1" },
      });
    }

    const res = await orig(input, init);
    const ms = Math.round(performance.now() - t0);
    let prefix = "other";
    try {
      const u = new URL(url, "https://local");
      const parts = u.pathname.split("/").filter(Boolean);
      prefix = parts.slice(0, 3).join("/") || "root";
    } catch {
      prefix = url.slice(0, 40);
    }
    const bucket = httpByPrefix[prefix] ?? { count: 0, ms: 0 };
    bucket.count += 1;
    bucket.ms += ms;
    httpByPrefix[prefix] = bucket;
    if (opts.waterfall && ms >= 50) {
      spans.push({
        name: `http:${method}:${prefix}`,
        startMs: Math.round(t0 - origin),
        endMs: Math.round(performance.now() - origin),
        durMs: ms,
        detail: { url: url.slice(0, 120) },
      });
    }
    return res;
  }) as typeof fetch;

  const t0 = performance.now();
  const ac = new AbortController();
  const kill = setTimeout(() => ac.abort(), HARD_MS);
  try {
    const result = await buildCoachParlay({
      requestedLegs: Number(ask.match(/(\d+)/)?.[1] ?? 5),
      askText: ask,
      priorUserTexts: priors,
      signal: ac.signal,
    });
    const picks = result.picks ?? [];
    const totalWallMs = Math.round(performance.now() - t0);
    const qualified =
      result.scan?.manifest?.totalQualified ??
      picks.filter((p) => p.finalAiScore?.recommends !== false).length;

    // Longest dependency chain for warm path (greedy by end time).
    const sorted = [...spans].sort((a, b) => a.startMs - b.startMs);
    const critical: Span[] = [];
    let cursor = 0;
    while (true) {
      const candidates = sorted.filter((s) => s.startMs >= cursor - 5);
      if (!candidates.length) break;
      // Pick span that extends the chain farthest
      candidates.sort((a, b) => b.endMs - a.endMs);
      const next = candidates[0]!;
      if (next.endMs <= cursor) break;
      critical.push(next);
      cursor = next.endMs;
      if (critical.length > 40) break;
    }

    return {
      label,
      ask,
      priors,
      totalWallMs,
      httpCalls,
      propSim: agg,
      clientCache: coachCacheSnapshot(),
      qualified,
      finalLegs: picks.length,
      propLike: picks.filter((p) => p.isProp).length,
      gameLike: picks.filter((p) => !p.isProp).length,
      markets: [...new Set(picks.map((p) => p.market))],
      timedOut: result.timedOut,
      note: (result.note || "").slice(0, 200),
      httpByPrefix: Object.entries(httpByPrefix)
        .map(([k, v]) => ({ path: k, ...v }))
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 20),
      waterfallSpans: opts.waterfall ? spans.sort((a, b) => a.startMs - b.startMs) : undefined,
      criticalPath: opts.waterfall
        ? {
            spans: critical,
            sumDurMs: critical.reduce((s, x) => s + x.durMs, 0),
            wallMs: totalWallMs,
          }
        : undefined,
    };
  } finally {
    clearTimeout(kill);
    globalThis.fetch = orig;
  }
}

function row(r: Awaited<ReturnType<typeof runAsk>>) {
  const s = r.propSim;
  return {
    request: r.label,
    totalWallMs: r.totalWallMs,
    http: r.httpCalls,
    athleteMs: s.athleteMs,
    injuryMs: s.injuryMs,
    stampedFastPath: s.stampedFastPath,
    athleteCacheHits: s.athleteCacheHits,
    athleteProviderCalls: s.athleteProviderCalls,
    ctxHits: s.ctxCacheHits,
    ctxMisses: s.ctxCacheMisses,
    distHits: s.distributionCacheHits,
    distMisses: s.distributionCacheMisses,
    coalesced: s.ctxCoalesced + s.distCoalesced,
    propSimWallMs: s.propSimWallMs,
    propSimElapsedMs: s.propSimElapsedMs,
    historyLoads: s.historyLoads,
    qualified: r.qualified,
    final: r.finalLegs,
  };
}

async function main() {
  console.error("API_BASE", API_BASE);
  console.error("Phase 2.2 E2E — local athlete resolve + runPropSims; board → production");

  const cold5 = await runAsk("fresh_5leg", "5 leg", [], {
    clearClientCache: true,
    clearPropSimStores: true,
    waterfall: false,
  });
  console.error(
    `[fresh_5] wall=${cold5.totalWallMs} athlete=${cold5.propSim.athleteMs} ctx=${cold5.propSim.ctxCacheHits}/${cold5.propSim.ctxCacheMisses} dist=${cold5.propSim.distributionCacheHits}/${cold5.propSim.distributionCacheMisses} final=${cold5.finalLegs}`,
  );

  await new Promise((r) => setTimeout(r, 800));
  const warm5 = await runAsk("repeat_5leg", "5 leg", [], {
    clearClientCache: false,
    clearPropSimStores: false,
    waterfall: true,
  });
  console.error(
    `[repeat_5] wall=${warm5.totalWallMs} athlete=${warm5.propSim.athleteMs} stamped=${warm5.propSim.stampedFastPath} ctx=${warm5.propSim.ctxCacheHits}/${warm5.propSim.ctxCacheMisses} dist=${warm5.propSim.distributionCacheHits}/${warm5.propSim.distributionCacheMisses} propSimElapsed=${warm5.propSim.propSimElapsedMs} final=${warm5.finalLegs}`,
  );

  await new Promise((r) => setTimeout(r, 800));
  clearCoachContextCache();
  const soccer = await runAsk("soccer_4leg", "4 leg soccer", [], {
    clearClientCache: false,
    clearPropSimStores: false,
    waterfall: false,
  });
  console.error(`[soccer_4] wall=${soccer.totalWallMs} final=${soccer.finalLegs}`);
  await new Promise((r) => setTimeout(r, 600));
  const afterSoccer = await runAsk("after_soccer_5leg", "5 leg", ["4 leg soccer"], {
    clearClientCache: false,
    clearPropSimStores: false,
    waterfall: false,
  });
  console.error(
    `[soccer→5] wall=${afterSoccer.totalWallMs} athlete=${afterSoccer.propSim.athleteMs} propSim=${afterSoccer.propSim.propSimElapsedMs} final=${afterSoccer.finalLegs}`,
  );

  await new Promise((r) => setTimeout(r, 800));
  const nfl7 = await runAsk("nfl_7leg", "7 leg NFL", [], {
    clearClientCache: true,
    clearPropSimStores: true,
    waterfall: false,
  });
  console.error(
    `[nfl_7] wall=${nfl7.totalWallMs} athlete=${nfl7.propSim.athleteMs} final=${nfl7.finalLegs} qualified=${nfl7.qualified}`,
  );

  const topHttp = warm5.httpByPrefix ?? [];
  const nonAthleteExplain = {
    premise:
      "Normal live athlete resolve is already 2–6ms when IDs are stamped. Phase 2.2 does not assume material ordinary-scan reduction.",
    warmAthleteMs: warm5.propSim.athleteMs,
    warmPropSimElapsedMs: warm5.propSim.propSimElapsedMs,
    warmCtx: `${warm5.propSim.ctxCacheHits}/${warm5.propSim.ctxCacheMisses}`,
    warmDist: `${warm5.propSim.distributionCacheHits}/${warm5.propSim.distributionCacheMisses}`,
    warmWallMs: warm5.totalWallMs,
    residualMs: warm5.totalWallMs - warm5.propSim.athleteMs,
    topHttpPaths: topHttp,
    criticalPath: warm5.criticalPath,
  };

  const report = {
    generatedAt: new Date().toISOString(),
    phase: "2.2",
    note: "Local Phase 2.2 athlete identity + runPropSims; other traffic production",
    apiBase: API_BASE,
    table: [row(cold5), row(warm5), row(afterSoccer), row(nfl7)],
    vsPhase21: {
      fresh_5leg: { now: cold5.totalWallMs, p21: PRE22.cold5, deltaMs: cold5.totalWallMs - PRE22.cold5 },
      repeat_5leg: { now: warm5.totalWallMs, p21: PRE22.warm5, deltaMs: warm5.totalWallMs - PRE22.warm5 },
      after_soccer_5leg: {
        now: afterSoccer.totalWallMs,
        p21: PRE22.soccerTo5,
        deltaMs: afterSoccer.totalWallMs - PRE22.soccerTo5,
      },
      nfl_7leg: { now: nfl7.totalWallMs, p21: PRE22.nfl7, deltaMs: nfl7.totalWallMs - PRE22.nfl7 },
    },
    warmRepeatWaterfall: nonAthleteExplain,
    runs: { cold5, warm5, soccer, afterSoccer, nfl7 },
  };

  const outPath = "/opt/cursor/artifacts/coach-phase22-e2e-waterfall.json";
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ table: report.table, warmRepeatWaterfall: nonAthleteExplain }, null, 2));
  console.error(`wrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
