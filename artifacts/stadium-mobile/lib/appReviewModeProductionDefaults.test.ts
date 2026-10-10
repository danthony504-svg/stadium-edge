/**
 * Guardrail: production EAS / OTA / CI must never default APP_REVIEW_MODE on,
 * and every production publish path must run verify-production-env.sh.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(here, "..");
const repoRoot = path.resolve(mobileRoot, "../..");

function read(relFromRepo: string): string {
  return fs.readFileSync(path.join(repoRoot, relFromRepo), "utf8");
}

function readMobile(rel: string): string {
  return fs.readFileSync(path.join(mobileRoot, rel), "utf8");
}

test("eas.json production profile sets APP_REVIEW_MODE false", () => {
  const eas = JSON.parse(readMobile("eas.json")) as {
    build?: { production?: { env?: Record<string, string> } };
  };
  const env = eas.build?.production?.env ?? {};
  assert.equal(env.EXPO_PUBLIC_APP_REVIEW_MODE, "false");
  assert.equal(
    env.EXPO_PUBLIC_APP_REVIEW_ACCOUNT_EMAIL,
    undefined,
    "client must not ship a review-email unlock allowlist",
  );
});

test("production OTA scripts default APP_REVIEW_MODE to false and verify env", () => {
  for (const rel of [
    "scripts/publish-production-ota.sh",
    "scripts/force-production-ota.sh",
    "scripts/heal-production-ota.sh",
  ]) {
    const src = readMobile(rel);
    assert.match(
      src,
      /EXPO_PUBLIC_APP_REVIEW_MODE:-false/,
      `${rel} must default APP_REVIEW_MODE to false`,
    );
    assert.doesNotMatch(
      src,
      /EXPO_PUBLIC_APP_REVIEW_MODE:-\s*true/,
      `${rel} must not default APP_REVIEW_MODE to true`,
    );
    assert.match(
      src,
      /verify-production-env\.sh/,
      `${rel} must run verify-production-env.sh`,
    );
  }
});

test("production GitHub workflows set APP_REVIEW_MODE false", () => {
  const files = [
    ".github/workflows/publish-production-ota.yml",
    ".github/workflows/force-production-ota.yml",
    ".github/workflows/build-ios-testflight.yml",
  ];
  for (const rel of files) {
    const src = read(rel);
    assert.match(src, /EXPO_PUBLIC_APP_REVIEW_MODE:\s*"false"/);
    assert.doesNotMatch(
      src,
      /EXPO_PUBLIC_APP_REVIEW_MODE:\s*"true"/,
      `${rel} must not set APP_REVIEW_MODE true`,
    );
  }
});

test("verify-production-env rejects APP_REVIEW_MODE=true", () => {
  const src = readMobile("scripts/verify-production-env.sh");
  assert.match(src, /must be false in production/);
  assert.match(src, /MODE_NORM/);
});
