/**
 * Multi-ask Phase 2 benchmark: cold 5 leg, warm 5 leg, soccer→5 leg, 7 leg NFL.
 * Report-only runner.
 */
import { buildCoachParlay } from "../../stadium-mobile/lib/coach/buildParlay.ts";
import {
  clearCoachContextCache,
  coachCacheSnapshot,
  resetCoachCacheStats,
} from "../../stadium-mobile/lib/coachContextCache.ts";
import { API_BASE } from "../../stadium-mobile/lib/apiBase.ts";

const HARD_MS = 300_000;

async function runAsk(label: string, ask: string, priors: string[], clearCache: boolean) {
  if (clearCache) clearCoachContextCache();
  resetCoachCacheStats();
  const t0 = performance.now();
  const ac = new AbortController();
  const kill = setTimeout(() => ac.abort(), HARD_MS);
  let httpCalls = 0;
  const orig = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    httpCalls += 1;
    return orig(input, init);
  }) as typeof fetch;
  try {
    const result = await buildCoachParlay({
      requestedLegs: Number(ask.match(/(\d+)/)?.[1] ?? 5),
      askText: ask,
      priorUserTexts: priors,
      signal: ac.signal,
    });
    return {
      label,
      ask,
      priors,
      totalRuntimeMs: Math.round(performance.now() - t0),
      terminal: true,
      timedOut: result.timedOut,
      posted: result.propPoolSize,
      finalLegs: result.picks.length,
      propLike: result.picks.filter((p) => p.isProp).length,
      gameLike: result.picks.filter((p) => !p.isProp).length,
      markets: [...new Set(result.picks.map((p) => p.market))],
      httpCalls,
      coachCache: coachCacheSnapshot(),
      note: (result.note || "").slice(0, 160),
    };
  } finally {
    clearTimeout(kill);
    globalThis.fetch = orig;
  }
}

async function main() {
  console.error("API_BASE", API_BASE);
  const cold5 = await runAsk("cold_5leg", "5 leg", [], true);
  console.error(`[cold_5leg] ${cold5.totalRuntimeMs}ms calls=${cold5.httpCalls} legs=${cold5.finalLegs}`);
  await new Promise((r) => setTimeout(r, 1000));
  const warm5 = await runAsk("warm_5leg", "5 leg", [], false);
  console.error(`[warm_5leg] ${warm5.totalRuntimeMs}ms calls=${warm5.httpCalls} legs=${warm5.finalLegs}`);
  await new Promise((r) => setTimeout(r, 1000));
  clearCoachContextCache();
  const soccer = await runAsk("soccer_4leg", "4 leg soccer", [], false);
  console.error(`[soccer] ${soccer.totalRuntimeMs}ms`);
  await new Promise((r) => setTimeout(r, 800));
  const afterSoccer = await runAsk("after_soccer_5leg", "5 leg", ["4 leg soccer"], false);
  console.error(`[after_soccer_5leg] ${afterSoccer.totalRuntimeMs}ms calls=${afterSoccer.httpCalls}`);
  await new Promise((r) => setTimeout(r, 1000));
  clearCoachContextCache();
  const nfl7 = await runAsk("cold_7leg_nfl", "7 leg NFL", [], true);
  console.error(`[7leg_nfl] ${nfl7.totalRuntimeMs}ms calls=${nfl7.httpCalls}`);

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        apiBase: API_BASE,
        phase2: true,
        runs: [cold5, warm5, soccer, afterSoccer, nfl7],
        summary: {
          cold5Ms: cold5.totalRuntimeMs,
          warm5Ms: warm5.totalRuntimeMs,
          afterSoccer5Ms: afterSoccer.totalRuntimeMs,
          nfl7Ms: nfl7.totalRuntimeMs,
          cold5Calls: cold5.httpCalls,
          warm5Calls: warm5.httpCalls,
          warmCacheHits: warm5.coachCache.stages.reduce((a, s) => a + s.cacheHit, 0),
          warmCoalesced: warm5.coachCache.stages.reduce((a, s) => a + s.coalesced, 0),
        },
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
