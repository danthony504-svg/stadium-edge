import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { compareBoardLegsForRank } from "./coachBoardRankVariety.ts";
import { parlayAmerican } from "./format.ts";
import {
  legAllowedForTicketStyle,
  legHasPositiveEvForValueStyle,
  legQualifiesForLongshotStyle,
  LONGSHOT_MIN_AMERICAN_ODDS,
  resolveCoachTicketStyle,
} from "./coachTicketQualityTiers.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";

function leg(opts: {
  odds?: number;
  ev?: number | null;
  edge?: number | null;
  rank?: number;
  pickLabel?: string;
}): BoardScoredLeg {
  return {
    pick: {
      game: "A @ B",
      market: "Spread",
      pick: opts.pickLabel ?? "A +3.5",
      odds: opts.odds ?? -110,
      sport: "mlb",
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
  assert.ok(compareBoardLegsForRank(highEv, lowEv, "seed", "balanced") > 0);
});

test("longshot style rejects Guardians-style heavy chalk (−575)", () => {
  const chalk = leg({
    odds: -575,
    rank: 99,
    edge: 8,
    pickLabel: "Guardians +3.5",
  });
  assert.equal(legQualifiesForLongshotStyle(chalk), false);
  assert.ok(LONGSHOT_MIN_AMERICAN_ODDS >= 100);
});

test("longshot style prefers higher American odds even when chalk has higher rankScore", () => {
  const chalk = leg({ odds: -575, rank: 95, edge: 5, pickLabel: "Guardians +3.5" });
  const dog = leg({ odds: 450, rank: 40, edge: 2, pickLabel: "Underdog ML" });
  // Prior bug: near-equal-only odds bias let −575 chalk win on rankScore.
  assert.ok(compareBoardLegsForRank(dog, chalk, "seed", "longshot") < 0);
  assert.equal(legQualifiesForLongshotStyle(dog), true);
  assert.equal(legQualifiesForLongshotStyle(chalk), false);
});

test("screenshot lead-leg alone cannot establish lottery selection or combined odds", () => {
  // Device claim: ticket started with Guardians +3.5 at −575. Opening Coach +
  // auto-send does not prove longshot seating. Full ticket was not captured —
  // combined odds for a single known chalk leg is undefined for the parlay.
  const knownLead = [-575];
  assert.equal(legQualifiesForLongshotStyle({ odds: -575 }), false);
  // A 1-leg "ticket" of only the lead is not a lottery parlay; report N/A for
  // complete combined odds without the remaining legs.
  const incomplete = knownLead; // missing remaining legs from screenshot
  assert.equal(incomplete.length < 2, true);
  // If someone did combine only that chalk leg, price stays −575 — still not lottery.
  assert.equal(parlayAmerican(knownLead), -575);
});

test("legAllowedForTicketStyle blocks minus-money on longshot (incl. backfill gate)", () => {
  assert.equal(legAllowedForTicketStyle({ odds: -575 }, "longshot"), false);
  assert.equal(legAllowedForTicketStyle({ odds: -110 }, "longshot"), false);
  assert.equal(legAllowedForTicketStyle({ odds: 100 }, "longshot"), true);
  assert.equal(legAllowedForTicketStyle({ odds: 450 }, "longshot"), true);
  // Non-longshot styles do not apply the plus-money floor.
  assert.equal(legAllowedForTicketStyle({ odds: -575 }, "balanced"), true);
  assert.equal(legAllowedForTicketStyle({ odds: -575 }, "safe"), true);
  assert.equal(legAllowedForTicketStyle({ odds: -575 }, "value"), false);
});

test("backfill/replacement helpers refuse minus-money under longshot style", () => {
  const srcCombos = readFileSync(
    new URL("./coachTicketCombinations.ts", import.meta.url),
    "utf8",
  );
  const srcStaging = readFileSync(
    new URL("./ticketStaging.ts", import.meta.url),
    "utf8",
  );
  // Combinator: qualify filter, tryAppendBackfillLeg, pickDiverseLegsFromPool,
  // backfillDiverseTicket, backfillAtQualityTier all gate on style.
  assert.match(srcCombos, /legAllowedForTicketStyle\(row,\s*config\.ticketStyle\)/);
  assert.match(srcCombos, /legAllowedForTicketStyle\(leg,\s*config\.ticketStyle\)/);
  assert.match(srcCombos, /legAllowedForTicketStyle\(next,\s*opts\?\.ticketStyle\)/);
  assert.match(srcCombos, /tryAppendBackfillLeg/);
  assert.match(srcCombos, /backfillDiverseTicket/);
  assert.match(srcCombos, /backfillAtQualityTier/);
  // Staging: primary pool filter, greedy/select loops, tryAppend, props backfill.
  assert.match(srcStaging, /legAllowedForTicketStyle\(row,\s*ticketStyle\)/);
  assert.match(srcStaging, /legAllowedForTicketStyle\(next,\s*opts\?\.ticketStyle\)/);
  assert.match(srcStaging, /applyCapAndBackfillToTarget\([\s\S]*ticketStyle/);
  assert.match(srcStaging, /tieredBackfillStagedTicket/);
});
