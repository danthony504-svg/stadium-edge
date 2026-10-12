/**
 * Integration call-count proof for a complete OTA lifecycle.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { OtaController } from "./OtaController.ts";
import type { OtaClient } from "./types.ts";

test("launch → check → download → Restart → boot → close → reopen call counts", async () => {
  const counts = {
    checkForUpdateAsync: 0,
    fetchUpdateAsync: 0,
    reloadAsync: 0,
  };

  let running = "embedded-run";
  let downloaded: string | null = null;
  let tipOnServer: string | null = "tip-new";

  const client: OtaClient = {
    isEnabled: () => true,
    getRunningUpdateId: () => running,
    getDownloadedUpdateId: () => downloaded,
    checkForUpdateAsync: async () => {
      counts.checkForUpdateAsync += 1;
      if (!tipOnServer || tipOnServer === running) {
        return { isAvailable: false, reason: "noUpdateAvailableOnServer" };
      }
      return { isAvailable: true, manifestId: tipOnServer };
    },
    fetchUpdateAsync: async () => {
      counts.fetchUpdateAsync += 1;
      downloaded = tipOnServer;
      return { isNew: true, manifestId: tipOnServer };
    },
    reloadAsync: async () => {
      counts.reloadAsync += 1;
      // Simulate successful apply.
      if (downloaded) running = downloaded;
    },
  };

  // Session 1: launch
  const session1 = new OtaController(client, { cooldownMs: 0 });
  session1.boot();
  assert.equal(counts.reloadAsync, 0, "boot never reloads");
  assert.equal(counts.checkForUpdateAsync, 0, "boot never checks");

  await session1.check();
  assert.equal(session1.getSnapshot().state, "ready");
  assert.equal(session1.getSnapshot().bannerVisible, true);
  assert.equal(counts.checkForUpdateAsync, 1);
  assert.equal(counts.fetchUpdateAsync, 1);
  assert.equal(counts.reloadAsync, 0);

  // Restart button only
  const outcome = await session1.restart();
  assert.equal(outcome, "reloaded");
  assert.equal(counts.reloadAsync, 1);
  assert.equal(running, "tip-new");

  // Session 2: boot into downloaded OTA
  const session2 = new OtaController(client, { cooldownMs: 0 });
  session2.replaceSnapshotForTests({ downloadedUpdateId: "tip-new" });
  const bootSnap = session2.boot();
  assert.equal(bootSnap.state, "idle");
  assert.equal(bootSnap.bannerVisible, false);
  assert.equal(counts.reloadAsync, 1, "no second reload on boot");

  await session2.check();
  assert.equal(session2.getSnapshot().bannerVisible, false);
  assert.equal(counts.fetchUpdateAsync, 1, "no re-fetch of same tip");
  assert.equal(counts.reloadAsync, 1);

  // Close / reopen
  const session3 = new OtaController(client, { cooldownMs: 0 });
  session3.boot();
  assert.equal(session3.getSnapshot().bannerVisible, false);
  await session3.check();
  assert.equal(session3.getSnapshot().bannerVisible, false);
  assert.equal(counts.reloadAsync, 1, "still exactly one reload");

  // Newer tip later
  tipOnServer = "tip-newer";
  await session3.check();
  // Still ready from previous? session3 was idle after no-update check;
  // need force — controller blocks check while ready, so from idle:
  // After no-update, state is idle. New tip available:
  // Wait — last check already ran when tipOnServer was tip-new (unavailable).
  // We set tip-newer then check again.
  assert.equal(session3.getSnapshot().state, "ready");
  assert.equal(session3.getSnapshot().downloadedUpdateId, "tip-newer");
  assert.equal(session3.getSnapshot().bannerVisible, true);
  assert.equal(counts.fetchUpdateAsync, 2, "1 fetch per new update");
  assert.equal(counts.reloadAsync, 1, "still no hidden reload");

  // Finite check count for the whole journey
  assert.ok(counts.checkForUpdateAsync <= 5);
  assert.ok(counts.checkForUpdateAsync >= 3);
});

test("Diagnostics mount equivalent: zero network until explicit check", () => {
  const counts = {
    checkForUpdateAsync: 0,
    fetchUpdateAsync: 0,
    reloadAsync: 0,
  };
  const client: OtaClient = {
    isEnabled: () => true,
    getRunningUpdateId: () => "run",
    getDownloadedUpdateId: () => null,
    checkForUpdateAsync: async () => {
      counts.checkForUpdateAsync += 1;
      return { isAvailable: false };
    },
    fetchUpdateAsync: async () => {
      counts.fetchUpdateAsync += 1;
      return {};
    },
    reloadAsync: async () => {
      counts.reloadAsync += 1;
    },
  };
  // Passive viewer: construct + read snapshot only (no boot check).
  const c = new OtaController(client);
  const snap = c.getSnapshot();
  assert.equal(snap.state, "idle");
  assert.equal(counts.checkForUpdateAsync, 0);
  assert.equal(counts.fetchUpdateAsync, 0);
  assert.equal(counts.reloadAsync, 0);
});
