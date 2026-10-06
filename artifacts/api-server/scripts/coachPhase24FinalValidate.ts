/**
 * Phase 2.1–2.4 final validation — warm 5× metrics + NFL7 funnel diagnosis.
 * No further perf changes. No merge/deploy/OTA/build.
 *
 *   node --import ./scripts/coachE2ERegisterHooks.mjs ./scripts/coachPhase24FinalValidate.ts
 */
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { buildCoachParlay } from "../../stadium-mobile/lib/coach/buildParlay.ts";
import {
  clearCoachContextCache,
  resetCoachCacheStats,
} from "../../stadium-mobile/lib/coachContextCache.ts";
import {
  getGameSimDistReuseStats,
  resetGameSimDistReuseStats,
} from "../../stadium-mobile/lib/gameSimDistReuse.ts";
import { clearPropSimDedicatedStoresForTests } from "../src/lib/propSimDedicatedStore.ts";
import { clearAthleteIdentityStoreForTests } from "../src/lib/athleteIdentityStore.ts";
import { clearAuthoritativePlayerHistoryForTests } from "../src/lib/authoritativePlayerHistory.ts";
import { API_BASE } from "../../stadium-mobile/lib/apiBase.ts";

const HARD_MS = 300_000;

function clearAll() {
  clearCoachContextCache();
  clearPropSimDedicatedStoresForTests();
  clearAthleteIdentityStoreForTests();
  clearAuthoritativePlayerHistoryForTests();
  resetCoachCacheStats();
  resetGameSimDistReuseStats();
}

function eventLoopProbe(intervalMs = 5) {
  const delays: number[] = [];
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    delays.push(Math.max(0, now - last - intervalMs));
    last = now;
  }, intervalMs);
  timer.unref?.();
  return {
    stop() {
      clearInterval(timer);
      const sorted = [...delays].sort((a, b) => a - b);
      return {
        maxDelayMs: sorted.length ? Math.round(sorted[sorted.length - 1]!) : 0,
        p95DelayMs: sorted.length
          ? Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]!)
          : 0,
      };
    },
  };
}

type RunRow = {
  label: string;
  coachWallMs: number;
  maxLoopDelayMs: number;
  propSimObservedMs: number | null;
  distCpuMs: number;
  distHits: number;
  distMisses: number;
  qualified: number | null;
  finalLegs: number;
  note: string;
  ticket: Array<{
    game?: string;
    market?: string;
    pick?: string;
    isProp?: boolean;
    sport?: string;
    grade?: string | null;
    simHit?: number | null;
  }>;
  diag: Record<string, unknown> | null;
};

async function runOnce(opts: {
  label: string;
  ask: string;
  priors?: string[];
  legs?: number;
  clearCaches: boolean;
}): Promise<RunRow> {
  if (opts.clearCaches) clearAll();
  else resetGameSimDistReuseStats();

  const propWalls: number[] = [];
  const orig = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    if (
      String(url).includes("/sports/simulate/props") &&
      String(init?.method ?? "GET").toUpperCase() === "POST"
    ) {
      const t0 = performance.now();
      const res = await orig(input, init);
      propWalls.push(Math.round(performance.now() - t0));
      return res;
    }
    return orig(input, init);
  }) as typeof fetch;

  const loop = eventLoopProbe(5);
  const t0 = performance.now();
  const ac = new AbortController();
  const kill = setTimeout(() => ac.abort(), HARD_MS);
  let result: Awaited<ReturnType<typeof buildCoachParlay>>;
  try {
    result = await buildCoachParlay({
      requestedLegs: opts.legs ?? (/\b7\b/.test(opts.ask) ? 7 : 5),
      askText: opts.ask,
      priorUserTexts: opts.priors ?? [],
      signal: ac.signal,
    });
  } finally {
    clearTimeout(kill);
    globalThis.fetch = orig;
  }
  const eventLoop = loop.stop();
  const dist = getGameSimDistReuseStats();
  const diag =
    (result.scan?.failureDiagnostics as Record<string, unknown> | undefined) ??
    (result.failureDiagnostics as Record<string, unknown> | null) ??
    null;

  return {
    label: opts.label,
    coachWallMs: Math.round(performance.now() - t0),
    maxLoopDelayMs: eventLoop.maxDelayMs,
    propSimObservedMs: propWalls.length ? propWalls[propWalls.length - 1]! : null,
    distCpuMs: Math.round(dist.computeMs),
    distHits: dist.hits,
    distMisses: dist.misses,
    qualified:
      (diag?.scoredBeforeStage as number | undefined) ??
      result.failureDiagnostics?.scoredBeforeStage ??
      null,
    finalLegs: result.picks?.length ?? 0,
    note: (result.note || "").slice(0, 400),
    ticket: (result.picks ?? []).map((p) => ({
      game: p.game,
      market: p.market,
      pick: p.pick ?? p.player,
      isProp: !!p.isProp,
      sport: p.sport,
      grade: p.finalAiScore?.grade ?? p.scores?.grade ?? null,
      simHit: p.finalAiScore?.simHit ?? null,
    })),
    diag,
  };
}

function stats(vals: number[]) {
  const s = [...vals].sort((a, b) => a - b);
  const mean = Math.round(s.reduce((a, b) => a + b, 0) / s.length);
  const median = s[Math.floor(s.length / 2)]!;
  const p95 = s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)]!;
  return { n: s.length, min: s[0]!, median, mean, p95, max: s[s.length - 1]! };
}

function printWarm(r: RunRow) {
  console.error(
    `| ${r.label.padEnd(10)} | ${String(r.coachWallMs).padStart(6)} | ${String(r.maxLoopDelayMs).padStart(14)} | ${String(r.propSimObservedMs ?? "-").padStart(7)} | ${String(r.distCpuMs).padStart(8)} | ${String(r.qualified ?? "-").padStart(9)} | ${String(r.finalLegs).padStart(5)} |`,
  );
}

async function main() {
  console.error("API_BASE", API_BASE);
  console.error("Phase 2.4 final validation — warm 5× + NFL7 funnel");

  // Warm prime then 5 consecutive warm 5-leg
  await runOnce({ label: "warm-prime", ask: "5 leg", clearCaches: true });
  console.error(
    "\n| run        |  wall | max loop delay | propSim | dist CPU | qualified | final |",
  );
  console.error(
    "|------------|-------|----------------|---------|----------|-----------|-------|",
  );
  const warmRuns: RunRow[] = [];
  for (let i = 0; i < 5; i++) {
    const r = await runOnce({
      label: `warm5-${i + 1}`,
      ask: "5 leg",
      clearCaches: false,
    });
    warmRuns.push(r);
    printWarm(r);
  }

  const nfl7 = await runOnce({
    label: "nfl7",
    ask: "7 leg NFL",
    legs: 7,
    clearCaches: true,
  });
  console.error(
    `\n[nfl7] wall=${nfl7.coachWallMs} final=${nfl7.finalLegs} qualified=${nfl7.qualified} note=${nfl7.note.slice(0, 120)}`,
  );

  const d = nfl7.diag ?? {};
  const scoredBefore = (d.scoredBeforeStage as number | undefined) ?? nfl7.qualified ?? 0;
  const gameLegs = (d.gameLegsScored as number | undefined) ?? 0;
  const propLegs = (d.propLegsScored as number | undefined) ?? 0;
  const propSimEval = (d.propSimEvaluated as number | undefined) ?? 0;
  const propPool = (d.propPoolSize as number | undefined) ?? null;
  const gameEntries = (d.gameEntryCount as number | undefined) ?? null;
  const oddsGames = (d.oddsGameCount as number | undefined) ?? null;
  const gameSims = (d.gameSimsLoaded as number | undefined) ?? null;

  const byGame = new Map<string, typeof nfl7.ticket>();
  for (const t of nfl7.ticket) {
    const g = t.game || "?";
    const arr = byGame.get(g) ?? [];
    arr.push(t);
    byGame.set(g, arr);
  }

  const disappearance =
    scoredBefore >= 7 && nfl7.finalLegs === 6
      ? "staging_correlation_diversity_or_per_game_cap"
      : scoredBefore < 7 && gameLegs + propLegs >= 7
        ? "qualification_threshold"
        : scoredBefore < 7
          ? "insufficient_qualified_after_sim_grade"
          : "unknown";

  const seventhQualifiedExisted =
    disappearance === "staging_correlation_diversity_or_per_game_cap"
      ? true
      : scoredBefore >= 7
        ? true
        : false;

  const funnel = {
    requested: 7,
    available: {
      propPoolSize: propPool,
      oddsGameCount: oddsGames,
      gameEntryCount: gameEntries,
    },
    simulated: {
      gameSimsLoaded: gameSims,
      gameLegsScored: gameLegs,
      propSimEvaluated: propSimEval,
      propLegsScored: propLegs,
    },
    qualified: {
      scoredBeforeStage: scoredBefore,
    },
    correlationDiversityStaging: {
      disappearance,
      requirePropMix: d.requirePropMix ?? null,
      note: nfl7.note,
    },
    staged: nfl7.finalLegs,
    final: nfl7.ticket,
    sameGameStacks: [...byGame.entries()].map(([game, legs]) => ({
      game,
      count: legs.length,
      legs: legs.map((l) => `${l.market}: ${l.pick}`),
    })),
    seventhLegitimateQualifiedCandidateExisted: seventhQualifiedExisted,
    analysis:
      disappearance === "staging_correlation_diversity_or_per_game_cap"
        ? "Board produced enough qualified candidates (scoredBeforeStage ≥ 7) but staging could only place 6 without violating per-game / correlation / prop-mix / diversity caps. A legitimate 7th qualified candidate existed in the pool but was excluded by staging policy — not by empty board or lowered thresholds."
        : disappearance === "insufficient_qualified_after_sim_grade"
          ? "Fewer than 7 legs cleared sim/grade qualification. Shortfall is upstream of staging — do not lower thresholds or add filler."
          : disappearance === "qualification_threshold"
            ? "Enough legs were scored but fewer than 7 cleared qualification gates before staging."
            : "Could not classify disappearance point from diagnostics.",
  };

  const report = {
    generatedAt: new Date().toISOString(),
    phase: "2.4-final-validate",
    apiBase: API_BASE,
    warm5: warmRuns.map((r) => ({
      run: r.label,
      coachWallMs: r.coachWallMs,
      maxLoopDelayMs: r.maxLoopDelayMs,
      propSim: r.propSimObservedMs,
      distCpuMs: r.distCpuMs,
      qualified: r.qualified,
      final: r.finalLegs,
    })),
    warm5Agg: {
      coachWall: stats(warmRuns.map((r) => r.coachWallMs)),
      maxLoopDelay: stats(warmRuns.map((r) => r.maxLoopDelayMs)),
      propSim: stats(warmRuns.map((r) => r.propSimObservedMs ?? 0)),
      distCpu: stats(warmRuns.map((r) => r.distCpuMs)),
      qualified: warmRuns.map((r) => r.qualified),
      final: warmRuns.map((r) => r.finalLegs),
    },
    nfl7Funnel: funnel,
    noThresholdChange: true,
    noFiller: true,
    noFurtherPerfOpt: true,
  };

  const outJson = "/opt/cursor/artifacts/coach-phase24-final-validate.json";
  const outMd = "/opt/cursor/artifacts/coach-phase24-final-validate.md";
  writeFileSync(outJson, JSON.stringify(report, null, 2));

  const md = `# Phase 2.4 final validation

## 5× warm 5-leg

| run | Coach wall | max loop delay | propSim | dist CPU | qualified | final |
|-----|------------|----------------|---------|----------|-----------|-------|
${warmRuns
  .map(
    (r) =>
      `| ${r.label} | ${r.coachWallMs} | ${r.maxLoopDelayMs} | ${r.propSimObservedMs ?? "-"} | ${r.distCpuMs} | ${r.qualified ?? "-"} | ${r.finalLegs} |`,
  )
  .join("\n")}

### Aggregates (min / median / mean / P95 / max)

- Coach wall: ${JSON.stringify(report.warm5Agg.coachWall)}
- max loop delay: ${JSON.stringify(report.warm5Agg.maxLoopDelay)}
- propSim: ${JSON.stringify(report.warm5Agg.propSim)}
- dist CPU: ${JSON.stringify(report.warm5Agg.distCpu)}

## NFL 7→6 funnel

\`\`\`
requested=${funnel.requested}
available=${JSON.stringify(funnel.available)}
simulated=${JSON.stringify(funnel.simulated)}
qualified=${JSON.stringify(funnel.qualified)}
correlation/diversity=${funnel.correlationDiversityStaging.disappearance}
staged/final=${funnel.staged}
seventhQualifiedExisted=${funnel.seventhLegitimateQualifiedCandidateExisted}
\`\`\`

${funnel.analysis}
`;
  writeFileSync(outMd, md);
  writeFileSync(
    "/workspace/artifacts/api-server/scripts/coach-phase24-final-validate.json",
    JSON.stringify(report, null, 2),
  );
  writeFileSync("/workspace/artifacts/api-server/scripts/coach-phase24-final-validate.md", md);

  console.log(JSON.stringify({ warm5Agg: report.warm5Agg, nfl7Funnel: funnel }, null, 2));
  console.error(`wrote ${outJson}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
