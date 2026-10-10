/**
 * Guardrail: production OTA rollback/republish paths must resolve runtime from
 * app.json (currently 1.1.0) and must not hardcode 1.0.0 in manifest probes.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const mobileRoot = join(import.meta.dirname, "..");
const app = JSON.parse(readFileSync(join(mobileRoot, "app.json"), "utf8")) as {
  expo: { runtimeVersion: string };
};

test("app.json runtimeVersion is 1.1.0 for current production tree", () => {
  assert.equal(app.expo.runtimeVersion, "1.1.0");
});

test("resolve_production_runtime_version returns app.json runtime", () => {
  const r = spawnSync(
    "bash",
    [
      "-c",
      'source scripts/lib/resolve-runtime-version.sh && resolve_production_runtime_version',
    ],
    { cwd: mobileRoot, encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), "1.1.0");
});

test("resolve_production_runtime_version fails closed on RUNTIME_VERSION mismatch", () => {
  const r = spawnSync(
    "bash",
    [
      "-c",
      'source scripts/lib/resolve-runtime-version.sh && resolve_production_runtime_version',
    ],
    {
      cwd: mobileRoot,
      encoding: "utf8",
      env: { ...process.env, RUNTIME_VERSION: "1.0.0" },
    },
  );
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /does not match app\.json/);
});

test("republish-stable-production-ota.sh uses resolved runtime, not hardcoded 1.0.0", () => {
  const src = readFileSync(
    join(mobileRoot, "scripts/republish-stable-production-ota.sh"),
    "utf8",
  );
  assert.match(src, /resolve-runtime-version\.sh/);
  assert.match(src, /expo-runtime-version: \$\{RUNTIME_VERSION\}/);
  assert.doesNotMatch(src, /expo-runtime-version: 1\.0\.0/);
  assert.match(src, /STABLE_UPDATE_GROUP is required/);
});

test("publish-ota-test-001.sh does not echo hardcoded Runtime 1.0.0", () => {
  const src = readFileSync(
    join(mobileRoot, "scripts/publish-ota-test-001.sh"),
    "utf8",
  );
  assert.doesNotMatch(src, /Runtime: 1\.0\.0/);
  assert.match(src, /resolve-runtime-version\.sh/);
});
