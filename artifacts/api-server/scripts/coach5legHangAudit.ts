/**
 * Production hang audit: fresh "5 leg" vs "4 leg soccer" → "5 leg".
 * Report-only — no production patches.
 *
 *   EXPO_PUBLIC_DOMAIN=stadium-edge.onrender.com \
 *   node --import ./scripts/coachE2ERegisterHooks.mjs ./scripts/coach5legHangAudit.ts
 */
import { buildCoachParlay } from "../../stadium-mobile/lib/coach/buildParlay.ts";
import { parseCoachAskMarketConstraint } from "../../stadium-mobile/lib/coachAskMarketFilter.ts";
import { askRequiresFootballPropMix } from "../../stadium-mobile/lib/boardScanPropDelivery.ts";
import { resolveBuildLegTarget } from "../../stadium-mobile/lib/coach/parseAsk.ts";
import { coachAbsoluteBudgetMs } from "../../stadium-mobile/lib/coach/session.ts";
import {
  boardScanMaxPropsToSim,
  boardScanPropPhaseDeadlineMs,
} from "../../stadium-mobile/lib/boardScanScope.ts";
import { API_BASE } from "../../stadium-mobile/lib/apiBase.ts";

const HARD_MS = Number(process.env.HARD_TIMEOUT_MS || 180_000);

type Stage = { tMs: number; status: string };

async function runOne(label: string, ask: string, priorUserTexts: string[]) {
  const t0 = performance.now();
  const stages: Stage[] = [];
  const mark = (status: string) => {
    stages.push({ tMs: Math.round(performance.now() - t0), status });
    console.error(`[${label} +${Math.round(performance.now() - t0)}ms] ${status}`);
  };

  const constraint = parseCoachAskMarketConstraint(ask, priorUserTexts);
  const legs = resolveBuildLegTarget(ask);
  const budgetMs = coachAbsoluteBudgetMs(legs);
  const requirePropMix = askRequiresFootballPropMix(ask);
  mark(
    `start ask="${ask}" priors=${JSON.stringify(priorUserTexts)} legs=${legs} budgetMs=${budgetMs} propsOnly=${constraint.propsOnly} gameLinesOnly=${constraint.gameLinesOnly} requirePropMix=${requirePropMix} api=${API_BASE}`,
  );

  const ac = new AbortController();
  const kill = setTimeout(() => {
    mark(`HARD_TIMEOUT abort after ${HARD_MS}ms`);
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
      onStatus: (s) => mark(`status: ${s}`),
      onReadyToScan: (info) =>
        mark(
          `onReadyToScan propPoolSize=${info.propPoolSize} maxToSim≈${boardScanMaxPropsToSim(legs, info.propPoolSize)} propDeadlineMs=${boardScanPropPhaseDeadlineMs(legs)}`,
        ),
      onPartialPicks: (picks) => {
        const props = picks.filter((p) => p.isProp).length;
        mark(`onPartialPicks n=${picks.length} props=${props}`);
      },
    });
    terminal = true;
    mark(
      `buildCoachParlay returned picks=${result.picks.length} timedOut=${result.timedOut} propPoolSize=${result.propPoolSize} noteLen=${(result.note || "").length}`,
    );
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    mark(`THREW ${error}`);
  } finally {
    clearTimeout(kill);
  }

  const picks = result?.picks ?? [];
  const scan = result?.scan;
  const diag = scan?.failureDiagnostics as Record<string, unknown> | undefined;
  const lastStatus =
    [...stages].reverse().find((s) => s.status.startsWith("status:"))?.status ?? null;

  return {
    label,
    ask,
    priorUserTexts,
    routing: {
      propsOnly: constraint.propsOnly,
      gameLinesOnly: constraint.gameLinesOnly,
      requirePropMix,
      budgetMs,
      propPhaseDeadlineMs: boardScanPropPhaseDeadlineMs(legs),
    },
    totalRuntimeMs: Math.round(performance.now() - t0),
    hardTimeoutMs: HARD_MS,
    aborted: ac.signal.aborted,
    terminalReached: terminal,
    error,
    lastProgressStatus: lastStatus,
    stages,
    totals: {
      postedCandidates: result?.propPoolSize ?? null,
      finalLegs: picks.length,
      timedOut: result?.timedOut ?? null,
      propLikeFinal: picks.filter((p) => p.isProp).length,
      gameLineFinal: picks.filter((p) => !p.isProp).length,
      scanTotalScanned: (diag as { totalScanned?: number } | undefined)?.totalScanned ?? null,
      propLegsScored: (diag as { propLegsScored?: number } | undefined)?.propLegsScored ?? null,
      gameLegsScored: (diag as { gameLegsScored?: number } | undefined)?.gameLegsScored ?? null,
      propPhaseIncomplete:
        (diag as { propPhaseIncomplete?: boolean } | undefined)?.propPhaseIncomplete ?? null,
      awaitingPropSlots: !!(scan as { awaitingPropSlots?: boolean } | undefined)?.awaitingPropSlots,
      failureReason: scan?.failureReason ?? null,
    },
    notePreview: (result?.note || "").slice(0, 240),
  };
}

async function main() {
  console.error("API_BASE", API_BASE);
  const A = await runOne("A_fresh", "5 leg", []);
  await new Promise((r) => setTimeout(r, 2000));
  const soccer = await runOne("B1_soccer", "4 leg soccer", []);
  await new Promise((r) => setTimeout(r, 2000));
  const B = await runOne("B2_after_soccer", "5 leg", ["4 leg soccer"]);

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        apiBase: API_BASE,
        A,
        B_soccer: soccer,
        B_five_after_soccer: B,
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
