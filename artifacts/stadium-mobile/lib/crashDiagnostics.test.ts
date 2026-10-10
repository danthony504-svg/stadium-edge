import assert from "node:assert/strict";
import test from "node:test";

import {
  formatCrashDiagnosticReport,
  sanitizeCrashText,
} from "./crashDiagnostics.ts";

test("sanitizeCrashText redacts JWT, Bearer, emails, RC keys, Clerk ids", () => {
  const raw = [
    "Bearer eyJhbGciOiJIUzI1NiJ9.aaa.bbb",
    "Authorization: Token secretvalue",
    "user email dan@example.com",
    "key appl_v1_abc123XYZ",
    "user_2abcdefghijklmnopqrst",
    "sess_2abcdefghijklmnopqrst",
    "pk_live_abcdef123456",
    "password: hunter2",
  ].join("\n");
  const cleaned = sanitizeCrashText(raw);
  assert.equal(cleaned.includes("eyJhbGci"), false);
  assert.equal(cleaned.includes("dan@example.com"), false);
  assert.equal(cleaned.includes("appl_v1_abc123XYZ"), false);
  assert.equal(cleaned.includes("user_2abcdefghijklmnopqrst"), false);
  assert.equal(cleaned.includes("pk_live_abcdef123456"), false);
  assert.equal(cleaned.includes("hunter2"), false);
  assert.match(cleaned, /\[redacted\]/);
});

test("sanitizeCrashText preserves Hermes Object.entries crash message", () => {
  const msg = "Cannot convert undefined value to object";
  assert.equal(sanitizeCrashText(msg), msg);
});

test("formatCrashDiagnosticReport never embeds secrets from stacks", () => {
  const report = formatCrashDiagnosticReport({
    errorMessage: "Cannot convert undefined value to object",
    errorStack: "at foo (app.js:1)\nAuthorization: Bearer eyJhbGciOiJIUzI1NiJ9.x.y",
    componentStack: "\n    in HomeSportFeed\n    in ErrorBoundary",
    ota: {
      updateId: "01a126ae-b6f5-739e-b6c7-80087b7cea25",
      runtimeVersion: "1.1.0",
      channel: "production",
      bundleSource: "ota",
      isEmergencyLaunch: false,
    },
  });
  assert.match(report, /updateId: 01a126ae/);
  assert.match(report, /runtimeVersion: 1\.1\.0/);
  assert.match(report, /channel: production/);
  assert.match(report, /Cannot convert undefined value to object/);
  assert.match(report, /HomeSportFeed/);
  assert.equal(report.includes("eyJhbGci"), false);
  assert.equal(report.includes("Bearer eyJ"), false);
});
