import assert from "node:assert/strict";
import test from "node:test";

import {
  emptyFailedLaunchRecord,
  failedLaunchCount,
  isUpdatePreviouslyFailed,
  MAX_FAILED_LAUNCHES_PER_UPDATE,
  noteReloadTarget,
  parseFailedLaunchRecord,
  reconcileLaunch,
  updateFailedLaunchRecord,
  type OtaFailedLaunchStorage,
} from "./otaFailedLaunch.ts";
import {
  readOtaRecoverySnapshot,
  reportOtaRecoveryState,
  resetOtaRecoveryStateForTests,
} from "./otaRecoveryState.ts";
import {
  isIdentifiedReloadTarget,
  resolveReloadTargetId,
  SESSION_RELOAD_COOLDOWN_MS,
  shouldAllowAutoReload,
} from "./otaReloadGuard.ts";
import {
  prefetchOtaUpdate,
  reloadPendingOtaUpdate,
  resetOtaUpdaterSessionGuardForTests,
  type OtaCheckResult,
  type OtaUpdateClient,
} from "./otaUpdaterCore.ts";

type Log = { step: string; ok: boolean; detail: string };

function logger() {
  const entries: Log[] = [];
  return {
    entries,
    log: (step: Log["step"], ok: boolean, detail: string) => entries.push({ step, ok, detail }),
    has: (step: string, needle: string) =>
      entries.some((e) => e.step === step && e.detail.includes(needle)),
  };
}

function client(
  partial: Partial<OtaUpdateClient> & Pick<OtaUpdateClient, "checkForUpdateAsync">,
): OtaUpdateClient {
  return {
    fetchUpdateAsync: async () => ({ isNew: true }),
    reloadAsync: async () => {},
    ...partial,
  };
}

const available = (id: string): OtaCheckResult => ({ isAvailable: true, manifest: { id } });

function memoryStorage(initial: string | null = null): OtaFailedLaunchStorage & { raw: () => string | null } {
  let value = initial;
  return {
    read: async () => value,
    write: async (raw) => {
      value = raw;
    },
    raw: () => value,
  };
}

function reset() {
  resetOtaUpdaterSessionGuardForTests();
  resetOtaRecoveryStateForTests();
}

// ---------------------------------------------------------------------------
// Reload target identity — the root-cause fix.
// ---------------------------------------------------------------------------

test("the reload target is the downloaded update, never the running one", () => {
  assert.equal(
    resolveReloadTargetId({ downloadedUpdateId: "374", runningUpdateId: "372" }),
    "374",
  );
  assert.equal(
    resolveReloadTargetId({ availableUpdateId: "374", runningUpdateId: "372" }),
    "374",
  );
});

test("an unknown target is namespaced so it cannot collide with a real update id", () => {
  const target = resolveReloadTargetId({ runningUpdateId: "372" });
  assert.notEqual(target, "372");
  assert.equal(isIdentifiedReloadTarget(target), false);
  assert.equal(isIdentifiedReloadTarget("374"), true);
});

test("a budget exhausted on one target does not block a superseding update", () => {
  const now = Date.now();
  const guard = { updateId: "373", attempts: 5, firstAttemptAt: now };
  assert.equal(shouldAllowAutoReload(guard, "373", now, SESSION_RELOAD_COOLDOWN_MS), false);
  // A newly published update is a different id and must still be attempted.
  assert.equal(shouldAllowAutoReload(guard, "374", now, SESSION_RELOAD_COOLDOWN_MS), true);
});

test("the session rate limiter releases after its cooldown, so nothing is stranded", () => {
  const now = Date.now();
  const guard = { updateId: "374", attempts: 2, firstAttemptAt: now - SESSION_RELOAD_COOLDOWN_MS - 1 };
  assert.equal(shouldAllowAutoReload(guard, "374", now, SESSION_RELOAD_COOLDOWN_MS), true);
  assert.ok(SESSION_RELOAD_COOLDOWN_MS <= 5 * 60 * 1000, "cooldown must be short enough to recover");
});

// ---------------------------------------------------------------------------
// A network failure must never discard a downloaded update.
// ---------------------------------------------------------------------------

test("a failed check still reloads an already-pending update", async () => {
  reset();
  let reloaded = 0;
  const { log, has } = logger();
  const outcome = await prefetchOtaUpdate(
    client({
      checkForUpdateAsync: async () => {
        throw new Error("ERR_UPDATES_CHECK network unreachable");
      },
      reloadAsync: async () => {
        reloaded += 1;
      },
    }),
    () => true, // an update is already downloaded and pending
    true,
    { log, downloadedUpdateId: () => "374", reloadUpdateKey: "372" },
  );
  assert.equal(outcome, "applied");
  assert.equal(reloaded, 1, "a downloaded update must apply even when the check fails");
  assert.ok(has("checkForUpdateAsync", "network unreachable"));
});

test("a failed fetch still reloads an already-pending update", async () => {
  reset();
  let reloaded = 0;
  const { log } = logger();
  const outcome = await prefetchOtaUpdate(
    client({
      checkForUpdateAsync: async () => available("375"),
      fetchUpdateAsync: async () => {
        throw new Error("offline");
      },
      reloadAsync: async () => {
        reloaded += 1;
      },
    }),
    () => true,
    true,
    { log, downloadedUpdateId: () => "374", reloadUpdateKey: "372" },
  );
  assert.equal(outcome, "applied");
  assert.equal(reloaded, 1);
});

test("a hung check that times out does not strand a pending update", async () => {
  reset();
  let reloaded = 0;
  const outcome = await prefetchOtaUpdate(
    client({
      checkForUpdateAsync: async () => {
        throw new Error("checkForUpdateAsync timed out after 15000ms");
      },
      reloadAsync: async () => {
        reloaded += 1;
      },
    }),
    () => true,
    true,
    { log: () => {}, downloadedUpdateId: () => "374" },
  );
  assert.equal(outcome, "applied");
  assert.equal(reloaded, 1);
});

test("reloading a pending update requires no network call at all", async () => {
  reset();
  let checked = 0;
  let reloaded = 0;
  const outcome = await reloadPendingOtaUpdate(
    {
      reloadAsync: async () => {
        reloaded += 1;
      },
    },
    "374",
    { log: () => {} },
  );
  assert.equal(outcome, "applied");
  assert.equal(reloaded, 1);
  assert.equal(checked, 0);
});

// ---------------------------------------------------------------------------
// No silent returns.
// ---------------------------------------------------------------------------

test("every terminal decision is logged, including no-update and deferral", async () => {
  reset();
  const noUpdate = logger();
  await prefetchOtaUpdate(
    client({
      checkForUpdateAsync: async () => ({ isAvailable: false, reason: "noUpdateAvailableOnServer" }),
    }),
    () => false,
    true,
    { log: noUpdate.log },
  );
  assert.ok(noUpdate.has("checkForUpdateAsync", "noUpdateAvailableOnServer"));
  assert.ok(noUpdate.has("reloadAsync", "no pending update"));

  reset();
  const deferred = logger();
  await prefetchOtaUpdate(
    client({ checkForUpdateAsync: async () => available("374") }),
    () => false,
    false,
    { log: deferred.log },
  );
  assert.ok(deferred.has("reloadAsync", "deferred"));
  assert.ok(deferred.has("reloadAsync", "374"));
});

test("a rollback-to-embedded directive is fetched, not ignored", async () => {
  reset();
  let fetched = 0;
  const { log } = logger();
  const outcome = await prefetchOtaUpdate(
    client({
      checkForUpdateAsync: async () => ({ isAvailable: false, isRollBackToEmbedded: true }),
      fetchUpdateAsync: async () => {
        fetched += 1;
        return { isNew: false, isRollBackToEmbedded: true };
      },
    }),
    () => false,
    false,
    { log },
  );
  assert.equal(fetched, 1);
  assert.equal(outcome, "pending");
});

// ---------------------------------------------------------------------------
// Diagnostics surface.
// ---------------------------------------------------------------------------

test("the diagnostics snapshot reports every required field", async () => {
  reset();
  await prefetchOtaUpdate(
    client({
      checkForUpdateAsync: async () => available("374"),
      fetchUpdateAsync: async () => ({ isNew: true, manifest: { id: "374" } }),
    }),
    () => false,
    true,
    { log: () => {}, report: reportOtaRecoveryState, reloadUpdateKey: "372" },
  );

  const snap = readOtaRecoverySnapshot();
  assert.equal(snap.availableUpdateId, "374");
  assert.equal(snap.reloadTargetId, "374");
  assert.equal(snap.pending, true);
  assert.equal(snap.reloadBlocked, false);
  assert.ok(snap.checkResult.includes("isAvailable=true"));
  assert.ok(snap.fetchResult.includes("isNew=true"));
});

test("a blocked reload is reported with its reason instead of failing silently", async () => {
  reset();
  const outcome = await prefetchOtaUpdate(
    client({ checkForUpdateAsync: async () => available("374") }),
    () => false,
    true,
    {
      log: () => {},
      report: reportOtaRecoveryState,
      isReloadBlocked: () => true,
    },
  );
  assert.equal(outcome, "pending");
  const snap = readOtaRecoverySnapshot();
  assert.equal(snap.reloadBlocked, true);
  assert.ok(snap.reloadBlockedReason.includes("coach/fantasy"));
});

test("a check error is surfaced as the last OTA error", async () => {
  reset();
  await prefetchOtaUpdate(
    client({
      checkForUpdateAsync: async () => {
        throw new Error("ERR_UPDATES_CHECK boom");
      },
    }),
    () => false,
    false,
    { log: () => {}, report: reportOtaRecoveryState },
  );
  assert.ok(readOtaRecoverySnapshot().lastError.includes("ERR_UPDATES_CHECK boom"));
});

test("the native updatePreviouslyFailed reason is surfaced", async () => {
  reset();
  await prefetchOtaUpdate(
    client({
      checkForUpdateAsync: async () => ({ isAvailable: false, reason: "updatePreviouslyFailed" }),
    }),
    () => false,
    false,
    { log: () => {}, report: reportOtaRecoveryState },
  );
  assert.equal(readOtaRecoverySnapshot().updatePreviouslyFailed, true);
});

// ---------------------------------------------------------------------------
// Failed-launch ledger: rollback protection that is per-update, not global.
// ---------------------------------------------------------------------------

test("a target that comes back running is a success and clears its failures", () => {
  let record = noteReloadTarget(emptyFailedLaunchRecord(), "374");
  record = reconcileLaunch(record, "374").record;
  assert.equal(failedLaunchCount(record, "374"), 0);
  assert.equal(record.pendingTargetId, null);
});

test("a target that does not come back running is counted as a failed launch", () => {
  let record = noteReloadTarget(emptyFailedLaunchRecord(), "374");
  const first = reconcileLaunch(record, "372");
  assert.equal(first.observed, "failed");
  assert.equal(first.failedTargetId, "374");
  assert.equal(first.failedCount, 1);

  record = noteReloadTarget(first.record, "374");
  const second = reconcileLaunch(record, "372");
  assert.equal(second.failedCount, 2);
  assert.equal(isUpdatePreviouslyFailed(second.record, "374"), true);
});

test("a repeatedly failing target stops being retried", async () => {
  reset();
  let reloaded = 0;
  const { log, has } = logger();
  const outcome = await reloadPendingOtaUpdate(
    {
      reloadAsync: async () => {
        reloaded += 1;
      },
    },
    "374",
    { log, isTargetPreviouslyFailed: (id) => id === "374", report: reportOtaRecoveryState },
  );
  assert.equal(outcome, "pending");
  assert.equal(reloaded, 0);
  assert.ok(has("reloadAsync", "previously failed to launch"));
  assert.equal(readOtaRecoverySnapshot().updatePreviouslyFailed, true);
});

test("a superseding update recovers a device whose previous target was marked failed", async () => {
  reset();
  // #374 has failed twice; #375 is published afterwards.
  let record = emptyFailedLaunchRecord();
  for (let i = 0; i < MAX_FAILED_LAUNCHES_PER_UPDATE; i++) {
    record = reconcileLaunch(noteReloadTarget(record, "374"), "372").record;
  }
  assert.equal(isUpdatePreviouslyFailed(record, "374"), true);
  assert.equal(isUpdatePreviouslyFailed(record, "375"), false);

  let reloaded = 0;
  const targets: string[] = [];
  const outcome = await prefetchOtaUpdate(
    client({
      checkForUpdateAsync: async () => available("375"),
      fetchUpdateAsync: async () => ({ isNew: true, manifest: { id: "375" } }),
      reloadAsync: async () => {
        reloaded += 1;
      },
    }),
    () => false,
    true,
    {
      log: () => {},
      reloadUpdateKey: "372",
      isTargetPreviouslyFailed: (id) => isUpdatePreviouslyFailed(record, id),
      onReloadTarget: (id) => {
        targets.push(id);
      },
    },
  );

  assert.equal(outcome, "applied");
  assert.equal(reloaded, 1, "a superseding update must apply on a device with a failed target");
  assert.deepEqual(targets, ["375"]);
});

test("the reload target is persisted before the app is told to restart", async () => {
  reset();
  const order: string[] = [];
  const storage = memoryStorage();
  const outcome = await reloadPendingOtaUpdate(
    {
      reloadAsync: async () => {
        order.push("reload");
      },
    },
    "374",
    {
      log: () => {},
      onReloadTarget: async (id) => {
        await updateFailedLaunchRecord(storage, (r) => noteReloadTarget(r, id));
        order.push("persist");
      },
    },
  );
  assert.equal(outcome, "applied");
  assert.deepEqual(order, ["persist", "reload"]);
  assert.equal(parseFailedLaunchRecord(storage.raw()).pendingTargetId, "374");
});

test("the ledger survives a round trip and ignores corrupt storage", async () => {
  const storage = memoryStorage();
  await updateFailedLaunchRecord(storage, (r) => noteReloadTarget(r, "374"));
  assert.equal(parseFailedLaunchRecord(storage.raw()).pendingTargetId, "374");

  assert.deepEqual(parseFailedLaunchRecord("not json").failures, {});
  assert.deepEqual(parseFailedLaunchRecord(null).failures, {});
  assert.deepEqual(parseFailedLaunchRecord('{"failures":{"a":{"count":"x"}}}').failures, {});
});

test("a storage failure never blocks an OTA from applying", async () => {
  const broken: OtaFailedLaunchStorage = {
    read: async () => {
      throw new Error("AsyncStorage unavailable");
    },
    write: async () => {
      throw new Error("AsyncStorage unavailable");
    },
  };
  const record = await updateFailedLaunchRecord(broken, (r) => noteReloadTarget(r, "374"));
  assert.equal(record.pendingTargetId, "374");
});

test("finishing Coach critical work notifies listeners so a delayed reload retries", async () => {
  const { blockOtaReload, isOtaReloadBlocked, subscribeOtaReloadUnblocked } = await import(
    "./otaBlock.ts"
  );
  let notified = 0;
  const unsubscribe = subscribeOtaReloadUnblocked(() => {
    notified += 1;
  });

  const releaseA = blockOtaReload();
  const releaseB = blockOtaReload();
  assert.equal(isOtaReloadBlocked(), true);

  releaseA();
  assert.equal(isOtaReloadBlocked(), true, "still blocked while a second operation runs");
  assert.equal(notified, 0, "must not fire until the last block is released");

  releaseB();
  assert.equal(isOtaReloadBlocked(), false);
  assert.equal(notified, 1);

  unsubscribe();
  blockOtaReload()();
  assert.equal(notified, 1, "unsubscribed listeners stop receiving notifications");
});

test("stale failures age out of the ledger", () => {
  const old = JSON.stringify({
    failures: { "370": { count: 9, lastAt: Date.now() - 30 * 24 * 60 * 60 * 1000 } },
  });
  const record = reconcileLaunch(parseFailedLaunchRecord(old), "372").record;
  assert.equal(failedLaunchCount(record, "370"), 0);
});
