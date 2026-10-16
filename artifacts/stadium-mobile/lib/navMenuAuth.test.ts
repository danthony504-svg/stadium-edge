import assert from "node:assert/strict";
import test from "node:test";

import {
  accountMenuItem,
  plansMenuItem,
  shouldShowDeviceAttestationUi,
  shouldShowOtaDiagnosticsMenuItem,
} from "./navMenuAuth.ts";

test("signed-out users get Sign in at /sign-in", () => {
  assert.deepEqual(accountMenuItem(false), {
    route: "/sign-in",
    label: "Sign in",
    icon: "log-in",
  });
});

test("signed-in users get Account at /account", () => {
  assert.deepEqual(accountMenuItem(true), {
    route: "/account",
    label: "Account",
    icon: "user-check",
  });
});

test("Plans menu item is always available for soft subscription", () => {
  assert.deepEqual(plansMenuItem(), {
    route: "/plans",
    label: "Plans",
    icon: "zap",
  });
});

test("Device attestation UI is hidden on production; visible on preview and development", () => {
  assert.equal(
    shouldShowDeviceAttestationUi({ isDev: false, channel: "production" }),
    false,
  );
  assert.equal(
    shouldShowDeviceAttestationUi({ isDev: false, channel: "preview" }),
    true,
  );
  assert.equal(
    shouldShowDeviceAttestationUi({ isDev: false, channel: "development" }),
    true,
  );
  assert.equal(
    shouldShowDeviceAttestationUi({ isDev: true, channel: "production" }),
    true,
  );
  // Blank / unknown release channel → hide (fail closed for App Store tips).
  assert.equal(shouldShowDeviceAttestationUi({ isDev: false, channel: "" }), false);
  assert.equal(shouldShowDeviceAttestationUi({ isDev: false, channel: null }), false);
  // Legacy helper matches channel-aware policy.
  assert.equal(shouldShowOtaDiagnosticsMenuItem(false, "production"), false);
  assert.equal(shouldShowOtaDiagnosticsMenuItem(false, "preview"), true);
  assert.equal(shouldShowOtaDiagnosticsMenuItem(true, "production"), true);
});
