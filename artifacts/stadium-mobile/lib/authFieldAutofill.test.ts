import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AUTH_CURRENT_PASSWORD_AUTOFILL,
  AUTH_EMAIL_AUTOFILL,
  AUTH_NEW_PASSWORD_AUTOFILL,
  AUTH_OTP_AUTOFILL,
  authAutofillProps,
} from "./authFieldAutofill.ts";

describe("authFieldAutofill", () => {
  it("pairs email with username textContentType for Keychain AutoFill", () => {
    const p = authAutofillProps("emailUsername");
    assert.equal(p.textContentType, "username");
    assert.equal(p.autoComplete, "username");
    assert.equal(p.autoCapitalize, "none");
    assert.equal(p.autoCorrect, false);
    assert.equal(p.spellCheck, false);
    assert.deepEqual(p, AUTH_EMAIL_AUTOFILL);
  });

  it("marks sign-in password for current-password Autofill", () => {
    const p = authAutofillProps("currentPassword");
    assert.equal(p.textContentType, "password");
    assert.equal(p.autoComplete, "password");
    assert.deepEqual(p, AUTH_CURRENT_PASSWORD_AUTOFILL);
  });

  it("enables Strong Password via newPassword on sign-up / reset", () => {
    const p = authAutofillProps("newPassword");
    assert.equal(p.textContentType, "newPassword");
    assert.equal(p.autoComplete, "new-password");
    assert.deepEqual(p, AUTH_NEW_PASSWORD_AUTOFILL);
  });

  it("uses oneTimeCode for verification / reset codes", () => {
    const p = authAutofillProps("oneTimeCode");
    assert.equal(p.textContentType, "oneTimeCode");
    assert.equal(p.autoComplete, "one-time-code");
    assert.deepEqual(p, AUTH_OTP_AUTOFILL);
  });

  it("does not embed password-policy weakening (HIBP stays on Clerk)", () => {
    for (const role of [
      "emailUsername",
      "currentPassword",
      "newPassword",
      "oneTimeCode",
    ] as const) {
      const json = JSON.stringify(authAutofillProps(role));
      assert.doesNotMatch(json, /disable_hibp|hibp|min_length|passwordRules/i);
    }
  });
});
