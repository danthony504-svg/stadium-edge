/**
 * Unit coverage for prepublish-export-auth-check.mjs (spawn with env fixtures).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(ROOT, "prepublish-export-auth-check.mjs");
const PK = "pk_test_cHJvZm91bmQtcmFwdG9yLTkyLmNsZXJrLmFjY291bnRzLmRldiQ";

function run(env, args = []) {
  const merged = { ...process.env, ...env };
  // Avoid inheriting a forced SHA from the agent shell into fixture runs.
  if (!Object.prototype.hasOwnProperty.call(env, "EXPO_PUBLIC_GIT_COMMIT")) {
    delete merged.EXPO_PUBLIC_GIT_COMMIT;
  }
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    env: merged,
    encoding: "utf8",
  });
}

test("fails when publishable key missing", () => {
  const r = run({ EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /missing\/empty/i);
});

test("fails when secret key env is set", () => {
  const r = run({
    EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: PK,
    CLERK_SECRET_KEY: "sk_test_should_never_ship",
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /CLERK_SECRET_KEY/);
});

test("passes env-only with publishable key", () => {
  const r = run({ EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: PK });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /prepublish-export-auth-check: pass/);
});

test("fails when dist lacks baked publishable key", () => {
  const dir = mkdtempSync(join(tmpdir(), "auth-check-"));
  try {
    const ios = join(dir, "_expo", "static", "js", "ios");
    mkdirSync(ios, { recursive: true });
    writeFileSync(join(ios, "entry.hbc"), "no clerk key here");
    const r = run({ EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: PK }, ["--dist", dir]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /does not contain/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("passes when dist contains publishable key and no secrets", () => {
  const dir = mkdtempSync(join(tmpdir(), "auth-check-"));
  try {
    const ios = join(dir, "_expo", "static", "js", "ios");
    mkdirSync(ios, { recursive: true });
    writeFileSync(join(ios, "entry.hbc"), `boot ${PK} ClerkProvider`);
    const r = run({ EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: PK }, ["--dist", dir]);
    assert.equal(r.status, 0, r.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fails when dist still has empty-key startup sentinel (expression not inlined)", () => {
  const dir = mkdtempSync(join(tmpdir(), "auth-check-"));
  try {
    const ios = join(dir, "_expo", "static", "js", "ios");
    mkdirSync(ios, { recursive: true });
    writeFileSync(
      join(ios, "entry.hbc"),
      `boot ${PK} STARTUP_AUTH_KEY_MISSING_SENTINEL`,
    );
    const r = run({ EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: PK }, ["--dist", dir]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /STARTUP_AUTH_KEY_MISSING_SENTINEL/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fails when dist contains sk_ secret", () => {
  const dir = mkdtempSync(join(tmpdir(), "auth-check-"));
  try {
    const ios = join(dir, "_expo", "static", "js", "ios");
    mkdirSync(ios, { recursive: true });
    writeFileSync(
      join(ios, "entry.hbc"),
      `boot ${PK} sk_test_leakleakleakleak`,
    );
    const r = run({ EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: PK }, ["--dist", dir]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /sk_test_\/sk_live_/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
