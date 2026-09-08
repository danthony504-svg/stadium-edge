import assert from "node:assert/strict";
import test from "node:test";

import {
  applyPendingOtaReload,
  prefetchOtaUpdate,
  prefetchOtaUpdateDetailed,
  reloadGuardRetryDelayMs,
  resetOtaUpdaterSessionGuardForTests,
  type OtaUpdateClient,
} from "./otaUpdaterCore.ts";

type Log = { step: string; ok: boolean; detail: string };

function logger() {
  const entries: Log[] = [];
  return {
    entries,
    log: (step: Log["step"], ok: boolean, detail: string) => {
      entries.push({ step, ok, detail });
    },
  };
}

function client(partial: Partial<OtaUpdateClient> & Pick<OtaUpdateClient, "checkForUpdateAsync">): OtaUpdateClient {
  return {
    fetchUpdateAsync: async () => ({ isNew: true, manifest: { id: "new-ota" } }),
    reloadAsync: async () => {},
    ...partial,
  };
}

test("available update always reaches fetch", async () => {
  resetOtaUpdaterSessionGuardForTests();
  let fetched = 0;
  const { entries, log } = logger();
  const outcome = await prefetchOtaUpdate(
    client({
      checkForUpdateAsync: async () => ({
        isAvailable: true,
        manifest: { id: "avail-1" },
      }),
      fetchUpdateAsync: async () => {
        fetched += 1;
        return { isNew: true, manifest: { id: "avail-1" } };
      },
    }),
    () => false,
    false,
    { log },
  );
  assert.equal(outcome, "pending");
  assert.equal(fetched, 1);
  assert.ok(entries.some((e) => e.step === "checkForUpdateAsync" && e.detail === "start"));
  assert.ok(entries.some((e) => e.step === "fetchUpdateAsync" && e.detail === "start"));
});

test("check logs updatePreviouslyFailed explicitly", async () => {
  resetOtaUpdaterSessionGuardForTests();
  const { entries, log } = logger();
  const report = await prefetchOtaUpdateDetailed(
    client({
      checkForUpdateAsync: async () => ({
        isAvailable: false,
        reason: "updatePreviouslyFailed",
      }),
    }),
    () => false,
    false,
    { log },
  );
  assert.equal(report.outcome, "none");
  assert.equal(report.previouslyFailed, true);
  assert.ok(
    entries.some(
      (e) => e.step === "checkForUpdateAsync" && e.detail.includes("updatePreviouslyFailed"),
    ),
  );
});

test("blocked Coach/Fantasy state delays reload only, not check/fetch", async () => {
  resetOtaUpdaterSessionGuardForTests();
  let checked = 0;
  let fetched = 0;
  let reloaded = 0;
  const { entries, log } = logger();
  const outcome = await prefetchOtaUpdate(
    client({
      checkForUpdateAsync: async () => {
        checked += 1;
        return { isAvailable: true, manifest: { id: "u1" } };
      },
      fetchUpdateAsync: async () => {
        fetched += 1;
        return { isNew: true, manifest: { id: "u1" } };
      },
      reloadAsync: async () => {
        reloaded += 1;
      },
    }),
    () => false,
    true,
    { isReloadBlocked: () => true, log, reloadUpdateKey: "u1" },
  );
  assert.equal(outcome, "pending");
  assert.equal(checked, 1);
  assert.equal(fetched, 1);
  assert.equal(reloaded, 0);
  assert.ok(entries.some((e) => e.step === "reloadAsync" && !e.ok && e.detail.includes("coach/fantasy")));
});

test("successful fetch is pending even if context has not updated yet", async () => {
  resetOtaUpdaterSessionGuardForTests();
  const { log } = logger();
  const outcome = await prefetchOtaUpdate(
    client({
      checkForUpdateAsync: async () => ({ isAvailable: true, manifest: { id: "x" } }),
      fetchUpdateAsync: async () => ({ isNew: true, manifest: { id: "x" } }),
    }),
    () => false, // latestContext still false — race
    false,
    { log },
  );
  assert.equal(outcome, "pending");
});

test("failed check errors are logged instead of swallowed", async () => {
  resetOtaUpdaterSessionGuardForTests();
  const { entries, log } = logger();
  const outcome = await prefetchOtaUpdate(
    client({
      checkForUpdateAsync: async () => {
        throw new Error("ERR_UPDATES_CHECK network");
      },
    }),
    () => false,
    false,
    { log },
  );
  assert.equal(outcome, "none");
  assert.ok(entries.some((e) => e.step === "checkForUpdateAsync" && !e.ok && e.detail.includes("ERR_UPDATES_CHECK")));
});

test("failed fetch errors are logged instead of swallowed", async () => {
  resetOtaUpdaterSessionGuardForTests();
  const { entries, log } = logger();
  const outcome = await prefetchOtaUpdate(
    client({
      checkForUpdateAsync: async () => ({ isAvailable: true, manifest: { id: "f" } }),
      fetchUpdateAsync: async () => {
        throw new Error("offline");
      },
    }),
    () => false,
    false,
    { log },
  );
  assert.equal(outcome, "none");
  assert.ok(entries.some((e) => e.step === "fetchUpdateAsync" && !e.ok && e.detail === "offline"));
});

test("loop guard keys off pending id — running-bundle key does not strand a new download", async () => {
  resetOtaUpdaterSessionGuardForTests();
  let reloaded = 0;
  const runningKey = "01a081de-running-372";
  const pendingKey = "01a082bd-pending-374";

  // Exhaust guard for the *running* update id (old bug keyed reloads this way).
  for (let i = 0; i < 2; i++) {
    await applyPendingOtaReload(
      {
        reloadAsync: async () => {
          reloaded += 1;
        },
      },
      { reloadUpdateKey: runningKey, log: () => {} },
    );
  }
  assert.equal(reloaded, 2);
  // Running key is now guarded…
  assert.ok(reloadGuardRetryDelayMs(runningKey) > 0);
  // …but a newly downloaded pending id must still be allowed to reload.
  assert.equal(reloadGuardRetryDelayMs(pendingKey), 0);
  const outcome = await applyPendingOtaReload(
    {
      reloadAsync: async () => {
        reloaded += 1;
      },
    },
    { reloadUpdateKey: pendingKey, log: () => {} },
  );
  assert.equal(outcome, "applied");
  assert.equal(reloaded, 3);
});

test("loop guard does not drop pending — returns pending and reports retry", async () => {
  resetOtaUpdaterSessionGuardForTests();
  const key = "loop-pending";
  const { entries, log } = logger();
  let reloaded = 0;
  const reloadClient = {
    reloadAsync: async () => {
      reloaded += 1;
    },
  };

  assert.equal(await applyPendingOtaReload(reloadClient, { reloadUpdateKey: key, log }), "applied");
  assert.equal(await applyPendingOtaReload(reloadClient, { reloadUpdateKey: key, log }), "applied");
  const third = await prefetchOtaUpdateDetailed(
    client({
      checkForUpdateAsync: async () => ({ isAvailable: false, reason: "noUpdateAvailableOnServer" }),
    }),
    () => true, // already pending from prior fetch
    true,
    { log, reloadUpdateKey: key },
  );
  assert.equal(third.outcome, "pending");
  assert.equal(third.pending, true);
  assert.ok(third.lastError?.includes("reload_loop_guard"));
  assert.ok(entries.some((e) => e.detail.includes("reload loop guard")));
  assert.equal(reloaded, 2);
});

test("applyPendingOtaReload does not re-check the server", async () => {
  resetOtaUpdaterSessionGuardForTests();
  let checked = 0;
  let reloaded = 0;
  const outcome = await applyPendingOtaReload(
    {
      reloadAsync: async () => {
        reloaded += 1;
      },
    },
    { reloadUpdateKey: "already-fetched", log: () => {} },
  );
  assert.equal(outcome, "applied");
  assert.equal(checked, 0);
  assert.equal(reloaded, 1);
  // Prove check is not involved:
  void checked;
});

test("unavailable check does not fetch or reload", async () => {
  resetOtaUpdaterSessionGuardForTests();
  let fetched = 0;
  let reloaded = 0;
  const outcome = await prefetchOtaUpdate(
    client({
      checkForUpdateAsync: async () => ({
        isAvailable: false,
        reason: "noUpdateAvailableOnServer",
      }),
      fetchUpdateAsync: async () => {
        fetched += 1;
        return { isNew: true };
      },
      reloadAsync: async () => {
        reloaded += 1;
      },
    }),
    () => false,
    true,
    { log: () => {} },
  );
  assert.equal(outcome, "none");
  assert.equal(fetched, 0);
  assert.equal(reloaded, 0);
});

test("detailed report exposes available update id after fetch", async () => {
  resetOtaUpdaterSessionGuardForTests();
  const report = await prefetchOtaUpdateDetailed(
    client({
      checkForUpdateAsync: async () => ({
        isAvailable: true,
        manifest: { id: "01a082bd-95fd-7fdc-b8cf-e7aadbaefc43" },
      }),
      fetchUpdateAsync: async () => ({
        isNew: true,
        manifest: { id: "01a082bd-95fd-7fdc-b8cf-e7aadbaefc43" },
      }),
    }),
    () => false,
    false,
    { log: () => {} },
  );
  assert.equal(report.outcome, "pending");
  assert.equal(report.availableUpdateId, "01a082bd-95fd-7fdc-b8cf-e7aadbaefc43");
  assert.equal(report.pending, true);
});
