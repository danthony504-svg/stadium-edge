/**
 * Adversarial static checks: every workflow that can publish NEW production JS
 * must require reliability critical tests + an explicit confirm gate (or be
 * emergency rollback-to-embedded only).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const REPO = join(process.cwd(), "../..");
const WF = join(REPO, ".github/workflows");

function readWf(name: string): string {
  return readFileSync(join(WF, name), "utf8");
}

const NEW_JS_PUBLISHERS = [
  "publish-production-ota.yml",
  "force-production-ota.yml",
  "bootstrap-ota.yml",
  "heal-production-ota.yml",
  "ota-test-001.yml",
  "ota-test-002.yml",
] as const;

test("inventory: known production OTA workflows exist", () => {
  for (const name of [
    ...NEW_JS_PUBLISHERS,
    "republish-stable-production-ota.yml",
    "rollback-production-ota.yml",
  ]) {
    assert.equal(existsSync(join(WF, name)), true, name);
  }
});

test("all new-JS production publishers require reliability critical tests", () => {
  for (const name of NEW_JS_PUBLISHERS) {
    const src = readWf(name);
    assert.match(
      src,
      /run-reliability-critical-tests\.sh/,
      `${name} must run reliability critical tests`,
    );
  }
});

test("bootstrap / heal / ota-test require explicit PUBLISH_NEW_OTA confirm and no push auto-publish", () => {
  for (const name of [
    "bootstrap-ota.yml",
    "heal-production-ota.yml",
    "ota-test-001.yml",
    "ota-test-002.yml",
  ] as const) {
    const src = readWf(name);
    assert.match(src, /PUBLISH_NEW_OTA/, `${name} missing confirm gate`);
    assert.match(
      src,
      /confirm_publish\s*==\s*'PUBLISH_NEW_OTA'|inputs\.confirm_publish == 'PUBLISH_NEW_OTA'/,
      `${name} must gate job on confirm_publish`,
    );
    // No unattended push→publish for these alternative paths.
    assert.equal(
      /^\s*push:\s*$/m.test(src),
      false,
      `${name} must not auto-publish on push`,
    );
  }
});

test("rollback-to-embedded does not publish new untested JS bundles", () => {
  const src = readWf("rollback-production-ota.yml");
  assert.match(src, /rollback-production-ota\.sh/);
  assert.match(src, /update:roll-back-to-embedded|roll-back-to-embedded/);
  // Workflow may mention publish names only inside a deny-list grep guard.
  assert.equal(src.includes("publish-production-ota.sh"), false);
  assert.equal(src.includes("publish-bootstrap-ota.sh"), false);
  assert.equal(src.includes("heal-production-ota.sh"), false);
  const script = readFileSync(
    join(REPO, "artifacts/stadium-mobile/scripts/rollback-production-ota.sh"),
    "utf8",
  );
  assert.match(script, /update:roll-back-to-embedded/);
  // Allow `eas update:roll-back-to-embedded` only — reject any other `eas update …` publish.
  assert.equal(/eas\s+update(?!:roll-back-to-embedded)/.test(script), false);
});

test("republish-stable republishes an existing update group (no eas update from HEAD)", () => {
  const src = readWf("republish-stable-production-ota.yml");
  assert.match(src, /republish-stable-production-ota\.sh/);
  assert.match(src, /run-reliability-critical-tests\.sh/);
  assert.match(src, /REPUBLISH_STABLE/);
  assert.match(
    src,
    /confirm_publish\s*==\s*'REPUBLISH_STABLE'|inputs\.confirm_publish == 'REPUBLISH_STABLE'/,
  );
  assert.equal(/\beas update\b/.test(src), false);
});

test("digest cron workflow is scheduled and uses secret cron key (not client)", () => {
  const src = readWf("reliability-digest-cron.yml");
  assert.match(src, /schedule:/);
  assert.match(src, /cron:\s*["']/);
  assert.match(src, /NOTIFY_CRON_KEY/);
  assert.match(src, /reliability\/cron\/digest/);
  assert.equal(src.includes("EXPO_PUBLIC_"), false);
});
