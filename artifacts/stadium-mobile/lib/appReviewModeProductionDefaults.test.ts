/**
 * Guardrail: production EAS / OTA / CI must never default APP_REVIEW_MODE on,
 * every production publish path must verify env, and runtime must match app.json.
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

test("eas.json production profile sets APP_REVIEW_MODE false; no public admin unlock", () => {
  const eas = JSON.parse(readMobile("eas.json")) as {
    build?: {
      production?: { env?: Record<string, string> };
      preview?: { env?: Record<string, string> };
    };
  };
  const env = eas.build?.production?.env ?? {};
  assert.equal(env.EXPO_PUBLIC_APP_REVIEW_MODE, "false");
  assert.equal(env.EXPO_PUBLIC_ADMIN_EMAILS, undefined);
  assert.equal(eas.build?.preview?.env?.EXPO_PUBLIC_ADMIN_EMAILS, undefined);
  assert.equal(env.EXPO_PUBLIC_APP_REVIEW_ACCOUNT_EMAIL, undefined);
});

test("app.json runtimeVersion is 1.1.0", () => {
  const app = JSON.parse(readMobile("app.json")) as {
    expo?: { runtimeVersion?: string; version?: string };
  };
  assert.equal(app.expo?.runtimeVersion, "1.1.0");
  assert.equal(app.expo?.version, "1.1.0");
});

test("production OTA scripts default APP_REVIEW_MODE to false, verify env, resolve runtime", () => {
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
    assert.match(
      src,
      /verify-production-env\.sh/,
      `${rel} must run verify-production-env.sh`,
    );
    assert.match(
      src,
      /resolve-runtime-version\.sh/,
      `${rel} must resolve runtime from app.json`,
    );
    assert.doesNotMatch(src, /RUNTIME_VERSION:-1\.0\.0/);
    assert.doesNotMatch(src, /RUNTIME_VERSION:-1\.0\.3/);
  }
});

test("rollback targets app.json runtime; never hardcodes 1.0.3", () => {
  const src = readMobile("scripts/rollback-production-ota.sh");
  assert.match(src, /resolve-runtime-version\.sh/);
  assert.doesNotMatch(src, /RUNTIME_VERSION:-1\.0\.3/);
  assert.match(src, /not for 1\.0\.3 devices/);
});

test("production GitHub workflows set APP_REVIEW_MODE false; rollback defaults blank/1.1.0 path", () => {
  const files = [
    ".github/workflows/publish-production-ota.yml",
    ".github/workflows/force-production-ota.yml",
    ".github/workflows/build-ios-testflight.yml",
  ];
  for (const rel of files) {
    const src = read(rel);
    assert.match(src, /EXPO_PUBLIC_APP_REVIEW_MODE:\s*"false"/);
    assert.doesNotMatch(src, /EXPO_PUBLIC_APP_REVIEW_MODE:\s*"true"/);
  }
  const rollback = read(".github/workflows/rollback-production-ota.yml");
  assert.doesNotMatch(rollback, /default:\s*"1\.0\.3"/);
  assert.match(rollback, /1\.1\.0/);
  assert.match(read(".github/workflows/publish-production-ota.yml"), /1\.1\.0/);
});

test("verify-production-env rejects APP_REVIEW_MODE=true", () => {
  const src = readMobile("scripts/verify-production-env.sh");
  assert.match(src, /must be false in production/);
  assert.match(src, /MODE_NORM/);
});

test("resolve-runtime-version.sh fails closed on mismatch and 1.0.3 vs 1.1.0", () => {
  const src = readMobile("scripts/lib/resolve-runtime-version.sh");
  assert.match(src, /does not match app\.json/);
  assert.match(src, /refusing runtime 1\.0\.3 against app\.json 1\.1\.0/);
  assert.match(src, /prepare-force-update-ota-103/);
});
