import assert from "node:assert/strict";
import test from "node:test";

import { shouldAllowAutoReload, type OtaReloadGuard } from "./otaReloadGuard.ts";

test("shouldAllowAutoReload allows first attempt for new update id", () => {
  const guard: OtaReloadGuard = {
    updateId: "aaa",
    attempts: 2,
    firstAttemptAt: Date.now(),
  };
  assert.equal(shouldAllowAutoReload(guard, "bbb"), true);
});

test("shouldAllowAutoReload blocks after max attempts within window", () => {
  const now = Date.now();
  const guard: OtaReloadGuard = {
    updateId: "aaa",
    attempts: 2,
    firstAttemptAt: now - 1000,
  };
  assert.equal(shouldAllowAutoReload(guard, "aaa", now), false);
});

test("shouldAllowAutoReload resets after guard window", () => {
  const now = Date.now();
  const guard: OtaReloadGuard = {
    updateId: "aaa",
    attempts: 5,
    firstAttemptAt: now - 61 * 60 * 1000,
  };
  assert.equal(shouldAllowAutoReload(guard, "aaa", now), true);
});
