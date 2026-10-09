import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalizeCoachSport,
  isGameLineSideMarket,
  isP0UnvalidatedNcaafGameLineMarket,
  isP0UnvalidatedSimTotalMarket,
  p0UnvalidatedNcaafGameLineDecision,
  p0UnvalidatedSimDecision,
  p0UnvalidatedSimTotalDecision,
  P0_UNVALIDATED_NCAAF_GAME_LINE_REASON,
  P0_UNVALIDATED_TOTAL_REASON,
  P0_UNVALIDATED_UNKNOWN_SPORT_GAME_LINE_REASON,
  resolveCoachPickSport,
  wouldStackSameTeamTeamTotals,
} from "./coachP0UnvalidatedTotals.ts";
import {
  assessSimMarketIntegrity,
  pickHasSimGrade,
  sanitizeSimHitForGrade,
} from "./simMarketSupport.ts";
import { selectCorrelationAwareBoardLegs } from "./parlayCorrelationScore.ts";
import { explainBoardLegQualification } from "./boardLegQualification.ts";
import {
  enforceMlLeanOnPicks,
  isLeanQualifiedSubstitute,
  passesLeanTicketConstraints,
} from "./mlLeanEnforcement.ts";
import { scoredLegFromQualifiedCandidate } from "./postLeanFinalFill.ts";
import {
  boardLegPoolRole,
  topUpTicketFromQualifiedScored,
} from "./ticketStaging.ts";
import type { ParsedPick } from "../components/PickCard.tsx";

test("P0 blocks NFL/NCAAF/NHL team totals (any period)", () => {
  for (const sport of ["nfl", "ncaaf", "nhl"] as const) {
    for (const market of ["Team Total", "1H Team Total", "2H Alt Team Total"]) {
      assert.equal(
        isP0UnvalidatedSimTotalMarket({ market, sport }),
        true,
        `${sport} ${market}`,
      );
      assert.equal(
        p0UnvalidatedSimTotalDecision({ market, sport })?.reason,
        P0_UNVALIDATED_TOTAL_REASON,
      );
    }
  }
});

test("P0 blocks NFL/NCAAF/NHL period game totals and FG game totals", () => {
  assert.equal(isP0UnvalidatedSimTotalMarket({ market: "Total", sport: "nfl" }), true);
  assert.equal(isP0UnvalidatedSimTotalMarket({ market: "Alt Total", sport: "ncaaf" }), true);
  assert.equal(isP0UnvalidatedSimTotalMarket({ market: "1H Total", sport: "nfl" }), true);
  assert.equal(isP0UnvalidatedSimTotalMarket({ market: "2H Alt Total", sport: "ncaaf" }), true);
  assert.equal(isP0UnvalidatedSimTotalMarket({ market: "Q1 Total", sport: "nfl" }), true);
  // NHL FG totals settle from the same broken nhl-shift scores — fail closed.
  assert.equal(isP0UnvalidatedSimTotalMarket({ market: "Total", sport: "nhl" }), true);
  assert.equal(isP0UnvalidatedSimTotalMarket({ market: "Alt Total", sport: "nhl" }), true);
  assert.equal(isP0UnvalidatedSimTotalMarket({ market: "1H Total", sport: "nhl" }), true);
  assert.equal(isP0UnvalidatedSimTotalMarket({ market: "P1 Total", sport: "nhl" }), true);
});

test("assessSimMarketIntegrity fail-closes NHL FG total from nhl-shift", () => {
  const ctx = {
    market: "Total",
    sport: "nhl",
    period: "fg",
    periodUsed: "fg",
    line: 5.5,
    odds: -110,
    simulationStatKey: "fg:game_total:over",
    expectedStatKey: "fg:game_total:over",
    simulatedMean: 4.2,
    simulatedStdev: 1.8,
  };
  const d = assessSimMarketIntegrity(0.72, ctx);
  assert.equal(d.accept, false);
  assert.equal(d.reason, P0_UNVALIDATED_TOTAL_REASON);
  assert.equal(sanitizeSimHitForGrade(0.72, ctx), null);
});

test("P0 does not block props, NFL spreads/ML, or NBA totals", () => {
  assert.equal(
    isP0UnvalidatedSimTotalMarket({
      market: "Passing Yards",
      sport: "nfl",
      isProp: true,
    }),
    false,
  );
  assert.equal(isP0UnvalidatedSimTotalMarket({ market: "Spread", sport: "nfl" }), false);
  assert.equal(isP0UnvalidatedSimTotalMarket({ market: "Moneyline", sport: "nfl" }), false);
  assert.equal(isP0UnvalidatedSimTotalMarket({ market: "Team Total", sport: "nba" }), false);
  assert.equal(isP0UnvalidatedSimTotalMarket({ market: "Total", sport: "nba" }), false);
  assert.equal(isP0UnvalidatedSimTotalMarket({ market: "1H Total", sport: "mlb" }), false);
  // NCAAF props stay open (game-line gate is separate).
  assert.equal(
    isP0UnvalidatedNcaafGameLineMarket({
      market: "Passing Yards",
      sport: "ncaaf",
      isProp: true,
    }),
    false,
  );
});

test("P0 fail-closes every NCAAF spread / alt / ML / period-side market", () => {
  const blocked = [
    "Spread",
    "Alt Spread",
    "Moneyline",
    "1H Spread",
    "2H Spread",
    "Q1 Spread",
    "Q2 Spread",
    "Q3 Spread",
    "Q4 Spread",
    "1H Moneyline",
    "2H Moneyline",
    "Q1 Moneyline",
    "spreads",
    "spreads_q2",
    "spreads_h1",
    "h2h",
    "h2h_h1",
    "alternate_spreads",
  ];
  for (const market of blocked) {
    assert.equal(
      isP0UnvalidatedNcaafGameLineMarket({ market, sport: "ncaaf" }),
      true,
      market,
    );
    assert.equal(
      p0UnvalidatedNcaafGameLineDecision({ market, sport: "ncaaf" })?.reason,
      P0_UNVALIDATED_NCAAF_GAME_LINE_REASON,
      market,
    );
    assert.equal(
      pickHasSimGrade({ market, sport: "ncaaf" }, 0.74),
      false,
      `pickHasSimGrade ${market}`,
    );
    assert.equal(
      p0UnvalidatedSimDecision({ market, sport: "ncaaf" })?.reason,
      P0_UNVALIDATED_NCAAF_GAME_LINE_REASON,
      `combined ${market}`,
    );
  }
  // NFL game lines remain open.
  assert.equal(isP0UnvalidatedNcaafGameLineMarket({ market: "Spread", sport: "nfl" }), false);
  assert.equal(isP0UnvalidatedNcaafGameLineMarket({ market: "Moneyline", sport: "nfl" }), false);
  // NCAAF totals stay on the totals P0 reason (not game-line reason).
  assert.equal(
    p0UnvalidatedSimDecision({ market: "Total", sport: "ncaaf" })?.reason,
    P0_UNVALIDATED_TOTAL_REASON,
  );
});

test("assessSimMarketIntegrity / pickHasSimGrade reject NCAAF Sac-style extreme game lines", () => {
  const spreadCtx = {
    market: "Spread",
    sport: "ncaaf",
    period: "fg" as const,
    periodUsed: "fg" as const,
    line: 7.5,
    odds: 100,
    simulationStatKey: "fg:spread:away",
    expectedStatKey: "fg:spread",
  };
  const d = assessSimMarketIntegrity(0.741, spreadCtx);
  assert.equal(d.accept, false);
  assert.equal(d.reason, P0_UNVALIDATED_NCAAF_GAME_LINE_REASON);
  assert.equal(sanitizeSimHitForGrade(0.741, spreadCtx), null);
  assert.equal(pickHasSimGrade({ market: "Spread", sport: "ncaaf" }, 0.741), false);
  assert.equal(pickHasSimGrade({ market: "Moneyline", sport: "ncaaf" }, 0.519), false);

  // Missing injury context does not reopen the gate.
  assert.equal(
    p0UnvalidatedSimDecision({ market: "Spread", sport: "ncaaf" })?.reason,
    P0_UNVALIDATED_NCAAF_GAME_LINE_REASON,
  );

  // NCAAF props and NFL spreads still grade.
  assert.equal(
    pickHasSimGrade({ market: "Rushing Yards", sport: "ncaaf", isProp: true }, 0.58),
    true,
  );
  assert.equal(pickHasSimGrade({ market: "Spread", sport: "nfl" }, 0.61), true);
});

test("NCAAF game-line shortfall: board qualification fails closed without inventing grade", () => {
  const q = explainBoardLegQualification(
    {
      game: "Sacramento State Hornets @ Bowling Green Falcons",
      market: "Spread",
      pick: "Sacramento State Hornets +7.5",
      odds: 100,
      sport: "ncaaf",
      isProp: false,
    },
    {
      composite: 9,
      grade: "A",
      confidencePct: 88,
      edgePct: 24.1,
      simHit: 0.741,
      simAligned: true,
      highRiskValuePlay: false,
      recommends: true,
      factors: [],
      rubric: {
        composite: 9,
        grade: "A",
        confidencePct: 88,
        edgePct: 24.1,
        scores: {} as never,
      },
    },
  );
  assert.equal(q.qualifies, false);
  assert.equal(q.gate, "no_sim_grade");
});

test("assessSimMarketIntegrity / sanitize fail closed on Bucs-style NFL TT", () => {
  const ctx = {
    market: "Team Total",
    sport: "nfl",
    period: "fg",
    periodUsed: "fg",
    line: 18.5,
    odds: -130,
    simulationStatKey: "fg:team_total:away:over",
    expectedStatKey: "fg:team_total:away:over",
    simulatedMean: 42.44,
    simulatedMedian: 43,
    simulatedStdev: 9.89,
  };
  const d = assessSimMarketIntegrity(0.994, ctx);
  assert.equal(d.accept, false);
  assert.equal(d.reason, P0_UNVALIDATED_TOTAL_REASON);
  assert.equal(sanitizeSimHitForGrade(0.994, ctx), null);
  assert.equal(pickHasSimGrade({ market: "Team Total", sport: "nfl" }, 0.994), false);
});

test("assessSimMarketIntegrity still grades NFL props and spreads", () => {
  const prop = assessSimMarketIntegrity(0.992, {
    market: "Passing Yards",
    sport: "nfl",
    isProp: true,
    period: "fg",
    periodUsed: "fg",
    line: 150.5,
    simulationStatKey: "player_prop",
    expectedStatKey: "player_prop",
    simulatedMean: 275,
    simulatedStdev: 42,
  });
  assert.equal(prop.accept, true);

  const spread = assessSimMarketIntegrity(0.61, {
    market: "Spread",
    sport: "nfl",
    period: "fg",
    periodUsed: "fg",
    line: -3.5,
    simulationStatKey: "fg:spread:home",
    expectedStatKey: "fg:spread",
  });
  assert.equal(spread.accept, true);
  assert.equal(pickHasSimGrade({ market: "Spread", sport: "nfl" }, 0.61), true);
});

test("wouldStackSameTeamTeamTotals blocks FG + 1H + 2H same team (all sports)", () => {
  const g = "Tampa Bay Buccaneers @ Dallas Cowboys";
  const fg = {
    game: g,
    market: "Team Total",
    pick: "Buccaneers Over 18.5",
  };
  const h1 = {
    game: g,
    market: "1H Team Total",
    pick: "Buccaneers Over 9.5",
  };
  const h2 = {
    game: g,
    market: "2H Alt Team Total",
    pick: "Buccaneers Over 9.5",
  };
  const other = {
    game: g,
    market: "Team Total",
    pick: "Cowboys Over 28.5",
  };
  const spread = {
    game: g,
    market: "Spread",
    pick: "Cowboys -8.5",
  };

  assert.equal(wouldStackSameTeamTeamTotals(h1, [fg]), true);
  assert.equal(wouldStackSameTeamTeamTotals(h2, [fg, h1]), true);
  assert.equal(wouldStackSameTeamTeamTotals(other, [fg]), false);
  assert.equal(wouldStackSameTeamTeamTotals(spread, [fg]), false);
  assert.equal(wouldStackSameTeamTeamTotals(fg, [spread]), false);
});

test("selectCorrelationAwareBoardLegs seats at most one same-team team total", () => {
  const g = "Tampa Bay Buccaneers @ Dallas Cowboys";
  const ranked = [
    {
      pick: {
        game: g,
        market: "Team Total",
        pick: "Buccaneers Over 18.5",
        odds: -130,
        sport: "nba",
      },
      rankScore: 100,
    },
    {
      pick: {
        game: g,
        market: "1H Team Total",
        pick: "Buccaneers Over 9.5",
        odds: -110,
        sport: "nba",
      },
      rankScore: 99,
    },
    {
      pick: {
        game: g,
        market: "2H Alt Team Total",
        pick: "Buccaneers Over 9.5",
        odds: -103,
        sport: "nba",
      },
      rankScore: 98,
    },
    {
      pick: {
        game: "Other @ Game",
        market: "Spread",
        pick: "Other +3.5",
        odds: -110,
        sport: "nba",
      },
      rankScore: 50,
    },
  ];
  const out = selectCorrelationAwareBoardLegs(ranked, 3);
  const bucsTt = out.filter(
    (p) => /team total/i.test(p.market) && /buccaneers/i.test(p.pick),
  );
  assert.equal(bucsTt.length, 1, "only one Bucs team-total may seat");
  assert.ok(out.some((p) => p.market === "Spread"), "unrelated spread still seats");
});

const scoredA = {
  composite: 9,
  grade: "A",
  confidencePct: 88,
  edgePct: 12,
  simHit: 0.62,
  simAligned: true,
  highRiskValuePlay: false,
  recommends: true,
  factors: [],
  rubric: { composite: 9, grade: "A", confidencePct: 88, edgePct: 12, scores: {} as never },
};

test("canonicalizeCoachSport maps cfb aliases to ncaaf; leaves nfl alone", () => {
  assert.equal(canonicalizeCoachSport("cfb"), "ncaaf");
  assert.equal(canonicalizeCoachSport("CFB"), "ncaaf");
  assert.equal(canonicalizeCoachSport("college-football"), "ncaaf");
  assert.equal(canonicalizeCoachSport("ncaaf"), "ncaaf");
  assert.equal(canonicalizeCoachSport("nfl"), "nfl");
  assert.equal(canonicalizeCoachSport("nba"), "nba");
  assert.equal(canonicalizeCoachSport(""), "");
  assert.equal(canonicalizeCoachSport(null), "");
});

test("P0 bypass seal: sport=ncaaf / cfb / missing / isProp=true on spread", () => {
  // ncaaf
  assert.equal(
    p0UnvalidatedSimDecision({ market: "Spread", sport: "ncaaf" })?.reason,
    P0_UNVALIDATED_NCAAF_GAME_LINE_REASON,
  );
  assert.equal(pickHasSimGrade({ market: "Spread", sport: "ncaaf" }, 0.62), false);

  // cfb alias
  assert.equal(resolveCoachPickSport({ sport: "cfb" }), "ncaaf");
  assert.equal(
    p0UnvalidatedSimDecision({ market: "Moneyline", sport: "cfb" })?.reason,
    P0_UNVALIDATED_NCAAF_GAME_LINE_REASON,
  );
  assert.equal(pickHasSimGrade({ market: "Alt Spread", sport: "cfb" }, 0.7), false);
  assert.equal(boardLegPoolRole({
    game: "A @ B",
    market: "Spread",
    pick: "A +3",
    odds: -110,
    sport: "cfb",
    isProp: false,
    finalAiScore: scoredA,
  }, scoredA), null);

  // missing sport — fail closed for game lines; do not invent NCAAF from names
  assert.equal(resolveCoachPickSport({}), "");
  assert.equal(
    p0UnvalidatedNcaafGameLineDecision({ market: "Spread" })?.reason,
    P0_UNVALIDATED_UNKNOWN_SPORT_GAME_LINE_REASON,
  );
  assert.equal(pickHasSimGrade({ market: "Spread" }, 0.62), false);
  assert.equal(pickHasSimGrade({ market: "Q2 Spread" }, 0.62), false);
  // Trusted provider metadata can resolve missing pick.sport
  assert.equal(
    resolveCoachPickSport({ providerSport: "ncaaf" }),
    "ncaaf",
  );
  assert.equal(
    p0UnvalidatedSimDecision({ market: "Spread", providerSport: "cfb" })?.reason,
    P0_UNVALIDATED_NCAAF_GAME_LINE_REASON,
  );
  // Trusted NFL metadata must NOT be classified as NCAAF
  assert.equal(
    isP0UnvalidatedNcaafGameLineMarket({ market: "Spread", providerSport: "nfl" }),
    false,
  );
  assert.equal(pickHasSimGrade({ market: "Spread", providerSport: "nfl" }, 0.61), true);

  // isProp=true must not bypass game-line market identity
  assert.equal(isGameLineSideMarket("Spread", true), true);
  assert.equal(
    isP0UnvalidatedNcaafGameLineMarket({
      market: "Spread",
      sport: "ncaaf",
      isProp: true,
    }),
    true,
  );
  assert.equal(
    pickHasSimGrade({ market: "Spread", sport: "ncaaf", isProp: true }, 0.74),
    false,
  );
  assert.equal(
    isLeanQualifiedSubstitute({
      game: "Iowa @ Wash",
      market: "Spread",
      pick: "Iowa +3",
      odds: -105,
      sport: "ncaaf",
      isProp: true,
      finalAiScore: scoredA,
    } as ParsedPick),
    false,
  );
});

test("P0 bypass seal: unknown market identity is not forced into NCAAF game-line P0", () => {
  // Unsupported / unknown markets fail mapping — not the NCAAF game-line reason.
  assert.equal(
    isP0UnvalidatedNcaafGameLineMarket({ market: "Mystery Futures", sport: "ncaaf" }),
    false,
  );
  assert.equal(pickHasSimGrade({ market: "Mystery Futures", sport: "ncaaf" }, 0.7), false);
  assert.equal(
    p0UnvalidatedSimDecision({ market: "Mystery Futures", sport: "ncaaf" }),
    null,
  );
});

test("P0 bypass seal: verified NFL game lines and NCAAF player props stay eligible", () => {
  assert.equal(pickHasSimGrade({ market: "Spread", sport: "nfl" }, 0.61), true);
  assert.equal(pickHasSimGrade({ market: "Moneyline", sport: "nfl" }, 0.55), true);
  assert.equal(
    pickHasSimGrade({
      market: "Rushing Yards",
      sport: "ncaaf",
      isProp: true,
      propMarketKey: "player_rush_yds",
    }, 0.58),
    true,
  );
  assert.equal(
    p0UnvalidatedSimDecision({
      market: "Passing Yards",
      sport: "ncaaf",
      isProp: true,
      propMarketKey: "player_pass_yds",
    }),
    null,
  );
  // Team-total P0 still intact for NFL/NCAAF
  assert.equal(
    p0UnvalidatedSimDecision({ market: "Team Total", sport: "nfl" })?.reason,
    P0_UNVALIDATED_TOTAL_REASON,
  );
  assert.equal(
    p0UnvalidatedSimDecision({ market: "Team Total", sport: "ncaaf", isProp: true })?.reason,
    P0_UNVALIDATED_TOTAL_REASON,
  );
});

test("P0 bypass seal: final-ticket lean / top-up / post-lean reject sealed vectors", () => {
  const vectors: ParsedPick[] = [
    {
      game: "Iowa Hawkeyes @ Washington Huskies",
      market: "Spread",
      pick: "Iowa Hawkeyes +3",
      odds: -105,
      sport: "ncaaf",
      isProp: false,
      finalAiScore: scoredA,
    },
    {
      game: "Iowa Hawkeyes @ Washington Huskies",
      market: "Spread",
      pick: "Iowa Hawkeyes +3",
      odds: -105,
      sport: "cfb",
      isProp: false,
      finalAiScore: scoredA,
    },
    {
      game: "Iowa Hawkeyes @ Washington Huskies",
      market: "Moneyline",
      pick: "Iowa Hawkeyes ML",
      odds: 130,
      // missing sport
      isProp: false,
      finalAiScore: scoredA,
    },
    {
      game: "Iowa Hawkeyes @ Washington Huskies",
      market: "Alt Spread",
      pick: "Iowa Hawkeyes +7.5",
      odds: -110,
      sport: "ncaaf",
      isProp: true, // mis-tagged
      finalAiScore: scoredA,
    },
  ];

  for (const pick of vectors) {
    assert.ok(p0UnvalidatedSimDecision(pick), `${pick.sport}|${pick.market}|isProp=${pick.isProp}`);
    assert.equal(pickHasSimGrade(pick, pick.finalAiScore!.simHit), false);
    assert.equal(isLeanQualifiedSubstitute(pick), false);
    assert.equal(passesLeanTicketConstraints(pick, []), false);
    assert.equal(scoredLegFromQualifiedCandidate(pick), null);
  }

  const topped = topUpTicketFromQualifiedScored(
    vectors,
    vectors.map((pick, i) => ({
      pick,
      evPct: 10,
      edgePct: 10,
      confidencePct: 80,
      impliedProbPct: 50,
      lineShoppingScore: 1,
      grade: "A",
      simHit: 0.62,
      composite: 9,
      rankScore: 100 - i,
    })),
    8,
  );
  assert.equal(topped.length, 0, "final top-up must shortfall all bypass vectors");

  const lean = enforceMlLeanOnPicks(vectors, {
    matchupHistory: {
      "Iowa Hawkeyes @ Washington Huskies": {
        mlLean: { side: "Washington Huskies", edge: 5, reasons: [] },
      },
    } as never,
    qualifiedCandidates: vectors,
  });
  assert.equal(lean.picks.length, 0);
  assert.ok(lean.dropped >= vectors.length);
});
