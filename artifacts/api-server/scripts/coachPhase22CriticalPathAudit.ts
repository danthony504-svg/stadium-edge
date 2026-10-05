/**
 * Phase 2.2 follow-up — critical-path waterfall for warm repeat 5.
 * Report-only: no production code changes.
 *
 * Captures overlapping start/end intervals (do NOT sum durations).
 * Also: 5× fresh-5 variance + NFL 7 shortfall classification.
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
import { resolvePropAthleteIdsDetailed } from "../src/lib/resolvePropAthleteIds.ts";
import { fetchEspnInjuries } from "../src/lib/espnInjuries.ts";
import { keyInjuryWeight, type SimPropRequest } from "../src/lib/monteCarloBuild.ts";
import { teamPace } from "../src/lib/statmuse.ts";
import type { SimTier } from "../src/lib/simCache.ts";
import { attachPickScores } from "../../stadium-mobile/lib/pickScoreContext.ts";
import type { ParsedPick } from "../../stadium-mobile/lib/parlayGenerator.ts";

const HARD_MS = 300_000;

type Interval = {
  stage: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  awaitedBy?: string;
  blocksFinal?: boolean;
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

function classifyUrl(url: string, method: string): string {
  const u = url.toLowerCase();
  if (u.includes("/sports/simulate/props")) return "prop_simulation";
  if (u.includes("/sports/simulate/game") || u.includes("/sports/simulate")) return "game_simulation";
  if (u.includes("/sports/live-odds")) return "live_odds";
  if (u.includes("/sports/props")) return "prop_alt_discovery";
  if (u.includes("/sports/odds")) return "board_odds";
  if (u.includes("/sports/games") || u.includes("/espn") && u.includes("scoreboard"))
    return "board_slate_games";
  if (u.includes("/sports/injuries") || u.includes("/injuries")) return "injuries";
  if (u.includes("/weather")) return "weather_park";
  if (u.includes("/player-history") || u.includes("/history")) return "player_history";
  if (u.includes("/defense") || u.includes("/rush")) return "context_defense";
  if (u.includes("/matchup")) return "context_matchup";
  if (u.includes("/team-period") || u.includes("/period-stats")) return "team_period_stats";
  if (u.includes("/mlb")) return "mlb_context";
  return `other:${method}`;
}

type RunOpts = {
  label: string;
  ask: string;
  priors: string[];
  clearClient: boolean;
  clearPropSim: boolean;
  waterfall: boolean;
};

async function runOnce(opts: RunOpts) {
  if (opts.clearClient) clearCoachContextCache();
  if (opts.clearPropSim) {
    clearPropSimDedicatedStoresForTests();
    clearAthleteIdentityStoreForTests();
  }
  resetCoachCacheStats();

  const origin = performance.now();
  const intervals: Interval[] = [];
  const statusLog: Array<{ t: number; status: string }> = [];
  const partialLog: Array<{
    t: number;
    picks: number;
    props: number;
    qualified: number;
    awaitingPropSlots?: boolean;
    propPhaseIncomplete?: boolean;
  }> = [];

  const open = new Map<string, number>();
  function openStage(stage: string, detail?: Record<string, unknown>) {
    open.set(stage, performance.now());
    if (detail) {
      /* stash on first open only */
    }
  }
  function closeStage(
    stage: string,
    extra?: { awaitedBy?: string; blocksFinal?: boolean; detail?: Record<string, unknown> },
  ) {
    const start = open.get(stage);
    if (start == null) return;
    const end = performance.now();
    intervals.push({
      stage,
      startMs: Math.round(start - origin),
      endMs: Math.round(end - origin),
      durationMs: Math.round(end - start),
      awaitedBy: extra?.awaitedBy,
      blocksFinal: extra?.blocksFinal,
      detail: extra?.detail,
    });
    open.delete(stage);
  }

  let athleteMs = 0;
  let injuryMs = 0;
  let propSimElapsedMs = 0;
  let propSimWallMs = 0;
  let stamped = 0;
  let ctxHits = 0;
  let ctxMisses = 0;
  let distHits = 0;
  let distMisses = 0;
  let httpCalls = 0;
  const httpByStage: Record<string, { count: number; sumMs: number; maxMs: number }> = {};

  const origFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    httpCalls += 1;
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    const method = String(init?.method ?? "GET").toUpperCase();
    const stage = classifyUrl(url, method);
    const t0 = performance.now();

    if (url.includes("/sports/simulate/props") && method === "POST") {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(String(init?.body ?? "{}"));
      } catch {
        body = {};
      }
      const sport = String(body.sport ?? "").toLowerCase();
      const tier = (String(body.tier ?? "deep").toLowerCase() === "quick" ? "quick" : "deep") as SimTier;
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
      const { props: propsResolved, stats } = await resolvePropAthleteIdsDetailed(sport, propsIn, {
        homeTeamId,
        awayTeamId,
        homeTeam,
        awayTeam,
      });
      const tAth1 = performance.now();
      athleteMs += Math.round(tAth1 - tAth0);
      stamped += stats.stampedFastPath;
      intervals.push({
        stage: "athlete_resolution",
        startMs: Math.round(tAth0 - origin),
        endMs: Math.round(tAth1 - origin),
        durationMs: Math.round(tAth1 - tAth0),
        awaitedBy: "prop_simulation",
        blocksFinal: true,
        detail: { ...stats, propCount: props.length },
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

      const tInj0 = performance.now();
      const injuries = await fetchEspnInjuries(sport);
      const tInj1 = performance.now();
      injuryMs += Math.round(tInj1 - tInj0);
      intervals.push({
        stage: "injury_context_server",
        startMs: Math.round(tInj0 - origin),
        endMs: Math.round(tInj1 - origin),
        durationMs: Math.round(tInj1 - tInj0),
        awaitedBy: "prop_simulation",
        blocksFinal: true,
      });

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
      const { rows, deepPending, distStats, propSimElapsedMs: elapsed } = await runPropSims(
        propsResolved,
        tier,
        gameCtx,
        isHomeByPlayer,
        body.simulations != null ? Number(body.simulations) : undefined,
      );
      const tSim1 = performance.now();
      propSimElapsedMs += elapsed;
      propSimWallMs += Math.round(tSim1 - tSim0);
      ctxHits += distStats.ctxCacheHits;
      ctxMisses += distStats.ctxCacheMisses;
      distHits += distStats.distributionCacheHits;
      distMisses += distStats.distributionCacheMisses;
      intervals.push({
        stage: "prop_simulation",
        startMs: Math.round(tSim0 - origin),
        endMs: Math.round(tSim1 - origin),
        durationMs: Math.round(tSim1 - tSim0),
        awaitedBy: "full_board_scan",
        blocksFinal: true,
        detail: { propSimElapsedMs: elapsed, ...distStats, scored: rows.filter((r) => r.hitProbability != null).length },
      });

      const wall = Math.round(performance.now() - t0);
      const bucket = httpByStage[stage] ?? { count: 0, sumMs: 0, maxMs: 0 };
      bucket.count += 1;
      bucket.sumMs += wall;
      bucket.maxMs = Math.max(bucket.maxMs, wall);
      httpByStage[stage] = bucket;

      return new Response(
        JSON.stringify({
          sport,
          tier,
          simulations: tierSimCount(tier, body.simulations != null ? Number(body.simulations) : undefined),
          deepPending: tier === "quick" ? deepPending : false,
          providerLinesEvaluated: rows.length,
          ...distStats,
          propSimElapsedMs: elapsed,
          props: rows,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    const res = await origFetch(input, init);
    const end = performance.now();
    const ms = Math.round(end - t0);
    const bucket = httpByStage[stage] ?? { count: 0, sumMs: 0, maxMs: 0 };
    bucket.count += 1;
    bucket.sumMs += ms;
    bucket.maxMs = Math.max(bucket.maxMs, ms);
    httpByStage[stage] = bucket;

    if (opts.waterfall) {
      intervals.push({
        stage: `http:${stage}`,
        startMs: Math.round(t0 - origin),
        endMs: Math.round(end - origin),
        durationMs: ms,
        awaitedBy: stage.includes("prop")
          ? "prop_alt_discovery_or_sim"
          : stage.includes("game")
            ? "game_simulation_phase"
            : "board_or_context",
        blocksFinal: true,
        detail: { method, url: url.slice(0, 140), status: res.status },
      });
    }
    return res;
  }) as typeof fetch;

  openStage("submit_to_final");
  const ac = new AbortController();
  const kill = setTimeout(() => ac.abort(), HARD_MS);
  let result: Awaited<ReturnType<typeof buildCoachParlay>>;
  try {
    const tLoad0 = performance.now();
    openStage("board_slate_and_discovery");
    result = await buildCoachParlay({
      requestedLegs: Number(opts.ask.match(/(\d+)/)?.[1] ?? 5),
      askText: opts.ask,
      priorUserTexts: opts.priors,
      signal: ac.signal,
      onStatus: (status) => {
        const t = Math.round(performance.now() - origin);
        statusLog.push({ t, status });
        // Map status → coarse stage boundaries
        if (/Loading .*board/i.test(status) || /Loading tonight/i.test(status)) {
          openStage("board_slate_load");
        }
        if (/player props and alt/i.test(status)) {
          closeStage("board_slate_load", { awaitedBy: "loadScanInputs", blocksFinal: true });
          openStage("prop_alt_discovery");
        }
        if (/matchups, injuries|injury context|weather, and coach|recent form/i.test(status)) {
          closeStage("prop_alt_discovery", { awaitedBy: "loadScanInputs", blocksFinal: true });
          closeStage("board_slate_and_discovery", {
            awaitedBy: "buildCoachParlay",
            blocksFinal: true,
            detail: { wallMs: Math.round(performance.now() - tLoad0) },
          });
          openStage("context_enrichment");
        }
        if (/Scanning .*posted/i.test(status) || /Scanning posted game/i.test(status)) {
          closeStage("context_enrichment", { awaitedBy: "buildCoachParlay", blocksFinal: true });
          openStage("scan_score_stage");
        }
        if (/Scoring game lines/i.test(status)) {
          openStage("game_line_scoring_visible");
        }
        if (/Scoring ticket/i.test(status) || /props\/alts/i.test(status)) {
          closeStage("game_line_scoring_visible", {
            awaitedBy: "scan",
            blocksFinal: false,
          });
        }
        if (/Finishing prop/i.test(status)) {
          openStage("prop_grace_window");
        }
      },
      onPartialPicks: (picks) => {
        partialLog.push({
          t: Math.round(performance.now() - origin),
          picks: picks.length,
          props: picks.filter((p) => p.isProp).length,
          qualified: picks.length,
        });
      },
      onReadyToScan: (info) => {
        intervals.push({
          stage: "ready_to_scan_marker",
          startMs: Math.round(performance.now() - origin),
          endMs: Math.round(performance.now() - origin),
          durationMs: 0,
          blocksFinal: true,
          detail: { propPoolSize: info.propPoolSize },
        });
      },
    });
  } finally {
    clearTimeout(kill);
    globalThis.fetch = origFetch;
  }

  closeStage("scan_score_stage", { awaitedBy: "buildCoachParlay", blocksFinal: true });
  closeStage("prop_grace_window", { awaitedBy: "buildCoachParlay", blocksFinal: true });
  closeStage("submit_to_final", { blocksFinal: true });

  // Close any dangling opens
  for (const stage of [...open.keys()]) {
    closeStage(stage, { blocksFinal: false, detail: { dangling: true } });
  }

  const totalWallMs = Math.round(performance.now() - origin);
  const picks = result.picks ?? [];

  // Critical path: greedy chain of overlapping intervals that extend farthest.
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs || b.endMs - a.endMs);
  const chain: Interval[] = [];
  let cursor = 0;
  const used = new Set<number>();
  while (chain.length < 60) {
    let best: Interval | null = null;
    let bestIdx = -1;
    for (let i = 0; i < sorted.length; i++) {
      if (used.has(i)) continue;
      const s = sorted[i]!;
      // Allow slight overlap start
      if (s.startMs > cursor + 30) continue;
      if (s.endMs <= cursor) continue;
      if (!best || s.endMs > best.endMs) {
        best = s;
        bestIdx = i;
      }
    }
    if (!best || bestIdx < 0) {
      // Jump to next unstarted span
      const next = sorted.find((s, i) => !used.has(i) && s.startMs >= cursor);
      if (!next) break;
      cursor = next.startMs;
      continue;
    }
    used.add(bestIdx);
    chain.push(best);
    cursor = best.endMs;
  }

  // Gap analysis: largest quiet gaps with no HTTP ≥5ms after ready_to_scan
  const httpIntervals = intervals
    .filter((i) => i.stage.startsWith("http:") || i.stage === "prop_simulation" || i.stage === "athlete_resolution")
    .sort((a, b) => a.startMs - b.startMs);
  const gaps: Array<{ startMs: number; endMs: number; durationMs: number; after: string; before: string }> = [];
  for (let i = 0; i < httpIntervals.length - 1; i++) {
    const a = httpIntervals[i]!;
    const b = httpIntervals[i + 1]!;
    if (b.startMs - a.endMs >= 100) {
      gaps.push({
        startMs: a.endMs,
        endMs: b.startMs,
        durationMs: b.startMs - a.endMs,
        after: a.stage,
        before: b.stage,
      });
    }
  }
  // Trailing CPU after last HTTP
  const lastHttp = httpIntervals[httpIntervals.length - 1];
  if (lastHttp && totalWallMs - lastHttp.endMs >= 100) {
    gaps.push({
      startMs: lastHttp.endMs,
      endMs: totalWallMs,
      durationMs: totalWallMs - lastHttp.endMs,
      after: lastHttp.stage,
      before: "final_return",
    });
  }

  return {
    label: opts.label,
    ask: opts.ask,
    totalWallMs,
    httpCalls,
    athleteMs,
    injuryMs,
    propSimElapsedMs,
    propSimWallMs,
    stamped,
    ctxHits,
    ctxMisses,
    distHits,
    distMisses,
    finalLegs: picks.length,
    propLike: picks.filter((p) => p.isProp).length,
    gameLike: picks.filter((p) => !p.isProp).length,
    qualified: result.scan?.manifest?.totalQualified ?? result.scan?.totalQualified ?? null,
    note: (result.note || "").slice(0, 400),
    timedOut: result.timedOut,
    failureReason: result.scan?.failureReason ?? null,
    failureDiagnostics: result.scan?.failureDiagnostics ?? null,
    staging: result.scan?.staging ?? null,
    propPoolSize: result.propPoolSize,
    clientCache: coachCacheSnapshot(),
    httpByStage,
    statusLog,
    partialLog,
    intervals: opts.waterfall
      ? intervals.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
      : intervals.filter((i) => !i.stage.startsWith("http:")).sort((a, b) => a.startMs - b.startMs),
    criticalPath: chain,
    criticalPathWallMs: chain.length ? chain[chain.length - 1]!.endMs - chain[0]!.startMs : 0,
    cpuGaps: gaps.sort((a, b) => b.durationMs - a.durationMs).slice(0, 12),
    ticket: picks.map((p) => ({
      pick: p.pick,
      market: p.market,
      isProp: !!p.isProp,
      sport: p.sport,
      odds: p.odds,
      grade: p.finalAiScore?.grade ?? null,
      simHit: p.finalAiScore?.simHit ?? null,
    })),
  };
}

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

async function main() {
  console.error("API_BASE", API_BASE);
  console.error("Critical-path audit — Phase 2.2 follow-up (report only)");

  // --- Warm path: cold then immediate repeat with full waterfall ---
  console.error("\n=== priming cold 5 (for warm) ===");
  const prime = await runOnce({
    label: "prime_cold_5",
    ask: "5 leg",
    priors: [],
    clearClient: true,
    clearPropSim: true,
    waterfall: false,
  });
  console.error(`[prime] wall=${prime.totalWallMs} final=${prime.finalLegs}`);

  await new Promise((r) => setTimeout(r, 600));
  console.error("\n=== warm repeat 5 (full waterfall) ===");
  const warm = await runOnce({
    label: "warm_repeat_5",
    ask: "5 leg",
    priors: [],
    clearClient: false,
    clearPropSim: false,
    waterfall: true,
  });
  console.error(
    `[warm] wall=${warm.totalWallMs} athlete=${warm.athleteMs} propSim=${warm.propSimElapsedMs} final=${warm.finalLegs} gaps=${warm.cpuGaps[0]?.durationMs}`,
  );

  // Microbench: attachPickScores cost at observed propPoolSize (candidate normalization).
  const poolN = Math.max(100, Number(warm.propPoolSize || 0));
  const fakePicks = Array.from({ length: Math.min(poolN, 4000) }, (_, i) => ({
    pick: `Player ${i} Over 0.5`,
    market: "Hits",
    isProp: true,
    player: `Player ${i}`,
    propLine: 0.5,
    propSide: "Over",
    propMarketKey: "batter_hits",
    sport: "mlb",
    game: "Away @ Home",
    odds: -110,
  })) as ParsedPick[];
  const tPrescore0 = performance.now();
  try {
    attachPickScores(fakePicks, { realOdds: [], propPool: [] });
  } catch {
    /* best-effort microbench */
  }
  const prescoreMicrobenchMs = Math.round(performance.now() - tPrescore0);
  console.error(`[prescore microbench] n=${fakePicks.length} ms=${prescoreMicrobenchMs}`);

  // --- Fresh 5 × 5 variance ---
  console.error("\n=== fresh 5 × 5 ===");
  const freshWalls: number[] = [];
  const freshRuns = [];
  for (let i = 1; i <= 5; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const run = await runOnce({
      label: `fresh_5_${i}`,
      ask: "5 leg",
      priors: [],
      clearClient: true,
      clearPropSim: true,
      waterfall: false,
    });
    freshWalls.push(run.totalWallMs);
    freshRuns.push({
      i,
      wallMs: run.totalWallMs,
      httpCalls: run.httpCalls,
      athleteMs: run.athleteMs,
      propSimElapsedMs: run.propSimElapsedMs,
      final: run.finalLegs,
      propPoolSize: run.propPoolSize,
      httpByStage: run.httpByStage,
    });
    console.error(`[fresh ${i}/5] wall=${run.totalWallMs} http=${run.httpCalls} athlete=${run.athleteMs} final=${run.finalLegs}`);
  }
  const sortedFresh = [...freshWalls].sort((a, b) => a - b);
  const freshStats = {
    n: sortedFresh.length,
    min: sortedFresh[0],
    max: sortedFresh[sortedFresh.length - 1],
    median: pct(sortedFresh, 50),
    p95: pct(sortedFresh, 95),
    mean: Math.round(sortedFresh.reduce((s, x) => s + x, 0) / sortedFresh.length),
    priorSample29800: 29800,
    priorSample36300: 36300,
    note:
      sortedFresh[sortedFresh.length - 1]! - sortedFresh[0]! > 5000
        ? "Wide spread → provider/network variance dominates; Phase 2.2 athlete path (~ms) cannot explain 29.8→36.3 single-sample delta"
        : "Tight spread → check systematic regression",
  };

  // --- NFL 7 ---
  console.error("\n=== NFL 7 ===");
  await new Promise((r) => setTimeout(r, 600));
  const nfl7 = await runOnce({
    label: "nfl_7",
    ask: "7 leg NFL",
    priors: [],
    clearClient: true,
    clearPropSim: true,
    waterfall: false,
  });
  console.error(
    `[nfl7] wall=${nfl7.totalWallMs} final=${nfl7.finalLegs}/7 note=${(nfl7.note || "").slice(0, 120)}`,
  );

  // Waterfall table (merged overlapping stages — show intervals, not sums)
  const stageRollup: Record<
    string,
    { startMs: number; endMs: number; durationMs: number; count: number }
  > = {};
  for (const iv of warm.intervals) {
    const key = iv.stage.startsWith("http:") ? iv.stage : iv.stage;
    const cur = stageRollup[key];
    if (!cur) {
      stageRollup[key] = {
        startMs: iv.startMs,
        endMs: iv.endMs,
        durationMs: iv.durationMs,
        count: 1,
      };
    } else {
      cur.startMs = Math.min(cur.startMs, iv.startMs);
      cur.endMs = Math.max(cur.endMs, iv.endMs);
      cur.durationMs = cur.endMs - cur.startMs; // span, not sum
      cur.count += 1;
    }
  }
  const waterfallTable = Object.entries(stageRollup)
    .map(([stage, v]) => ({
      stage,
      startMs: v.startMs,
      endMs: v.endMs,
      durationMs: v.durationMs,
      events: v.count,
      awaitedBy: warm.intervals.find((i) => i.stage === stage)?.awaitedBy ?? "",
      blocksFinal: warm.intervals.find((i) => i.stage === stage)?.blocksFinal ?? true,
    }))
    .sort((a, b) => a.startMs - b.startMs || b.durationMs - a.durationMs);

  const report = {
    generatedAt: new Date().toISOString(),
    phase: "2.2-critical-path",
    note: "Report only — no merge/deploy. Intervals are start/end spans (overlapping); do not sum durations.",
    apiBase: API_BASE,
    warmRepeat5: {
      wallMs: warm.totalWallMs,
      athleteMs: warm.athleteMs,
      propSimElapsedMs: warm.propSimElapsedMs,
      propSimWallMs: warm.propSimWallMs,
      residualMs: warm.totalWallMs - warm.athleteMs - warm.propSimElapsedMs,
      stamped: warm.stamped,
      ctx: `${warm.ctxHits}/${warm.ctxMisses}`,
      dist: `${warm.distHits}/${warm.distMisses}`,
      finalLegs: warm.finalLegs,
      propPoolSize: warm.propPoolSize,
      httpByStage: warm.httpByStage,
      statusLog: warm.statusLog,
      partialLog: warm.partialLog,
      cpuGaps: warm.cpuGaps,
      prescoreMicrobench: { n: fakePicks.length, ms: prescoreMicrobenchMs },
      criticalPath: warm.criticalPath.map((c) => ({
        stage: c.stage,
        startMs: c.startMs,
        endMs: c.endMs,
        durationMs: c.durationMs,
      })),
      waterfallTable,
      clientCache: warm.clientCache,
      failureDiagnostics: warm.failureDiagnostics,
      note: warm.note,
    },
    fresh5Variance: { stats: freshStats, runs: freshRuns },
    nfl7: {
      wallMs: nfl7.totalWallMs,
      requested: 7,
      returned: nfl7.finalLegs,
      shortfall: nfl7.finalLegs < 7,
      note: nfl7.note,
      failureReason: nfl7.failureReason,
      failureDiagnostics: nfl7.failureDiagnostics,
      staging: nfl7.staging,
      ticket: nfl7.ticket,
      propPoolSize: nfl7.propPoolSize,
      qualified: nfl7.qualified,
    },
    primeCold: { wallMs: prime.totalWallMs, final: prime.finalLegs },
  };

  const out = "/opt/cursor/artifacts/coach-phase22-critical-path.json";
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        warmWallMs: warm.totalWallMs,
        residualMs: report.warmRepeat5.residualMs,
        topGaps: warm.cpuGaps.slice(0, 5),
        freshStats,
        nfl7: { returned: nfl7.finalLegs, shortfall: nfl7.finalLegs < 7, note: nfl7.note?.slice(0, 200) },
        waterfallTop: waterfallTable.slice(0, 25),
      },
      null,
      2,
    ),
  );
  console.error(`wrote ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
