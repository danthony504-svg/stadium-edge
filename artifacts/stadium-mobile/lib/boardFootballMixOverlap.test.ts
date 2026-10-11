import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  boardScanFootballMixOverlapGameBudgetMs,
  boardScanMaxPropsToSimForMix,
  shouldOverlapFootballMixSims,
  shouldOverlapPropPhaseWithGames,
} from "./boardScanScope.ts";
import {
  coachAbsoluteBudgetMs,
  coachFinalizationReserveMs,
  coachScoringWorkBudgetMs,
} from "./coach/session.ts";
import {
  beginCoachSimulateSession,
  CoachSimulateLimiter,
  endCoachSimulateSession,
  resetCoachSimulateSessionForTests,
} from "./coachSimulateLimiter.ts";
import { buildStagedTicketFromScan, type BoardScoredLeg } from "./ticketStaging.ts";
import type { ParsedPick } from "../components/PickCard.tsx";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const scannerSrc = () => readFileSync(join(root, "lib/boardMarketScanner.ts"), "utf8");

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

test.afterEach(() => {
  resetCoachSimulateSessionForTests();
});

test("9-leg NFL football mix overlaps prop and game phases (decision + timing model)", () => {
  assert.equal(shouldOverlapFootballMixSims(true, false, 4000), true);
  assert.equal(shouldOverlapFootballMixSims(true, true, 4000), false);
  assert.equal(shouldOverlapFootballMixSims(false, false, 4000), false);
  assert.equal(shouldOverlapFootballMixSims(true, false, 0), false);
  // Finishable deep-sim cap unchanged.
  assert.equal(boardScanMaxPropsToSimForMix(9, 4704), 72);
});

test("game phase completion cannot cancel an in-flight prop phase", async () => {
  const session = beginCoachSimulateSession();
  let propCancelled = false;
  let propFinished = false;
  const propAc = new AbortController();

  session.markPropPhaseStart();
  const propPhaseP = (async () => {
    try {
      await delay(80);
      if (propAc.signal.aborted) {
        propCancelled = true;
        return;
      }
      propFinished = true;
    } finally {
      session.markPropPhaseEnd();
    }
  })();

  session.markGamePhaseStart();
  await delay(15);
  // Games finish — must NOT abort props.
  session.markGamePhaseEnd();
  assert.equal(propAc.signal.aborted, false);

  await propPhaseP;
  assert.equal(propCancelled, false);
  assert.equal(propFinished, true);
  const m = endCoachSimulateSession();
  assert.ok(m && m.overlapMs > 0);
  assert.ok((m!.propPhaseEndMs ?? 0) >= (m!.gamePhaseEndMs ?? 0));
});

test("props retain priority under shared simulate limiter pressure", async () => {
  const lim = new CoachSimulateLimiter(1);
  const order: string[] = [];
  const hold = lim.run("prop", async () => {
    await delay(30);
  });
  const games = Promise.all(
    Array.from({ length: 3 }, () =>
      lim.run("game", async () => {
        order.push("game");
      }),
    ),
  );
  await delay(5);
  const props = Promise.all(
    Array.from({ length: 2 }, () =>
      lim.run("prop", async () => {
        order.push("prop");
      }),
    ),
  );
  await Promise.all([hold, games, props]);
  // After the hold, both queued props must run before any game.
  assert.deepEqual(order.slice(0, 2), ["prop", "prop"]);
  assert.ok(order.filter((x) => x === "game").length === 3);
});

test("same completed prop+game candidate pools stage the same ticket (serial vs overlap-equivalent)", () => {
  const mk = (id: string, isProp: boolean, composite: number): BoardScoredLeg => {
    const pick = {
      pick: `${id}`,
      market: isProp ? "Pass Yds" : "Spread",
      game: isProp ? "A @ B" : "C @ D",
      sport: "nfl",
      odds: -110,
      isProp,
      player: isProp ? id : undefined,
      propLine: isProp ? 225.5 : undefined,
      propSide: isProp ? "Over" : undefined,
      propMarketKey: isProp ? "player_pass_yds" : undefined,
      finalAiScore: {
        composite,
        grade: "B+",
        confidencePct: 58,
        edgePct: 4,
        simHit: 0.56,
        simAligned: true,
        highRiskValuePlay: false,
        recommends: true,
        factors: [],
        rubric: {
          composite,
          grade: "B+",
          confidencePct: 58,
          edgePct: 4,
          scores: {} as never,
        },
      },
    } as ParsedPick;
    return {
      pick,
      evPct: 3,
      edgePct: 4,
      confidencePct: 58,
      impliedProbPct: 52,
      lineShoppingScore: null,
      grade: "B+",
      simHit: 0.56,
      composite,
      rankScore: composite,
    };
  };

  const pool = [
    mk("P1", true, 90),
    mk("P2", true, 88),
    mk("P3", true, 86),
    mk("P4", true, 84),
    mk("G1", false, 82),
    mk("G2", false, 80),
    mk("G3", false, 78),
    mk("G4", false, 76),
    mk("G5", false, 74),
  ];

  // Overlap only changes when work runs — staging over the same completed pools
  // must match the serial path's ticket.
  const serial = buildStagedTicketFromScan(pool, 9);
  const overlapped = buildStagedTicketFromScan([...pool], 9);
  assert.deepEqual(
    serial.picks.map((p) => p.pick),
    overlapped.picks.map((p) => p.pick),
  );
  assert.equal(serial.picks.length, overlapped.picks.length);
});

test("finalization reserve leaves room before the absolute 110s deadline for 9-leg", () => {
  const abs = coachAbsoluteBudgetMs(9);
  const reserve = coachFinalizationReserveMs();
  const work = coachScoringWorkBudgetMs(9);
  assert.equal(abs, 110_000);
  assert.ok(reserve >= 3_000 && reserve <= 5_000);
  assert.equal(work, abs - reserve);

  const gameBudget = boardScanFootballMixOverlapGameBudgetMs(9, abs, reserve);
  assert.ok(gameBudget <= work);
  // Soft mix floor still applies when it fits under the scoring work budget.
  assert.equal(gameBudget, 36_000);

  // Model: phases finish, then finalization starts before absolute deadline.
  const session = beginCoachSimulateSession({ now: 0 });
  session.markPropPhaseStart(0);
  session.markGamePhaseStart(0);
  session.markGamePhaseEnd(36_000);
  session.markPropPhaseEnd(70_000);
  const finalizationStart = work; // last moment to start new sim work
  session.markFinalizationStart(finalizationStart);
  session.markFinalizationEnd(finalizationStart + reserve);
  const m = endCoachSimulateSession();
  assert.ok(m);
  assert.ok((m!.finalizationStartMs ?? 0) <= work);
  assert.ok((m!.finalizationEndMs ?? 0) <= abs);
  assert.ok((m!.finalizationEndMs ?? 0) > (m!.finalizationStartMs ?? 0));
});

test("football 9-leg mix wires overlap limiter + finalization reserve; non-football does not", () => {
  const src = scannerSrc();
  // Football mix: session only when footballMixOverlap.
  assert.match(
    src,
    /const simulateSession = footballMixOverlap \? beginCoachSimulateSession\(\) : null/,
  );
  assert.doesNotMatch(src, /footballMixOverlap \|\| overlapProps/);
  // Finalization reserve / scoringWorkBudgetMs gated to football mix only.
  assert.match(
    src,
    /const scoringWorkBudgetMs = footballMixOverlap\s*\?\s*coachScoringWorkBudgetMs\(opts\.target\)\s*:\s*null/,
  );
  assert.match(src, /scoringWorkBudgetMs != null/);
  assert.match(src, /boardScanFootballMixOverlapGameBudgetMs/);
  // 9-leg mix decision + cap still hold.
  assert.equal(shouldOverlapFootballMixSims(true, false, 4000), true);
  assert.equal(boardScanMaxPropsToSimForMix(9, 5000), 72);
  assert.equal(coachScoringWorkBudgetMs(9), 106_000);
});

test("non-football overlapProps orchestration stays baseline (no limiter / no 106s cutoff)", () => {
  const src = scannerSrc();
  // Prefetch overlap still exists for non-football.
  assert.equal(shouldOverlapPropPhaseWithGames(true, 120, false), true);
  assert.equal(shouldOverlapFootballMixSims(false, false, 120), false);

  // Baseline overlapProps branch: start propPhaseP without session markers.
  const overlapIdx = src.indexOf("} else if (overlapProps) {");
  assert.ok(overlapIdx >= 0, "overlapProps branch present");
  const overlapSlice = src.slice(overlapIdx, overlapIdx + 450);
  assert.match(overlapSlice, /baseline overlap \(no simulate limiter\)/);
  assert.match(overlapSlice, /propPhaseP = runPropPhase\(pool\)\s*\.then\(\(r\) => r\)/);
  assert.doesNotMatch(overlapSlice, /markPropPhaseStart|beginCoachSimulateSession|simulateSession/);

  // Non-football game budget path still uses boardScanGamePhaseBudgetMs + 48s floor.
  assert.match(
    src,
    /boardScanGamePhaseBudgetMs\(opts\.target\),\s*footballMixPath \? 36_000 : 48_000/,
  );
  // scoringWorkBudgetMs is null outside football mix — no unconditional 106s cutoff.
  assert.match(
    src,
    /const scoringWorkBudgetMs = footballMixOverlap\s*\?\s*coachScoringWorkBudgetMs\(opts\.target\)\s*:\s*null/,
  );
  assert.match(
    src,
    /scoringWorkBudgetMs != null &&\s*Date\.now\(\) - scoringStartedAt >= scoringWorkBudgetMs/s,
  );
});

test("propsOnly path unchanged (no football-mix overlap / no game slate)", () => {
  assert.equal(shouldOverlapFootballMixSims(true, true, 4000), false);
  assert.equal(shouldOverlapPropPhaseWithGames(true, 4000, true), false);
  const src = scannerSrc();
  assert.match(src, /const propsOnlyPath = !!opts\.propsOnly/);
  const propsIdx = src.indexOf("} else if (propsOnlyPath) {");
  assert.ok(propsIdx >= 0);
  const propsSlice = src.slice(propsIdx, propsIdx + 280);
  assert.match(propsSlice, /propPhaseP = runPropPhase\(pool\)\s*\.then\(\(r\) => r\)/);
  assert.doesNotMatch(propsSlice, /simulateSession|beginCoachSimulateSession/);
  // Game sims still skipped when propsOnly.
  assert.match(src, /if \(!opts\.propsOnly\) \{\s*gameSimsAttempted = gameEntries\.length > 0/s);
});
