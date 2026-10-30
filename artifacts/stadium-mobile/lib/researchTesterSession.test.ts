import assert from "node:assert/strict";
import test from "node:test";

import {
  isP0UnvalidatedNcaafGameLineMarket,
  isP0UnvalidatedSimTotalMarket,
  ncaafGameLineAskIsP0Blocked,
  NCAAF_GAME_LINE_SIM_VALIDATED,
  p0UnvalidatedSimDecision,
} from "./coachP0UnvalidatedTotals.ts";
import {
  isResearchTesterUnlockActive,
  RESEARCH_NOT_VALIDATED_LABEL,
  runWithResearchTesterUnlock,
  runWithResearchTesterUnlockAsync,
} from "./researchTesterSession.ts";

test("research tester session defaults locked and restores after scope", () => {
  assert.equal(isResearchTesterUnlockActive(), false);
  assert.equal(
    runWithResearchTesterUnlock(true, () => isResearchTesterUnlockActive()),
    true,
  );
  assert.equal(isResearchTesterUnlockActive(), false);
  assert.equal(
    runWithResearchTesterUnlock(false, () => isResearchTesterUnlockActive()),
    false,
  );
});

test("research tester unlock opens NCAAF game-line / total P0 for research only", () => {
  const spread = { sport: "ncaaf", market: "spread", pick: "Alabama -7.5" };
  const total = { sport: "ncaaf", market: "Total", pick: "Over 48.5" };

  assert.equal(isP0UnvalidatedNcaafGameLineMarket(spread), true);
  assert.equal(isP0UnvalidatedSimTotalMarket(total), true);
  assert.ok(p0UnvalidatedSimDecision(spread));

  runWithResearchTesterUnlock(true, () => {
    assert.equal(isP0UnvalidatedNcaafGameLineMarket(spread), false);
    assert.equal(isP0UnvalidatedSimTotalMarket(total), false);
    assert.equal(p0UnvalidatedSimDecision(spread), null);
    assert.equal(
      ncaafGameLineAskIsP0Blocked({
        gameLinesOnly: true,
        lockedSports: ["ncaaf"],
      }),
      false,
    );
  });

  // Subscriber / default path stays blocked after the research scope ends.
  assert.equal(isP0UnvalidatedNcaafGameLineMarket(spread), true);
  assert.equal(NCAAF_GAME_LINE_SIM_VALIDATED, false);
  assert.equal(
    ncaafGameLineAskIsP0Blocked({
      gameLinesOnly: true,
      lockedSports: ["ncaaf"],
    }),
    true,
  );
});

test("client flag alone cannot unlock research P0; async scope restores", async () => {
  assert.equal(isResearchTesterUnlockActive(), false);
  await runWithResearchTesterUnlockAsync(true, async () => {
    assert.equal(isResearchTesterUnlockActive(), true);
  });
  assert.equal(isResearchTesterUnlockActive(), false);
  assert.equal(RESEARCH_NOT_VALIDATED_LABEL, "Research — not validated.");
});
