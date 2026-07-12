import assert from "node:assert/strict";
import test from "node:test";
import { balancedMixSlots, BALANCED_MIX_FRACTIONS } from "./balancedTicketMix.ts";
import { buildBalancedStagedTicketFromScan, type BoardScoredLeg } from "./ticketStaging.ts";
import { boardMarketCategory, partitionScoredLegsByCategory, ticketCategoryMix } from "./boardMarketPools.ts";
import type { ParsedPick } from "../components/PickCard.tsx";

function leg(
  pick: Partial<ParsedPick> & Pick<ParsedPick, "game" | "market" | "pick" | "odds">,
  rankScore: number,
  finalAiScore?: ParsedPick["finalAiScore"],
): BoardScoredLeg {
  const full: ParsedPick = {
    isProp: false,
    sport: "nba",
    ...pick,
    finalAiScore: finalAiScore ?? pick.finalAiScore,
  };
  return {
    pick: full,
    evPct: 2,
    edgePct: 3,
    confidencePct: 58,
    impliedProbPct: 50,
    lineShoppingScore: 6,
    grade: "B+",
    simHit: 0.56,
    composite: 7.5,
    rankScore,
  };
}

const qualifiedScore = {
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

test("BALANCED_MIX_FRACTIONS sum to 100%", () => {
  const sum = Object.values(BALANCED_MIX_FRACTIONS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 0.001);
});

test("balancedMixSlots targets ~50% props on a 10-leg ticket", () => {
  const slots = balancedMixSlots(10);
  assert.equal(slots.props, 5);
  assert.equal(slots.gameLines + slots.teamTotals + slots.alternateLines, 5);
});

test("boardMarketCategory separates props, game lines, team totals, and alts", () => {
  assert.equal(
    boardMarketCategory({
      game: "A @ B",
      market: "Points",
      pick: "Star Over 24.5",
      odds: -110,
      isProp: true,
      player: "Star",
    }),
    "props",
  );
  assert.equal(
    boardMarketCategory({ game: "A @ B", market: "Spread", pick: "A -3.5", odds: -110 }),
    "gameLines",
  );
  assert.equal(
    boardMarketCategory({ game: "A @ B", market: "Team Total", pick: "Over 112.5", odds: -110 }),
    "teamTotals",
  );
  assert.equal(
    boardMarketCategory({ game: "A @ B", market: "Alt Spread", pick: "A -1.5", odds: -110 }),
    "alternateLines",
  );
});

test("buildBalancedStagedTicketFromScan prefers props over game lines when both qualify", () => {
  const props: BoardScoredLeg[] = Array.from({ length: 6 }, (_, i) =>
    leg(
      {
        game: `Away${i} @ Home${i}`,
        market: "Points",
        pick: `Player${i} Over 20.5`,
        odds: -110,
        isProp: true,
        player: `Player${i}`,
        propLine: 20.5,
        propSide: "Over",
      },
      90 - i,
      qualifiedScore,
    ),
  );
  const gameLines: BoardScoredLeg[] = Array.from({ length: 8 }, (_, i) =>
    leg(
      {
        game: `G${i} @ H${i}`,
        market: "Moneyline",
        pick: `G${i} ML`,
        odds: 130,
      },
      99 - i,
      qualifiedScore,
    ),
  );
  const scored = [...gameLines, ...props];
  const { picks } = buildBalancedStagedTicketFromScan(scored, 8);
  const mix = ticketCategoryMix(picks);
  assert.ok(mix.props >= 4, `expected props-first mix, got ${JSON.stringify(mix)}`);
  assert.ok(mix.gameLines <= 3, `too many game lines: ${mix.gameLines}`);
});

test("buildBalancedStagedTicketFromScan returns fewer legs when pool is short — no filler", () => {
  const scored = [
    leg({ game: "A @ B", market: "Spread", pick: "A -2.5", odds: -110 }, 80, qualifiedScore),
    leg(
      {
        game: "C @ D",
        market: "Rebounds",
        pick: "X Over 8.5",
        odds: -105,
        isProp: true,
        player: "X",
        propLine: 8.5,
        propSide: "Over",
      },
      70,
      qualifiedScore,
    ),
  ];
  const { picks } = buildBalancedStagedTicketFromScan(scored, 9);
  assert.equal(picks.length, 2);
});

test("partitionScoredLegsByCategory keeps independent rank orders", () => {
  const pools = partitionScoredLegsByCategory([
    leg({ game: "A @ B", market: "Spread", pick: "A -1", odds: -110 }, 50, qualifiedScore),
    leg(
      {
        game: "C @ D",
        market: "Assists",
        pick: "Y Over 5.5",
        odds: 120,
        isProp: true,
        player: "Y",
      },
      90,
      qualifiedScore,
    ),
  ]);
  assert.equal(pools.props.length, 1);
  assert.equal(pools.gameLines.length, 1);
  assert.ok(pools.props[0]!.rankScore > pools.gameLines[0]!.rankScore);
});
