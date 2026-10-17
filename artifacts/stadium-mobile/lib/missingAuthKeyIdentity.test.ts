import assert from "node:assert/strict";
import { test } from "node:test";

import {
  readBakedGitCommit,
  readMissingAuthBundleIdentity,
  runPreClerkOtaRecovery,
} from "./missingAuthKeyIdentity.ts";
import {
  resetExpoUpdatesAccessForTests,
  setExpoUpdatesModuleForTests,
} from "./expoUpdatesAccess.ts";

test("readBakedGitCommit prefers EXPO_PUBLIC_GIT_COMMIT", () => {
  const prev = process.env.EXPO_PUBLIC_GIT_COMMIT;
  process.env.EXPO_PUBLIC_GIT_COMMIT = "abc123deadbeef";
  try {
    assert.equal(readBakedGitCommit(), "abc123deadbeef");
  } finally {
    if (prev === undefined) delete process.env.EXPO_PUBLIC_GIT_COMMIT;
    else process.env.EXPO_PUBLIC_GIT_COMMIT = prev;
  }
});

test("readMissingAuthBundleIdentity surfaces updateId/channel without Clerk", () => {
  resetExpoUpdatesAccessForTests();
  setExpoUpdatesModuleForTests({
    updateId: "01a14ab5-1271-7d9e-9b76-bdfc53a31197",
    channel: "preview",
    isEnabled: true,
  } as never);
  const prev = process.env.EXPO_PUBLIC_GIT_COMMIT;
  process.env.EXPO_PUBLIC_GIT_COMMIT = "0112ee0b33240d82b680e5aa7453b7b53567c554";
  try {
    const id = readMissingAuthBundleIdentity();
    assert.equal(id.updateId, "01a14ab5-1271-7d9e-9b76-bdfc53a31197");
    assert.equal(id.channel, "preview");
    assert.equal(id.bakedSha, "0112ee0b33240d82b680e5aa7453b7b53567c554");
  } finally {
    resetExpoUpdatesAccessForTests();
    if (prev === undefined) delete process.env.EXPO_PUBLIC_GIT_COMMIT;
    else process.env.EXPO_PUBLIC_GIT_COMMIT = prev;
  }
});

test("runPreClerkOtaRecovery fetches when an update is available", async () => {
  resetExpoUpdatesAccessForTests();
  let fetched = 0;
  let reloaded = 0;
  setExpoUpdatesModuleForTests({
    isEnabled: true,
    checkForUpdateAsync: async () => ({ isAvailable: true }),
    fetchUpdateAsync: async () => {
      fetched += 1;
      return {};
    },
    reloadAsync: async () => {
      reloaded += 1;
    },
  } as never);
  try {
    const outcome = await runPreClerkOtaRecovery();
    assert.equal(outcome, "reloaded");
    assert.equal(fetched, 1);
    assert.equal(reloaded, 1);
  } finally {
    resetExpoUpdatesAccessForTests();
  }
});

test("_layout missing-key path mounts MissingAuthKeyScreen + DeferredOtaRuntime", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const src = readFileSync(join(process.cwd(), "app/_layout.tsx"), "utf8");
  assert.match(src, /MissingAuthKeyScreen/);
  const missAt = src.indexOf("if (!publishableKey)");
  const clerkAt = src.indexOf("<ClerkProvider");
  assert.ok(missAt > 0 && clerkAt > missAt);
  const missBlock = src.slice(missAt, clerkAt);
  assert.match(missBlock, /MissingAuthKeyScreen/);
  assert.match(missBlock, /DeferredOtaRuntime|MissingAuthKeyScreen/);
  // AppShell (normal DeferredOtaRuntime host) must not be the only path.
  assert.doesNotMatch(missBlock, /<AppShell/);
});
