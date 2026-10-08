import test from "node:test";
import assert from "node:assert/strict";
import {
  isP0UnvalidatedSimTotalMarket,
  p0UnvalidatedSimTotalDecision,
  P0_UNVALIDATED_TOTAL_REASON,
  wouldStackSameTeamTeamTotals,
} from "./coachP0UnvalidatedTotals.ts";
import {
  assessSimMarketIntegrity,
  pickHasSimGrade,
  sanitizeSimHitForGrade,
} from "./simMarketSupport.ts";
import { selectCorrelationAwareBoardLegs } from "./parlayCorrelationScore.ts";

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

test("P0 does not block props, spreads, moneylines, or NBA totals", () => {
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
