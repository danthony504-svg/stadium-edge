/**
 * Coach QA — terminal-state invariant.
 *
 * Every Coach request must end in exactly one of:
 *   completed ticket | honest shortfall | controlled error | user cancellation
 * Never remain indefinitely in Building/Scanning.
 *
 * Parser-only suites can pass while the real async pipeline hangs; this module
 * gates the absolute-session latch and production-equivalent A/B hang audits.
 */

import {
  armCoachAbsoluteTerminal,
  beginCoachSession,
  coachAbsoluteBudgetMs,
  coachSessionIsTerminal,
  createCoachSession,
  latchCoachSession,
} from "../coach/session.ts";
import { snapshotAsk } from "./parseSnapshot.ts";
import type { QaCaseResult, QaFinding } from "./types.ts";

let n = 0;
function F(partial: Omit<QaFinding, "id">): QaFinding {
  n += 1;
  return { id: `term-${n}`, ...partial };
}

/** Wall budget for live production-equivalent hang audits (5-leg). */
export function coachTerminalLiveDeadlineMs(requestedLegs = 5): number {
  // Absolute scoring budget + prop-pending grace (~25% of budget, capped 20s)
  // + load/network margin. Must stay finite.
  const budget = coachAbsoluteBudgetMs(requestedLegs);
  const grace = Math.min(20_000, Math.max(8_000, Math.round(budget * 0.25)));
  return budget + grace + 45_000;
}

/**
 * Sync suite: RC1 routing + finite budgets + session handoff timer clear.
 * Does not call live providers.
 */
export function runAbsoluteTerminalHangGuardSuite(): QaCaseResult[] {
  const out: QaCaseResult[] = [];

  {
    const after = snapshotAsk("5 leg", ["4 leg soccer"]);
    const clean = snapshotAsk("5 leg", []);
    const ok =
      after.propsOnly === false &&
      clean.propsOnly === false &&
      after.pathHint === "full_board_mix";
    out.push({
      id: "term-rc1-routing",
      suite: "terminal_state",
      ok,
      finding: ok
        ? undefined
        : F({
            severity: "P0",
            category: "crash_timeout",
            title: "Soccer→5 leg still routes propsOnly (RC1 regression)",
            promptOrSequence: ["4 leg soccer", "5 leg"],
            expected: "propsOnly=false, pathHint=full_board_mix",
            actual: `propsOnly=${after.propsOnly} path=${after.pathHint}`,
            stage: "routing",
            likelyFile: "lib/coachAskMarketFilter.ts",
            productionAffected: true,
          }),
      meta: { after, clean },
    });
  }

  {
    const b5 = coachAbsoluteBudgetMs(5);
    const b6 = coachAbsoluteBudgetMs(6);
    const live = coachTerminalLiveDeadlineMs(5);
    const ok = b5 === 75_000 && b6 === 90_000 && live < 180_000;
    out.push({
      id: "term-budget-finite",
      suite: "terminal_state",
      ok,
      finding: ok
        ? undefined
        : F({
            severity: "P1",
            category: "crash_timeout",
            title: "Absolute budget not finite / unexpected",
            promptOrSequence: "5 leg",
            expected: "5→75000, 6→90000, live deadline < 180s",
            actual: `b5=${b5} b6=${b6} live=${live}`,
            stage: "session_budget",
            likelyFile: "lib/coach/session.ts",
            productionAffected: true,
          }),
    });
  }

  {
    const session = createCoachSession(1, 4);
    armCoachAbsoluteTerminal(session, () => {});
    const hadTimer = session.absoluteTimer != null;
    beginCoachSession(session, { sendGen: 2, requestedLegs: 5 });
    const ok = hadTimer && session.absoluteTimer == null && session.outcome === "open";
    out.push({
      id: "term-session-handoff-clears-timer",
      suite: "terminal_state",
      ok,
      finding: ok
        ? undefined
        : F({
            severity: "P1",
            category: "crash_timeout",
            title: "New send did not clear prior absolute timer",
            promptOrSequence: ["4 leg soccer", "5 leg"],
            expected: "beginCoachSession clears absoluteTimer, outcome=open",
            actual: `hadTimer=${hadTimer} timer=${!!session.absoluteTimer} outcome=${session.outcome}`,
            stage: "session_handoff",
            likelyFile: "lib/coach/session.ts",
            productionAffected: true,
          }),
    });
  }

  return out;
}

/**
 * Async: hung Promise never resolves → absolute terminal must fire and clear busy.
 * Models the phone limbo stuck on
 * "Scoring game lines… props/alts next (3180 posted)".
 */
export async function assertAbsoluteTerminalClearsBusyOnHungScan(): Promise<QaCaseResult> {
  const session = createCoachSession(7, 5, Date.now());
  // Tiny remaining budget so the unit test does not wait 75s.
  session.startedAtMs = Date.now() - coachAbsoluteBudgetMs(5) + 30;

  let busy: boolean = true;
  let building: boolean = true;
  let outcome: string = "open";

  const hungScan = new Promise<never>(() => {
    /* never resolves — hung game-sim / res.json body */
  });

  armCoachAbsoluteTerminal(session, () => {
    // Mirrors coach.tsx fireAbsoluteTerminal → finishSession
    latchCoachSession(session, "empty");
    busy = false;
    building = false;
    outcome = session.outcome;
  });

  await Promise.race([
    hungScan,
    new Promise<void>((resolve) => setTimeout(resolve, 500)),
  ]);

  const ok =
    coachSessionIsTerminal(session) &&
    !busy &&
    !building &&
    outcome !== "open";

  return {
    id: "term-hung-scan-absolute-clears-busy",
    suite: "terminal_state",
    ok,
    finding: ok
      ? undefined
      : F({
          severity: "P0",
          category: "crash_timeout",
          title: "Hung scan did not reach a terminal busy=false state",
          promptOrSequence: "5 leg (simulated hung game-sim)",
          expected: "absolute terminal latches session and clears busy/building",
          actual: `terminal=${coachSessionIsTerminal(session)} busy=${busy} building=${building} outcome=${outcome}`,
          stage: "absolute_terminal",
          likelyFile: "app/(tabs)/coach.tsx / lib/coach/session.ts",
          productionAffected: true,
        }),
    meta: {
      lastProgressStatus:
        "Scoring game lines… props/alts next (3180 posted) [simulated hang]",
      busy,
      building,
      outcome,
    },
  };
}

export type LiveTerminalRunSummary = {
  label: string;
  ask: string;
  priorUserTexts: string[];
  terminalReached: boolean;
  totalRuntimeMs: number;
  deadlineMs: number;
  postedCandidates: number | null;
  gameLineCandidates: number | null;
  propAltCandidates: number | null;
  deepSimulated: number | null;
  qualifiedCandidates: number | null;
  stagedCandidates: number | null;
  finalLegs: number;
  lastProgressStatus: string | null;
  timedOut: boolean | null;
  error: string | null;
};

/**
 * Convert a live A/B hang-audit row into a harness case result.
 * Fails hard if the pipeline never reaches a terminal within the deadline.
 */
export function liveTerminalCaseFromSummary(s: LiveTerminalRunSummary): QaCaseResult {
  const withinDeadline = s.totalRuntimeMs <= s.deadlineMs;
  const ok = s.terminalReached && withinDeadline && !s.error;
  return {
    id: `term-live-${s.label}`,
    suite: "terminal_state",
    ok,
    finding: ok
      ? undefined
      : F({
          severity: "P0",
          category: "crash_timeout",
          title: `Live Coach pipeline did not terminate: ${s.label}`,
          promptOrSequence: s.priorUserTexts.length
            ? [...s.priorUserTexts, s.ask]
            : s.ask,
          expected: `terminal within ${s.deadlineMs}ms (ticket|shortfall|error|cancel)`,
          actual: `terminal=${s.terminalReached} runtime=${s.totalRuntimeMs}ms last=${s.lastProgressStatus} err=${s.error}`,
          stage: "live_pipeline",
          likelyFile: "lib/coach/buildParlay.ts / lib/boardMarketScanner.ts",
          productionAffected: true,
        }),
    meta: { ...s },
  };
}
