import assert from "node:assert/strict";
import test from "node:test";

import {
  accountMenuItem,
  plansMenuItem,
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

test("OTA Diagnostics / device attestation menu item is temporarily visible in production", () => {
  assert.equal(shouldShowOtaDiagnosticsMenuItem(false), true);
  assert.equal(shouldShowOtaDiagnosticsMenuItem(true), true);
});
