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
  researchTesterActiveBuildIds,
  resetResearchTesterSessionsForTests,
  runWithResearchTesterUnlock,
  runWithResearchTesterUnlockAsync,
} from "./researchTesterSession.ts";

test("research tester session defaults locked and clears after scope", () => {
  resetResearchTesterSessionsForTests();
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
  assert.deepEqual(researchTesterActiveBuildIds(), []);
});

test("research tester unlock opens NCAAF game-line / total P0 for research only", () => {
  resetResearchTesterSessionsForTests();
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

test("overlapping unlocked builds never clobber each other via shared boolean restore", async () => {
  resetResearchTesterSessionsForTests();
  let buildASawUnlockDuringOverlap = false;
  let buildBFinished = false;

  const buildA = runWithResearchTesterUnlockAsync(true, async () => {
    assert.equal(isResearchTesterUnlockActive(), true);
    // Start overlapping build B while A is still active.
    await Promise.resolve();
    assert.equal(isResearchTesterUnlockActive(), true);
    // Wait until B has entered and exited — old shared-boolean finally would
    // have restored false here and stripped A's unlock.
    while (!buildBFinished) {
      await Promise.resolve();
    }
    buildASawUnlockDuringOverlap = isResearchTesterUnlockActive();
    return "a";
  });

  const buildB = runWithResearchTesterUnlockAsync(true, async () => {
    assert.equal(isResearchTesterUnlockActive(), true);
    await Promise.resolve();
    assert.equal(isResearchTesterUnlockActive(), true);
    buildBFinished = true;
    return "b";
  });

  const [a, b] = await Promise.all([buildA, buildB]);
  assert.equal(a, "a");
  assert.equal(b, "b");
  assert.equal(buildASawUnlockDuringOverlap, true);
  assert.equal(isResearchTesterUnlockActive(), false);
  assert.deepEqual(researchTesterActiveBuildIds(), []);
});

test("overlapping locked + unlocked builds fail closed (no unlock leak)", async () => {
  resetResearchTesterSessionsForTests();
  let lockedSawUnlock = false;
  let unlockedSawDuringOverlap = true;

  const unlocked = runWithResearchTesterUnlockAsync(true, async () => {
    await Promise.resolve();
    unlockedSawDuringOverlap = isResearchTesterUnlockActive();
    await Promise.resolve();
    return "unlocked";
  });

  const locked = runWithResearchTesterUnlockAsync(false, async () => {
    await Promise.resolve();
    lockedSawUnlock = isResearchTesterUnlockActive();
    await Promise.resolve();
    return "locked";
  });

  await Promise.all([unlocked, locked]);
  // Locked build must never observe unlock.
  assert.equal(lockedSawUnlock, false);
  // Mixed overlap fails closed for everyone while both are active.
  assert.equal(unlockedSawDuringOverlap, false);
  assert.equal(isResearchTesterUnlockActive(), false);
});

test("cancellation / timeout / error paths clear build context", async () => {
  resetResearchTesterSessionsForTests();

  await assert.rejects(
    () =>
      runWithResearchTesterUnlockAsync(true, async () => {
        assert.equal(isResearchTesterUnlockActive(), true);
        throw new Error("build_failed");
      }),
    /build_failed/,
  );
  assert.equal(isResearchTesterUnlockActive(), false);
  assert.deepEqual(researchTesterActiveBuildIds(), []);

  const cancelled = runWithResearchTesterUnlockAsync(true, async () => {
    assert.equal(isResearchTesterUnlockActive(), true);
    const err = new Error("cancelled");
    err.name = "AbortError";
    throw err;
  });
  await assert.rejects(() => cancelled, /cancelled/);
  assert.equal(isResearchTesterUnlockActive(), false);

  const timedOut = runWithResearchTesterUnlockAsync(true, async () => {
    assert.equal(isResearchTesterUnlockActive(), true);
    await Promise.resolve();
    throw Object.assign(new Error("absolute_budget"), { code: "timeout" });
  });
  await assert.rejects(() => timedOut);
  assert.equal(isResearchTesterUnlockActive(), false);
  assert.deepEqual(researchTesterActiveBuildIds(), []);
});

test("client flag alone cannot unlock research P0; async scope clears", async () => {
  resetResearchTesterSessionsForTests();
  assert.equal(isResearchTesterUnlockActive(), false);
  await runWithResearchTesterUnlockAsync(true, async () => {
    assert.equal(isResearchTesterUnlockActive(), true);
  });
  assert.equal(isResearchTesterUnlockActive(), false);
  assert.equal(RESEARCH_NOT_VALIDATED_LABEL, "Research — not validated.");
});
