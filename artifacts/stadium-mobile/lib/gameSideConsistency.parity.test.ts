/**
 * Client/server ranking parity + delivery integrity checks for opposing sides.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { ParsedPick } from "../components/PickCard.tsx";
import {
  compareLegMetrics,
  enforceConsistentGameSides,
  type GameSideLegMetrics,
} from "./gameSideConsistency.ts";
import { finalizeCoachDeliveryPicks } from "./ticketDiversity.ts";
import { dedupePicksByMarketLadder } from "./marketLadderKey.ts";

/** Mirror of server compareMetrics — keep in sync with coachSlateGameSideConsistency. */
function serverCompareMetrics(
  a: {
    qualified: boolean;
    composite: number;
    simAligned: boolean;
    edgePct: number;
    evPct: number;
  },
  b: typeof a,
): number {
  if (a.qualified !== b.qualified) return a.qualified ? 1 : -1;
  if (a.composite !== b.composite) return a.composite - b.composite;
  if (a.simAligned !== b.simAligned) return a.simAligned ? 1 : -1;
  if (a.edgePct !== b.edgePct) return a.edgePct - b.edgePct;
  if (a.evPct !== b.evPct) return a.evPct - b.evPct;
  return 0;
}

test("client/server compare order is identical on shared metrics", () => {
  const cases: Array<[GameSideLegMetrics, GameSideLegMetrics]> = [
    [
      {
        qualified: true,
        composite: 8,
        edgePct: 3,
        evPct: 2,
        simAligned: true,
        marketSimHit: 0.55,
      },
      {
        qualified: true,
        composite: 7,
        edgePct: 5,
        evPct: 4,
        simAligned: true,
        marketSimHit: 0.7,
      },
    ],
    [
      {
        qualified: false,
        composite: 9,
        edgePct: 5,
        evPct: 4,
        simAligned: true,
        marketSimHit: 0.8,
      },
      {
        qualified: true,
        composite: 6,
        edgePct: 1,
        evPct: 0.5,
        simAligned: false,
        marketSimHit: 0.5,
      },
    ],
    [
      {
        qualified: true,
        composite: 7,
        edgePct: 2,
        evPct: 1,
        simAligned: true,
        marketSimHit: 0.54,
      },
      {
        qualified: true,
        composite: 7,
        edgePct: 2,
        evPct: 1.5,
        simAligned: true,
        marketSimHit: 0.9,
      },
    ],
  ];
  for (const [a, b] of cases) {
    assert.equal(
      Math.sign(compareLegMetrics(a, b)),
      Math.sign(serverCompareMetrics(a, b)),
      `parity fail ${JSON.stringify(a)} vs ${JSON.stringify(b)}`,
    );
  }
});

function scored(
  pick: string,
  market: string,
  odds: number,
  composite: number,
  edgePct: number,
  simHit: number,
  game = "Away Team @ Home Team",
): ParsedPick {
  return {
    game,
    market,
    pick,
    odds,
    isProp: false,
    sport: "nfl",
    finalAiScore: {
      composite,
      grade: "B+",
      confidencePct: 60,
      edgePct,
      simHit,
      simAligned: simHit >= 0.52,
      highRiskValuePlay: false,
      recommends: true,
      factors: [],
      rubric: {
        scores: {},
        composite,
        grade: "B+",
        confidencePct: 60,
        edgePct,
      },
    },
  };
}

test("delivery belt: no opposite-team conflict after finalizeCoachDeliveryPicks", () => {
  const game = "Detroit Lions @ Kansas City Chiefs";
  const picks = [
    scored("Chiefs -6.5", "Spread", -110, 6.5, 0.5, 0.52, game),
    scored("Lions +6.5", "Spread", -110, 8.1, 3.5, 0.57, game),
    scored("Chiefs ML", "Moneyline", -180, 6.0, 0.2, 0.6, game),
  ];
  // Ladder dedupe alone keeps both sides (different side keys).
  const afterLadder = dedupePicksByMarketLadder(picks);
  assert.ok(afterLadder.length >= 2);

  const delivered = finalizeCoachDeliveryPicks(afterLadder);
  assert.equal(delivered.length, 1);
  assert.match(delivered[0]!.pick, /Lions/i);
  const sides = new Set(
    delivered.map((p) => (/lions/i.test(p.pick) ? "away" : "home")),
  );
  assert.equal(sides.size, 1);
});

test("delivery belt: duplicate alt lines on same side collapse to one", () => {
  const game = "Away Dogs @ Home Chalk";
  const picks = [
    scored("Away Dogs +7.5", "Alt Spread", -105, 7.2, 2.0, 0.55, game),
    scored("Away Dogs +3.5", "Spread", -110, 8.0, 3.5, 0.56, game),
    scored("Home Chalk -3.5", "Spread", -110, 6.0, 0.4, 0.52, game),
  ];
  const afterLadder = dedupePicksByMarketLadder(picks);
  // Same-side alts share a ladder → one away rung before side consistency.
  assert.equal(afterLadder.filter((p) => /Away Dogs/.test(p.pick)).length, 1);

  const delivered = finalizeCoachDeliveryPicks(afterLadder);
  assert.equal(delivered.length, 1);
  assert.match(delivered[0]!.pick, /Away Dogs/);
  // No second alt on the same team.
  assert.equal(delivered.filter((p) => /Away Dogs/.test(p.pick)).length, 1);
});

test("full delivery belt: one side per game and one rung per team", () => {
  const game = "A @ B";
  const delivered = finalizeCoachDeliveryPicks([
    scored("A +3", "Spread", -110, 7.5, 2, 0.55, game),
    scored("B -3", "Spread", -110, 6.5, 0.5, 0.53, game),
    scored("A ML", "Moneyline", 150, 7.0, 1.5, 0.48, game),
  ]);
  // Same-team dedupe → one A leg; opposite B dropped.
  assert.equal(delivered.length, 1);
  assert.ok(delivered.every((p) => /^A\b/.test(p.pick)));
  assert.ok(delivered.every((p) => !/^B\b/.test(p.pick)));
});
