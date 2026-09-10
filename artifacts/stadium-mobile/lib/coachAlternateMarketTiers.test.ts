import test from "node:test";
import assert from "node:assert/strict";
import {
  ALTERNATE_MARKET_SEARCH_ORDER,
  classifyCoachAlternateMarketTier,
  countMarketTierQualification,
  partitionScoredLegsByMarketTier,
} from "./coachAlternateMarketTiers.ts";
import { buildAlternateMarketSearchSummary } from "./fullBoardMarketCopy.ts";
import { backfillFromAlternateMarketTiers, buildStagedTicketFromScan, type BoardScoredLeg } from "./ticketStaging.ts";
import type { ParsedPick } from "../components/PickCard.tsx";

function leg(
  pick: Partial<ParsedPick> & Pick<ParsedPick, "game" | "market" | "pick" | "odds">,
  rankScore: number,
  finalAiScore?: ParsedPick["finalAiScore"],
): BoardScoredLeg {
  const full: ParsedPick = {
    isProp: false,
    sport: "mlb",
    ...pick,
    finalAiScore: finalAiScore ?? pick.finalAiScore,
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

const altScore = {
  composite: 6,
  grade: "C+",
  confidencePct: 52,
  edgePct: 1.5,
  simHit: 0.53,
  simAligned: true,
  highRiskValuePlay: false,
  recommends: false,
  factors: [],
  rubric: { composite: 6, grade: "C+", confidencePct: 52, edgePct: 1.5, scores: {} as never },
};

test("ALTERNATE_MARKET_SEARCH_ORDER has 12 tiers in the requested sequence", () => {
  assert.equal(ALTERNATE_MARKET_SEARCH_ORDER.length, 12);
  assert.deepEqual(ALTERNATE_MARKET_SEARCH_ORDER.slice(0, 6), [
    "mainPlayerProps",
    "alternatePlayerLines",
    "teamProps",
    "gameProps",
    "firstHalfProps",
    "quarterPeriodProps",
  ]);
});

test("classifyCoachAlternateMarketTier maps main vs alt player props", () => {
  const main = leg(
    {
      game: "A @ B",
      market: "Points",
      pick: "Star Over 24.5 Points",
      odds: -110,
      isProp: true,
      player: "Star",
      sport: "nba",
      propMarketKey: "player_points",
    },
    90,
  );
  const alt = leg(
    {
      game: "A @ B",
      market: "Alt Points",
      pick: "Star Over 29.5 Points",
      odds: 140,
      isProp: true,
      player: "Star",
      sport: "nba",
      propIsAlt: true,
    },
    80,
    altScore,
  );
  assert.equal(classifyCoachAlternateMarketTier(main.pick), "mainPlayerProps");
  assert.equal(classifyCoachAlternateMarketTier(alt.pick), "alternatePlayerLines");
});

test("classifyCoachAlternateMarketTier maps sport-specific MLB and NFL buckets for non-player props", () => {
  const pitcherTeam = leg(
    {
      game: "A @ B",
      market: "Pitcher Strikeouts",
      pick: "Over 12.5",
      odds: -115,
      isProp: true,
      sport: "mlb",
      propMarketKey: "pitcher_strikeouts",
    },
    88,
  );
  const nflTeam = leg(
    {
      game: "A @ B",
      market: "Passing Yards",
      pick: "Over 245.5 Passing Yards",
      odds: -110,
      isProp: true,
      sport: "nfl",
      propMarketKey: "player_pass_yds",
    },
    84,
  );
  assert.equal(classifyCoachAlternateMarketTier(pitcherTeam.pick), "mlbPitchingStats");
  assert.equal(classifyCoachAlternateMarketTier(nflTeam.pick), "nflReceivingRushingPassing");
});

test("backfillFromAlternateMarketTiers fills from later tiers without lowering gates", () => {
  const mains: BoardScoredLeg[] = [
    leg(
      {
        game: "G1",
        market: "Points",
        pick: "A Over 20.5 Points",
        odds: -110,
        isProp: true,
        player: "A",
        sport: "nba",
      },
      100,
      mainScore,
    ),
  ];
  const alts: BoardScoredLeg[] = [
    leg({ game: "G2", market: "Spread", pick: "B -3.5", odds: -110, sport: "nba" }, 95, mainScore),
    leg(
      {
        game: "G3",
        market: "Alt Points",
        pick: "C Over 28.5 Points",
        odds: 130,
        isProp: true,
        player: "C",
        sport: "nba",
        propIsAlt: true,
      },
      90,
      altScore,
    ),
    leg({ game: "G4", market: "Team Total", pick: "Over 112.5", odds: -105, sport: "nba" }, 85, mainScore),
  ];
  const qualifying = [...mains, ...alts];
  const filled = backfillFromAlternateMarketTiers(
    mains.map((r) => ({ ...r.pick, ticketRole: "main" as const })),
    3,
    qualifying,
  );
  assert.equal(filled.length, 3);
  assert.ok(filled.some((p) => p.market.includes("Alt") || p.ticketRole === "alt"));
});

test("buildStagedTicketFromScan reports primary vs alternate market qualification", () => {
  const scored: BoardScoredLeg[] = [
    leg(
      {
        game: "G1",
        market: "Points",
        pick: "A Over 20.5 Points",
        odds: -110,
        isProp: true,
        player: "A",
        sport: "nba",
      },
      100,
      mainScore,
    ),
    leg(
      {
        game: "G2",
        market: "Alt Points",
        pick: "B Over 29.5 Points",
        odds: 125,
        isProp: true,
        player: "B",
        sport: "nba",
        propIsAlt: true,
      },
      90,
      altScore,
    ),
    leg({ game: "G3", market: "Spread", pick: "C -2.5", odds: -110, sport: "nba" }, 85, mainScore),
    leg({ game: "G4", market: "Total", pick: "Over 220.5", odds: -105, sport: "nba" }, 80, mainScore),
  ];
  const { breakdown } = buildStagedTicketFromScan(scored, 2, "seed");
  const tierCounts = countMarketTierQualification(
    scored.filter((s) => s.pick.finalAiScore?.recommends || s.pick.finalAiScore?.simAligned),
  );
  assert.ok(breakdown.primaryMarketQualified != null);
  assert.ok(breakdown.alternateMarketQualified != null);
  assert.equal(
    (breakdown.primaryMarketQualified ?? 0) + (breakdown.alternateMarketQualified ?? 0),
    tierCounts.primaryMarketQualified + tierCounts.alternateMarketQualified,
  );
});

test("buildAlternateMarketSearchSummary shows primary/alternate breakdown when alternates exist", () => {
  const summary = buildAlternateMarketSearchSummary(15, {
    mainQualified: 9,
    altQualified: 5,
    mainOnTicket: 9,
    altOnTicket: 5,
    primaryMarketQualified: 9,
    alternateMarketQualified: 5,
  }, 14);
  assert.match(summary, /Requested: \*\*15\*\*/);
  assert.match(summary, /Qualified from primary markets: \*\*9\*\*/);
  assert.match(summary, /Qualified from alternate markets: \*\*5\*\*/);
  assert.match(summary, /Final ticket: \*\*14\*\*/);
});

test("buildAlternateMarketSearchSummary shows total qualified when no alternate pool", () => {
  const summary = buildAlternateMarketSearchSummary(15, {
    mainQualified: 11,
    altQualified: 0,
    mainOnTicket: 11,
    altOnTicket: 0,
    primaryMarketQualified: 11,
    alternateMarketQualified: 0,
  }, 11);
  assert.match(summary, /Requested: \*\*15\*\*/);
  assert.match(summary, /Qualified after scanning every available market: \*\*11\*\*/);
});

test("partitionScoredLegsByMarketTier keeps one pool per tier", () => {
  const scored: BoardScoredLeg[] = [
    leg(
      {
        game: "G1",
        market: "Points",
        pick: "A Over 20.5 Points",
        odds: -110,
        isProp: true,
        player: "A",
        sport: "nba",
      },
      100,
    ),
    leg({ game: "G2", market: "Team Total", pick: "Over 112.5", odds: -105, sport: "nba", isProp: true }, 90),
  ];
  const pools = partitionScoredLegsByMarketTier(scored);
  assert.equal(pools.mainPlayerProps.length, 1);
  assert.equal(pools.teamProps.length, 1);
  assert.equal(pools.gameProps.length, 0);
});
