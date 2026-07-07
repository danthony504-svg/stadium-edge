import assert from "node:assert/strict";
import test from "node:test";

import {
  isKnownCorruptCrashMessage,
  recordBootCrash,
} from "./crashRecovery.ts";

test("isKnownCorruptCrashMessage matches getOddsSelector eval errors", () => {
  assert.equal(
    isKnownCorruptCrashMessage("(eval) Cannot read property 'getOddsSelector' of undefined"),
    true,
  );
  assert.equal(
    isKnownCorruptCrashMessage("Cannot read property 'getOddsSelector' of undefined"),
    true,
  );
  assert.equal(isKnownCorruptCrashMessage("Network request failed"), false);
});

test("recordBootCrash ignores unrelated errors", async () => {
  await recordBootCrash("benign error");
  // No throw — storage is best-effort in tests too.
});
