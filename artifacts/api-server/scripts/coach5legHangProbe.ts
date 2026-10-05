/**
 * Deeper hang probe via global fetch timing (ESM exports are read-only).
 * Report-only.
 *
 *   EXPO_PUBLIC_DOMAIN=stadium-edge.onrender.com \
 *   node --import ./scripts/coachE2ERegisterHooks.mjs ./scripts/coach5legHangProbe.ts
 */
import { buildCoachParlay } from "../../stadium-mobile/lib/coach/buildParlay.ts";
import { coachAbsoluteBudgetMs } from "../../stadium-mobile/lib/coach/session.ts";
import { resolveBuildLegTarget } from "../../stadium-mobile/lib/coach/parseAsk.ts";
import { API_BASE } from "../../stadium-mobile/lib/apiBase.ts";

const HARD_MS = Number(process.env.HARD_TIMEOUT_MS || 120_000);

type Mark = { tMs: number; event: string; detail?: Record<string, unknown> };

function installFetchProbe(marks: (m: Omit<Mark, "tMs">) => void) {
  const g = globalThis as typeof globalThis & {
    fetch: typeof fetch;
    __coachHangProbeInstalled?: boolean;
  };
  if (g.__coachHangProbeInstalled) return () => ({});
  g.__coachHangProbeInstalled = true;
  const orig = g.fetch.bind(g);
  let gameCalls = 0;
  let propCalls = 0;
  let gameHangSuspect = 0;
  let propHangSuspect = 0;
  let longestGameMs = 0;
  let longestPropMs = 0;

  g.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(typeof input === "string" ? input : (input as Request).url ?? input);
    const isGame = url.includes("/sports/simulate/game-outcome");
    const isProp = url.includes("/sports/simulate/props");
    if (!isGame && !isProp) return orig(input, init);

    const n = isGame ? ++gameCalls : ++propCalls;
    const t0 = performance.now();
    marks({
      event: isGame ? "game_sim_start" : "prop_sim_start",
      detail: { n, url: url.replace(API_BASE, "") },
    });
    try {
      const res = await orig(input, init);
      // Time body read separately — headers-ok + hung body is the hang hypothesis.
      const tHeader = Math.round(performance.now() - t0);
      const clone = res.clone();
      const bodyT0 = performance.now();
      let bodyBytes = 0;
      try {
        const buf = await clone.arrayBuffer();
        bodyBytes = buf.byteLength;
      } catch (e) {
        marks({
          event: isGame ? "game_body_err" : "prop_body_err",
          detail: {
            n,
            headerMs: tHeader,
            err: e instanceof Error ? e.message : String(e),
          },
        });
      }
      const bodyMs = Math.round(performance.now() - bodyT0);
      const totalMs = Math.round(performance.now() - t0);
      marks({
        event: isGame ? "game_sim_end" : "prop_sim_end",
        detail: {
          n,
          status: res.status,
          headerMs: tHeader,
          bodyMs,
          totalMs,
          bodyBytes,
        },
      });
      if (isGame) {
        longestGameMs = Math.max(longestGameMs, totalMs);
        if (totalMs > 20_000 || bodyMs > 15_000) gameHangSuspect += 1;
      } else {
        longestPropMs = Math.max(longestPropMs, totalMs);
        if (totalMs > 20_000 || bodyMs > 15_000) propHangSuspect += 1;
      }
      return res;
    } catch (e) {
      const totalMs = Math.round(performance.now() - t0);
      marks({
        event: isGame ? "game_sim_err" : "prop_sim_err",
        detail: {
          n,
          totalMs,
          err: e instanceof Error ? e.message : String(e),
        },
      });
      throw e;
    }
  }) as typeof fetch;

  return () => ({
    gameCalls,
    propCalls,
    gameHangSuspect,
    propHangSuspect,
    longestGameMs,
    longestPropMs,
  });
}

async function runOne(label: string, ask: string, priorUserTexts: string[]) {
  const t0 = performance.now();
  const stages: Mark[] = [];
  const mark = (m: Omit<Mark, "tMs">) => {
    const row = { tMs: Math.round(performance.now() - t0), ...m };
    stages.push(row);
    console.error(
      `[${label} +${row.tMs}ms] ${row.event}${row.detail ? " " + JSON.stringify(row.detail) : ""}`,
    );
  };

  const snap = installFetchProbe(mark);
  const legs = resolveBuildLegTarget(ask);
  const budgetMs = coachAbsoluteBudgetMs(legs);
  mark({
    event: "start",
    detail: { ask, priorUserTexts, legs, budgetMs, api: API_BASE },
  });

  const ac = new AbortController();
  const kill = setTimeout(() => {
    mark({ event: "HARD_TIMEOUT", detail: { hardMs: HARD_MS } });
    ac.abort();
  }, HARD_MS);

  let result: Awaited<ReturnType<typeof buildCoachParlay>> | null = null;
  let error: string | null = null;
  let terminal = false;
  try {
    result = await buildCoachParlay({
      requestedLegs: legs,
      askText: ask,
      priorUserTexts,
      signal: ac.signal,
      onStatus: (s) => mark({ event: "status", detail: { s } }),
      onReadyToScan: (info) =>
        mark({ event: "ready_to_scan", detail: { propPoolSize: info.propPoolSize } }),
      onPartialPicks: (picks) =>
        mark({
          event: "partial",
          detail: {
            n: picks.length,
            props: picks.filter((p) => p.isProp).length,
          },
        }),
    });
    terminal = true;
    mark({
      event: "returned",
      detail: {
        picks: result.picks.length,
        timedOut: result.timedOut,
        propPoolSize: result.propPoolSize,
      },
    });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    mark({ event: "threw", detail: { error } });
  } finally {
    clearTimeout(kill);
  }

  const probe = snap();
  const lastStatus =
    [...stages].reverse().find((s) => s.event === "status")?.detail?.s ?? null;
  const awaiting = stages.filter(
    (s) =>
      s.event === "status" &&
      String(s.detail?.s ?? "").includes("props/alts next"),
  );
  const scoringTicket = stages.filter(
    (s) =>
      s.event === "status" &&
      String(s.detail?.s ?? "").startsWith("Scoring ticket"),
  );

  return {
    label,
    ask,
    priorUserTexts,
    totalRuntimeMs: Math.round(performance.now() - t0),
    terminalReached: terminal,
    error,
    lastProgressStatus: lastStatus,
    probe,
    timings: {
      readyToScanMs:
        stages.find((s) => s.event === "ready_to_scan")?.tMs ?? null,
      firstAwaitingGameLinesMs: awaiting[0]?.tMs ?? null,
      lastAwaitingGameLinesMs: awaiting.length
        ? awaiting[awaiting.length - 1]!.tMs
        : null,
      awaitingWindowMs:
        awaiting.length >= 2
          ? awaiting[awaiting.length - 1]!.tMs - awaiting[0]!.tMs
          : awaiting.length === 1
            ? 0
            : null,
      firstScoringTicketMs: scoringTicket[0]?.tMs ?? null,
      lastScoringTicketMs: scoringTicket.length
        ? scoringTicket[scoringTicket.length - 1]!.tMs
        : null,
      returnedMs: stages.find((s) => s.event === "returned")?.tMs ?? null,
    },
    totals: {
      postedCandidates: result?.propPoolSize ?? null,
      finalLegs: result?.picks.length ?? 0,
      timedOut: result?.timedOut ?? null,
      propLikeFinal: result?.picks.filter((p) => p.isProp).length ?? 0,
      gameLineFinal: result?.picks.filter((p) => !p.isProp).length ?? 0,
      propLegsScored:
        (result?.scan?.failureDiagnostics as { propLegsScored?: number } | undefined)
          ?.propLegsScored ?? null,
      gameLegsScored:
        (result?.scan?.failureDiagnostics as { gameLegsScored?: number } | undefined)
          ?.gameLegsScored ?? null,
    },
    statusOnly: stages.filter((s) =>
      ["start", "status", "ready_to_scan", "partial", "returned", "HARD_TIMEOUT", "threw"].includes(
        s.event,
      ),
    ),
    slowSims: stages.filter(
      (s) =>
        (s.event === "game_sim_end" || s.event === "prop_sim_end") &&
        Number(s.detail?.totalMs ?? 0) >= 12_000,
    ),
    largeBodies: stages.filter(
      (s) =>
        (s.event === "game_sim_end" || s.event === "prop_sim_end") &&
        Number(s.detail?.bodyBytes ?? 0) >= 500_000,
    ),
  };
}

async function main() {
  console.error("API_BASE", API_BASE);
  const soccer = await runOne("B1_soccer", "4 leg soccer", []);
  await new Promise((r) => setTimeout(r, 1500));
  const five = await runOne("B2_after_soccer", "5 leg", ["4 leg soccer"]);
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), soccer, five }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
