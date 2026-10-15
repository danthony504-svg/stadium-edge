/**
 * Final-review stage timings for Coach seating (identical fixtures).
 *
 * Measures correlation + final selection + ticket creation wall times on a
 * fixed scored pool — the same inputs before/after sport-belt + correlation
 * hardening. Does NOT claim full Monte-Carlo scan parity (requires captured
 * board + live sim settings on device); see review report UNVERIFIED for that.
 */
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import type { ParsedPick } from "../components/PickCard.tsx";
import { hardLockedSportsFromAsk } from "./coachAskSportScope.ts";
import {
  selectCorrelationAwareBoardLegs,
  wouldRepeatPlayerProp,
} from "./parlayCorrelationScore.ts";
import {
  buildStagedTicketFromScan,
  topUpTicketFromQualifiedScored,
  type BoardScoredLeg,
} from "./ticketStaging.ts";

function qualifiedScore(): NonNullable<ParsedPick["finalAiScore"]> {
  return {
    composite: 8,
    grade: "B+",
    confidencePct: 58,
    edgePct: 4,
    simHit: 0.56,
    simAligned: true,
    highRiskValuePlay: false,
    recommends: true,
    factors: [],
    rubric: {
      composite: 8,
      grade: "B+",
      confidencePct: 58,
      edgePct: 4,
      scores: {} as never,
    },
  } as NonNullable<ParsedPick["finalAiScore"]>;
}

function mkPick(
  sport: string,
  game: string,
  market: string,
  label: string,
  opts?: { isProp?: boolean; player?: string },
): ParsedPick {
  return {
    game,
    market,
    pick: label,
    sport,
    odds: -110,
    isProp: !!opts?.isProp,
    player: opts?.player,
    finalAiScore: qualifiedScore(),
  };
}

function mkScored(p: ParsedPick, rankScore: number): BoardScoredLeg {
  return {
    pick: p,
    evPct: 4,
    edgePct: 4,
    confidencePct: 58,
    impliedProbPct: 50,
    lineShoppingScore: 1,
    grade: "B+",
    simHit: 0.56,
    composite: 8,
    rankScore,
  };
}

/**
 * Identical captured-style board: 7 NHL + 12 foreign high-score contaminants.
 * Uses NHL (not NCAAF) so P0 unvalidated college game-line rejects do not empty
 * the in-sport pool and hide the before/after foreign-leak signal.
 */
function identicalNhlBoard(): BoardScoredLeg[] {
  const nhl: BoardScoredLeg[] = [];
  for (let i = 0; i < 7; i++) {
    nhl.push(
      mkScored(
        mkPick(
          "nhl",
          `Team${i}A @ Team${i}B`,
          "Puck Line",
          `Team${i}A +${1.5 + i * 0}`,
        ),
        70 - i,
      ),
    );
  }
  const foreignSports = ["mlb", "ncaaf", "nfl", "nba"];
  const foreign: BoardScoredLeg[] = [];
  for (let i = 0; i < 12; i++) {
    const sport = foreignSports[i % foreignSports.length]!;
    foreign.push(
      mkScored(
        mkPick(sport, `${sport} H @ ${sport} A ${i}`, "Spread", `Home +${i}`),
        95 - i,
      ),
    );
  }
  // Two Ohtani name-form unders (must not both seat).
  foreign.push(
    mkScored(
      mkPick("mlb", "LAD @ SF", "Hits", "Shohei Ohtani Under 1.5 Hits", {
        isProp: true,
        player: "Shohei Ohtani",
      }),
      94,
    ),
    mkScored(
      mkPick("mlb", "LAD @ SF", "Pitcher K", "Ohtani Under 5.5 K", {
        isProp: true,
        player: "Ohtani",
      }),
      93,
    ),
  );
  return [...nhl, ...foreign];
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

test("stage timings before/after sport belt on identical NHL board", () => {
  const board = identicalNhlBoard();
  const ask = "7 leg nhl";
  const locked = hardLockedSportsFromAsk(ask)!;
  const target = 7;
  const runs = 30;

  const beforeCorrMs: number[] = [];
  const beforeSelectMs: number[] = [];
  const beforeTicketMs: number[] = [];
  const beforeTotalMs: number[] = [];
  const afterCorrMs: number[] = [];
  const afterSelectMs: number[] = [];
  const afterTicketMs: number[] = [];
  const afterTotalMs: number[] = [];
  let afterSports: string[] = [];
  let beforeForeign = 0;
  let afterForeign = 0;

  for (let i = 0; i < runs; i++) {
    // BEFORE: no sport belt (historical leak path).
    const t0 = performance.now();
    const tCorr0 = performance.now();
    const ranked = board.map((l) => ({ pick: l.pick, rankScore: l.rankScore }));
    const corrBefore = selectCorrelationAwareBoardLegs(ranked, target, {
      ticketTarget: target,
    });
    const tCorr1 = performance.now();
    const tSel0 = performance.now();
    const selectBefore = topUpTicketFromQualifiedScored(
      corrBefore.slice(0, 2),
      board,
      target,
      ask,
      4,
    );
    const tSel1 = performance.now();
    const tTick0 = performance.now();
    const ticketBefore = buildStagedTicketFromScan(board, target, ask, "balanced", {
      askText: ask,
    });
    const tTick1 = performance.now();
    const t1 = performance.now();
    beforeCorrMs.push(tCorr1 - tCorr0);
    beforeSelectMs.push(tSel1 - tSel0);
    beforeTicketMs.push(tTick1 - tTick0);
    beforeTotalMs.push(t1 - t0);
    beforeForeign += selectBefore.filter((p) => p.sport !== "nhl").length;

    // AFTER: sport belt + allowedSports on top-up (current path).
    const a0 = performance.now();
    const belted = board.filter((l) => locked.includes(String(l.pick.sport)));
    const aCorr0 = performance.now();
    const rankedAfter = belted.map((l) => ({
      pick: l.pick,
      rankScore: l.rankScore,
    }));
    const corrAfter = selectCorrelationAwareBoardLegs(rankedAfter, target, {
      ticketTarget: target,
    });
    const aCorr1 = performance.now();
    const aSel0 = performance.now();
    const selectAfter = topUpTicketFromQualifiedScored(
      corrAfter.slice(0, 2),
      belted,
      target,
      ask,
      4,
      { allowedSports: locked },
    );
    const aSel1 = performance.now();
    const aTick0 = performance.now();
    const ticketAfter = buildStagedTicketFromScan(belted, target, ask, "balanced", {
      askText: ask,
    });
    const aTick1 = performance.now();
    const a1 = performance.now();
    afterCorrMs.push(aCorr1 - aCorr0);
    afterSelectMs.push(aSel1 - aSel0);
    afterTicketMs.push(aTick1 - aTick0);
    afterTotalMs.push(a1 - a0);
    afterForeign += selectAfter.filter((p) => p.sport !== "nhl").length;
    afterSports = [...new Set(selectAfter.map((p) => String(p.sport)))];

    // Correlation: Ohtani dual unders cannot both appear when belted to MLB pool.
    const mlbProps = board.filter((l) => l.pick.isProp && l.pick.sport === "mlb");
    const ohtaniTicket: ParsedPick[] = [];
    for (const row of mlbProps) {
      if (wouldRepeatPlayerProp(row.pick, ohtaniTicket)) continue;
      ohtaniTicket.push(row.pick);
    }
    assert.equal(ohtaniTicket.length, 1, "Ohtani name forms → one seat");
    assert.ok(ticketAfter.picks.length <= target);
    assert.ok(ticketBefore.picks.length <= target);
  }

  const report = {
    label: "coach-scan-stage-timings identical NHL board",
    boardSize: board.length,
    runs,
    before: {
      correlationMedianMs: Number(median(beforeCorrMs).toFixed(3)),
      selectionMedianMs: Number(median(beforeSelectMs).toFixed(3)),
      ticketMedianMs: Number(median(beforeTicketMs).toFixed(3)),
      totalMedianMs: Number(median(beforeTotalMs).toFixed(3)),
      foreignLegsSeatedAcrossRuns: beforeForeign,
    },
    after: {
      correlationMedianMs: Number(median(afterCorrMs).toFixed(3)),
      selectionMedianMs: Number(median(afterSelectMs).toFixed(3)),
      ticketMedianMs: Number(median(afterTicketMs).toFixed(3)),
      totalMedianMs: Number(median(afterTotalMs).toFixed(3)),
      foreignLegsSeatedAcrossRuns: afterForeign,
      sportsOnTicket: afterSports,
    },
    simulationMs: null as null,
    renderingMs: null as null,
    note:
      "Simulation + UI rendering not included — no captured board/sim dump in CI. Stage timings above are seating-path only on identical fixtures.",
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(report, null, 2));

  assert.equal(afterForeign, 0, "after path must not seat foreign sports");
  assert.ok(beforeForeign > 0, "before path must demonstrate the historical leak");
  assert.deepEqual(afterSports, ["nhl"]);
  // After path should not be materially slower than before on identical work.
  assert.ok(
    median(afterTotalMs) <= median(beforeTotalMs) * 3 + 5,
    `after total ${median(afterTotalMs)}ms vs before ${median(beforeTotalMs)}ms`,
  );
});
