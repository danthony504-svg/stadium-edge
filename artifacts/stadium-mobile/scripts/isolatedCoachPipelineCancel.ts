/**
 * Full Coach pipeline + cancellation with tip-SHA isolated sim rewrite.
 * Device asks under test (not a generic 5-leg):
 *   - "8 leg broncos"
 *   - "4 leg NFL spreads and moneylines for upcoming games."
 * Run from artifacts/stadium-mobile:
 *   EXPO_PUBLIC_DOMAIN=stadium-edge.onrender.com \
 *   ISOLATED_SIM_BASE=http://127.0.0.1:8787/api \
 *   REVIEWED_SHA=$(git rev-parse HEAD) \
 *   node --import ./test/register-hooks.mjs ./scripts/isolatedCoachPipelineCancel.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { buildCoachParlay } from "../lib/coach/buildParlay.ts";
import { resolveBuildLegTarget } from "../lib/coach/parseAsk.ts";
import { coachAbsoluteBudgetMs } from "../lib/coach/session.ts";
import { API_BASE } from "../lib/apiBase.ts";
import { isPeriodMainMarket } from "../lib/altLinePool.ts";
import { parseMarketPeriod } from "../lib/simMarketSupport.ts";

const REVIEWED_SHA =
  process.env.REVIEWED_SHA || "576578cd22ac69108e8a7a74177b9de75f708d39";
const LOCAL = (process.env.ISOLATED_SIM_BASE || "http://127.0.0.1:8787/api").replace(
  /\/$/,
  "",
);
const HARD_MS = Number(process.env.HARD_TIMEOUT_MS || 180_000);
const CANCEL_AFTER_MS = Number(process.env.CANCEL_AFTER_MS || 2500);

const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : String((input as Request).url ?? input);
  const m = url.match(/^(https?:\/\/[^/]+)\/api(\/sports\/simulate\b[^?#]*)(\?.*)?$/i);
  if (m) {
    const target = `${LOCAL}${m[2]}${m[3] || ""}`;
    return realFetch(target, init);
  }
  return realFetch(input as any, init);
}) as typeof fetch;

type Stage = { tMs: number; status: string };
type PartialSnap = {
  tMs: number;
  n: number;
  markets: string[];
  periodMarkets: string[];
};

const markFactory = (label: string, t0: number, stages: Stage[]) => (status: string) => {
  const row = { tMs: Math.round(performance.now() - t0), status };
  stages.push(row);
  console.error(`[${label} +${row.tMs}ms] ${status}`);
};

function pickSummary(picks: Array<{ market?: string; pick?: string; game?: string; grade?: string; finalAiScore?: { grade?: string; confidencePct?: number; edgePct?: number } | null }>) {
  return picks.map((p) => ({
    market: p.market ?? null,
    pick: p.pick ?? null,
    game: p.game ?? null,
    grade: p.finalAiScore?.grade ?? p.grade ?? null,
    confidencePct: p.finalAiScore?.confidencePct ?? null,
    edgePct: p.finalAiScore?.edgePct ?? null,
    isPeriod:
      isPeriodMainMarket(String(p.market ?? "")) ||
      parseMarketPeriod(String(p.market ?? "")) !== "fg",
  }));
}

async function runPipeline(label: string, ask: string, priorUserTexts: string[] = []) {
  const t0 = performance.now();
  const stages: Stage[] = [];
  const partials: PartialSnap[] = [];
  const mark = markFactory(label, t0, stages);
  const legs = resolveBuildLegTarget(ask);
  const budgetMs = coachAbsoluteBudgetMs(legs);
  mark(`start ask="${ask}" legs=${legs} budgetMs=${budgetMs} api=${API_BASE} isolatedSim=${LOCAL}`);
  const ac = new AbortController();
  const kill = setTimeout(() => {
    mark(`HARD_TIMEOUT abort after ${HARD_MS}ms`);
    ac.abort();
  }, HARD_MS);
  let result: Awaited<ReturnType<typeof buildCoachParlay>> | null = null;
  let error: string | null = null;
  let terminalReached = false;
  try {
    result = await buildCoachParlay({
      requestedLegs: legs,
      askText: ask,
      priorUserTexts,
      signal: ac.signal,
      onStatus: (s) => mark(`status: ${s}`),
      onReadyToScan: (info) => mark(`onReadyToScan propPoolSize=${info.propPoolSize}`),
      onPartialPicks: (picks) => {
        const markets = picks.map((p) => String(p.market ?? ""));
        const periodMarkets = markets.filter(
          (m) => isPeriodMainMarket(m) || parseMarketPeriod(m) !== "fg",
        );
        partials.push({
          tMs: Math.round(performance.now() - t0),
          n: picks.length,
          markets,
          periodMarkets,
        });
        mark(
          `onPartialPicks n=${picks.length} props=${picks.filter((p) => p.isProp).length} period=${periodMarkets.length}`,
        );
      },
    });
    terminalReached = true;
    mark(
      `returned picks=${result.picks.length} timedOut=${!!result.timedOut} noteLen=${(result.note || "").length} propPool=${result.propPoolSize}`,
    );
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    mark(`THREW ${error}`);
  } finally {
    clearTimeout(kill);
  }
  const delivered = pickSummary(result?.picks ?? []);
  const periodInPartials = partials.some((p) => p.periodMarkets.length > 0);
  const periodInFinal = delivered.some((p) => p.isPeriod);
  const nullTrimExposed =
    !!error && /trim/i.test(error) && /null|undefined/i.test(error);
  return {
    label,
    ask,
    priorUserTexts,
    reviewedSha: REVIEWED_SHA,
    terminalReached,
    totalRuntimeMs: Math.round(performance.now() - t0),
    budgetMs,
    finalLegs: result?.picks?.length ?? 0,
    timedOut: result?.timedOut ?? null,
    propPoolSize: result?.propPoolSize ?? null,
    notePreview: (result?.note || "").slice(0, 240),
    noteIsNullSafe: !nullTrimExposed,
    deliveredMarkets: delivered,
    partialSnapshots: partials,
    periodInPartials,
    periodInFinal,
    nullTrimExposed,
    stages,
    error,
    pass:
      terminalReached &&
      !error &&
      !nullTrimExposed &&
      !periodInPartials &&
      !periodInFinal,
  };
}

async function runCancel(label: string, ask: string) {
  const t0 = performance.now();
  const stages: Stage[] = [];
  const mark = markFactory(label, t0, stages);
  mark(`start cancel-test ask="${ask}" cancelAfterMs=${CANCEL_AFTER_MS}`);
  const ac = new AbortController();
  const cancelTimer = setTimeout(() => {
    mark("USER_CANCEL abort()");
    ac.abort();
  }, CANCEL_AFTER_MS);
  const kill = setTimeout(() => {
    mark(`HARD_TIMEOUT abort after ${HARD_MS}ms`);
    ac.abort();
  }, HARD_MS);
  let result: Awaited<ReturnType<typeof buildCoachParlay>> | null = null;
  let error: string | null = null;
  let terminalReached = false;
  try {
    result = await buildCoachParlay({
      requestedLegs: resolveBuildLegTarget(ask),
      askText: ask,
      priorUserTexts: [],
      signal: ac.signal,
      onStatus: (s) => mark(`status: ${s}`),
      onReadyToScan: (info) => mark(`onReadyToScan propPoolSize=${info.propPoolSize}`),
      onPartialPicks: (picks) => mark(`onPartialPicks n=${picks.length}`),
    });
    terminalReached = true;
    mark(`returned after cancel picks=${result.picks.length} timedOut=${!!result.timedOut}`);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    terminalReached = true;
    mark(`THREW_AFTER_CANCEL ${error}`);
  } finally {
    clearTimeout(cancelTimer);
    clearTimeout(kill);
  }
  const runtime = Math.round(performance.now() - t0);
  return {
    label,
    ask,
    reviewedSha: REVIEWED_SHA,
    terminalReached,
    totalRuntimeMs: runtime,
    cancelAfterMs: CANCEL_AFTER_MS,
    abortedSignal: ac.signal.aborted,
    finalLegs: result?.picks?.length ?? 0,
    timedOut: result?.timedOut ?? null,
    error,
    stages,
    pass:
      terminalReached &&
      ac.signal.aborted &&
      runtime < HARD_MS &&
      runtime < CANCEL_AFTER_MS + 60_000,
  };
}

const hz = await realFetch(`${LOCAL}/healthz`);
const hzBody = await hz.json();
console.error("[healthz]", hz.status, hzBody);

const broncos = await runPipeline("A_8leg_broncos", "8 leg broncos", []);
await new Promise((r) => setTimeout(r, 1000));
const spreadsMl = await runPipeline(
  "B_4leg_nfl_spreads_ml",
  "4 leg NFL spreads and moneylines for upcoming games.",
  [],
);
await new Promise((r) => setTimeout(r, 1000));
const cancel = await runCancel("Z_cancel_8leg_broncos", "8 leg broncos");

const report = {
  generatedAt: new Date().toISOString(),
  reviewedSha: REVIEWED_SHA,
  apiBase: API_BASE,
  isolatedSimBase: LOCAL,
  isolatedHealth: hzBody,
  physicalDeviceReactUi: "PENDING",
  ncaafP0: "ARMED (do not flip)",
  unsupportedPeriodMarkets: "BLOCKED (delivery qualification + partial revalidate)",
  results: { broncos, spreadsMl, cancel },
  verdicts: {
    pipeline_broncos_terminal: broncos.terminalReached && !broncos.error,
    pipeline_broncos_null_note: broncos.noteIsNullSafe && !broncos.nullTrimExposed,
    pipeline_broncos_no_period: !broncos.periodInPartials && !broncos.periodInFinal,
    pipeline_spreads_ml_terminal: spreadsMl.terminalReached && !spreadsMl.error,
    pipeline_spreads_ml_no_period: !spreadsMl.periodInPartials && !spreadsMl.periodInFinal,
    cancellation: cancel.pass === true,
    react_ui_device: "PENDING",
  },
};

mkdirSync("/opt/cursor/artifacts", { recursive: true });
writeFileSync(
  "/opt/cursor/artifacts/coach-pipeline-cancel-isolated.json",
  JSON.stringify(report, null, 2),
);
mkdirSync("/workspace/artifacts/api-server/test/fixtures", { recursive: true });
writeFileSync(
  "/workspace/artifacts/api-server/test/fixtures/coach-pipeline-cancel-isolated.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify({ verdicts: report.verdicts, broncosPass: broncos.pass, spreadsPass: spreadsMl.pass }, null, 2));
if (
  !report.verdicts.pipeline_broncos_terminal ||
  !report.verdicts.pipeline_broncos_null_note ||
  !report.verdicts.pipeline_broncos_no_period ||
  !report.verdicts.pipeline_spreads_ml_terminal ||
  !report.verdicts.pipeline_spreads_ml_no_period ||
  !report.verdicts.cancellation
) {
  process.exitCode = 2;
}
