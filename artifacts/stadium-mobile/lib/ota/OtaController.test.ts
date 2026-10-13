/**
 * Deterministic state-machine tests for the new OTA controller.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { OtaController, computeBannerVisible } from "./OtaController.ts";
import type { OtaCheckResult, OtaClient, OtaFetchResult } from "./types.ts";

type Counts = {
  checkForUpdateAsync: number;
  fetchUpdateAsync: number;
  reloadAsync: number;
};

function makeClient(opts: {
  runningUpdateId?: string | null;
  downloadedUpdateId?: string | null;
  enabled?: boolean;
  check?: () => Promise<OtaCheckResult>;
  fetch?: () => Promise<OtaFetchResult>;
  reload?: () => Promise<void>;
}): { client: OtaClient; counts: Counts } {
  const counts: Counts = {
    checkForUpdateAsync: 0,
    fetchUpdateAsync: 0,
    reloadAsync: 0,
  };
  let downloaded = opts.downloadedUpdateId ?? null;
  const client: OtaClient = {
    isEnabled: () => opts.enabled !== false,
    getRunningUpdateId: () => opts.runningUpdateId ?? "run-1",
    getDownloadedUpdateId: () => downloaded,
    checkForUpdateAsync: async () => {
      counts.checkForUpdateAsync += 1;
      return opts.check
        ? opts.check()
        : { isAvailable: false, reason: "noUpdateAvailableOnServer" };
    },
    fetchUpdateAsync: async () => {
      counts.fetchUpdateAsync += 1;
      const result = opts.fetch
        ? await opts.fetch()
        : { isNew: true, manifestId: "new-1" };
      if (result.manifestId) downloaded = result.manifestId;
      return result;
    },
    reloadAsync: async () => {
      counts.reloadAsync += 1;
      if (opts.reload) await opts.reload();
    },
  };
  return { client, counts };
}

test("No update: idle → checking → idle, banner false", async () => {
  const { client, counts } = makeClient({
    check: async () => ({ isAvailable: false }),
  });
  const c = new OtaController(client);
  c.boot();
  assert.equal(c.getSnapshot().state, "idle");
  await c.check();
  const snap = c.getSnapshot();
  assert.equal(snap.state, "idle");
  assert.equal(snap.bannerVisible, false);
  assert.equal(counts.checkForUpdateAsync, 1);
  assert.equal(counts.fetchUpdateAsync, 0);
  assert.equal(counts.reloadAsync, 0);
});

test("New update: idle → checking → downloading → ready, banner true", async () => {
  const { client, counts } = makeClient({
    runningUpdateId: "run-1",
    check: async () => ({
      isAvailable: true,
      manifestId: "tip-2",
    }),
    fetch: async () => ({ isNew: true, manifestId: "tip-2" }),
  });
  const c = new OtaController(client);
  c.boot();
  await c.check();
  const snap = c.getSnapshot();
  assert.equal(snap.state, "ready");
  assert.equal(snap.downloadedUpdateId, "tip-2");
  assert.equal(snap.bannerVisible, true);
  assert.equal(counts.fetchUpdateAsync, 1);
  assert.equal(counts.reloadAsync, 0);
});

test("Restart action → exactly one reloadAsync", async () => {
  const { client, counts } = makeClient({
    runningUpdateId: "run-1",
    check: async () => ({ isAvailable: true, manifestId: "tip-2" }),
    fetch: async () => ({ isNew: true, manifestId: "tip-2" }),
  });
  const c = new OtaController(client);
  c.boot();
  await c.check();
  const outcome = await c.restart();
  assert.equal(outcome, "reloaded");
  assert.equal(c.getSnapshot().state, "restarting");
  assert.equal(counts.reloadAsync, 1);
  // Second restart while restarting / not ready must not reload again.
  const again = await c.restart();
  assert.equal(again, "rejected");
  assert.equal(counts.reloadAsync, 1);
});

test("Restart notes ledger target before reloadAsync", async () => {
  const noted: string[] = [];
  const { client, counts } = makeClient({
    runningUpdateId: "run-1",
    check: async () => ({ isAvailable: true, manifestId: "tip-2" }),
    fetch: async () => ({ isNew: true, manifestId: "tip-2" }),
  });
  const c = new OtaController(client, {
    failedLaunchHooks: {
      noteReloadTarget: async (id) => {
        noted.push(id);
      },
      reconcileBoot: async () => ({ observed: "no-target" }),
    },
  });
  c.boot();
  await c.check();
  await c.restart();
  assert.deepEqual(noted, ["tip-2"]);
  assert.equal(c.getSnapshot().lastRestartTargetId, "tip-2");
  assert.equal(counts.reloadAsync, 1);
});

test("Boot reconcile launch_failed when ledger target ≠ running", async () => {
  const { client } = makeClient({
    runningUpdateId: "embedded-1",
    enabled: true,
  });
  client.isEmbeddedLaunch = () => true;
  client.isEmergencyLaunch = () => false;
  const c = new OtaController(client, {
    failedLaunchHooks: {
      noteReloadTarget: async () => {},
      reconcileBoot: async () => ({
        observed: "failed",
        failedTargetId: "tip-2",
        failedCount: 1,
      }),
    },
  });
  c.boot();
  await new Promise((r) => setTimeout(r, 20));
  const snap = c.getSnapshot();
  assert.equal(snap.launchOutcome, "launch_failed");
  assert.equal(snap.failedUpdateId, "tip-2");
});

test("Boot into downloaded OTA: running === downloaded → idle, banner false", () => {
  const { client, counts } = makeClient({
    runningUpdateId: "tip-2",
    downloadedUpdateId: "tip-2",
  });
  const c = new OtaController(client);
  c.replaceSnapshotForTests({
    state: "ready",
    downloadedUpdateId: "tip-2",
    runningUpdateId: "run-1",
  });
  // Simulate post-restart boot where running is the previous download.
  const bootClient = makeClient({
    runningUpdateId: "tip-2",
    downloadedUpdateId: "tip-2",
  });
  const c2 = new OtaController(bootClient.client);
  c2.replaceSnapshotForTests({ downloadedUpdateId: "tip-2" });
  const snap = c2.boot();
  assert.equal(snap.state, "idle");
  assert.equal(snap.bannerVisible, false);
  assert.equal(snap.downloadedUpdateId, null);
  assert.equal(counts.reloadAsync, 0);
  assert.equal(bootClient.counts.reloadAsync, 0);
});

test("Close/reopen: same running update → banner remains false", async () => {
  const { client } = makeClient({
    runningUpdateId: "tip-2",
    downloadedUpdateId: "tip-2",
    check: async () => ({ isAvailable: false }),
  });
  const c = new OtaController(client);
  c.boot();
  await c.check();
  assert.equal(c.getSnapshot().bannerVisible, false);
  // Simulate close/reopen = new controller boot
  const c2 = new OtaController(client);
  c2.boot();
  assert.equal(c2.getSnapshot().state, "idle");
  assert.equal(c2.getSnapshot().bannerVisible, false);
});

test("Newer OTA later → banner true again", async () => {
  let availableId = "tip-3";
  const { client, counts } = makeClient({
    runningUpdateId: "tip-2",
    check: async () => ({ isAvailable: true, manifestId: availableId }),
    fetch: async () => ({ isNew: true, manifestId: availableId }),
  });
  const c = new OtaController(client, { cooldownMs: 0 });
  c.boot();
  await c.check();
  assert.equal(c.getSnapshot().state, "ready");
  assert.equal(c.getSnapshot().bannerVisible, true);
  assert.equal(c.getSnapshot().downloadedUpdateId, "tip-3");
  assert.equal(counts.fetchUpdateAsync, 1);
});

test("Previously failed update → error, no fetch/reload loop", async () => {
  const { client, counts } = makeClient({
    runningUpdateId: "run-1",
    check: async () => ({
      isAvailable: false,
      reason: "updatePreviouslyFailed",
      manifestId: "bad-tip",
    }),
  });
  const c = new OtaController(client, { cooldownMs: 0 });
  c.boot();
  await c.check();
  assert.equal(c.getSnapshot().state, "error");
  assert.equal(c.getSnapshot().failedUpdateId, "bad-tip");
  assert.equal(c.getSnapshot().bannerVisible, false);
  assert.equal(counts.fetchUpdateAsync, 0);
  assert.equal(counts.reloadAsync, 0);

  // Same failed id offered as available later — still no fetch/reload.
  const { client: client2, counts: counts2 } = makeClient({
    runningUpdateId: "run-1",
    check: async () => ({
      isAvailable: true,
      manifestId: "bad-tip",
    }),
  });
  const c2 = new OtaController(client2, { cooldownMs: 0 });
  c2.replaceSnapshotForTests({ failedUpdateId: "bad-tip" });
  c2.boot();
  await c2.check();
  assert.equal(c2.getSnapshot().state, "error");
  assert.equal(counts2.fetchUpdateAsync, 0);
  assert.equal(counts2.reloadAsync, 0);
});

test("Sticky isUpdatePending with no distinct downloaded ID → banner false, reload=0", async () => {
  const { client, counts } = makeClient({
    runningUpdateId: "run-1",
    downloadedUpdateId: null,
    check: async () => ({ isAvailable: true, manifestId: null }),
    fetch: async () => ({ isNew: true, manifestId: null }),
  });
  // After fetch, getDownloadedUpdateId still null (sticky pending / unknown).
  const c = new OtaController(client);
  c.boot();
  await c.check();
  const snap = c.getSnapshot();
  assert.equal(snap.bannerVisible, false);
  assert.notEqual(snap.state, "ready");
  assert.equal(counts.reloadAsync, 0);
});

test("Embedded boot must not by itself trigger reload", () => {
  const { client, counts } = makeClient({
    runningUpdateId: "b08e66a1-9079-458b-9016-2a4a672237d1",
    downloadedUpdateId: null,
  });
  const c = new OtaController(client);
  c.boot();
  assert.equal(c.getSnapshot().state, "idle");
  assert.equal(c.getSnapshot().bannerVisible, false);
  assert.equal(counts.reloadAsync, 0);
  assert.equal(counts.checkForUpdateAsync, 0);
});

test("Cold deep link: OTA actions = 0 until normal controller initialization", () => {
  const { client, counts } = makeClient({});
  // Constructing the controller must not touch the network.
  void new OtaController(client);
  assert.equal(counts.checkForUpdateAsync, 0);
  assert.equal(counts.fetchUpdateAsync, 0);
  assert.equal(counts.reloadAsync, 0);
});

test("computeBannerVisible rejects native-pending-only cases", () => {
  assert.equal(
    computeBannerVisible({
      state: "idle",
      downloadedUpdateId: "tip-2",
      runningUpdateId: "run-1",
    }),
    false,
  );
  assert.equal(
    computeBannerVisible({
      state: "ready",
      downloadedUpdateId: null,
      runningUpdateId: "run-1",
    }),
    false,
  );
  assert.equal(
    computeBannerVisible({
      state: "ready",
      downloadedUpdateId: "run-1",
      runningUpdateId: "run-1",
    }),
    false,
  );
  assert.equal(
    computeBannerVisible({
      state: "ready",
      downloadedUpdateId: "tip-2",
      runningUpdateId: "run-1",
    }),
    true,
  );
});

test("Foreground check respects cooldown and never reloads", async () => {
  let now = 1_000_000;
  const { client, counts } = makeClient({
    check: async () => ({ isAvailable: false }),
  });
  const c = new OtaController(client, {
    cooldownMs: 45_000,
    now: () => now,
  });
  c.boot();
  await c.onForeground();
  assert.equal(counts.checkForUpdateAsync, 1);
  await c.onForeground();
  assert.equal(counts.checkForUpdateAsync, 1, "cooldown blocks second check");
  now += 46_000;
  await c.onForeground();
  assert.equal(counts.checkForUpdateAsync, 2);
  assert.equal(counts.reloadAsync, 0);
});

test("restart rejected when not ready", async () => {
  const { client, counts } = makeClient({});
  const c = new OtaController(client);
  c.boot();
  assert.equal(await c.restart(), "rejected");
  assert.equal(counts.reloadAsync, 0);
});

test("isStartupProcedureRunning blocks check network I/O (01a13540 class)", async () => {
  const { client, counts } = makeClient({
    check: async () => ({ isAvailable: true, manifestId: "tip-2" }),
    fetch: async () => ({ isNew: true, manifestId: "tip-2" }),
  });
  client.isStartupProcedureRunning = () => true;
  const c = new OtaController(client);
  c.boot();
  const snap = await c.check();
  assert.equal(snap.state, "idle");
  assert.match(String(snap.lastError), /isStartupProcedureRunning/);
  assert.equal(counts.checkForUpdateAsync, 0);
  assert.equal(counts.fetchUpdateAsync, 0);
  assert.equal(counts.reloadAsync, 0);
});

test("isStartupProcedureRunning blocks restart reload (tip-boot blacklist)", async () => {
  let startup = false;
  const { client, counts } = makeClient({
    runningUpdateId: "run-1",
    check: async () => ({ isAvailable: true, manifestId: "tip-2" }),
    fetch: async () => ({ isNew: true, manifestId: "tip-2" }),
  });
  client.isStartupProcedureRunning = () => startup;
  const c = new OtaController(client);
  c.boot();
  await c.check();
  assert.equal(c.getSnapshot().state, "ready");
  startup = true;
  assert.equal(await c.restart(), "rejected");
  assert.equal(counts.reloadAsync, 0);
  assert.match(String(c.getSnapshot().lastError), /isStartupProcedureRunning/);
});

test("check proceeds after startup procedure settles", async () => {
  const { client, counts } = makeClient({
    runningUpdateId: "run-1",
    check: async () => ({ isAvailable: true, manifestId: "tip-2" }),
    fetch: async () => ({ isNew: true, manifestId: "tip-2" }),
  });
  client.isStartupProcedureRunning = () => false;
  const c = new OtaController(client);
  c.boot();
  await c.check();
  assert.equal(c.getSnapshot().state, "ready");
  assert.equal(counts.checkForUpdateAsync, 1);
  assert.equal(counts.reloadAsync, 0);
});
