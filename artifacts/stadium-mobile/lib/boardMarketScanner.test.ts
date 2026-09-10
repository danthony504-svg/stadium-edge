import test from "node:test";
import assert from "node:assert/strict";
import { augmentEvalLinesWithPostedOdds } from "./postedGameLineMerge.ts";
import { FULL_BOARD_MARKET_FAMILIES } from "./fullBoardMarketCopy.ts";
import {
  buildScanResult,
  reachBoardScanEligible,
  shouldUseFullBoardScan,
} from "./boardMarketScanner.ts";
import {
  createCoachBoardScanManifestRecorder,
} from "./coachBoardScanManifest.ts";
import { safeCoachManifestInstrument } from "./coachFootballPropFunnel.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";
import type { ParsedPick } from "../components/PickCard.tsx";

test("FULL_BOARD_MARKET_FAMILIES lists every period and combo market", () => {
  assert.match(FULL_BOARD_MARKET_FAMILIES, /live markets/i);
  assert.match(FULL_BOARD_MARKET_FAMILIES, /race-to/i);
  assert.match(FULL_BOARD_MARKET_FAMILIES, /second half/i);
  assert.match(FULL_BOARD_MARKET_FAMILIES, /second quarter/i);
  assert.match(FULL_BOARD_MARKET_FAMILIES, /third quarter/i);
  assert.match(FULL_BOARD_MARKET_FAMILIES, /second period/i);
  assert.match(FULL_BOARD_MARKET_FAMILIES, /third period/i);
  assert.match(FULL_BOARD_MARKET_FAMILIES, /combo props/i);
});

test("augmentEvalLinesWithPostedOdds merges posted game lines missing from eval ladder", () => {
  const evalLines = new Map([
    [
      "Lakers @ Suns",
      [{ sport: "nba", game: "Lakers @ Suns", market: "Spread", pick: "Lakers +3.5", odds: -110 }],
    ],
  ]);
  const realOdds = [
    { sport: "nba", game: "Lakers @ Suns", market: "2H Spread", pick: "Lakers +1.5", odds: -105 },
    { sport: "nba", game: "Lakers @ Suns", market: "Points", pick: "LeBron James Over 24.5", odds: -115 },
  ];
  const merged = augmentEvalLinesWithPostedOdds(evalLines, realOdds);
  const lines = merged.get("Lakers @ Suns") ?? [];
  assert.equal(lines.length, 2);
  assert.ok(lines.some((e) => e.market === "2H Spread"));
  assert.ok(!lines.some((e) => e.market === "Points"));
});


test("reachBoardScanEligible requires 3+ legs and no locks", () => {
  assert.equal(reachBoardScanEligible({ requestedLegs: 15 }), true);
  assert.equal(reachBoardScanEligible({ requestedLegs: 9 }), true);
  assert.equal(reachBoardScanEligible({ requestedLegs: 5 }), true);
  assert.equal(reachBoardScanEligible({ requestedLegs: 2 }), false);
  assert.equal(reachBoardScanEligible({ requestedLegs: 15, propsOnly: true }), false);
  assert.equal(shouldUseFullBoardScan(15, { requestedLegs: 15 }), true);
});

const mainScore = {
  composite: 8,
  grade: "B+",
  confidencePct: 58,
  edgePct: 4,
  simHit: 0.56,
  simAligned: true,
  highRiskValuePlay: false,
  recommends: true,
  factors: [],
  rubric: { composite: 8, grade: "B+", confidencePct: 58, edgePct: 4, scores: {} as never },
};

function scoredLeg(
  pick: Partial<ParsedPick> & Pick<ParsedPick, "game" | "market" | "pick" | "odds">,
  rankScore: number,
): BoardScoredLeg {
  const full: ParsedPick = {
    isProp: false,
    sport: "nfl",
    ...pick,
    finalAiScore: pick.finalAiScore ?? (mainScore as ParsedPick["finalAiScore"]),
  };
  return {
    pick: full,
    evPct: 2,
    edgePct: 3,
    confidencePct: 55,
    impliedProbPct: 50,
    lineShoppingScore: 1,
    grade: "B",
    simHit: 0.55,
    composite: 7,
    rankScore,
  };
}

function pickFp(p: ParsedPick): string {
  return `${p.sport}|${p.game}|${p.market}|${p.pick}|${p.odds}`;
}

test("safeCoachManifestInstrument swallows throws without rethrowing", () => {
  let hit = false;
  assert.doesNotThrow(() => {
    safeCoachManifestInstrument("unit-throw", () => {
      hit = true;
      throw new Error("forced instrument failure");
    });
  });
  assert.equal(hit, true);
});

test("instrumentation throw does not change Coach scan picks or delivery counts", () => {
  // buildScanResult is synchronous — fail-safe wraps must not introduce awaits.
  assert.equal(buildScanResult.constructor.name, "Function");
  assert.notEqual(buildScanResult.constructor.name, "AsyncFunction");

  const scored: BoardScoredLeg[] = [
    scoredLeg({ game: "KC @ BUF", market: "Spread", pick: "BUF -2.5", odds: -110 }, 100),
    scoredLeg({ game: "DAL @ PHI", market: "Total", pick: "Over 47.5", odds: -105 }, 95),
    scoredLeg(
      {
        game: "SF @ SEA",
        market: "Pass Yds",
        pick: "Purdy Over 249.5",
        odds: -110,
        isProp: true,
        player: "Purdy",
        propLine: 249.5,
        propSide: "Over",
        propMarketKey: "player_pass_yds",
        sport: "nfl",
      },
      99,
    ),
    scoredLeg(
      {
        game: "ALA @ UGA",
        market: "Rush Yds",
        pick: "Back Over 85.5",
        odds: -115,
        isProp: true,
        player: "Back",
        propLine: 85.5,
        propSide: "Over",
        propMarketKey: "player_rush_yds",
        sport: "ncaaf",
      },
      98,
    ),
  ];
  const target = 3;
  const seed = "instrument-fail-safe";
  const scanOptsBase = {
    target,
    evalLinesByGame: new Map(),
    gameSimulations: new Map(),
    totalScanned: 400,
    boardExhausted: true as const,
    varietySeed: seed,
  };

  const controlRecorder = createCoachBoardScanManifestRecorder(target);
  const control = buildScanResult(scored, {
    ...scanOptsBase,
    manifestRecorder: controlRecorder,
  });

  const throwingRecorder = createCoachBoardScanManifestRecorder(target);
  throwingRecorder.recordFootballPropDeliveryFunnel = () => {
    throw new Error("forced football delivery funnel failure");
  };
  throwingRecorder.recordPropSimBatch = () => {
    throw new Error("forced prop sim batch instrument failure");
  };

  const experimental = buildScanResult(scored, {
    ...scanOptsBase,
    manifestRecorder: throwingRecorder,
  });

  assert.deepEqual(experimental.picks.map(pickFp), control.picks.map(pickFp));
  assert.equal(experimental.picks.length, control.picks.length);
  assert.equal(experimental.requestedLegs, control.requestedLegs);
  assert.equal(experimental.requestedLegs, target);
  assert.equal(experimental.scanComplete, control.scanComplete);
  assert.equal(experimental.manifest?.deliveredLegs, control.manifest?.deliveredLegs);
  assert.equal(experimental.manifest?.requestedLegs, control.manifest?.requestedLegs);
  assert.equal(experimental.totalQualified, control.totalQualified);
});
