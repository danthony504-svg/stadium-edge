/**
 * Node test: preview-build78 must clear Associated Domains so Ad Hoc builds
 * without that entitlement can compile (and match Build 78 / no passkeys).
 */
const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

describe("app.config.js EXPO_NO_CLERK_PASSKEYS", () => {
  const prev = process.env.EXPO_NO_CLERK_PASSKEYS;
  const prevPk = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

  beforeEach(() => {
    delete require.cache[require.resolve("./app.config.js")];
    delete require.cache[require.resolve("./app.json")];
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.EXPO_NO_CLERK_PASSKEYS;
    else process.env.EXPO_NO_CLERK_PASSKEYS = prev;
    if (prevPk === undefined) delete process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
    else process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = prevPk;
    delete require.cache[require.resolve("./app.config.js")];
  });

  it("omits associatedDomains key when EXPO_NO_CLERK_PASSKEYS=1", () => {
    process.env.EXPO_NO_CLERK_PASSKEYS = "1";
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY =
      "pk_test_cHJvZm91bmQtcmFwdG9yLTkyLmNsZXJrLmFjY291bnRzLmRldiQ";
    const cfg = require("./app.config.js")();
    assert.equal(
      Object.prototype.hasOwnProperty.call(cfg.expo.ios, "associatedDomains"),
      false,
    );
  });

  it("keeps Clerk host domains when flag unset", () => {
    delete process.env.EXPO_NO_CLERK_PASSKEYS;
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY =
      "pk_test_cHJvZm91bmQtcmFwdG9yLTkyLmNsZXJrLmFjY291bnRzLmRldiQ";
    const cfg = require("./app.config.js")();
    assert.ok(
      cfg.expo.ios.associatedDomains.some((d) =>
        d.includes("profound-raptor-92.clerk.accounts.dev"),
      ),
    );
  });
});
