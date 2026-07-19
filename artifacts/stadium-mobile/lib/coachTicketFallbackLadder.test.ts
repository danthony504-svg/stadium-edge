import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCoachTicketFallbackLadder,
  isTier2SupportedAltMarket,
  legQualifiesTier2,
  legQualifiesTier3,
} from "./coachTicketFallbackLadder.ts";
import { finalizeBoardBuiltCoachTicket } from "./pickRecommendation.ts";
import { buildStagedTicketFromScan, type BoardScoredLeg } from "./ticketStaging.ts";
import type { ParsedPick } from "../components/PickCard.tsx";

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

const mediumScore = {
  composite: 5.5,
  grade: "C",
  confidencePct: 48,
  edgePct: 1.5,
  simHit: 0.54,
  simAligned: false,
  highRiskValuePlay: false,
  recommends: false,
  factors: [],
  rubric: { composite: 5.5, grade: "C", confidencePct: 48, edgePct: 1.5, scores: {} as never },
};

function leg(
  pick: Partial<ParsedPick> & Pick<ParsedPick, "game" | "market" | "pick" | "odds">,
  rankScore: number,
  finalAiScore?: ParsedPick["finalAiScore"],
): BoardScoredLeg {
  const full: ParsedPick = { isProp: false, sport: "mlb", ...pick, finalAiScore: finalAiScore ?? pick.finalAiScore };
  return {
    pick: full,
    evPct: 2,
    edgePct: finalAiScore?.edgePct ?? 2,
    confidencePct: finalAiScore?.confidencePct ?? 55,
    impliedProbPct: 50,
    lineShoppingScore: 1,
    grade: finalAiScore?.grade ?? "B",
    simHit: finalAiScore?.simHit ?? 0.55,
    composite: 7,
    rankScore,
  };
}

test("delivery must not zero B-tier fallback legs that cleared staging", () => {
  const scored: BoardScoredLeg[] = [
    leg({ game: "C @ D", market: "Total", pick: "Over 8.5", odds: -110 }, 95, bTierGameLine),
    leg({ game: "E @ F", market: "Moneyline", pick: "E ML", odds: 120 }, 90, bTierGameLine),
    leg({ game: "G @ H", market: "Moneyline", pick: "G ML", odds: 130 }, 85, bTierGameLine),
    leg({ game: "I @ J", market: "Spread", pick: "I +2.5", odds: -105 }, 80, bTierGameLine),
    leg({ game: "K @ L", market: "Spread", pick: "K -1.5", odds: -108 }, 75, bTierGameLine),
    leg({ game: "M @ N", market: "Total", pick: "Under 9", odds: -112 }, 70, bTierGameLine),
  ];
  const { picks: staged } = buildStagedTicketFromScan(scored, 5, "delivery-b-tier-only-5", { ticketStyle: "balanced" });
  assert.ok(staged.length > 0, `staging produced ${staged.length} picks`);

  const { picks: delivered } = finalizeBoardBuiltCoachTicket(staged, { realOdds: [], propPool: [], gameMeta: [] });
  assert.equal(
    delivered.length,
    staged.length,
    `delivery should keep all ${staged.length} B-tier staged legs, got ${delivered.length}`,
  );
});

test("isTier2SupportedAltMarket recognizes core prop and game markets", () => {
  assert.ok(isTier2SupportedAltMarket("Points"));
  assert.ok(isTier2SupportedAltMarket("Alt Spread"));
  assert.ok(isTier2SupportedAltMarket("Team Total"));
  assert.ok(!isTier2SupportedAltMarket("First Basket"));
});

test("fallback ladder fills 5/10/15 leg targets from qualifying pool", () => {
  const scored: BoardScoredLeg[] = [];
  for (let i = 0; i < 30; i++) {
    scored.push(
      leg(
        {
          game: `Team${i % 6} @ Team${(i + 1) % 6}`,
          market: i % 3 === 0 ? "Spread" : "Moneyline",
          pick: `Pick ${i}`,
          odds: -110 + (i % 5),
        },
        100 - i,
        i === 0 ? mainScore : bTierGameLine,
      ),
    );
  }
  for (const target of [5, 10, 15]) {
    const { picks } = applyCoachTicketFallbackLadder(scored, [], target, `ladder-${target}`);
    assert.ok(picks.length > 0, `expected picks for ${target}-leg target, got 0`);
    assert.ok(picks.length <= target);
  }
});

test("tier 2 medium confidence and tier 3 alt lines require posted odds and positive edge", () => {
  const mediumLeg = leg({ game: "A @ B", market: "Total", pick: "Over 7.5", odds: -110 }, 50, mediumScore);
  assert.ok(legQualifiesTier2(mediumLeg.pick, mediumLeg.pick.finalAiScore));
  const altLeg = leg(
    {
      game: "C @ D",
      market: "Alt Points",
      pick: "Star Over 22.5 Points",
      odds: -115,
      isProp: true,
      player: "Star",
      propLine: 22.5,
      propSide: "Over",
      propIsAlt: true,
    },
    45,
    mediumScore,
  );
  assert.ok(legQualifiesTier3(altLeg.pick, altLeg.pick.finalAiScore));
});
