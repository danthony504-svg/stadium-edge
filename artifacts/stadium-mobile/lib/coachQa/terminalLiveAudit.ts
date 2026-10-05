/**
 * Production-equivalent live terminal audit for Coach QA harness.
 * Runs A (fresh 5 leg) and B (4 leg soccer → 5 leg) against the live API.
 * Audit-only — does not change production thresholds or selection.
 */

import { buildCoachParlay } from "../coach/buildParlay.ts";
import { resolveBuildLegTarget } from "../coach/parseAsk.ts";
import { coachAbsoluteBudgetMs } from "../coach/session.ts";
import { API_BASE } from "../apiBase.ts";
import {
  coachTerminalLiveDeadlineMs,
  liveTerminalCaseFromSummary,
  type LiveTerminalRunSummary,
} from "./terminalInvariant.ts";
import type { QaCaseResult } from "./types.ts";

type Stage = { tMs: number; status: string };

async function runOne(
  label: string,
  ask: string,
  priorUserTexts: string[],
): Promise<LiveTerminalRunSummary> {
  const t0 = performance.now();
  const stages: Stage[] = [];
  const mark = (status: string) => {
    stages.push({ tMs: Math.round(performance.now() - t0), status });
  };

  const legs = resolveBuildLegTarget(ask);
  const deadlineMs = coachTerminalLiveDeadlineMs(legs);
  const budgetMs = coachAbsoluteBudgetMs(legs);
  mark(
    `start ask="${ask}" priors=${JSON.stringify(priorUserTexts)} legs=${legs} budgetMs=${budgetMs} api=${API_BASE}`,
  );

  const ac = new AbortController();
  const kill = setTimeout(() => {
    mark(`HARD_TIMEOUT abort after ${deadlineMs}ms`);
    ac.abort();
  }, deadlineMs);

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
        const props = picks.filter((p) => p.isProp).length;
        mark(`onPartialPicks n=${picks.length} props=${props}`);
      },
    });
    terminalReached = true;
    mark(
      `returned picks=${result.picks.length} timedOut=${result.timedOut} propPoolSize=${result.propPoolSize}`,
    );
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    mark(`THREW ${error}`);
  } finally {
    clearTimeout(kill);
  }

  const picks = result?.picks ?? [];
  const diag = result?.scan?.failureDiagnostics as
    | {
        propLegsScored?: number;
        gameLegsScored?: number;
        totalScanned?: number;
      }
    | undefined;
  const lastStatus =
    [...stages].reverse().find((s) => s.status.startsWith("status:"))?.status ?? null;

  return {
    label,
    ask,
    priorUserTexts,
    terminalReached,
    totalRuntimeMs: Math.round(performance.now() - t0),
    deadlineMs,
    postedCandidates: result?.propPoolSize ?? null,
    gameLineCandidates: diag?.gameLegsScored ?? null,
    propAltCandidates: result?.propPoolSize ?? null,
    deepSimulated: diag?.propLegsScored ?? null,
    qualifiedCandidates: picks.length || null,
    stagedCandidates: picks.length || null,
    finalLegs: picks.length,
    lastProgressStatus: lastStatus,
    timedOut: result?.timedOut ?? null,
    error,
  };
}

/**
 * A = fresh 5 leg; B = 4 leg soccer → 5 leg. Both must terminate.
 */
export async function runProductionTerminalAbAudit(): Promise<{
  cases: QaCaseResult[];
  summaries: LiveTerminalRunSummary[];
}> {
  const A = await runOne("A_fresh", "5 leg", []);
  await new Promise((r) => setTimeout(r, 1500));
  const soccer = await runOne("B1_soccer", "4 leg soccer", []);
  await new Promise((r) => setTimeout(r, 1500));
  const B = await runOne("B2_after_soccer", "5 leg", ["4 leg soccer"]);

  const summaries = [A, soccer, B];
  return {
    summaries,
    cases: summaries.map(liveTerminalCaseFromSummary),
  };
}
