/**
 * Full Coach pipeline + cancellation with tip-SHA isolated sim rewrite.
 * Run from artifacts/stadium-mobile:
 *   EXPO_PUBLIC_DOMAIN=stadium-edge.onrender.com \
 *   ISOLATED_SIM_BASE=http://127.0.0.1:8787/api \
 *   node --import ./test/register-hooks.mjs ./scripts/isolatedCoachPipelineCancel.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { buildCoachParlay } from "../lib/coach/buildParlay.ts";
import { resolveBuildLegTarget } from "../lib/coach/parseAsk.ts";
import { coachAbsoluteBudgetMs } from "../lib/coach/session.ts";
import { API_BASE } from "../lib/apiBase.ts";

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
const markFactory = (label: string, t0: number, stages: Stage[]) => (status: string) => {
  const row = { tMs: Math.round(performance.now() - t0), status };
  stages.push(row);
  console.error(`[${label} +${row.tMs}ms] ${status}`);
};

async function runPipeline(label: string, ask: string, priorUserTexts: string[] = []) {
  const t0 = performance.now();
  const stages: Stage[] = [];
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
      onPartialPicks: (picks) =>
        mark(`onPartialPicks n=${picks.length} props=${picks.filter((p) => p.isProp).length}`),
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
    stages,
    error,
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

const A = await runPipeline("A_fresh_5leg", "5 leg", []);
await new Promise((r) => setTimeout(r, 1000));
const college = await runPipeline("C_college_6leg", "6 leg college", []);
await new Promise((r) => setTimeout(r, 1000));
const cancel = await runCancel("Z_cancel_5leg", "5 leg");

const report = {
  generatedAt: new Date().toISOString(),
  reviewedSha: REVIEWED_SHA,
  apiBase: API_BASE,
  isolatedSimBase: LOCAL,
  isolatedHealth: hzBody,
  physicalDeviceReactUi: "PENDING",
  ncaafP0: "ARMED (do not flip)",
  results: { A, college, cancel },
  verdicts: {
    pipeline_A_terminal: A.terminalReached && !A.error,
    pipeline_college_terminal: college.terminalReached && !college.error,
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
console.log(JSON.stringify(report.verdicts, null, 2));
if (
  !report.verdicts.pipeline_A_terminal ||
  !report.verdicts.pipeline_college_terminal ||
  !report.verdicts.cancellation
) {
  process.exitCode = 2;
}
