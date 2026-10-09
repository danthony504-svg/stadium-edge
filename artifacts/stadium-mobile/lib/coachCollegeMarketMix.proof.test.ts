/**
 * Proof: NCAAF Coach team-market fill behavior under P0 integrity gates.
 *
 * Football totals remain P0-blocked. NCAAF spreads/ML are also fail-closed
 * until nfl-drive is recalibrated (rate-cap / missing matchup inputs). Bare
 * college (gameLinesOnly) therefore shortfalls rather than seating unsupported
 * high-confidence edges. Player props stay eligible when the ask allows them.
 * Correlation / per-game caps are unchanged.
 */
import assert from "node:assert/strict";
import test from "node:test";

import type { ParsedPick } from "../components/PickCard.tsx";
import {
  askAllowsCollegeTeamMarketStacks,
  askAllowsNcaafPlayerProps,
  askRequiresFootballPropMix,
  fillReservedPeriodSlots,
  fillReservedTeamTotalSlots,
} from "./boardScanPropDelivery.ts";
import { parseCoachAskMarketConstraint } from "./coachAskMarketFilter.ts";
import {
  legsPerGameCapForAsk,
  maxLegsPerGame,
  wouldExceedMaxLegsPerGame,
} from "./parlayCorrelationScore.ts";
import {
  collapseSameTeamGameLineSides,
  topUpTicketFromQualifiedScored,
  type BoardScoredLeg,
} from "./ticketStaging.ts";

const mainScore = {
  composite: 8,
  grade: "B+",
  confidencePct: 58,
  edgePct: 5,
  simHit: 0.58,
  simAligned: true,
  highRiskValuePlay: false,
  recommends: true,
  factors: [],
  rubric: { composite: 8, grade: "B+", confidencePct: 58, edgePct: 5, scores: {} as never },
};

function scored(
  partial: Partial<ParsedPick> & Pick<ParsedPick, "game" | "market" | "pick" | "odds">,
  rankScore: number,
): BoardScoredLeg {
  const pick: ParsedPick = {
    isProp: false,
    sport: "ncaaf",
    ...partial,
    finalAiScore: partial.finalAiScore ?? mainScore,
  };
  return {
    pick,
    evPct: 3,
    edgePct: 5,
    confidencePct: 58,
    impliedProbPct: 52,
    lineShoppingScore: 1,
    grade: "B+",
    simHit: 0.56,
    composite: 8,
    rankScore,
  };
}

/** Qualified Saturday board: yards + FG + team totals + 1H/Q + alts + OU both sides. */
function collegeQualifiedBoard(): BoardScoredLeg[] {
  const g1 = "Ohio State Buckeyes @ Iowa Hawkeyes";
  const g2 = "Michigan Wolverines @ Minnesota Golden Gophers";
  const g3 = "Syracuse Orange @ UConn Huskies";
  const g4 = "USC Trojans @ UCLA Bruins";
  const g5 = "Alabama Crimson Tide @ Georgia Bulldogs";
  let r = 100;
  const next = () => (r -= 1);
  return [
    // Player yards (provider-supplied props)
    scored(
      {
        game: g1,
        market: "player_pass_yds",
        pick: "Caleb Downs Over 65.5",
        odds: -115,
        isProp: true,
        player: "Caleb Downs",
        propMarketKey: "player_pass_yds",
      },
      next(),
    ),
    scored(
      {
        game: g2,
        market: "player_rush_yds",
        pick: "Darius Taylor Under 72.5",
        odds: -110,
        isProp: true,
        player: "Darius Taylor",
        propMarketKey: "player_rush_yds",
      },
      next(),
    ),
    scored(
      {
        game: g3,
        market: "player_reception_yds",
        pick: "Skyler Bell Over 48.5",
        odds: -105,
        isProp: true,
        player: "Skyler Bell",
        propMarketKey: "player_reception_yds",
      },
      next(),
    ),
    // Full-game spreads
    scored({ game: g1, market: "Spread", pick: "Iowa Hawkeyes +14.5", odds: -110 }, next()),
    scored({ game: g2, market: "Spread", pick: "Minnesota Golden Gophers +6.5", odds: -110 }, next()),
    scored({ game: g3, market: "Spread", pick: "UConn Huskies +7", odds: -115 }, next()),
    // Full-game totals — both Over and Under
    scored({ game: g4, market: "Total", pick: "Over 54.5", odds: -110 }, next()),
    scored({ game: g5, market: "Total", pick: "Under 49.5", odds: -105 }, next()),
    // Team totals
    scored(
      { game: g1, market: "Team Total", pick: "Iowa Hawkeyes Under 17.5", odds: -115 },
      next(),
    ),
    scored(
      { game: g2, market: "Team Total", pick: "Minnesota Golden Gophers Over 20.5", odds: -110 },
      next(),
    ),
    // First-half + quarter
    scored({ game: g1, market: "1H Spread", pick: "Iowa Hawkeyes +7.5", odds: -110 }, next()),
    scored({ game: g2, market: "Q2 Spread", pick: "Minnesota Golden Gophers +3.5", odds: -110 }, next()),
    scored({ game: g3, market: "Q1 Spread", pick: "UConn Huskies +2.5", odds: -105 }, next()),
    scored({ game: g4, market: "1H Total", pick: "Under 27.5", odds: -110 }, next()),
    // Alternate FG spreads (genuinely supplied)
    scored({ game: g3, market: "Alt Spread", pick: "UConn Huskies +6.5", odds: -101 }, next()),
    scored({ game: g5, market: "Alt Spread", pick: "Alabama Crimson Tide +3", odds: +102 }, next()),
    // Extra FG sides for deep fills
    scored({ game: g4, market: "Spread", pick: "UCLA Bruins +3.5", odds: -110 }, next()),
    scored({ game: g5, market: "Spread", pick: "Alabama Crimson Tide +7.5", odds: -110 }, next()),
  ];
}

function fillCollegeTicket(target: number, legsPerGameCap: number | null = null): ParsedPick[] {
  const ask = `${target} leg college`;
  const constraint = parseCoachAskMarketConstraint(ask);
  assert.equal(constraint.gameLinesOnly, true, "bare college is team markets / GL-only");
  assert.equal(askAllowsNcaafPlayerProps(ask), false);
  assert.equal(askRequiresFootballPropMix(ask), false);
  assert.equal(askAllowsCollegeTeamMarketStacks(ask), true);

  const board = collegeQualifiedBoard().filter((l) => !l.pick.isProp);
  // Start short (FG-heavy) then apply the same seat-reservation + top-up path
  // Coach uses after staging (no player-prop seats on bare college).
  const short = board
    .filter((l) => !/q[1-4]|1h|2h|team total|alt/i.test(l.pick.market ?? ""))
    .slice(0, Math.min(3, target))
    .map((l) => l.pick);

  let picks = fillReservedPeriodSlots(short, board, target, legsPerGameCap);
  picks = fillReservedTeamTotalSlots(picks, board, target, legsPerGameCap);
  picks = topUpTicketFromQualifiedScored(picks, board, target, "proof-college", legsPerGameCap, {
    collapseSameTeamSides: false,
    collegeTeamMarketStacks: true,
  });
  picks = fillReservedPeriodSlots(picks, board, target, legsPerGameCap);
  picks = fillReservedTeamTotalSlots(picks, board, target, legsPerGameCap);
  return picks;
}

function marketKinds(picks: ParsedPick[]) {
  const kinds = new Set<string>();
  for (const p of picks) {
    if (p.isProp) {
      kinds.add("player_yards");
      continue;
    }
    const m = String(p.market ?? "").toLowerCase();
    if (/team total/.test(m)) kinds.add("team_total");
    else if (/alt/.test(m)) kinds.add("alt");
    else if (/q[1-4]|1h|2h/.test(m) && /spread/.test(m)) kinds.add("period_spread");
    else if (/q[1-4]|1h|2h/.test(m) && /total/.test(m)) kinds.add("period_total");
    else if (/spread/.test(m)) kinds.add("fg_spread");
    else if (/total/.test(m)) kinds.add("fg_total");
    else kinds.add(`other:${m}`);
  }
  return kinds;
}

test("proof: bare college routing is team markets + period stacks; explicit props opt in", () => {
  const bare = parseCoachAskMarketConstraint("10 leg college");
  assert.equal(bare.gameLinesOnly, true);
  assert.equal(askRequiresFootballPropMix("10 leg college"), false);
  assert.equal(askAllowsNcaafPlayerProps("10 leg college"), false);

  const collage = parseCoachAskMarketConstraint("8 leg Collage");
  assert.equal(collage.gameLinesOnly, true);
  assert.equal(askAllowsNcaafPlayerProps("8 leg Collage"), false);

  const team = parseCoachAskMarketConstraint("10 leg college team props");
  assert.equal(team.gameLinesOnly, true);
  assert.equal(askAllowsNcaafPlayerProps("10 leg college team props"), false);

  const yards = parseCoachAskMarketConstraint("8 leg college receiving yards");
  assert.equal(yards.gameLinesOnly, false);
  assert.equal(askAllowsNcaafPlayerProps("8 leg college receiving yards"), true);

  const nfl = parseCoachAskMarketConstraint("10 leg nfl");
  assert.equal(nfl.gameLinesOnly, false);
  assert.equal(askRequiresFootballPropMix("10 leg nfl"), true);
  assert.equal(askAllowsCollegeTeamMarketStacks("10 leg nfl"), false);
});

test("proof: bare college shortfalls when NCAAF game lines are P0 fail-closed", () => {
  // Bare college is gameLinesOnly + stacks → college floor ≥4 (caps unchanged).
  const collegeCap = legsPerGameCapForAsk(10, {
    gameLinesOnly: true,
    collegeTeamMarketStacks: true,
  });
  assert.ok((collegeCap ?? 0) >= 4, `expected college stack cap ≥4, got ${collegeCap}`);

  for (const target of [5, 10, 15]) {
    const picks = fillCollegeTicket(target, collegeCap);
    // Spreads/ML/totals all fail closed — shortfall, never invent filler.
    assert.equal(
      picks.length,
      0,
      `${target}-leg: expected empty shortfall (no validated NCAAF game lines), got ${picks.length}`,
    );
    assert.ok(!marketKinds(picks).has("player_yards"), "bare college must not invent props");
  }
});

test("proof: team totals stay P0-blocked; top-up does not seat unvalidated NCAAF sides", () => {
  const board = collegeQualifiedBoard().filter((l) => !l.pick.isProp);
  assert.ok(board.some((l) => /team total/i.test(l.pick.market ?? "")));
  assert.ok(board.some((l) => /^alt /i.test(l.pick.market ?? "") || /alt spread/i.test(l.pick.market ?? "")));
  const short = [
    board.find((l) => l.pick.market === "Spread" && /iowa/i.test(l.pick.pick))!.pick,
    board.find((l) => l.pick.market === "Spread" && /minnesota/i.test(l.pick.pick))!.pick,
  ];
  const topped = topUpTicketFromQualifiedScored(short, board, 8, "proof-tt", 4, {
    collapseSameTeamSides: false,
    collegeTeamMarketStacks: true,
  });
  // Unvalidated NCAAF spreads stripped; team totals remain P0-blocked → shortfall.
  assert.equal(topped.length, 0);
  assert.ok(
    !topped.some((p) => /team total/i.test(p.market ?? "")),
    "P0 team totals must not re-enter via top-up",
  );
});

test("proof: NCAAF player props still stage when ask allows them", () => {
  const board = collegeQualifiedBoard().filter((l) => l.pick.isProp);
  assert.ok(board.length >= 3, "fixture must include provider props");
  const topped = topUpTicketFromQualifiedScored([], board, 5, "proof-props", 2, {
    collapseSameTeamSides: false,
  });
  assert.ok(topped.length >= 3, `expected prop shortfall fill, got ${topped.length}`);
  assert.ok(topped.every((p) => p.isProp), "only player props may seat");
  for (const p of topped) {
    assert.ok(
      board.some(
        (l) =>
          l.pick.game === p.game &&
          l.pick.market === p.market &&
          l.pick.pick === p.pick &&
          l.pick.odds === p.odds,
      ),
      `mutated provider prop: ${p.market} ${p.pick}`,
    );
  }
});

test("proof: same-game FG + Q2 / 1H collapse helper unchanged; college fill stays empty under P0", () => {
  const g = "Ohio State Buckeyes @ Iowa Hawkeyes";
  const stacked = collapseSameTeamGameLineSides([
    {
      game: g,
      market: "Spread",
      pick: "Iowa Hawkeyes +14.5",
      odds: -110,
      isProp: false,
      sport: "ncaaf",
      finalAiScore: mainScore,
    },
    {
      game: g,
      market: "Q2 Spread",
      pick: "Iowa Hawkeyes +7.5",
      odds: -110,
      isProp: false,
      sport: "ncaaf",
      finalAiScore: mainScore,
    },
    {
      game: g,
      market: "1H Spread",
      pick: "Iowa Hawkeyes +7.5",
      odds: -110,
      isProp: false,
      sport: "ncaaf",
      finalAiScore: mainScore,
    },
  ]);
  // Helper still collapses by team bucket — Coach must skip calling it for college.
  assert.equal(stacked.length, 1, "collapse helper itself still collapses; college must not invoke it");

  const picks = fillCollegeTicket(10, 4);
  assert.equal(picks.length, 0, "P0 NCAAF game lines → bare college shortfall");
});

test("proof: per-game caps still block unsafe over-stacking", () => {
  const g = "Ohio State Buckeyes @ Iowa Hawkeyes";
  const ticket = [
    { game: g, market: "Spread", pick: "Iowa +14.5", odds: -110, isProp: false },
    { game: g, market: "Q2 Spread", pick: "Iowa +7.5", odds: -110, isProp: false },
  ];
  // Default deep-ticket cap is 2 game-line seats per matchup.
  assert.equal(maxLegsPerGame(10), 2);
  assert.equal(
    wouldExceedMaxLegsPerGame(
      { game: g, market: "1H Spread", pick: "Iowa +7", odds: -110, isProp: false },
      ticket,
      2,
    ),
    true,
  );
  // Props do not consume the hard game-line seat budget.
  assert.equal(
    wouldExceedMaxLegsPerGame(
      {
        game: g,
        market: "player_rush_yds",
        pick: "Over 65.5",
        odds: -110,
        isProp: true,
        player: "A",
      },
      ticket,
      2,
    ),
    false,
  );
});

test("proof: #579 bare-college team markets raise legsPerGameCap via college stacks (≥4)", () => {
  // Bare college is gameLinesOnly + collegeTeamMarketStacks → raised per-game
  // floor so FG+Q2+team-total fills can reach N without player props.
  const c = parseCoachAskMarketConstraint("10 leg college");
  assert.equal(c.gameLinesOnly, true);
  const cap = legsPerGameCapForAsk(10, {
    gameLinesOnly: c.gameLinesOnly,
    collegeTeamMarketStacks: true,
  });
  assert.ok(cap != null && cap >= 4, `expected ≥4 college stack seats, got ${cap}`);
  assert.equal(maxLegsPerGame(10), 2);
});

test("proof: NHL/team-props collapse path unchanged", () => {
  const g = "Pittsburgh Steelers @ Cleveland Browns";
  const short = [
    scored({ game: g, market: "Spread", pick: "Browns +1.5", odds: 101, sport: "nfl" }, 100).pick,
    scored({ game: "A @ B", market: "Moneyline", pick: "B ML", odds: -120, sport: "nfl" }, 90).pick,
    scored({ game: "C @ D", market: "Total", pick: "Under 45.5", odds: -110, sport: "nfl" }, 85).pick,
  ];
  const board: BoardScoredLeg[] = [
    ...short.map((pick, i) => scored({ game: pick.game!, market: pick.market!, pick: pick.pick!, odds: pick.odds!, sport: "nfl" }, 100 - i)),
    scored({ game: g, market: "Q2 Spread", pick: "Browns +1.5", odds: -130, sport: "nfl" }, 99),
    scored({ game: "E @ F", market: "Spread", pick: "E +3.5", odds: -105, sport: "nfl" }, 80),
  ];
  const topped = topUpTicketFromQualifiedScored(short, board, 5, undefined, null, {
    collapseSameTeamSides: true,
  });
  const browns = topped.filter((p) => /browns/i.test(p.pick) && /steelers/i.test(p.game ?? ""));
  assert.equal(browns.length, 1);
});
