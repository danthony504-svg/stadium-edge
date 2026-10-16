/**
 * Regression: preview 01a143a5 / tip 528a8359 delivered Penguins +2.5 @ −215
 * on Longshots. Handicap (+2.5) is not American odds (−215). Style must gate
 * final delivered odds after every post-staging substitution.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  filterPicksForTicketStyle,
  filterScoredLegsForTicketStyle,
  legAllowedForTicketStyle,
  legQualifiesForLongshotStyle,
  LONGSHOT_MIN_AMERICAN_ODDS,
} from "./coachTicketQualityTiers.ts";
import {
  enforceMultiSportFloorOnTicket,
  injectPrioritySportsIntoTicket,
} from "./coachPrioritySports.ts";
import { enforceMlLeanOnPicks } from "./mlLeanEnforcement.ts";
import { topUpAfterMlLean } from "./postLeanFinalFill.ts";
import {
  boardLegPoolRole,
  topUpTicketFromQualifiedScored,
  type BoardScoredLeg,
} from "./ticketStaging.ts";
import type { ParsedPick } from "../components/PickCard.tsx";

/** High enough simHit that −215 still clears qualifiesAltPick / AI recommend. */
const mainScore = {
  composite: 8,
  grade: "B+" as const,
  confidencePct: 60,
  edgePct: 5,
  simHit: 0.72,
  simAligned: true,
  highRiskValuePlay: false,
  recommends: true,
  factors: [],
  rubric: {
    composite: 8,
    grade: "B+",
    confidencePct: 60,
    edgePct: 5,
    scores: {} as never,
  },
};

const altScore = {
  composite: 8,
  grade: "B+" as const,
  confidencePct: 60,
  edgePct: 5,
  simHit: 0.72,
  simAligned: true,
  highRiskValuePlay: false,
  recommends: false,
  factors: [],
  rubric: {
    composite: 8,
    grade: "B+",
    confidencePct: 60,
    edgePct: 5,
    scores: {} as never,
  },
};

function nhlPenguinsAlt(odds: number): ParsedPick {
  return {
    game: "Penguins @ Capitals",
    market: "Alt Spread",
    pick: "Penguins +2.5",
    odds,
    sport: "nhl",
    isProp: false,
    ticketRole: "alt",
    qualificationStatus: "qualified",
    finalAiScore: altScore,
  } as ParsedPick;
}

function scoredFromPick(pick: ParsedPick, rank = 70): BoardScoredLeg {
  return {
    pick,
    evPct: pick.finalAiScore?.edgePct ?? null,
    edgePct: pick.finalAiScore?.edgePct ?? null,
    confidencePct: pick.finalAiScore?.confidencePct ?? null,
    impliedProbPct: 50,
    lineShoppingScore: 1,
    grade: pick.finalAiScore?.grade ?? null,
    simHit: pick.finalAiScore?.simHit ?? null,
    composite: pick.finalAiScore?.composite ?? null,
    rankScore: rank,
  };
}

function plusMoneyDog(sport: string, label: string, odds: number): ParsedPick {
  return {
    game: `${label} @ Opp`,
    market: "Moneyline",
    pick: `${label} ML`,
    odds,
    sport,
    isProp: false,
    ticketRole: "main",
    qualificationStatus: "qualified",
    finalAiScore: mainScore,
  } as ParsedPick;
}

test("handicap +2.5 is not American odds — floor reads pick.odds only", () => {
  const chalk = nhlPenguinsAlt(-215);
  assert.equal(chalk.pick, "Penguins +2.5");
  assert.equal(chalk.odds, -215);
  assert.ok(LONGSHOT_MIN_AMERICAN_ODDS >= 100);
  assert.equal(legQualifiesForLongshotStyle(chalk), false);
  assert.equal(legAllowedForTicketStyle(chalk, "longshot"), false);
  // Same handicap at plus-money clears the floor.
  assert.equal(legAllowedForTicketStyle(nhlPenguinsAlt(150), "longshot"), true);
});

test("NHL ALT Penguins +2.5 @ −215 cannot top-up a longshot ticket", () => {
  const short = [
    plusMoneyDog("mlb", "Underdog A", 180),
    plusMoneyDog("nba", "Underdog B", 220),
  ];
  const chalk = nhlPenguinsAlt(-215);
  // Shared qualification still seats this ALT — style floor is the blocker.
  assert.equal(boardLegPoolRole(chalk, chalk.finalAiScore), "alt");
  assert.equal(legAllowedForTicketStyle(chalk, "longshot"), false);
  const topped = topUpTicketFromQualifiedScored(
    short,
    [scoredFromPick(chalk, 99), scoredFromPick(plusMoneyDog("nhl", "Pens Dog", 310), 40)],
    4,
    "penguins-alt-regression",
    null,
    { ticketStyle: "longshot" },
  );
  assert.equal(
    topped.some((p) => p.pick === "Penguins +2.5" && p.odds === -215),
    false,
  );
  assert.ok(topped.every((p) => (p.odds ?? 0) >= 100));
  // Without ticketStyle, the same qualified chalk leftover still top-ups —
  // proving preview 01a143a5 bypass: post-staging fill ignored style.
  const ungated = topUpTicketFromQualifiedScored(
    short,
    [scoredFromPick(chalk, 99)],
    3,
    "penguins-alt-ungated",
  );
  assert.ok(ungated.some((p) => p.pick === "Penguins +2.5" && p.odds === -215));
});

test("multi-sport inject / floor cannot seat NHL −215 ALT under longshot", () => {
  const mlbHeavy = [
    plusMoneyDog("mlb", "Dog1", 140),
    plusMoneyDog("mlb", "Dog2", 155),
    plusMoneyDog("mlb", "Dog3", 165),
    plusMoneyDog("mlb", "Dog4", 175),
    plusMoneyDog("mlb", "Dog5", 185),
    plusMoneyDog("mlb", "Dog6", 195),
  ];
  const chalk = nhlPenguinsAlt(-215);
  const plusNhl = plusMoneyDog("nhl", "Jackets", 240);
  const pool = [scoredFromPick(chalk, 99), scoredFromPick(plusNhl, 50)];
  const injected = injectPrioritySportsIntoTicket(
    mlbHeavy,
    pool,
    6,
    ["nhl"],
    false,
    "longshot",
  );
  assert.equal(
    injected.some((p) => p.pick === "Penguins +2.5" && p.odds === -215),
    false,
  );
  const floored = enforceMultiSportFloorOnTicket(
    mlbHeavy,
    pool,
    6,
    ["nhl"],
    false,
    "longshot",
  );
  assert.equal(
    floored.some((p) => p.pick === "Penguins +2.5" && p.odds === -215),
    false,
  );
});

test("post-lean fill and mlLean swap refuse −215 under longshot", () => {
  const chalk = nhlPenguinsAlt(-215);
  const dog = plusMoneyDog("nhl", "Caps", 200);
  const short = [plusMoneyDog("mlb", "A", 130), plusMoneyDog("nba", "B", 160)];
  const filled = topUpAfterMlLean({
    picks: short,
    qualifiedCandidates: [chalk, dog],
    target: 4,
    ticketStyle: "longshot",
  });
  assert.equal(filled.some((p) => p.odds === -215), false);
  assert.ok(filled.every((p) => (p.odds ?? 0) >= 100));

  const leanSwap = enforceMlLeanOnPicks([plusMoneyDog("nhl", "Capitals", 110)], {
    matchupHistory: {
      "Penguins @ Capitals": {
        mlLean: { side: "Penguins", confidence: 0.6 },
      } as never,
    },
    qualifiedCandidates: [chalk],
    requestedLegs: 4,
    ticketStyle: "longshot",
  });
  assert.equal(
    leanSwap.picks.some((p) => p.pick === "Penguins +2.5" && p.odds === -215),
    false,
  );
});

test("terminal filterPicksForTicketStyle strips delivered minus-money across sports", () => {
  const delivered = [
    nhlPenguinsAlt(-215),
    { ...plusMoneyDog("mlb", "Guardians", -575), pick: "Guardians +3.5", market: "Alt Spread" },
    plusMoneyDog("nfl", "Dog", 250),
    { ...plusMoneyDog("nba", "Chalk", -110), pick: "Lakers -3.5", market: "Spread" },
    nhlPenguinsAlt(175),
  ];
  const cleared = filterPicksForTicketStyle(delivered, "longshot");
  assert.deepEqual(
    cleared.map((p) => `${p.pick}|${p.odds}`),
    ["Dog ML|250", "Penguins +2.5|175"],
  );
  const scored = filterScoredLegsForTicketStyle(
    delivered.map((p) => scoredFromPick(p)),
    "longshot",
  );
  assert.equal(scored.length, 2);
  assert.ok(scored.every((leg) => (leg.pick.odds ?? 0) >= 100));
});

test("balanced style still allows minus-money ALT (gates unchanged for non-longshot)", () => {
  const chalk = nhlPenguinsAlt(-215);
  assert.equal(legAllowedForTicketStyle(chalk, "balanced"), true);
  assert.equal(legAllowedForTicketStyle(chalk, "safe"), true);
  const topped = topUpTicketFromQualifiedScored(
    [plusMoneyDog("mlb", "A", -105), plusMoneyDog("nba", "B", -110)],
    [scoredFromPick(chalk, 99)],
    3,
    "balanced-allows-chalk",
    null,
    { ticketStyle: "balanced" },
  );
  assert.ok(topped.some((p) => p.pick === "Penguins +2.5" && p.odds === -215));
});
