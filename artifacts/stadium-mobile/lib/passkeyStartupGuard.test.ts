/**
 * Regression: RootLayout mounts ClerkProvider with
 * `__experimental_passkeys={getProviderPasskeys()}` on every cold start.
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
  getProviderPasskeys,
  hasClerkExpoPasskeysNative,
} from "./passkeyAuth.ts";

/** Mirrors app/_layout.tsx RootLayoutContent → ClerkProvider prop. */
function rootLayoutPasskeysProp(): unknown {
  return getProviderPasskeys();
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
    // Preview tip 01a14b8b @ 2e22997b crashed the same way on Build 78 IPA.
    const failedReleaseFatal =
      "Cannot find native module 'ClerkExpoPasskeys'";
    assert.match(failedReleaseFatal, /ClerkExpoPasskeys/);
  });
});


it("ClerkProvider receives only a complete guarded native adapter", () => {
  __setPasskeysNativePresentForTests(() => true);
  try {
    __setPasskeysLoaderForTests(() => ({ isSupported: () => true }));
    assert.equal(getProviderPasskeys(), undefined);
    const adapter = { isSupported: () => true, get: async () => { throw Error("not called"); }, create: async () => { throw Error("not called"); } };
    __setPasskeysLoaderForTests(() => adapter);
    assert.equal(getProviderPasskeys(), adapter);
  } finally {
    __setPasskeysNativePresentForTests(null);
    __setPasskeysLoaderForTests(null);
  }
});
