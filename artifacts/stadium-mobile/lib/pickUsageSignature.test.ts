import assert from "node:assert/strict";
import test from "node:test";
import {
  pickLineBucket,
  pickSideShape,
  pickUsageSignature,
} from "./pickUsageSignature.ts";
import {
  clearParlayVarietyMemory,
  pickUsageCount,
  recentParlayVarietyContext,
  rememberParlayBuild,
} from "./parlayVarietyMemory.ts";
import { SLIP_UI_ENABLED } from "./slipUi.ts";

test("SLIP_UI_ENABLED is off — Add to slip / Slip page stay hidden", () => {
  assert.equal(SLIP_UI_ENABLED, false);
});

test("pickUsageSignature collapses F5 run line dog alts across teams", () => {
  const yankees = pickUsageSignature({
    market: "F5 Run Line",
    pick: "Yankees +0.5",
  });
  const padres = pickUsageSignature({
    market: "F5 Run Line",
    pick: "Padres +0.5",
  });
  assert.equal(yankees, padres);
  assert.match(yankees, /^game\|f5:spread\|plus\|0\.5$/);
});

test("pickUsageSignature collapses Hits+Runs+RBIs Over 0.5 across players", () => {
  const a = pickUsageSignature({
    market: "Hits+Runs+RBIs",
    pick: "Brenton Doyle Over 0.5 Hits+Runs+RBIs",
    isProp: true,
    player: "Brenton Doyle",
  });
  const b = pickUsageSignature({
    market: "Hits+Runs+RBIs",
    pick: "Aaron Judge Over 0.5 Hits+Runs+RBIs",
    isProp: true,
    player: "Aaron Judge",
  });
  assert.equal(a, b);
  assert.match(a, /^prop\|hits runs rbis\|over\|0\.5$/);
});

test("pickSideShape and pickLineBucket are stable helpers", () => {
  assert.equal(pickSideShape("Yankees +0.5"), "plus");
  assert.equal(pickSideShape("Over 1.5 Hits", "Over"), "over");
  assert.equal(pickLineBucket(0.5), "0.5");
  assert.equal(pickLineBucket(4.5), "4-7.5");
});

test("rememberParlayBuild counts repeated market-shape signatures", () => {
  clearParlayVarietyMemory();
  rememberParlayBuild([
    {
      game: "New York Yankees @ Tampa Bay Rays",
      market: "F5 Run Line",
      pick: "Yankees +0.5",
      odds: -120,
      isProp: false,
    },
  ] as never);
  rememberParlayBuild([
    {
      game: "San Diego Padres @ Milwaukee Brewers",
      market: "F5 Run Line",
      pick: "Padres +0.5",
      odds: -115,
      isProp: false,
    },
  ] as never);
  const sig = pickUsageSignature({
    market: "F5 Run Line",
    pick: "Dodgers +0.5",
  });
  const ctx = recentParlayVarietyContext();
  assert.equal(ctx.recentSignatureCounts.get(sig), 2);
  assert.equal(
    pickUsageCount({ market: "F5 Run Line", pick: "Sox +0.5" }),
    2,
  );
});
