import assert from "node:assert/strict";
import test from "node:test";
import { accountMenuItem, plansMenuItem, shouldShowOtaDiagnosticsMenuItem } from "./navMenuAuth.ts";

test("signed-out users get Sign in", () => assert.deepEqual(accountMenuItem(false), { route: "/sign-in", label: "Sign in", icon: "log-in" }));
test("signed-in users get Account", () => assert.deepEqual(accountMenuItem(true), { route: "/account", label: "Account", icon: "user-check" }));
test("Plans remain accessible", () => assert.equal(plansMenuItem().route, "/plans"));
test("diagnostics menu is test-only", () => {
  assert.equal(shouldShowOtaDiagnosticsMenuItem(false, "production"), false);
  assert.equal(shouldShowOtaDiagnosticsMenuItem(true, "production"), false);
  assert.equal(shouldShowOtaDiagnosticsMenuItem(false, "preview"), true);
  assert.equal(shouldShowOtaDiagnosticsMenuItem(false, "development"), true);
  assert.equal(shouldShowOtaDiagnosticsMenuItem(false), false);
  assert.equal(shouldShowOtaDiagnosticsMenuItem(true), true);
});
