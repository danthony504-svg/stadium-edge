import test from "node:test";
import assert from "node:assert/strict";
import { buildIndependentCoachTicket } from "./coachTicketCombinations.ts";
import { buildStagedTicketFromScan, type BoardScoredLeg } from "./ticketStaging.ts";
import { boardScanStagedLegQualifies } from "./pickRecommendation.ts";
import type { ParsedPick } from "../components/PickCard.tsx";
import {
  buildTieredFillLegNote,
  legMeetsEliteTier,
  legMeetsExpandedTier,
  resolveQualifyingPoolForTarget,
  tieredFillToTarget,
} from "./coachTicketTieredFill.ts";

function leg(
  pick: Partial<ParsedPick> & Pick<ParsedPick, "game" | "market" | "pick" | "odds">,
  rankScore: number,
  finalAiScore?: ParsedPick["finalAiScore"],
  evPct = 2,
): BoardScoredLeg {
  const full: ParsedPick = {
    isProp: false,
    sport: "mlb",
    ...pick,
    finalAiScore: finalAiScore ?? pick.finalAiScore,
  };
  return {
    pick: full,
    evPct,
    edgePct: 3,
    confidencePct: 55,
    impliedProbPct: 50,
    lineShoppingScore: 1,
    grade: finalAiScore?.grade ?? "B",
    simHit: finalAiScore?.simHit ?? 0.55,
    composite: 7,
    rankScore,
  };
}

function scoreWith(
  grade: string,
  confidencePct: number,
  recommends = true,
  rubricConfidence?: number,
) {
  const rubricScores = rubricConfidence != null
    ? {
        matchup: rubricConfidence,
        trend: rubricConfidence,
        lineValue: rubricConfidence,
        injury: rubricConfidence,
        lineShopping: rubricConfidence,
        simulation: rubricConfidence,
      }
    : ({} as never);
  return {
    composite: 8,
    grade,
    confidencePct,
    edgePct: 4,
    simHit: 0.56,
    simAligned: true,
    highRiskValuePlay: false,
    recommends,
    factors: [],
    rubric: { composite: 8, grade, confidencePct, edgePct: 4, scores: rubricScores },
  };
}

const mainScore = scoreWith("B+", 58);
const bTierGameLine = scoreWith("B", 55, false);

test("elite tier requires A+ grade and confidence ≥9/10", () => {
  const elite = leg(
    { game: "A @ B", market: "Spread", pick: "B -3.5", odds: -110 },
    100,
    scoreWith("A+", 92, true, 9.2),
  );
  const notEliteGrade = leg(
    { game: "C @ D", market: "Total", pick: "Over 8.5", odds: -110 },
    95,
    scoreWith("A", 92, true, 9.2),
  );
  assert.equal(legMeetsEliteTier(elite), true);
  assert.equal(legMeetsEliteTier(notEliteGrade), false);
});

test("expanded tier requires A or better and confidence ≥8.5/10", () => {
  const expanded = leg(
    { game: "A @ B", market: "Spread", pick: "B -3.5", odds: -110 },
    100,
    scoreWith("A", 86, true),
  );
  const belowConf = leg(
    { game: "C @ D", market: "Total", pick: "Over 8.5", odds: -110 },
    95,
    scoreWith("A+", 82, true),
  );
  assert.equal(legMeetsExpandedTier(expanded), true);
  assert.equal(legMeetsExpandedTier(belowConf), false);
});

test("resolveQualifyingPoolForTarget picks expanded pool when elite is short", () => {
  const scored: BoardScoredLeg[] = [
    leg({ game: "G1", market: "Spread", pick: "A -1.5", odds: -110 }, 100, scoreWith("A+", 92, true, 9.2)),
    leg({ game: "G2", market: "Spread", pick: "B -1.5", odds: -110 }, 99, scoreWith("A+", 91, true, 9.1)),
    leg({ game: "G3", market: "Total", pick: "Over 7.5", odds: -110 }, 98, scoreWith("A", 86, true)),
    leg({ game: "G4", market: "Total", pick: "Over 8.5", odds: -110 }, 97, scoreWith("A", 85, true)),
    leg({ game: "G5", market: "Moneyline", pick: "C ML", odds: 120 }, 96, scoreWith("A", 85, true)),
    leg({ game: "G6", market: "Moneyline", pick: "D ML", odds: 130 }, 95, scoreWith("A", 85, true)),
  ];
  const { pool, summary } = resolveQualifyingPoolForTarget(scored, 5, "balanced");
  assert.equal(summary.eliteCount, 2);
  assert.equal(summary.expandedCount, 6);
  assert.equal(summary.selectedPool, "expanded");
  assert.equal(pool.length, 6);
});

test("buildIndependentCoachTicket fills 5-leg ask from expanded pool when only 2 elite", () => {
  const scored: BoardScoredLeg[] = [
    leg({ game: "G1", market: "Spread", pick: "A -1.5", odds: -110 }, 100, scoreWith("A+", 92, true, 9.2)),
    leg({ game: "G2", market: "Spread", pick: "B -1.5", odds: -110 }, 99, scoreWith("A+", 91, true, 9.1)),
    leg({ game: "G3", market: "Total", pick: "Over 7.5", odds: -110 }, 98, scoreWith("A", 86, true)),
    leg({ game: "G4", market: "Total", pick: "Over 8.5", odds: -110 }, 97, scoreWith("A", 85, true)),
    leg({ game: "G5", market: "Moneyline", pick: "C ML", odds: 120 }, 96, scoreWith("A", 85, true)),
    leg({ game: "G6", market: "Moneyline", pick: "D ML", odds: 130 }, 95, scoreWith("A", 85, true)),
    leg({ game: "G7", market: "ML", pick: "E ML", odds: 140 }, 50, mainScore),
    leg({ game: "G8", market: "ML", pick: "F ML", odds: 150 }, 49, mainScore),
  ];
  const { picks, tieredFill } = buildIndependentCoachTicket(scored, 5, {
    varietySeed: "elite-expand-5",
    ticketStyle: "balanced",
  });
  assert.equal(picks.length, 5, `expected 5 legs, got ${picks.length}`);
  assert.equal(tieredFill?.selectedPool, "expanded");
  assert.ok(
    picks.every((p) => boardScanStagedLegQualifies(p, p.finalAiScore)),
    "all delivered legs must pass staged delivery gates",
  );
});

test("tieredFillToTarget tops up with highest-EV safety legs when expanded pool is short", () => {
  const scored: BoardScoredLeg[] = [
    leg({ game: "G1", market: "Spread", pick: "A -1.5", odds: -110 }, 100, scoreWith("A+", 92, true, 9.2), 3),
    leg({ game: "G2", market: "Spread", pick: "B -1.5", odds: -110 }, 99, scoreWith("A+", 91, true, 9.1), 2.8),
    leg({ game: "G3", market: "Total", pick: "Over 7.5", odds: -110 }, 98, scoreWith("A", 86, true, 8.6), 2.5),
    leg({ game: "C @ D", market: "Spread", pick: "C -3.5", odds: -110 }, 90, bTierGameLine, 4.5),
    leg({ game: "E @ F", market: "Moneyline", pick: "E ML", odds: 120 }, 85, bTierGameLine, 4.2),
    leg({ game: "G @ H", market: "Moneyline", pick: "G ML", odds: 130 }, 80, bTierGameLine, 3.9),
  ];
  const { picks, summary } = tieredFillToTarget([], 5, scored, "balanced", "safety-top-up");
  assert.equal(picks.length, 5);
  assert.equal(summary.safetyFillCount, 2);
  assert.ok(picks.some((p) => p.coachFillTier === "B"));
});

test("buildIndependentCoachTicket fills 4-leg ask with B-tier fallback legs", () => {
  const scored: BoardScoredLeg[] = [
    leg({ game: "A @ B", market: "Spread", pick: "B -3.5", odds: -110 }, 100, mainScore),
    leg({ game: "C @ D", market: "Total", pick: "Over 8.5", odds: -110 }, 95, bTierGameLine),
    leg({ game: "E @ F", market: "Moneyline", pick: "E ML", odds: 120 }, 90, bTierGameLine),
    leg({ game: "G @ H", market: "Moneyline", pick: "G ML", odds: 130 }, 85, bTierGameLine),
  ];
  const { picks } = buildIndependentCoachTicket(scored, 4, {
    varietySeed: "tiered-fill-4",
    ticketStyle: "balanced",
  });
  assert.equal(picks.length, 4, `expected 4 legs, got ${picks.length}`);
  assert.ok(
    picks.some((p) => p.coachFillTier === "B" || p.coachFillTier === "B+"),
    "expected at least one tier-relaxed fill leg",
  );
  assert.ok(
    picks.every((p) => boardScanStagedLegQualifies(p, p.finalAiScore)),
    "all delivered legs must pass staged delivery gates",
  );
});

test("safe ticket style does not fill below B+ even when B-tier legs exist", () => {
  const scored: BoardScoredLeg[] = [
    leg({ game: "A @ B", market: "Spread", pick: "B -3.5", odds: -110 }, 100, mainScore),
    leg({ game: "C @ D", market: "Total", pick: "Over 8.5", odds: -110 }, 95, bTierGameLine),
    leg({ game: "E @ F", market: "Moneyline", pick: "E ML", odds: 120 }, 90, bTierGameLine),
    leg({ game: "G @ H", market: "Moneyline", pick: "G ML", odds: 130 }, 85, bTierGameLine),
  ];
  const { picks } = buildStagedTicketFromScan(scored, 4, "safe-fill-4", { ticketStyle: "safe" });
  assert.equal(picks.length, 1, "safe style should not backfill B-tier-only legs");
});

test("buildTieredFillLegNote explains elite shortfall and safety top-up", () => {
  const note = buildTieredFillLegNote(
    {
      eliteCount: 3,
      expandedCount: 3,
      strictQualifiedCount: 10,
      selectedPool: "mixed",
      safetyFillCount: 2,
      expandedFillCount: 0,
    },
    5,
    5,
  );
  assert.match(note, /Elite bar/i);
  assert.match(note, /remaining \*\*2\*\* legs/i);
  assert.match(note, /highest-EV/i);
});
