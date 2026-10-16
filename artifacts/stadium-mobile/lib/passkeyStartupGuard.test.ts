/**
 * Regression: RootLayout mounts ClerkProvider with
 * `__experimental_passkeys={getPasskeys() ?? undefined}` on every cold start.
 * On Build 78 / preview-build78 (no ClerkExpoPasskeys), evaluating
 * `@clerk/expo/passkeys` throws and Expo ErrorRecovery aborts the process.
 * Startup must call getPasskeys() without ever requiring that package.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  __setPasskeysLoaderForTests,
  __setPasskeysNativePresentForTests,
  getPasskeys,
  hasClerkExpoPasskeysNative,
} from "./passkeyAuth.ts";

/** Mirrors app/_layout.tsx RootLayoutContent → ClerkProvider prop. */
function rootLayoutPasskeysProp(): unknown {
  return getPasskeys() ?? undefined;
}

describe("startup succeeds with ClerkExpoPasskeys absent", () => {
  it("RootLayout passkeys prop resolves without requiring @clerk/expo/passkeys", () => {
    let loaderCalls = 0;
    __setPasskeysNativePresentForTests(() => false);
    __setPasskeysLoaderForTests(() => {
      loaderCalls += 1;
      throw new Error("Cannot find native module 'ClerkExpoPasskeys'");
    });
    try {
      assert.equal(hasClerkExpoPasskeysNative(), false);
      const prop = rootLayoutPasskeysProp();
      assert.equal(prop, undefined);
      assert.equal(loaderCalls, 0);
      // Second mount / re-render must stay fail-soft.
      assert.equal(rootLayoutPasskeysProp(), undefined);
      assert.equal(loaderCalls, 0);
    } finally {
      __setPasskeysNativePresentForTests(null);
      __setPasskeysLoaderForTests(null);
    }
  });

  it("documents the failed-release fatal string for regression search", () => {
    // Evidence for tip c859c1ce / 01a142e1 on passkeys-absent binary (Build 79).
    // Oct 14 Build 78 is NOT attributed to this string without its own fatal log.
    const failedReleaseFatal =
      "Cannot find native module 'ClerkExpoPasskeys'";
    assert.match(failedReleaseFatal, /ClerkExpoPasskeys/);
  });
});
