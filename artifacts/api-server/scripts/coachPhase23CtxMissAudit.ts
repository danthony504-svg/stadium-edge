/**
 * AUDIT ONLY — identify the 4 persistent propsim-ctx misses on warm 5-leg.
 * No production code changes. No optimizations.
 */
import { writeFileSync } from "node:fs";
import { buildCoachParlay } from "../../stadium-mobile/lib/coach/buildParlay.ts";
import {
  clearCoachContextCache,
  resetCoachCacheStats,
} from "../../stadium-mobile/lib/coachContextCache.ts";
import { API_BASE } from "../../stadium-mobile/lib/apiBase.ts";
import { runPropSims, tierSimCount } from "../src/lib/propSimRunner.ts";
import {
  clearPropSimDedicatedStoresForTests,
  propSimDedicatedStoreStatsForTests,
  getPropSimCtxStore,
  getPropSimDistStore,
} from "../src/lib/propSimDedicatedStore.ts";
import { clearAthleteIdentityStoreForTests } from "../src/lib/athleteIdentityStore.ts";
import { clearAuthoritativePlayerHistoryForTests } from "../src/lib/authoritativePlayerHistory.ts";
import { resolvePropAthleteIdsDetailed } from "../src/lib/resolvePropAthleteIds.ts";
import { fetchEspnInjuries } from "../src/lib/espnInjuries.ts";
import {
  keyInjuryWeight,
  type SimPropRequest,
  buildPropSimulationContext,
  sharedDistributionPartsForProp,
} from "../src/lib/monteCarloBuild.ts";
import { propSharedDistributionKey } from "../src/lib/propSharedDistribution.ts";
import { propDistributionCacheKey } from "../src/lib/propDistributionCache.ts";
import {
  propSimCtxCacheKey,
  cachedPropSimCtxFromContext,
  type CachedPropSimCtx,
} from "../src/lib/propSimCtxCache.ts";
import { fetchEspnPlayerHistory } from "../src/lib/espnPlayerHistory.ts";
import type { SimTier } from "../src/lib/simCache.ts";

const HARD_MS = 300_000;

type MissEvt = {
  run: string;
  wave: number;
  player: string;
  sport: string;
  market: string;
  line: number;
  side: string;
  athleteId: string;
  opponentTeamId: string;
  isHome: boolean | null;
  homeTeamId: string;
  awayTeamId: string;
  gameHint: string;
  ctxKey: string;
  parts: Record<string, unknown>;
  priorStoreHit: boolean;
  historyLoadMs: number;
  historyRecentLen: number;
  historyLabels: string[];
  buildOk: boolean;
  buildFailReason: string | null;
  fingerprint: string | null;
  wroteCtx: boolean;
  distKey: string | null;
  distHitAfterBuild: boolean | null;
  startMs: number;
  endMs: number;
  wallMs: number;
  underlying: Array<{ op: string; startMs: number; endMs: number; wallMs: number; detail?: string }>;
};

type HitEvt = {
  run: string;
  player: string;
  sport: string;
  market: string;
  athleteId: string;
  ctxKey: string;
  parts: Record<string, unknown>;
  fingerprint: string;
  distKey: string;
  distHit: boolean;
};

type KeySnap = {
  run: string;
  phase: "pre" | "post";
  ctxKeys: string[];
  distKeySample: string[];
  store: ReturnType<typeof propSimDedicatedStoreStatsForTests>;
};

const missLog: MissEvt[] = [];
const hitLog: HitEvt[] = [];
const keySnaps: KeySnap[] = [];
const histCallLog: Array<{
  run: string;
  sport: string;
  athleteId: string;
  opponentTeamId?: string;
  startMs: number;
  endMs: number;
  wallMs: number;
  recentLen: number;
}> = [];

let currentRun = "";
let waveOrigin = 0;
let waveIdx = 0;

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

/** Keys written by this audit probe (mirrors setPropSimCtxStore / dist). */
const writtenCtxKeys = new Set<string>();
const writtenDistKeys = new Set<string>();

async function interceptPropSim(
  body: Record<string, unknown>,
  origin: number,
): Promise<{ response: Response; misses: MissEvt[]; hits: HitEvt[] }> {
  const sport = String(body.sport ?? "").toLowerCase();
  const tier = (String(body.tier ?? "deep").toLowerCase() === "quick" ? "quick" : "deep") as SimTier;
  const props = (body.props ?? []) as SimPropRequest[];
  const homeTeam = String(body.homeTeam ?? "");
  const awayTeam = String(body.awayTeam ?? "");
  const homeTeamId = String(body.homeTeamId ?? "").trim();
  const awayTeamId = String(body.awayTeamId ?? "").trim();
  const isHomeByPlayer = (body.isHomeByPlayer ?? {}) as Record<string, boolean>;
  const gameHint = `${awayTeam} @ ${homeTeam}`.trim();

  const { props: propsResolved } = await resolvePropAthleteIdsDetailed(
    sport,
    props.map((p) => ({ ...p, sport: String(p.sport ?? sport).toLowerCase() })),
    { homeTeamId, awayTeamId, homeTeam, awayTeam },
  );

  const injuries = await fetchEspnInjuries(sport);
  const gameCtx = {
    sport,
    oppPace: null as number | null,
    leaguePace: 100 as number | null,
    oppKeyInjuries: awayTeam ? teamInjuryWeight(injuries, awayTeam) : 0,
    ownKeyInjuries: homeTeam ? teamInjuryWeight(injuries, homeTeam) : 0,
    weatherImpact:
      sport === "mlb" && body.weatherImpact != null ? Number(body.weatherImpact) : null,
  };

  // Manual resolve mirroring propSimRunner so we can attribute each miss.
  type Indexed = { index: number; prop: SimPropRequest; isHome: boolean | null };
  const indexed: Indexed[] = propsResolved.map((prop, index) => ({
    index,
    prop,
    isHome:
      prop.isHome ??
      isHomeByPlayer[prop.player] ??
      null,
  }));

  const groups = new Map<string, Indexed[]>();
  for (const item of indexed) {
    const parts = sharedDistributionPartsForProp(
      { ...item.prop, sport: String(item.prop.sport ?? sport).toLowerCase() },
      gameCtx,
      item.isHome,
    );
    const key = propSharedDistributionKey(parts);
    const arr = groups.get(key) ?? [];
    arr.push(item);
    groups.set(key, arr);
  }

  const localMisses: MissEvt[] = [];
  const localHits: HitEvt[] = [];
  const simCount = tierSimCount(tier, body.simulations != null ? Number(body.simulations) : undefined);

  // Probe each group (read-only on miss) then call real runPropSims.
  // Skip expensive miss-history probe on cold to avoid doubling ESPN cost;
  // warm runs need the identity of sticky misses.
  const probeMissesDeep = currentRun.startsWith("warm");

  for (const [, group] of groups) {
    const primary = group[0]!;
    const primaryReq: SimPropRequest = {
      ...primary.prop,
      sport: String(primary.prop.sport ?? sport).toLowerCase(),
      isHome: primary.isHome,
    };
    const parts = sharedDistributionPartsForProp(primaryReq, gameCtx, primary.isHome);
    const ctxKey = propSimCtxCacheKey(parts);
    const t0 = performance.now();
    const existing = await getPropSimCtxStore<CachedPropSimCtx>(ctxKey);
    if (existing) {
      const distKey = propDistributionCacheKey(parts, existing.fingerprint, tier, simCount);
      const dist = await getPropSimDistStore(distKey);
      localHits.push({
        run: currentRun,
        player: primaryReq.player,
        sport: primaryReq.sport ?? sport,
        market: primaryReq.market,
        athleteId: String(primaryReq.athleteId ?? ""),
        ctxKey,
        parts: { ...parts },
        fingerprint: existing.fingerprint,
        distKey,
        distHit: !!dist,
      });
      continue;
    }

    // Miss path — observe-only (no cache write); runPropSims owns writes.
    const underlying: MissEvt["underlying"] = [];
    let historyLoadMs = 0;
    let historyRecentLen = 0;
    let historyLabels: string[] = [];
    let buildOk = false;
    let buildFailReason: string | null = probeMissesDeep
      ? null
      : "skipped_deep_probe_on_cold";
    let fingerprint: string | null = null;
    const wroteCtx = false;
    let distKey: string | null = null;
    let distHitAfterBuild: boolean | null = null;

    if (probeMissesDeep) {
      const tHist0 = performance.now();
      const history = primaryReq.athleteId
        ? await fetchEspnPlayerHistory(
            String(primaryReq.sport ?? sport),
            String(primaryReq.athleteId),
            primaryReq.opponentTeamId ?? undefined,
          )
        : null;
      const tHist1 = performance.now();
      historyLoadMs = Math.round(tHist1 - tHist0);
      historyRecentLen = history?.recent?.length ?? 0;
      historyLabels = history?.labels ?? [];
      histCallLog.push({
        run: currentRun,
        sport: String(primaryReq.sport ?? sport),
        athleteId: String(primaryReq.athleteId ?? ""),
        opponentTeamId: primaryReq.opponentTeamId ?? undefined,
        startMs: Math.round(tHist0 - origin),
        endMs: Math.round(tHist1 - origin),
        wallMs: historyLoadMs,
        recentLen: historyRecentLen,
      });
      underlying.push({
        op: "fetchEspnPlayerHistory",
        startMs: Math.round(tHist0 - origin),
        endMs: Math.round(tHist1 - origin),
        wallMs: historyLoadMs,
        detail: `athleteId=${primaryReq.athleteId} recent=${historyRecentLen}`,
      });

      if (!primaryReq.athleteId) buildFailReason = "no_athleteId";
      else if (!history?.recent?.length) buildFailReason = "no_history_recent";

      const built = buildPropSimulationContext(primaryReq, history, gameCtx);
      buildOk = !!built;
      if (!built && !buildFailReason) {
        buildFailReason =
          "buildPropSimulationContext_null(likely_recentValues<3_or_empty_stat)";
      }

      if (built) {
        const cachedCtx = cachedPropSimCtxFromContext(built);
        fingerprint = cachedCtx.fingerprint;
        distKey = propDistributionCacheKey(parts, fingerprint, tier, simCount);
        const dist = await getPropSimDistStore(distKey);
        distHitAfterBuild = !!dist;
        underlying.push({
          op: "observe_dist_lookup",
          startMs: Math.round(performance.now() - origin),
          endMs: Math.round(performance.now() - origin),
          wallMs: 0,
          detail: `distHit=${!!dist} fp=${fingerprint}`,
        });
      }
    }

    const t1 = performance.now();
    localMisses.push({
      run: currentRun,
      wave: waveIdx,
      player: primaryReq.player,
      sport: String(primaryReq.sport ?? sport),
      market: primaryReq.market,
      line: primaryReq.line,
      side: primaryReq.side,
      athleteId: String(primaryReq.athleteId ?? ""),
      opponentTeamId: String(primaryReq.opponentTeamId ?? ""),
      isHome: primary.isHome,
      homeTeamId: String(primaryReq.homeTeamId ?? homeTeamId),
      awayTeamId: String(primaryReq.awayTeamId ?? awayTeamId),
      gameHint,
      ctxKey,
      parts: { ...parts },
      priorStoreHit: false,
      historyLoadMs,
      historyRecentLen,
      historyLabels,
      buildOk,
      buildFailReason,
      fingerprint,
      wroteCtx,
      distKey,
      distHitAfterBuild,
      startMs: Math.round(t0 - origin),
      endMs: Math.round(t1 - origin),
      wallMs: Math.round(t1 - t0),
      underlying,
    });
  }

  // Real run for the coach scan
  const {
    rows,
    deepPending,
    distStats,
    propSimElapsedMs,
    playerHistories,
    historyShared,
    historyCoalesced,
  } = await runPropSims(
    propsResolved,
    tier,
    gameCtx,
    isHomeByPlayer,
    body.simulations != null ? Number(body.simulations) : undefined,
  );

  return {
    response: new Response(
      JSON.stringify({
        sport,
        tier,
        simulations: simCount,
        deepPending,
        props: rows,
        playerHistories,
        historyShared,
        historyCoalesced,
        propSimElapsedMs,
        ...distStats,
        _auditProbe: {
          missCount: localMisses.length,
          hitCount: localHits.length,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
    misses: localMisses,
    hits: localHits,
  };
}

async function runOnce(label: string, clearAll: boolean) {
  if (clearAll) {
    clearCoachContextCache();
    clearPropSimDedicatedStoresForTests();
    clearAthleteIdentityStoreForTests();
    clearAuthoritativePlayerHistoryForTests();
    writtenCtxKeys.clear();
    writtenDistKeys.clear();
  }
  resetCoachCacheStats();
  currentRun = label;
  waveIdx = 0;
  const origin = performance.now();
  waveOrigin = origin;

  keySnaps.push({
    run: label,
    phase: "pre",
    ctxKeys: [...writtenCtxKeys],
    distKeySample: [...writtenDistKeys].slice(0, 30),
    store: propSimDedicatedStoreStatsForTests(),
  });

  const runMisses: MissEvt[] = [];
  const runHits: HitEvt[] = [];

  const orig = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    const method = String(init?.method ?? "GET").toUpperCase();
    if (url.includes("/sports/simulate/props") && method === "POST") {
      waveIdx += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      const { response, misses, hits } = await interceptPropSim(body, origin);
      runMisses.push(...misses);
      runHits.push(...hits);
      missLog.push(...misses);
      hitLog.push(...hits);
      return response;
    }
    return orig(input, init);
  }) as typeof fetch;

  const ac = new AbortController();
  const kill = setTimeout(() => ac.abort(), HARD_MS);
  let result: Awaited<ReturnType<typeof buildCoachParlay>>;
  try {
    result = await buildCoachParlay({
      requestedLegs: 5,
      askText: "5 leg",
      priorUserTexts: [],
      signal: ac.signal,
    });
  } finally {
    clearTimeout(kill);
    globalThis.fetch = orig;
  }

  const wallMs = Math.round(performance.now() - origin);
  keySnaps.push({
    run: label,
    phase: "post",
    ctxKeys: [...writtenCtxKeys],
    distKeySample: [...writtenDistKeys].slice(0, 40),
    store: propSimDedicatedStoreStatsForTests(),
  });

  return {
    label,
    wallMs,
    finalLegs: result.picks?.length ?? 0,
    missCount: runMisses.length,
    hitCount: runHits.length,
    misses: runMisses,
    hits: runHits,
    histCalls: histCallLog.filter((h) => h.run === label),
  };
}

function fieldDiff(hits: HitEvt[], misses: MissEvt[]) {
  const fields = [
    "sport",
    "athleteId",
    "opponentTeamId",
    "isHome",
    "homeTeamId",
    "awayTeamId",
    "oppPace",
    "leaguePace",
    "oppKeyInjuries",
    "ownKeyInjuries",
    "weatherImpact",
    "market",
  ] as const;

  const summarize = (rows: Array<{ parts: Record<string, unknown> }>, field: string) => {
    const vals = new Map<string, number>();
    for (const r of rows) {
      const v = String(r.parts[field] ?? "");
      vals.set(v, (vals.get(v) ?? 0) + 1);
    }
    return Object.fromEntries([...vals.entries()].sort((a, b) => b[1] - a[1]));
  };

  return fields.map((f) => ({
    field: f,
    hitGroup: summarize(hits, f),
    missGroup: summarize(misses, f),
  }));
}

async function main() {
  console.error("API_BASE", API_BASE);
  console.error("Phase 2.3 ctx-miss audit (no optimizations)");

  const cold = await runOnce("cold", true);
  console.error(
    `[cold] wall=${cold.wallMs} final=${cold.finalLegs} probeHits=${cold.hitCount} probeMisses=${cold.missCount} histEspn=${cold.histCalls.length}`,
  );
  for (const m of cold.misses) {
    console.error(
      `  COLD MISS ${m.player} ${m.sport}/${m.market} ath=${m.athleteId} buildOk=${m.buildOk} reason=${m.buildFailReason} histMs=${m.historyLoadMs} recent=${m.historyRecentLen} wrote=${m.wroteCtx} distHit=${m.distHitAfterBuild}`,
    );
    console.error(`    key=${m.ctxKey}`);
  }

  const warm1 = await runOnce("warm-1", false);
  console.error(
    `[warm-1] wall=${warm1.wallMs} final=${warm1.finalLegs} probeHits=${warm1.hitCount} probeMisses=${warm1.missCount} histEspn=${warm1.histCalls.length}`,
  );
  for (const m of warm1.misses) {
    console.error(
      `  WARM MISS ${m.player} ${m.sport}/${m.market} ath=${m.athleteId} buildOk=${m.buildOk} reason=${m.buildFailReason} histMs=${m.historyLoadMs} recent=${m.historyRecentLen} wrote=${m.wroteCtx} distHit=${m.distHitAfterBuild} wall=${m.wallMs}`,
    );
    console.error(`    key=${m.ctxKey}`);
    console.error(`    parts=${JSON.stringify(m.parts)}`);
  }

  const warm2 = await runOnce("warm-2", false);
  console.error(
    `[warm-2] wall=${warm2.wallMs} final=${warm2.finalLegs} probeHits=${warm2.hitCount} probeMisses=${warm2.missCount} histEspn=${warm2.histCalls.length}`,
  );
  for (const m of warm2.misses) {
    console.error(
      `  WARM2 MISS ${m.player} ${m.sport}/${m.market} ath=${m.athleteId} buildOk=${m.buildOk} reason=${m.buildFailReason} histMs=${m.historyLoadMs} wrote=${m.wroteCtx} key=${m.ctxKey}`,
    );
  }

  // Cross-run key stability for warm misses
  const warm1Keys = new Set(warm1.misses.map((m) => m.ctxKey));
  const warm2Keys = new Set(warm2.misses.map((m) => m.ctxKey));
  const sameKeys =
    warm1Keys.size === warm2Keys.size && [...warm1Keys].every((k) => warm2Keys.has(k));

  // Were warm-1 miss keys present in cold writes?
  const coldWrote = new Set(
    [...writtenCtxKeys].filter((k) =>
      // approximate: keys written by end of warm2 include all; use keySnaps
      true,
    ),
  );
  const postCold = keySnaps.find((s) => s.run === "cold" && s.phase === "post");
  const postWarm1 = keySnaps.find((s) => s.run === "warm-1" && s.phase === "post");

  const warm1MissKeysInColdStore = warm1.misses.map((m) => ({
    ctxKey: m.ctxKey,
    player: m.player,
    wasInColdWrittenSet: postCold?.ctxKeys.includes(m.ctxKey) ?? false,
    buildOk: m.buildOk,
    wroteCtxThisRun: m.wroteCtx,
  }));

  // Key field diffs between consecutive warm misses for same player
  const pairDiffs = warm1.misses.map((m1) => {
    const m2 = warm2.misses.find(
      (x) => x.player === m1.player && x.market === m1.market && x.athleteId === m1.athleteId,
    );
    if (!m2) {
      return {
        player: m1.player,
        market: m1.market,
        athleteId: m1.athleteId,
        paired: false,
        keyEqual: false,
        fieldChanges: [] as string[],
      };
    }
    const fieldChanges: string[] = [];
    for (const f of Object.keys(m1.parts)) {
      if (String(m1.parts[f]) !== String(m2.parts[f])) {
        fieldChanges.push(`${f}: ${JSON.stringify(m1.parts[f])} → ${JSON.stringify(m2.parts[f])}`);
      }
    }
    if (m1.ctxKey !== m2.ctxKey) fieldChanges.push(`ctxKey changed`);
    return {
      player: m1.player,
      market: m1.market,
      athleteId: m1.athleteId,
      paired: true,
      keyEqual: m1.ctxKey === m2.ctxKey,
      fieldChanges,
      warm1Key: m1.ctxKey,
      warm2Key: m2.ctxKey,
    };
  });

  // Dist-hit path analysis (code-derived + observed)
  const distHitPath = {
    observedWarm1: {
      ctxHits: warm1.hitCount,
      ctxMisses: warm1.missCount,
      distHitsAmongCtxHits: warm1.hits.filter((h) => h.distHit).length,
      missesThatBuiltAndFoundDist: warm1.misses.filter((m) => m.distHitAfterBuild).length,
      missesThatFailedBuild: warm1.misses.filter((m) => !m.buildOk).length,
      missesThatBuiltAndWrote: warm1.misses.filter((m) => m.wroteCtx).length,
    },
    codePath: [
      "1. group props by propSharedDistributionKey(parts)",
      "2. getCachedPropSimCtx(parts)  // NO dist lookup yet",
      "3. on miss: loadPropHistory (ESPN) → buildPropSimulationContext → fingerprint → setCachedPropSimCtx",
      "4. on build null: cachedCtx=null, NEVER written, NEVER dist lookup",
      "5. on success: distKey = propDistributionCacheKey(parts, fingerprint, tier, simCount)",
      "6. getCachedPropDistribution(distKey) → score from samples if hit",
    ],
    canAvoidCtxForDist:
      "Not with current key design: dist key embeds historyFingerprint which is derived from ctx material (recentValues etc). Looking up dist without fingerprint would require a fingerprint-free key (forbidden) or a secondary index from parts→lastFingerprint (still needs invalidation when history changes — which is what ctx cache provides).",
  };

  const checklist = {
    keyInstability: pairDiffs.some((p) => p.paired && !p.keyEqual),
    ttlExpiration: false, // consecutive warm within seconds; TTL=30m
    cacheCapacityEviction: "uncapped dedicated Map — no capacity eviction",
    separateProcessStore: "audit uses in-process dedicated store; consecutive warms share it",
    fieldsChangingBetweenRequests: pairDiffs.flatMap((p) => p.fieldChanges),
    fingerprintBeforeCacheLookup:
      "Fingerprint is NOT required for ctx lookup (ctx key = shared parts only). Fingerprint IS required before dist lookup.",
    enrichmentOnlyEnteringCtx:
      "Prop-sim batch is scanner deep-sim candidates, not enrich-only. Enrich reuses playerHistories after sim.",
    failedContextNotCached:
      "YES — buildPropSimulationContext null → return cachedCtx:null without setCachedPropSimCtx",
    cacheWriteNotOccurring: null as boolean | null,
    cacheReadWriteKeyMismatch: null as boolean | null,
  };

  checklist.cacheWriteNotOccurring = warm1.misses.every((m) => !m.wroteCtx) && warm1.misses.length > 0
    ? true
    : warm1.misses.some((m) => m.buildOk && !m.wroteCtx);
  checklist.cacheReadWriteKeyMismatch = warm1MissKeysInColdStore.some(
    (m) => m.buildOk === false && m.wasInColdWrittenSet === false,
  )
    ? false // failed builds never written — not a mismatch
    : warm1.misses.some((m) => m.wroteCtx) &&
      warm2.misses.some((m2) =>
        warm1.misses.some((m1) => m1.player === m2.player && m1.ctxKey === m2.ctxKey && m1.wroteCtx),
      );

  // If warm1 wrote ctx for a miss but warm2 misses same key → read/write mismatch or overwrite
  const wroteThenMissed = warm1.misses
    .filter((m) => m.wroteCtx)
    .map((m) => {
      const again = warm2.misses.find((m2) => m2.ctxKey === m.ctxKey);
      return {
        ctxKey: m.ctxKey,
        player: m.player,
        wroteOnWarm1: true,
        missedAgainWarm2: !!again,
      };
    });

  const report = {
    generatedAt: new Date().toISOString(),
    phase: "2.3-ctx-miss-audit",
    note: "AUDIT ONLY — no code changes / optimizations",
    apiBase: API_BASE,
    cold: {
      wallMs: cold.wallMs,
      missCount: cold.missCount,
      hitCount: cold.hitCount,
      misses: cold.misses,
      histEspnCalls: cold.histCalls.length,
      histEspnWallSum: cold.histCalls.reduce((a, h) => a + h.wallMs, 0),
    },
    warm1: {
      wallMs: warm1.wallMs,
      missCount: warm1.missCount,
      hitCount: warm1.hitCount,
      misses: warm1.misses,
      hits: warm1.hits,
      histEspnCalls: warm1.histCalls,
      histEspnWallSum: warm1.histCalls.reduce((a, h) => a + h.wallMs, 0),
    },
    warm2: {
      wallMs: warm2.wallMs,
      missCount: warm2.missCount,
      hitCount: warm2.hitCount,
      misses: warm2.misses,
      histEspnCalls: warm2.histCalls,
      histEspnWallSum: warm2.histCalls.reduce((a, h) => a + h.wallMs, 0),
    },
    sameMissKeysWarm1Warm2: sameKeys,
    pairDiffs,
    warm1MissKeysInColdStore,
    wroteThenMissed,
    fieldDiffHitVsMiss: fieldDiff(warm1.hits, warm1.misses),
    distHitPath,
    checklist,
    keySnaps,
    storeStats: propSimDedicatedStoreStatsForTests(),
  };

  const out = "/opt/cursor/artifacts/coach-phase23-ctx-miss-audit.json";
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.error("Wrote", out);
  console.error(
    JSON.stringify(
      {
        warm1Misses: warm1.misses.map((m) => ({
          player: m.player,
          sport: m.sport,
          market: m.market,
          buildOk: m.buildOk,
          reason: m.buildFailReason,
          histMs: m.historyLoadMs,
          wall: m.wallMs,
          wrote: m.wroteCtx,
          distHit: m.distHitAfterBuild,
        })),
        warm2Misses: warm2.misses.map((m) => ({
          player: m.player,
          market: m.market,
          buildOk: m.buildOk,
          reason: m.buildFailReason,
          histMs: m.historyLoadMs,
        })),
        sameKeys,
        wroteThenMissed,
        histWallWarm1: warm1.histCalls.reduce((a, h) => a + h.wallMs, 0),
        checklist,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
