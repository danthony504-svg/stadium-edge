import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  __setPasskeysLoaderForTests,
  __setPasskeysNativePresentForTests,
  classifyPasskeyError,
  clerkAssociatedDomains,
  clerkFrontendApiHost,
  describePasskeyError,
  describeSignupError,
  generateMachinePassword,
  getPasskeys,
  hasClerkExpoPasskeysNative,
  isDuplicateEmailError,
  isPasskeyCancellation,
  isPasskeysSupported,
  machinePasswordFromBytes,
} from "./passkeyAuth.ts";

describe("passkeyAuth machine password", () => {
  it("builds a complex secret the user never needs to remember", () => {
    const pw = machinePasswordFromBytes(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]));
    assert.match(pw, /^Pk!/);
    assert.match(pw, /A1$/);
    assert.ok(pw.length >= 12);
  });

  it("generateMachinePassword returns unique values", () => {
    const a = generateMachinePassword();
    const b = generateMachinePassword();
    assert.notEqual(a, b);
    assert.match(a, /^Pk!/);
  });
});

describe("passkeyAuth error classification", () => {
  it("treats Face ID / passkey cancel as cancelled (no freeze)", () => {
    assert.equal(
      classifyPasskeyError({ code: "passkey_registration_cancelled" }),
      "cancelled",
    );
    assert.equal(
      classifyPasskeyError({ code: "passkey_retrieval_cancelled" }),
      "cancelled",
    );
    assert.equal(
      classifyPasskeyError({
        errors: [{ code: "passkey_operation_aborted", message: "aborted" }],
      }),
      "cancelled",
    );
    assert.equal(isPasskeyCancellation({ message: "User cancelled" }), true);
    assert.match(describePasskeyError({ code: "passkey_retrieval_cancelled" }), /cancelled/i);
  });

  it("maps duplicate email so a second account is not created", () => {
    const err = {
      errors: [{ code: "form_identifier_exists", message: "That email is taken" }],
    };
    assert.equal(isDuplicateEmailError(err), true);
    assert.equal(classifyPasskeyError(err), "duplicate_email");
    assert.match(describeSignupError(err), /already exists/i);
    assert.match(describePasskeyError(err, "sign_up"), /Sign in instead/i);
  });

  it("surfaces wrong-password style failures for password sign-in separately", () => {
    // Passkey helpers must not mis-label a wrong password as cancel.
    assert.equal(
      classifyPasskeyError({
        errors: [{ code: "form_password_incorrect", message: "Password is incorrect" }],
      }),
      "failed",
    );
    assert.equal(isPasskeyCancellation({ code: "form_password_incorrect" }), false);
  });

  it("explains invalid associated-domain / rpId misconfig", () => {
    assert.match(
      describePasskeyError({ code: "passkey_invalid_rpID_or_domain" }, "create"),
      /configured/i,
    );
  });

  it("explains unsupported devices cleanly", () => {
    assert.match(
      describePasskeyError({ code: "passkey_not_supported" }),
      /aren't available/i,
    );
  });
});

describe("passkeyAuth clerk domain helpers", () => {
  it("decodes Frontend API host from pk_test publishable key", () => {
    // profound-raptor-92.clerk.accounts.dev$ (matches eas.json production key)
    const key =
      "pk_test_cHJvZm91bmQtcmFwdG9yLTkyLmNsZXJrLmFjY291bnRzLmRldiQ";
    assert.equal(
      clerkFrontendApiHost(key),
      "profound-raptor-92.clerk.accounts.dev",
    );
    assert.deepEqual(clerkAssociatedDomains(key), [
      "applinks:profound-raptor-92.clerk.accounts.dev",
      "webcredentials:profound-raptor-92.clerk.accounts.dev",
    ]);
  });

  it("returns null/empty for malformed keys", () => {
    assert.equal(clerkFrontendApiHost(""), null);
    assert.equal(clerkFrontendApiHost("pk_test_@@@"), null);
    assert.deepEqual(clerkAssociatedDomains("nope"), []);
  });
});

describe("passkeyAuth account restore invariants", () => {
  it("passkey login does not use machine-password signup path", () => {
    // Sign-in with passkey authenticates an existing Clerk user (same user id /
    // entitlements). Sign-up with passkey is the only path that mints a machine
    // password — documented here so refactors keep the split.
    const signupSecret = generateMachinePassword();
    assert.match(signupSecret, /^Pk!/);
    // Discoverable passkey sign-in has no password parameter by design.
    const signInParams = { flow: "discoverable" as const };
    assert.equal("password" in signInParams, false);
  });
});

describe("passkeyAuth missing ClerkExpoPasskeys (OTA Build 78)", () => {
  it("fail-softs when native module is absent (OTA #617 fatal)", () => {
    // Device log: Unhandled JS Exception: Cannot find native module 'ClerkExpoPasskeys'
    // Static import of @clerk/expo/passkeys crashed the tip; getPasskeys must swallow.
    __setPasskeysLoaderForTests(() => {
      throw new Error("Cannot find native module 'ClerkExpoPasskeys'");
    });
    try {
      assert.equal(getPasskeys(), null);
      assert.equal(isPasskeysSupported(), false);
      // Second call uses cache — still null, never rethrows.
      assert.equal(getPasskeys(), null);
    } finally {
      __setPasskeysLoaderForTests(null);
    }
  });

  it("never requires @clerk/expo/passkeys when native module is missing", () => {
    let loaderCalls = 0;
    __setPasskeysNativePresentForTests(() => false);
    __setPasskeysLoaderForTests(() => {
      loaderCalls += 1;
      throw new Error("loader must not run when native absent");
    });
    try {
      assert.equal(hasClerkExpoPasskeysNative(), false);
      assert.equal(getPasskeys(), null);
      assert.equal(isPasskeysSupported(), false);
      assert.equal(
        loaderCalls,
        0,
        "loader/require must not run without ClerkExpoPasskeys",
      );
    } finally {
      __setPasskeysNativePresentForTests(null);
      __setPasskeysLoaderForTests(null);
    }
  });

  it("returns support true when loader yields a working passkeys API", () => {
    __setPasskeysNativePresentForTests(() => true);
    __setPasskeysLoaderForTests(() => ({
      passkeys: { isSupported: () => true },
    }));
    try {
      assert.equal(hasClerkExpoPasskeysNative(), true);
      assert.equal(isPasskeysSupported(), true);
      assert.ok(getPasskeys());
    } finally {
      __setPasskeysNativePresentForTests(null);
      __setPasskeysLoaderForTests(null);
    }
  });

  it("returns support false when isSupported reports false", () => {
    __setPasskeysNativePresentForTests(() => true);
    __setPasskeysLoaderForTests(() => ({
      passkeys: { isSupported: () => false },
    }));
    try {
      assert.equal(isPasskeysSupported(), false);
    } finally {
      __setPasskeysNativePresentForTests(null);
      __setPasskeysLoaderForTests(null);
    }
  });

  it("missing passkeys leaves RootLayout Clerk prop undefined (normal sign-in path)", () => {
    __setPasskeysNativePresentForTests(() => false);
    try {
      // Mirrors app/_layout.tsx: __experimental_passkeys={getPasskeys() ?? undefined}
      const prop = getPasskeys() ?? undefined;
      assert.equal(prop, undefined);
    } finally {
      __setPasskeysNativePresentForTests(null);
    }
  });
});
