import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { buildFixedLegCountShortfallLead } from "./coachScanPolicy.ts";
import { resolveCoachParlayShortfallLead } from "./lockedMarketQualityShortfall.ts";

const root = dirname(fileURLToPath(import.meta.url));

test("buildParlay shortfall uses finalLegCount and drops scanNote when short", () => {
  const src = readFileSync(join(root, "coach/buildParlay.ts"), "utf8");
  assert.match(src, /const finalLegCount = picks\.length/);
  assert.match(src, /qualified: finalLegCount/);
  assert.match(src, /scanNote: finalLegCount < target \? undefined : scan\?\.note/);
  assert.match(src, /topUpAfterMlLean/);
  assert.doesNotMatch(src, /applyPeriodOffenseDefenseCoverRates/);
});

test("shortfall lead cites actual final count not a larger staging pool", () => {
  const note = resolveCoachParlayShortfallLead({
    askText: "7 leg NFL",
    requestedLegs: 7,
    qualified: 5,
    analyzed: 0,
    isMarketLocked: false,
  });
  assert.equal(note, buildFixedLegCountShortfallLead(7, 5));
  assert.match(note, /5/);
  assert.doesNotMatch(note, /\b6\b/);
});
