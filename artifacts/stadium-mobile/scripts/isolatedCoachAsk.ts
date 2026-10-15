/**
 * Real buildCoachParlay run against the isolated staging API.
 * COACH_API_BASE must be the isolated origin plus /api.
 * Prices on that origin are staging fixtures, not sportsbook closes.
 * Does not deploy.
 */
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { buildCoachParlay } from "../lib/coach/buildParlay.ts";
import { resolveBuildLegTarget } from "../lib/coach/parseAsk.ts";
import {
  coachCacheSnapshot,
  clearCoachContextCache,
} from "../lib/coachContextCache.ts";
import {
  coachSessionShouldKeepBusy,
  createCoachSession,
  latchCoachSession,
} from "../lib/coach/session.ts";

const ASK = "4 leg NFL spreads and moneylines for upcoming games.";
const base = process.env.COACH_API_BASE ?? "http://127.0.0.1:8099/api";
const origin = base.replace(/\/api$/, "");

type Call = {
  kind: "games" | "odds" | "live-odds" | "simulate" | "other";
  method: string;
  path: string;
  startMs: number;
  endMs: number | null;
  ok: boolean | null;
  error: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  simulations: number | null;
  queryIds: string[];
  periods: string[];
  abortPhase: "before-abort" | "after-abort" | "no-abort";
};

const calls: Call[] = [];
let abortAtMs: number | null = null;
let onFirstSimulate: (() => void) | null = null;

function kindFor(path: string, method: string): Call["kind"] {
  if (method === "POST" && path.includes("/sports/simulate/game-outcome")) return "simulate";
  if (path.includes("/sports/odds")) return "odds";
  if (path.includes("/sports/live-odds")) return "live-odds";
  if (path.includes("/sports/games")) return "games";
  return "other";
}

const originalFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? "GET").toUpperCase();
  const path = url.replace(origin, "");
  const startMs = Date.now();
  let homeTeam: string | null = null;
  let awayTeam: string | null = null;
  let simulations: number | null = null;
  let queryIds: string[] = [];
  let periods: string[] = [];
  if (method === "POST" && typeof init?.body === "string" && path.includes("game-outcome")) {
    const body = JSON.parse(init.body) as {
      homeTeam?: string;
      awayTeam?: string;
      simulations?: number;
      coverQueries?: Array<{ id?: string; period?: string }>;
    };
    homeTeam = body.homeTeam ?? null;
    awayTeam = body.awayTeam ?? null;
    simulations = body.simulations ?? null;
    queryIds = (body.coverQueries ?? []).map((q) => String(q.id ?? ""));
    periods = (body.coverQueries ?? []).map((q) => String(q.period ?? "fg"));
  }
  const rec: Call = {
    kind: kindFor(path, method),
    method,
    path,
    startMs,
    endMs: null,
    ok: null,
    error: null,
    homeTeam,
    awayTeam,
    simulations,
    queryIds,
    periods,
    abortPhase:
      abortAtMs == null ? "no-abort" : startMs <= abortAtMs ? "before-abort" : "after-abort",
  };
  calls.push(rec);
  if (rec.kind === "simulate" && onFirstSimulate) {
    const fire = onFirstSimulate;
    onFirstSimulate = null;
    queueMicrotask(fire);
  }
  try {
    const res = await originalFetch(input, init);
    rec.endMs = Date.now();
    rec.ok = res.ok;
    return res;
  } catch (err) {
    rec.endMs = Date.now();
    rec.ok = false;
    rec.error = err instanceof Error ? err.name : String(err);
    throw err;
  }
};

function callReport(list: Call[]) {
  return list.map((c, i) => ({
    n: i + 1,
    kind: c.kind,
    method: c.method,
    path: c.path,
    startOffsetMs: null as number | null,
    durationMs: c.endMs == null ? null : c.endMs - c.startMs,
    ok: c.ok,
    error: c.error,
    matchup: c.homeTeam ? `${c.awayTeam} @ ${c.homeTeam}` : null,
    simulations: c.simulations,
    periods: c.periods,
    queryIds: c.queryIds,
    abortPhase: c.abortPhase,
  }));
}

async function serverStarts(): Promise<Array<{ atMs: number; path: string }>> {
  const res = await originalFetch(`${origin}/api/staging/simulate-starts`);
  const body = (await res.json()) as { starts: Array<{ atMs: number; path: string }> };
  return body.starts ?? [];
}

async function resetServerStarts(): Promise<void> {
  await originalFetch(`${origin}/api/staging/simulate-starts/reset`, { method: "POST" });
}

function pickSummary(picks: Array<Record<string, unknown>>) {
  return picks.map((p) => ({
    market: p.market ?? null,
    pick: p.pick ?? null,
    game: p.game ?? null,
    odds: p.odds ?? null,
    isProp: p.isProp ?? null,
    grade: (p.finalAiScore as { grade?: string } | undefined)?.grade ?? null,
  }));
}

async function main(): Promise<number> {
  const health = await originalFetch(`${origin}/api/health`);
  const healthBody = await health.json();
  const legs = resolveBuildLegTarget(ASK);
  clearCoachContextCache();
  await resetServerStarts();

  const stages: Array<{ tMs: number; status: string }> = [];
  const t0 = performance.now();
  const mark = (status: string) => stages.push({ tMs: Math.round(performance.now() - t0), status });
  const callStart = calls.length;
  mark("start");
  const success = await buildCoachParlay({
    requestedLegs: legs,
    askText: ASK,
    priorUserTexts: [],
    signal: new AbortController().signal,
    deadlineAtMs: Date.now() + 75_000,
    onStatus: (status) => mark(status),
    onPartialPicks: (picks) => mark(`partial picks=${picks.length}`),
  });
  mark(`returned picks=${success.picks.length} timedOut=${success.timedOut}`);
  const successMs = Math.round(performance.now() - t0);
  const successCalls = calls.slice(callStart);
  const tOrigin = successCalls[0]?.startMs ?? Date.now();
  const labeled = callReport(successCalls).map((c, i) => ({
    ...c,
    startOffsetMs: successCalls[i]!.startMs - tOrigin,
  }));
  const simulateCalls = labeled.filter((c) => c.kind === "simulate");
  const terminal =
    success.timedOut
      ? "deadline"
      : success.picks.length <= 0
        ? "empty"
        : success.picks.length < legs
          ? "shortfall"
          : "shown";

  clearCoachContextCache();
  await resetServerStarts();
  const beforeEntries = coachCacheSnapshot().gameSimEntries;
  const session = createCoachSession(2, legs);
  const ac = new AbortController();
  abortAtMs = null;
  let appliedPicks = 0;
  let latched = false;
  const abortCallStart = calls.length;
  onFirstSimulate = () => {
    abortAtMs = Date.now();
    ac.abort();
    latchCoachSession(session, "failed");
    latched = true;
    appliedPicks = 0;
  };
  const aborted = await buildCoachParlay({
    requestedLegs: legs,
    askText: ASK,
    priorUserTexts: [],
    signal: ac.signal,
    deadlineAtMs: Date.now() + 75_000,
    onPartialPicks: (picks) => {
      if (!latched) appliedPicks = picks.length;
    },
  });
  if (!latched) {
    abortAtMs = Date.now();
    ac.abort();
    latchCoachSession(session, "failed");
  }
  await new Promise((r) => setTimeout(r, 400));
  const abortCalls = calls.slice(abortCallStart);
  for (const c of abortCalls) {
    if (c.kind !== "simulate") continue;
    c.abortPhase = abortAtMs != null && c.startMs > abortAtMs ? "after-abort" : "before-abort";
  }
  const starts = await serverStarts();
  const afterClient = abortCalls.filter((c) => c.kind === "simulate" && c.abortPhase === "after-abort");
  const beforeClient = abortCalls.filter((c) => c.kind === "simulate" && c.abortPhase === "before-abort");
  const serverAfterCount = Math.max(0, starts.length - beforeClient.length);
  const cacheAfter = coachCacheSnapshot().gameSimEntries;
  const lateIgnored =
    latched &&
    !coachSessionShouldKeepBusy(session) &&
    appliedPicks === 0 &&
    aborted.picks.length >= 0;

  const report = {
    ask: ASK,
    api: base,
    health: healthBody,
    priceSource: "staging-fixture",
    priceNote: "Spread -3.5 / +3.5 and moneylines are -110 fixtures. They are not closing prices. ODDS_API_KEY is unset.",
    pipeline: {
      requestedLegs: legs,
      terminal,
      timedOut: success.timedOut,
      note: success.note,
      pickCount: success.picks.length,
      picks: pickSummary(success.picks as unknown as Array<Record<string, unknown>>),
      totalMs: successMs,
      stages,
      calls: labeled,
      simulateCalls,
    },
    abort: {
      latched,
      sessionBusy: coachSessionShouldKeepBusy(session),
      appliedPickCount: appliedPicks,
      lateResultPickCount: aborted.picks.length,
      lateResultIgnored: lateIgnored,
      cacheEntriesBefore: beforeEntries,
      cacheEntriesAfter: cacheAfter,
      clientSimulateAlreadyRunning: beforeClient.length,
      clientSimulateStartedAfterAbort: afterClient.length,
      serverSimulateAlreadyRunning: Math.min(starts.length, beforeClient.length),
      serverSimulateStartedAfterAbort: serverAfterCount,
      serverStartAtMs: starts.map((s) => s.atMs),
      abortAtMs,
      clientSimulate: callReport(abortCalls.filter((c) => c.kind === "simulate")),
    },
  };
  const json = JSON.stringify(report, null, 2);
  writeFileSync("/opt/cursor/artifacts/isolated-coach-ask.json", json);
  console.log(json);
  const ok =
    report.health?.sha &&
    simulateCalls.every((c) => !c.periods.some((p) => p && p !== "fg")) &&
    afterClient.length === 0 &&
    serverAfterCount === 0 &&
    cacheAfter === 0 &&
    lateIgnored;
  return ok ? 0 : 1;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error(err);
  process.exit(1);
});
