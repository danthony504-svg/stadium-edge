import assert from "node:assert/strict";
import test from "node:test";

import { addMissingSlipLegs } from "./bulkSlipLegs.ts";
import { coachScreenInteractionEnabled } from "./coachPartialUi.ts";
import { buildIndependentCoachTicket } from "./coachTicketCombinations.ts";
import type { ParsedPick } from "../components/PickCard.tsx";
import type { BoardScoredLeg } from "./ticketStaging.ts";

const score = {
  composite: 8, grade: "B+", confidencePct: 58, edgePct: 12, simHit: 0.56,
  simAligned: true, highRiskValuePlay: false, recommends: true, factors: [],
  rubric: { composite: 8, grade: "B+", confidencePct: 58, edgePct: 12, scores: {} as never },
};

function qualified(index: number, isProp: boolean, market = isProp ? "Hits" : "Spread"): BoardScoredLeg {
  const game = `Away ${index} @ Home ${index}`;
  const pick: ParsedPick = {
    game, market, pick: isProp ? `Player ${index} Over 1.5 Hits` : `Away ${index} +1.5`,
    player: isProp ? `Player ${index}` : undefined, isProp, odds: -110, sport: "mlb",
    finalAiScore: { ...score, composite: 100 - index },
  };
  return { pick, evPct: 12, edgePct: 12, confidencePct: 58, impliedProbPct: 50,
    lineShoppingScore: null, grade: "B+", simHit: 56, composite: 100 - index, rankScore: 100 - index };
}

test("mixed provider regression: progressive preview stays interactive and final six retains qualified props", () => {
  const providerCandidates = [
    qualified(1, true), qualified(2, true), qualified(3, true), qualified(4, true),
    qualified(5, false, "Moneyline"), qualified(6, false, "Spread"),
    qualified(7, false, "Game Total"), qualified(8, false, "Team Total"),
  ];
  for (const count of [2, 4, 5, 6]) {
    assert.equal(coachScreenInteractionEnabled({ requestActive: true, hasVisiblePartialPicks: count > 0 }), true);
  }
  const { picks } = buildIndependentCoachTicket(providerCandidates, 6, {
    marketAgnostic: true, varietySeed: "production-mixed-six",
  });
  assert.equal(picks.length, 6);
  assert.ok(picks.filter((pick) => pick.isProp).length >= 1);
  assert.ok(picks.some((pick) => !pick.isProp));

  type Stored = ParsedPick & { id: string };
  const stored = addMissingSlipLegs<ParsedPick, Stored>([], picks, 15, (pick) => ({
    ...pick, id: `${pick.game}|${pick.market}|${pick.pick}`.toLowerCase(),
  }));
  assert.equal(stored.legs.length, 6);
  assert.equal(new Set(stored.legs.map((pick) => pick.id)).size, 6);
});
