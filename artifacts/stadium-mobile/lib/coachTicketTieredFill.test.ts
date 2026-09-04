import test from "node:test";
import assert from "node:assert/strict";
import { buildIndependentCoachTicket } from "./coachTicketCombinations.ts";
import { buildStagedTicketFromScan, type BoardScoredLeg } from "./ticketStaging.ts";
import { boardScanStagedLegQualifies } from "./pickRecommendation.ts";
import type { ParsedPick } from "./parsedPick.ts";

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
    grade: finalAiScore?.grade ?? "B",
    simHit: finalAiScore?.simHit ?? 0.55,
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

const bTierGameLine = {
  composite: 6,
  grade: "B",
  confidencePct: 55,
  edgePct: 2,
  simHit: 0.56,
  simAligned: true,
  highRiskValuePlay: false,
  recommends: false,
  factors: [],
  rubric: { composite: 6, grade: "B", confidencePct: 55, edgePct: 2, scores: {} as never },
};

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
