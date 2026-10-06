import assert from "node:assert/strict";
import test from "node:test";
import { balancedMixSlots, BALANCED_MIX_FRACTIONS, FOOTBALL_BALANCED_MIX_FRACTIONS } from "./balancedTicketMix.ts";
import {
  buildBalancedStagedTicketFromScan,
  buildStagedTicketFromScan,
  type BoardScoredLeg,
} from "./ticketStaging.ts";
import { buildIndependentCoachTicket } from "./coachTicketCombinations.ts";
import {
  boardMarketCategory,
  gameLineFamily,
  orderLegsPreferringSides,
  partitionScoredLegsByCategory,
  propOuSide,
  sidePriorityTiers,
  ticketCategoryMix,
  interleaveSidesWithProps,
} from "./boardMarketPools.ts";
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

test("balancedMixSlots keeps alt slots and shrinks team totals on 8-leg tickets", () => {
  const slots = balancedMixSlots(8);
  assert.ok(slots.alternateLines >= 1, `expected alt slot, got ${JSON.stringify(slots)}`);
  assert.ok(slots.teamTotals <= 1, `team totals too high: ${JSON.stringify(slots)}`);
  assert.equal(slots.props + slots.gameLines + slots.teamTotals + slots.alternateLines, 8);
});

test("orderLegsPreferringSides puts spreads and ML ahead of totals", () => {
  const pools = orderLegsPreferringSides([
    leg({ game: "A @ B", market: "Total", pick: "Over 7", odds: -110 }, 99, qualifiedScore),
    leg({ game: "C @ D", market: "Spread", pick: "C -3.5", odds: -110 }, 50, qualifiedScore),
    leg({ game: "E @ F", market: "Moneyline", pick: "E ML", odds: 130 }, 40, qualifiedScore),
  ]);
  assert.equal(gameLineFamily(pools[0]!.pick), "spread");
  assert.equal(gameLineFamily(pools[1]!.pick), "moneyline");
  assert.equal(gameLineFamily(pools[2]!.pick), "total");
});

test("buildBalancedStagedTicketFromScan prefers spreads over FG totals in game-line slots", () => {
  const props: BoardScoredLeg[] = Array.from({ length: 5 }, (_, i) =>
    leg(
      {
        game: `PAway${i} @ PHome${i}`,
        market: "Points",
        pick: `Player${i} Over 20.5`,
        odds: -110,
        isProp: true,
        player: `Player${i}`,
        propLine: 20.5,
        propSide: "Over",
      },
      80 - i,
      qualifiedScore,
    ),
  );
  // Higher-ranked totals vs lower-ranked spreads — sides should still win game-line slots.
  const totals: BoardScoredLeg[] = Array.from({ length: 4 }, (_, i) =>
    leg(
      {
        game: `T${i} @ U${i}`,
        market: "Total",
        pick: `Over ${220 + i}.5`,
        odds: -110,
      },
      95 - i,
      qualifiedScore,
    ),
  );
  const spreads: BoardScoredLeg[] = Array.from({ length: 4 }, (_, i) =>
    leg(
      {
        game: `S${i} @ H${i}`,
        market: "Spread",
        pick: `S${i} -3.5`,
        odds: -110,
      },
      60 - i,
      qualifiedScore,
    ),
  );
  const { picks } = buildBalancedStagedTicketFromScan([...props, ...totals, ...spreads], 8);
  const gameLinePicks = picks.filter((p) => !p.isProp && boardMarketCategory(p) === "gameLines");
  assert.ok(gameLinePicks.length >= 1, `expected game-line slots, got ${picks.map((p) => p.market)}`);
  assert.ok(
    gameLinePicks.every((p) => gameLineFamily(p) === "spread" || gameLineFamily(p) === "moneyline"),
    `game-line slots should prefer sides, got ${gameLinePicks.map((p) => `${p.market}:${p.pick}`)}`,
  );
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


test("boardMarketCategory routes period mains to alternateLines so FG owns gameLines", () => {
  assert.equal(
    boardMarketCategory({ game: "A @ B", market: "Q4 Spread", pick: "A +2.5", odds: -105 }),
    "alternateLines",
  );
  assert.equal(
    boardMarketCategory({ game: "A @ B", market: "Spread", pick: "A +3.5", odds: -110 }),
    "gameLines",
  );
  assert.equal(
    boardMarketCategory({ game: "A @ B", market: "Q1 Alt Spread", pick: "A +6.5", odds: -415 }),
    "alternateLines",
  );
});

test("sidePriorityTiers prefers FG fair juice before period and heavy alts", () => {
  const tiers = sidePriorityTiers([
    leg({ game: "A @ B", market: "Q1 Alt Spread", pick: "A +6.5", odds: -415 }, 99, qualifiedScore),
    leg({ game: "C @ D", market: "Q4 Spread", pick: "C +2.5", odds: -105 }, 95, qualifiedScore),
    leg({ game: "E @ F", market: "Spread", pick: "E -3.5", odds: -110 }, 40, qualifiedScore),
    leg({ game: "G @ H", market: "Total", pick: "Over 45.5", odds: -110 }, 100, qualifiedScore),
  ]);
  assert.equal(tiers[0]![0]!.pick.market, "Spread");
  assert.equal(tiers[1]![0]!.pick.market, "Q4 Spread");
  assert.equal(tiers[2]![0]!.pick.market, "Q1 Alt Spread");
});

test("buildBalancedStagedTicketFromScan prefers FG spread over higher-ranked Q4 spread", () => {
  const props: BoardScoredLeg[] = Array.from({ length: 4 }, (_, i) =>
    leg(
      {
        game: `P${i} @ Q${i}`,
        market: "Receptions",
        pick: `Player${i} Over 1.5`,
        odds: -110,
        isProp: true,
        player: `Player${i}`,
        propLine: 1.5,
        propSide: "Over",
      },
      80 - i,
      qualifiedScore,
    ),
  );
  const q4 = leg(
    { game: "ATL @ PIT", market: "Q4 Spread", pick: "Falcons +2.5", odds: -105 },
    99,
    qualifiedScore,
  );
  const fg = leg(
    { game: "BAL @ IND", market: "Spread", pick: "Colts +3.5", odds: -110 },
    40,
    qualifiedScore,
  );
  const juice = leg(
    { game: "BAL @ IND", market: "Q1 Alt Spread", pick: "Colts +6.5", odds: -415 },
    98,
    qualifiedScore,
  );
  const { picks } = buildBalancedStagedTicketFromScan([...props, q4, fg, juice], 7);
  const markets = picks.map((p) => p.market);
  assert.ok(markets.includes("Spread"), `expected FG spread on ticket, got ${markets}`);
  assert.ok(!markets.includes("Q1 Alt Spread") || markets.indexOf("Spread") < markets.indexOf("Q1 Alt Spread"));
  const gameLines = picks.filter((p) => boardMarketCategory(p) === "gameLines");
  assert.ok(
    gameLines.every((p) => p.market === "Spread" || p.market === "Moneyline"),
    `gameLines should be FG sides, got ${gameLines.map((p) => p.market)}`,
  );
});

test("buildBalancedStagedTicketFromScan reserves Unders among prop slots when available", () => {
  const overs: BoardScoredLeg[] = Array.from({ length: 6 }, (_, i) =>
    leg(
      {
        game: `O${i} @ X${i}`,
        market: "Receptions",
        pick: `OverGuy${i} Over 1.5`,
        odds: -110,
        isProp: true,
        player: `OverGuy${i}`,
        propLine: 1.5,
        propSide: "Over",
      },
      90 - i,
      qualifiedScore,
    ),
  );
  const unders: BoardScoredLeg[] = Array.from({ length: 3 }, (_, i) =>
    leg(
      {
        game: `U${i} @ Y${i}`,
        market: "Pass Yds",
        pick: `UnderGuy${i} Under 225.5`,
        odds: -110,
        isProp: true,
        player: `UnderGuy${i}`,
        propLine: 225.5,
        propSide: "Under",
      },
      50 - i,
      qualifiedScore,
    ),
  );
  const sides: BoardScoredLeg[] = Array.from({ length: 4 }, (_, i) =>
    leg(
      {
        game: `S${i} @ H${i}`,
        market: "Spread",
        pick: `S${i} -3.5`,
        odds: -110,
      },
      70 - i,
      qualifiedScore,
    ),
  );
  const { picks } = buildBalancedStagedTicketFromScan([...overs, ...unders, ...sides], 8);
  const propPicks = picks.filter((p) => p.isProp);
  const underCount = propPicks.filter((p) => propOuSide(p) === "under").length;
  assert.ok(underCount >= 1, `expected reserved Under props, got ${propPicks.map((p) => p.pick)}`);
});


test("football mix slots reserve more sides on a 7-leg ticket", () => {
  const slots = balancedMixSlots(7, FOOTBALL_BALANCED_MIX_FRACTIONS);
  assert.ok(slots.props <= 3, `expected ≤3 props, got ${JSON.stringify(slots)}`);
  assert.ok(slots.gameLines + slots.alternateLines >= 3, `expected ≥3 side/alt seats, got ${JSON.stringify(slots)}`);
  assert.equal(slots.props + slots.gameLines + slots.teamTotals + slots.alternateLines, 7);
});

test("interleaveSidesWithProps leads with a side so Overs are not the whole first screen", () => {
  const picks = [
    { isProp: true, pick: "A Over 1.5" },
    { isProp: true, pick: "B Over 2.5" },
    { isProp: true, pick: "C Over 0.5" },
    { isProp: true, pick: "D Over 3.5" },
    { isProp: false, pick: "Falcons +6" },
    { isProp: false, pick: "Over 48" },
    { isProp: false, pick: "Colts +2.5" },
  ];
  const out = interleaveSidesWithProps(picks);
  assert.equal(out[0]!.isProp, false, `expected side first, got ${out[0]!.pick}`);
  assert.equal(out.length, 7);
  assert.equal(out.filter((p) => p.isProp).length, 4);
});


test("interleaveSidesWithProps puts spread ahead of Over props (LIVE card-order contract)", () => {
  const picks = [
    { isProp: true, pick: "Darren Waller Over 1.5 Receptions", market: "Receptions" },
    { isProp: true, pick: "Aaron Rodgers Over 0.5 Rush Yds", market: "Rush Yds" },
    { isProp: true, pick: "Patrick Mahomes Over 0.5 Pass INTs", market: "Pass INTs" },
    { isProp: true, pick: "Cade Otton Over 3.5 Receptions", market: "Receptions" },
    // Total listed before spread — lead must still be Falcons +6, not Over 48.
    { isProp: false, pick: "Over 48", market: "Total" },
    { isProp: false, pick: "Falcons +6", market: "Spread" },
    { isProp: false, pick: "Colts +2.5", market: "Alt Spread" },
  ];
  const out = interleaveSidesWithProps(picks);
  assert.equal(out[0]!.pick, "Falcons +6");
  assert.notEqual(out[0]!.pick, "Over 48");
  assert.ok(out.slice(0, 3).some((p) => !p.isProp), "first viewport must include a side");
});

/** Qualified multi-family pool for generic market-agnostic mix regression. */
function multiFamilyQualifiedPool(): BoardScoredLeg[] {
  const props: BoardScoredLeg[] = Array.from({ length: 6 }, (_, i) =>
    leg(
      {
        game: `PropAway${i} @ PropHome${i}`,
        market: "Receptions",
        pick: `Skill${i} Over 3.5`,
        odds: -110,
        isProp: true,
        player: `Skill${i}`,
        propLine: 3.5,
        propSide: "Over",
        sport: "nfl",
      },
      88 - i,
      qualifiedScore,
    ),
  );
  const moneylines: BoardScoredLeg[] = Array.from({ length: 4 }, (_, i) =>
    leg(
      {
        game: `MlAway${i} @ MlHome${i}`,
        market: "Moneyline",
        pick: `MlAway${i} ML`,
        odds: 125,
        sport: "nfl",
      },
      86 - i,
      qualifiedScore,
    ),
  );
  const spreads: BoardScoredLeg[] = Array.from({ length: 4 }, (_, i) =>
    leg(
      {
        game: `SpAway${i} @ SpHome${i}`,
        market: "Spread",
        pick: `SpAway${i} -3.5`,
        odds: -110,
        sport: "nfl",
      },
      84 - i,
      qualifiedScore,
    ),
  );
  const teamTotals: BoardScoredLeg[] = Array.from({ length: 3 }, (_, i) =>
    leg(
      {
        game: `TtAway${i} @ TtHome${i}`,
        market: "Team Total",
        pick: `TtAway${i} Over 22.5`,
        odds: -110,
        sport: "nfl",
      },
      82 - i,
      qualifiedScore,
    ),
  );
  const alts: BoardScoredLeg[] = Array.from({ length: 4 }, (_, i) =>
    leg(
      {
        game: `AltAway${i} @ AltHome${i}`,
        market: "Alt Spread",
        pick: `AltAway${i} +1.5`,
        odds: -115,
        sport: "nfl",
      },
      80 - i,
      qualifiedScore,
    ),
  );
  const totals: BoardScoredLeg[] = Array.from({ length: 4 }, (_, i) =>
    leg(
      {
        game: `TotAway${i} @ TotHome${i}`,
        market: "Total",
        pick: `Over ${44 + i}.5`,
        odds: -110,
        sport: "nfl",
      },
      95 - i,
      qualifiedScore,
    ),
  );
  return [...props, ...moneylines, ...spreads, ...teamTotals, ...alts, ...totals];
}

function familiesPresent(mix: ReturnType<typeof ticketCategoryMix>): number {
  return (["props", "gameLines", "teamTotals", "alternateLines"] as const).filter(
    (k) => mix[k] > 0,
  ).length;
}

test("generic mix: multi-family pool → ticket uses props + game lines + alts (no mono-family)", () => {
  const scored = multiFamilyQualifiedPool();
  const { picks } = buildBalancedStagedTicketFromScan(scored, 10);
  assert.ok(picks.length >= 8, `expected near-target ticket, got ${picks.length}`);
  const mix = ticketCategoryMix(picks);
  assert.ok(
    familiesPresent(mix) >= 3,
    `generic 10-leg must span ≥3 market families when pool supports it, got ${JSON.stringify(mix)}`,
  );
  assert.ok(mix.props > 0 && mix.props < picks.length, `must not be all props: ${JSON.stringify(mix)}`);
  assert.ok(
    mix.gameLines + mix.alternateLines > 0,
    `must include game-line/alt seats: ${JSON.stringify(mix)}`,
  );
  assert.ok(
    mix.props + mix.teamTotals < picks.length,
    `must not collapse to props+team-totals only: ${JSON.stringify(mix)}`,
  );
});

test("generic mix: 5/7/8-leg targets keep multi-family preference (no hard quotas)", () => {
  const scored = multiFamilyQualifiedPool();
  for (const n of [5, 7, 8]) {
    const { picks } = buildBalancedStagedTicketFromScan(scored, n);
    assert.equal(picks.length, n, `${n}-leg shortfall unexpectedly`);
    const mix = ticketCategoryMix(picks);
    assert.ok(
      familiesPresent(mix) >= 2,
      `${n}-leg generic must use ≥2 families when pool supports it, got ${JSON.stringify(mix)}`,
    );
    assert.notEqual(mix.props, n, `${n}-leg must not be all player props`);
    assert.notEqual(mix.gameLines, n, `${n}-leg must not be all game lines`);
  }
});

test("generic mix: sides preferred — not all Overs/Unders when spreads/ML qualify", () => {
  const scored = multiFamilyQualifiedPool();
  const { picks } = buildBalancedStagedTicketFromScan(scored, 8);
  const ouOnly = picks.every(
    (p) => /\bover\b|\bunder\b/i.test(p.pick) || boardMarketCategory(p) === "teamTotals",
  );
  assert.equal(ouOnly, false, `ticket must not be all O/U when sides qualify: ${picks.map((p) => p.pick)}`);
  const sideCount = picks.filter(
    (p) => !p.isProp && (gameLineFamily(p) === "spread" || gameLineFamily(p) === "moneyline"),
  ).length;
  assert.ok(sideCount >= 1, `expected ≥1 spread/ML seat, got ${picks.map((p) => `${p.market}:${p.pick}`)}`);
});

test("generic mix: honest mono-family shortfall when only one family qualifies — no filler", () => {
  const propsOnlyPool: BoardScoredLeg[] = Array.from({ length: 4 }, (_, i) =>
    leg(
      {
        game: `Only${i} @ X${i}`,
        market: "Points",
        pick: `Only${i} Over 20.5`,
        odds: -110,
        isProp: true,
        player: `Only${i}`,
        propLine: 20.5,
        propSide: "Over",
      },
      90 - i,
      qualifiedScore,
    ),
  );
  const { picks } = buildBalancedStagedTicketFromScan(propsOnlyPool, 8);
  assert.equal(picks.length, 4, "must not invent legs outside the qualified pool");
  assert.ok(picks.every((p) => p.isProp));
});

test("generic mix via buildStagedTicketFromScan (no varietySeed) stays multi-family", () => {
  const scored = multiFamilyQualifiedPool();
  const { picks } = buildStagedTicketFromScan(scored, 7);
  const mix = ticketCategoryMix(picks);
  assert.ok(
    familiesPresent(mix) >= 2,
    `staged generic 7-leg must be multi-family, got ${JSON.stringify(mix)}`,
  );
});

test("generic mix via independent path (varietySeed) still prefers multi-family", () => {
  const scored = multiFamilyQualifiedPool();
  const { picks } = buildIndependentCoachTicket(scored, 8, {
    varietySeed: "generic-mix-lock",
  });
  const mix = ticketCategoryMix(picks);
  assert.ok(picks.length >= 6, `expected filled ticket, got ${picks.length}`);
  assert.ok(
    familiesPresent(mix) >= 2,
    `independent generic path must stay multi-family, got ${JSON.stringify(mix)}`,
  );
  assert.notEqual(mix.props, picks.length, "must not be all props");
  assert.notEqual(mix.gameLines, picks.length, "must not be all game lines");
});
