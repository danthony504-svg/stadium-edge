/**
 * Phase 2.4 Option C validation — FG dist reuse + cooperative yield.
 *
 * Runs regression tickets and warm 5-leg series. Reports:
 *   run | Coach wall | dist CPU | max loop delay | propSim | qualified | final
 *
 * Does NOT change production math beyond Option C already wired.
 * No merge / deploy / OTA / build.
 *
 *   node --import ./scripts/coachE2ERegisterHooks.mjs ./scripts/coachPhase24OptionCValidate.ts
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
  describeFgDistReuseKey,
  fgDistSeriesKey,
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
        samples: sorted.length,
        maxDelayMs: sorted.length ? Math.round(sorted[sorted.length - 1]!) : 0,
        meanDelayMs: sorted.length
          ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length)
          : 0,
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
  distCpuMs: number;
  distHits: number;
  distMisses: number;
  distBypass: number;
  maxLoopDelayMs: number;
  propSimObservedMs: number | null;
  qualified: number | null;
  finalLegs: number;
  note: string;
  ticket: Array<{ game?: string; market?: string; pick?: string; isProp?: boolean }>;
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
      requestedLegs: opts.legs ?? (opts.ask.includes("7") ? 7 : 5),
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

  return {
    label: opts.label,
    coachWallMs: Math.round(performance.now() - t0),
    distCpuMs: Math.round(dist.computeMs),
    distHits: dist.hits,
    distMisses: dist.misses,
    distBypass: dist.bypass,
    maxLoopDelayMs: eventLoop.maxDelayMs,
    propSimObservedMs: propWalls.length ? propWalls[propWalls.length - 1]! : null,
    qualified: result.failureDiagnostics?.scoredBeforeStage ?? null,
    finalLegs: result.picks?.length ?? 0,
    note: (result.note || "").slice(0, 200),
    ticket: (result.picks ?? []).map((p) => ({
      game: p.game,
      market: p.market,
      pick: p.pick ?? p.player,
      isProp: !!p.isProp,
    })),
  };
}

function stats(vals: number[]) {
  const s = [...vals].sort((a, b) => a - b);
  const mean = Math.round(s.reduce((a, b) => a + b, 0) / s.length);
  const median = s[Math.floor(s.length / 2)]!;
  const p95 = s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)]!;
  return { n: s.length, min: s[0]!, median, mean, p95, max: s[s.length - 1]! };
}

function printRow(r: RunRow) {
  console.error(
    `| ${r.label.padEnd(14)} | ${String(r.coachWallMs).padStart(6)} | ${String(r.distCpuMs).padStart(7)} | ${String(r.maxLoopDelayMs).padStart(14)} | ${String(r.propSimObservedMs ?? "-").padStart(7)} | ${String(r.qualified ?? "-").padStart(9)} | ${String(r.finalLegs).padStart(5)} | hits=${r.distHits} miss=${r.distMisses} bypass=${r.distBypass}`,
  );
}

async function main() {
  console.error("API_BASE", API_BASE);
  console.error("Phase 2.4 Option C validation (reuse + yield)");
  console.error(
    "Canonical key form:",
    describeFgDistReuseKey("<outcomesRef|projectionSimRef>", "<seriesKey>"),
  );
  console.error("Example series keys:", [
    fgDistSeriesKey({ kind: "ml", teamSide: "home" }),
    fgDistSeriesKey({ kind: "spread", teamSide: "away" }),
    fgDistSeriesKey({ kind: "total" }),
    fgDistSeriesKey({ kind: "teamTotal", teamSide: "home" }),
    fgDistSeriesKey({ kind: "spread", teamSide: "home", period: "h1" }),
    fgDistSeriesKey({ kind: "raceTo", teamSide: "home" }),
  ]);

  console.error(
    "\n| run            |  wall | distCPU | max loop delay | propSim | qualified | final |",
  );
  console.error(
    "|----------------|-------|---------|----------------|---------|-----------|-------|",
  );

  const fresh5 = await runOnce({
    label: "fresh5",
    ask: "5 leg",
    clearCaches: true,
  });
  printRow(fresh5);

  const repeat5 = await runOnce({
    label: "repeat5",
    ask: "5 leg",
    clearCaches: false,
  });
  printRow(repeat5);

  const soccer = await runOnce({
    label: "soccer→5",
    ask: "5 leg",
    priors: ["soccer"],
    clearCaches: true,
  });
  printRow(soccer);

  const nfl7 = await runOnce({
    label: "nfl7",
    ask: "7 leg NFL",
    legs: 7,
    clearCaches: true,
  });
  printRow(nfl7);

  // Warm prime then 5 consecutive warm 5-leg requests
  await runOnce({ label: "warm-prime", ask: "5 leg", clearCaches: true });
  const warmRuns: RunRow[] = [];
  for (let i = 0; i < 5; i++) {
    const r = await runOnce({
      label: `warm5-${i + 1}`,
      ask: "5 leg",
      clearCaches: false,
    });
    warmRuns.push(r);
    printRow(r);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    phase: "2.4-option-c-validate",
    apiBase: API_BASE,
    canonicalKeyForm: "fgDist|<outcomesRef|projectionSimRef>|<seriesKey>",
    seriesKeyExamples: {
      mlHome: "ml|home",
      spreadAway: "spread|away",
      total: "total",
      teamTotalHome: "teamTotal|home",
      periodBypass: null,
      raceBypass: null,
    },
    materialDims:
      "outcomes object identity (WeakMap) + kind + teamSide (FG only); period must be fg",
    excludedDims: "line thresholds, totalSide, sportsbook/price, cover query id",
    table: {
      fresh5,
      repeat5,
      soccerTo5: soccer,
      nfl7,
      warm5: warmRuns,
    },
    warm5Agg: {
      coachWall: stats(warmRuns.map((r) => r.coachWallMs)),
      distCpu: stats(warmRuns.map((r) => r.distCpuMs)),
      maxLoopDelay: stats(warmRuns.map((r) => r.maxLoopDelayMs)),
      propSim: stats(warmRuns.map((r) => r.propSimObservedMs ?? 0)),
      qualified: warmRuns.map((r) => r.qualified),
      final: warmRuns.map((r) => r.finalLegs),
    },
    nfl7Note:
      "NFL 7→6 shortfall kept separate — do not lower thresholds or add filler.",
    ancestry: { pr609: true, pr612: true, pr341: true, pr342: true },
  };

  const outJson = "/opt/cursor/artifacts/coach-phase24-option-c-validate.json";
  const outMd = "/opt/cursor/artifacts/coach-phase24-option-c-validate.md";
  writeFileSync(outJson, JSON.stringify(report, null, 2));

  const md = `# Phase 2.4 Option C validation

Canonical key: \`${report.canonicalKeyForm}\`

Material: ${report.materialDims}

Excluded: ${report.excludedDims}

## Regression

| run | Coach wall | dist CPU | max loop delay | propSim | qualified | final |
|-----|------------|----------|----------------|---------|-----------|-------|
| fresh5 | ${fresh5.coachWallMs} | ${fresh5.distCpuMs} | ${fresh5.maxLoopDelayMs} | ${fresh5.propSimObservedMs ?? "-"} | ${fresh5.qualified ?? "-"} | ${fresh5.finalLegs} |
| repeat5 | ${repeat5.coachWallMs} | ${repeat5.distCpuMs} | ${repeat5.maxLoopDelayMs} | ${repeat5.propSimObservedMs ?? "-"} | ${repeat5.qualified ?? "-"} | ${repeat5.finalLegs} |
| soccer→5 | ${soccer.coachWallMs} | ${soccer.distCpuMs} | ${soccer.maxLoopDelayMs} | ${soccer.propSimObservedMs ?? "-"} | ${soccer.qualified ?? "-"} | ${soccer.finalLegs} |
| nfl7 | ${nfl7.coachWallMs} | ${nfl7.distCpuMs} | ${nfl7.maxLoopDelayMs} | ${nfl7.propSimObservedMs ?? "-"} | ${nfl7.qualified ?? "-"} | ${nfl7.finalLegs} |

## 5× warm 5-leg

| run | Coach wall | dist CPU | max loop delay | propSim | qualified | final |
|-----|------------|----------|----------------|---------|-----------|-------|
${warmRuns
  .map(
    (r) =>
      `| ${r.label} | ${r.coachWallMs} | ${r.distCpuMs} | ${r.maxLoopDelayMs} | ${r.propSimObservedMs ?? "-"} | ${r.qualified ?? "-"} | ${r.finalLegs} |`,
  )
  .join("\n")}

### Warm aggregates (min / median / mean / P95 / max)

- Coach wall: ${JSON.stringify(report.warm5Agg.coachWall)}
- dist CPU: ${JSON.stringify(report.warm5Agg.distCpu)}
- max loop delay: ${JSON.stringify(report.warm5Agg.maxLoopDelay)}
- propSim: ${JSON.stringify(report.warm5Agg.propSim)}

NFL 7 note: ${report.nfl7Note}
`;
  writeFileSync(outMd, md);

  console.log(
    JSON.stringify(
      {
        fresh5: {
          wall: fresh5.coachWallMs,
          distCpu: fresh5.distCpuMs,
          maxLoop: fresh5.maxLoopDelayMs,
          propSim: fresh5.propSimObservedMs,
          qualified: fresh5.qualified,
          final: fresh5.finalLegs,
        },
        repeat5: {
          wall: repeat5.coachWallMs,
          distCpu: repeat5.distCpuMs,
          maxLoop: repeat5.maxLoopDelayMs,
          propSim: repeat5.propSimObservedMs,
          qualified: repeat5.qualified,
          final: repeat5.finalLegs,
        },
        soccer: {
          wall: soccer.coachWallMs,
          final: soccer.finalLegs,
        },
        nfl7: {
          wall: nfl7.coachWallMs,
          final: nfl7.finalLegs,
          qualified: nfl7.qualified,
        },
        warm5Agg: report.warm5Agg,
      },
      null,
      2,
    ),
  );
  console.error(`wrote ${outJson}`);
  console.error(`wrote ${outMd}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
