import assert from "node:assert/strict";
import test from "node:test";

import { compareBoardLegsForRank } from "./coachBoardRankVariety.ts";
import {
  legHasPositiveEvForValueStyle,
  resolveCoachTicketStyle,
} from "./coachTicketQualityTiers.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";

function leg(opts: {
  odds?: number;
  ev?: number | null;
  edge?: number | null;
  rank?: number;
}): BoardScoredLeg {
  return {
    pick: {
      game: "A @ B",
      market: "Moneyline",
      pick: "A ML",
      odds: opts.odds ?? -110,
      sport: "nfl",
      isProp: false,
    } as BoardScoredLeg["pick"],
    evPct: opts.ev ?? null,
    edgePct: opts.edge ?? null,
    confidencePct: 60,
    impliedProbPct: 50,
    lineShoppingScore: null,
    grade: "B+",
    simHit: 0.55,
    composite: 7,
    rankScore: opts.rank ?? 50,
  };
}

test("resolveCoachTicketStyle prefers explicit Home mode over ask text", () => {
  assert.equal(resolveCoachTicketStyle("value", "safe chalk lock"), "value");
  assert.equal(resolveCoachTicketStyle("longshot", "best balanced parlay"), "longshot");
  assert.equal(resolveCoachTicketStyle(null, "safe lower-risk parlay"), "safe");
  assert.equal(resolveCoachTicketStyle(undefined, "lottery boom"), "longshot");
  assert.equal(resolveCoachTicketStyle("nope", "4 leg tonight"), "balanced");
});

test("legHasPositiveEvForValueStyle requires positive EV or edge", () => {
  assert.equal(legHasPositiveEvForValueStyle({ evPct: 2, edgePct: -1 }), true);
  assert.equal(legHasPositiveEvForValueStyle({ evPct: null, edgePct: 1.5 }), true);
  assert.equal(legHasPositiveEvForValueStyle({ evPct: 0, edgePct: 0 }), false);
  assert.equal(legHasPositiveEvForValueStyle({ evPct: -2, edgePct: null }), false);
});

test("value style ranks by EV ahead of composite rankScore", () => {
  const highEv = leg({ ev: 8, rank: 10, odds: -120 });
  const lowEv = leg({ ev: 1, rank: 90, odds: -110 });
  assert.ok(compareBoardLegsForRank(highEv, lowEv, "seed", "value") < 0);
  // Without value style, rankScore still leads when not near-equal.
  assert.ok(compareBoardLegsForRank(highEv, lowEv, "seed", "balanced") > 0);
});

test("longshot style prefers higher American odds when ranks are near-equal", () => {
  const chalk = leg({ odds: -150, rank: 50, edge: 2 });
  const dog = leg({ odds: 450, rank: 51, edge: 2.1 });
  assert.ok(compareBoardLegsForRank(dog, chalk, "seed", "longshot") < 0);
});
