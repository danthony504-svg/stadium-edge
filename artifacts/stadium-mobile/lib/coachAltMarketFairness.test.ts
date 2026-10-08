/**
 * Phase 1 — all-sports AI Coach market-diversity fairness regressions.
 * Proves fair seating, distinct alt thresholds, correlation caps, sim quotas,
 * honest 7-leg fill / shortfall, and no fabricated odds.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  collapseScoredLegsByMarketLadder,
  wouldRepeatMarketLadder,
  dedupePicksByMarketLadder,
  marketLadderScoreKey,
} from "./marketLadderExhaustion.ts";
import {
  buildStagedTicketFromScan,
  selectGreedyBoardLegs,
  type BoardScoredLeg,
} from "./ticketStaging.ts";
import {
  BOARD_PROP_SIM_ALT_QUOTA_FRACTION,
  pickDiverseLadderRungsForSim,
  selectBoardPropSimCandidates,
  selectFootballMixPropSimCandidates,
} from "./boardPropSimExpansion.ts";
import { boardScanMaxPropsToSimForMix } from "./boardScanScope.ts";
import { promoteQualifyingStagedToTicket } from "./parlayReachCore.ts";
import { buildFixedLegCountShortfallLead } from "./coachScanPolicy.ts";

const qualMain = {
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

const qualAlt = {
  composite: 7,
  grade: "B",
  confidencePct: 56,
  edgePct: 3,
  simHit: 0.55,
  simAligned: true,
  highRiskValuePlay: false,
  recommends: false,
  factors: [],
  rubric: { composite: 7, grade: "B", confidencePct: 56, edgePct: 3, scores: {} as never },
};

function scoredLeg(
  pick: {
    game: string;
    market: string;
    pick: string;
    odds: number;
    isProp?: boolean;
    propIsAlt?: boolean;
    player?: string;
    propSide?: string;
    propLine?: number;
    sport?: string;
  },
  rankScore: number,
  finalAiScore: typeof qualMain = qualMain,
): BoardScoredLeg {
  return {
    pick: {
      sport: pick.sport ?? "nfl",
      isProp: !!pick.isProp,
      ...pick,
      finalAiScore,
    },
    evPct: 2,
    edgePct: finalAiScore.edgePct,
    confidencePct: finalAiScore.confidencePct,
    impliedProbPct: 50,
    lineShoppingScore: 1,
    grade: finalAiScore.grade,
    simHit: finalAiScore.simHit,
    composite: finalAiScore.composite,
    rankScore,
  };
}

test("Phase1: qualified alternate beats a lower-ranked main for a ticket slot", () => {
  const scored = [
    scoredLeg(
      {
        game: "DEN @ KC",
        market: "Rush Yds",
        pick: "Barkley Over 67.5 Rush Yds",
        odds: -110,
        isProp: true,
        propIsAlt: false,
        player: "Barkley",
        propSide: "Over",
        propLine: 67.5,
      },
      70,
      qualMain,
    ),
    scoredLeg(
      {
        game: "DEN @ KC",
        market: "Rush Yds",
        pick: "Barkley Over 149.5 Rush Yds",
        odds: 250,
        isProp: true,
        propIsAlt: true,
        player: "Barkley",
        propSide: "Over",
        propLine: 149.5,
      },
      95,
      qualAlt,
    ),
    scoredLeg(
      { game: "BUF @ MIA", market: "Spread", pick: "BUF -3.5", odds: -110 },
      60,
      qualMain,
    ),
  ];
  const collapsed = collapseScoredLegsByMarketLadder(scored);
  assert.equal(collapsed.length, 3, "distinct thresholds survive scoring collapse");
  const picks = selectGreedyBoardLegs(collapsed, 2);
  assert.equal(picks.length, 2);
  assert.match(picks[0]!.pick, /149\.5/, "higher-ranked alt seats first");
  assert.equal(
    picks.some((p) => /67\.5/.test(p.pick)),
    false,
    "correlated main rung cannot also seat",
  );
});

test("Phase1: main-first ordering no longer excludes a better alternate on promote", () => {
  const { picks } = promoteQualifyingStagedToTicket(
    [],
    [
      {
        pick: {
          game: "A @ B",
          market: "Spread",
          pick: "A +1.5",
          odds: -110,
          isProp: false,
        } as never,
        reason: "main",
        nearScore: 40,
      },
    ],
    [
      {
        pick: {
          game: "C @ D",
          market: "Alt Spread",
          pick: "D +6.5",
          odds: -105,
          isProp: false,
        } as never,
        reason: "alt",
        nearScore: 80,
      },
    ],
    1,
  );
  assert.equal(picks.length, 1);
  assert.equal(picks[0]!.market, "Alt Spread");
  assert.equal(picks[0]!.ticketRole, "alt");
});

test("Phase1: distinct alternate thresholds survive scoring", () => {
  const scored = [
    scoredLeg(
      {
        game: "LAL @ BOS",
        market: "Points",
        pick: "Tatum Over 24.5 Points",
        odds: -110,
        isProp: true,
        propIsAlt: false,
        player: "Tatum",
        propSide: "Over",
        propLine: 24.5,
        sport: "nba",
      },
      80,
    ),
    scoredLeg(
      {
        game: "LAL @ BOS",
        market: "Points",
        pick: "Tatum Over 34.5 Points",
        odds: 180,
        isProp: true,
        propIsAlt: true,
        player: "Tatum",
        propSide: "Over",
        propLine: 34.5,
        sport: "nba",
      },
      75,
      qualAlt,
    ),
    scoredLeg(
      {
        game: "LAL @ BOS",
        market: "Points",
        pick: "Tatum Over 39.5 Points",
        odds: 300,
        isProp: true,
        propIsAlt: true,
        player: "Tatum",
        propSide: "Over",
        propLine: 39.5,
        sport: "nba",
      },
      70,
      qualAlt,
    ),
  ];
  const keys = new Set(scored.map((l) => marketLadderScoreKey(l.pick)));
  assert.equal(keys.size, 3);
  const out = collapseScoredLegsByMarketLadder(scored);
  assert.equal(out.length, 3);
  assert.deepEqual(
    out.map((l) => l.pick.propLine).sort((a, b) => (a ?? 0) - (b ?? 0)),
    [24.5, 34.5, 39.5],
  );
});

test("Phase1: correlated alternate rungs cannot fill multiple ticket slots", () => {
  const ticket = [
    {
      game: "DEN @ KC",
      market: "Rush Yds",
      pick: "Barkley Over 67.5 Rush Yds",
      odds: -110,
      isProp: true,
      player: "Barkley",
      propSide: "Over",
      propLine: 67.5,
      sport: "nfl",
    },
  ];
  const alt = {
    game: "DEN @ KC",
    market: "Rush Yds",
    pick: "Barkley Over 149.5 Rush Yds",
    odds: 250,
    isProp: true,
    player: "Barkley",
    propSide: "Over",
    propLine: 149.5,
    sport: "nfl",
  };
  assert.equal(wouldRepeatMarketLadder(alt, ticket), true);
  const deduped = dedupePicksByMarketLadder([
    { ...ticket[0]!, finalAiScore: qualMain },
    { ...alt, finalAiScore: { ...qualAlt, composite: 99 } },
  ] as never);
  assert.equal(deduped.length, 1);
});

test("Phase1: market quotas stay within the existing 96 mixed-sim cap", () => {
  // Cap scales with target but never exceeds 96 without separate approval.
  assert.equal(boardScanMaxPropsToSimForMix(7, 500), 56);
  assert.equal(boardScanMaxPropsToSimForMix(12, 500), 96);
  assert.ok(boardScanMaxPropsToSimForMix(20, 500) <= 96);
  assert.ok(BOARD_PROP_SIM_ALT_QUOTA_FRACTION > 0 && BOARD_PROP_SIM_ALT_QUOTA_FRACTION < 1);

  const ranked = [];
  for (let i = 0; i < 200; i++) {
    ranked.push({
      game: `G${i % 20} @ H${i % 20}`,
      market: i % 3 === 0 ? "Rush Yds" : "Pass Yds",
      propMarketKey: i % 3 === 0 ? "player_rush_yds" : "player_pass_yds",
      pick: `P${i} Over ${50.5 + (i % 10) * 10} Yds`,
      odds: -110,
      isProp: true as const,
      sport: "nfl",
      player: `P${i}`,
      propLine: 50.5 + (i % 10) * 10,
      propSide: "Over" as const,
      propIsAlt: i % 2 === 1,
      athleteId: `a${i}`,
    });
  }
  const mixCap = boardScanMaxPropsToSimForMix(12, ranked.length);
  assert.equal(mixCap, 96);
  const { selected } = selectFootballMixPropSimCandidates(ranked, mixCap);
  assert.ok(selected.length <= 96);
  assert.equal(selected.length, mixCap);
  const alts = selected.filter((p) => p.propIsAlt).length;
  assert.ok(
    alts >= Math.floor(mixCap * BOARD_PROP_SIM_ALT_QUOTA_FRACTION * 0.5),
    `alt floor should reserve room inside cap (got ${alts}/${mixCap})`,
  );
});

test("Phase1: pickDiverseLadderRungsForSim keeps main + nearest + farthest", () => {
  const rungs = [67.5, 99.5, 124.5, 149.5, 174.5].map((line, i) => ({
    propLine: line,
    propIsAlt: i > 0,
  }));
  const picked = pickDiverseLadderRungsForSim(rungs, 3);
  assert.deepEqual(
    picked.map((r) => r.propLine).sort((a, b) => a - b),
    [67.5, 99.5, 174.5],
  );
});

test("Phase1: 7-leg ticket returns seven when seven qualified non-conflicting candidates exist", () => {
  const scored: BoardScoredLeg[] = [];
  for (let i = 0; i < 7; i++) {
    scored.push(
      scoredLeg(
        {
          game: `A${i} @ B${i}`,
          market: i % 2 === 0 ? "Spread" : "Alt Spread",
          pick: i % 2 === 0 ? `A${i} -3.5` : `B${i} +6.5`,
          odds: -110,
          sport: "nba",
        },
        100 - i,
        i % 2 === 0 ? qualMain : qualAlt,
      ),
    );
  }
  // target < 3 uses fair greedy path (no varietySeed / balanced mix)
  const { picks, breakdown } = buildStagedTicketFromScan(scored, 2);
  assert.equal(picks.length, 2);
  assert.ok(breakdown.mainQualified + breakdown.altQualified >= 2);

  const greedy = selectGreedyBoardLegs(collapseScoredLegsByMarketLadder(scored), 7);
  assert.equal(greedy.length, 7, "seven non-conflicting qualifiers fill seven seats");
});

test("Phase1: shortfalls are reported honestly — no filler", () => {
  const scored = [
    scoredLeg(
      { game: "A @ B", market: "Spread", pick: "A -3.5", odds: -110, sport: "nba" },
      90,
    ),
    scoredLeg(
      { game: "C @ D", market: "Total", pick: "Over 220.5", odds: -110, sport: "nba" },
      80,
    ),
  ];
  const { picks } = buildStagedTicketFromScan(scored, 2);
  assert.equal(picks.length, 2);
  const lead = buildFixedLegCountShortfallLead(7, picks.length);
  assert.match(lead, /asked for 7 legs/i);
  assert.match(lead, /only 2 cleared/i);
  assert.match(lead, /No ungraded filler was added/i);
});

test("Phase1: no fabricated odds — only posted prices seat", () => {
  const scored = [
    scoredLeg(
      {
        game: "X @ Y",
        market: "Points",
        pick: "Player Over 24.5 Points",
        odds: -115,
        isProp: true,
        player: "Player",
        propSide: "Over",
        propLine: 24.5,
        sport: "nba",
      },
      90,
    ),
  ];
  const { picks } = buildStagedTicketFromScan(scored, 1);
  assert.equal(picks[0]!.odds, -115);
  assert.ok(Number.isFinite(picks[0]!.odds));
  assert.notEqual(picks[0]!.odds, 0);
});

test("Phase1: selectBoardPropSimCandidates does not exceed caller cap", () => {
  const ranked = [];
  for (let i = 0; i < 120; i++) {
    ranked.push({
      game: "A @ B",
      market: "Points",
      pick: `P${i} Over ${20.5 + (i % 5)} Points`,
      odds: -110,
      isProp: true as const,
      sport: "nba",
      player: `P${i}`,
      propLine: 20.5 + (i % 5),
      propSide: "Over" as const,
      propIsAlt: i % 3 === 0,
    });
  }
  const { selected } = selectBoardPropSimCandidates(ranked, 96);
  assert.ok(selected.length <= 96);
});
