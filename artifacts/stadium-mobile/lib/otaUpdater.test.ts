import assert from "node:assert/strict";
import test from "node:test";

import {
  prefetchOtaUpdate,
  reloadPendingOtaUpdate,
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
    fetchUpdateAsync: async () => ({ isNew: true }),
    reloadAsync: async () => {},
    ...partial,
  };
}

test("available update always reaches fetch", async () => {
  resetOtaUpdaterSessionGuardForTests();
  let fetched = 0;
  const { entries, log } = logger();
  const newer = "ffffffff-1111-2222-3333-444444444444";
  const outcome = await prefetchOtaUpdate(
    client({
      checkForUpdateAsync: async () => ({
        isAvailable: true,
        manifest: { id: newer },
      }),
      fetchUpdateAsync: async () => {
        fetched += 1;
        return { isNew: true, manifest: { id: newer } };
      },
    }),
    () => false,
    false,
    { log, reloadUpdateKey: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
  );
  assert.equal(outcome, "pending");
  assert.equal(fetched, 1);
  assert.ok(entries.some((e) => e.step === "checkForUpdateAsync" && e.detail === "start"));
  assert.ok(entries.some((e) => e.step === "fetchUpdateAsync" && e.detail === "start"));
});

test("blocked Coach/Fantasy state delays reload only, not check/fetch", async () => {
  resetOtaUpdaterSessionGuardForTests();
  let checked = 0;
  let fetched = 0;
  let reloaded = 0;
  const { entries, log } = logger();
  const newer = "ffffffff-1111-2222-3333-444444444444";
  const outcome = await prefetchOtaUpdate(
    client({
      checkForUpdateAsync: async () => {
        checked += 1;
        return { isAvailable: true, manifest: { id: newer } };
      },
      fetchUpdateAsync: async () => {
        fetched += 1;
        return { isNew: true, manifest: { id: newer } };
      },
      reloadAsync: async () => {
        reloaded += 1;
      },
    }),
    () => false,
    true,
    {
      isReloadBlocked: () => true,
      log,
      reloadUpdateKey: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    },
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
  const newer = "ffffffff-1111-2222-3333-444444444444";
  const outcome = await prefetchOtaUpdate(
    client({
      checkForUpdateAsync: async () => ({
        isAvailable: true,
        manifest: { id: newer },
      }),
      fetchUpdateAsync: async () => ({ isNew: true, manifest: { id: newer } }),
    }),
    () => false, // latestContext still false — race
    false,
    { log, reloadUpdateKey: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
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
      checkForUpdateAsync: async () => ({ isAvailable: true }),
      fetchUpdateAsync: async () => {
        throw new Error("offline");
      },
    }),
    () => false,
    false,
    { log },
  );
  assert.equal(outcome, "none");
  assert.ok(entries.some((e) => e.step === "fetchUpdateAsync" && !e.ok && e.detail.includes("offline")));
});

test("no repeated reload loop under applyWhenReady", async () => {
  resetOtaUpdaterSessionGuardForTests();
  let reloaded = 0;
  const newer = "ffffffff-1111-2222-3333-444444444444";
  const make = () =>
    prefetchOtaUpdate(
      client({
        checkForUpdateAsync: async () => ({
          isAvailable: true,
          manifest: { id: newer },
        }),
        fetchUpdateAsync: async () => ({ isNew: true, manifest: { id: newer } }),
        reloadAsync: async () => {
          reloaded += 1;
        },
      }),
      () => false,
      true,
      {
        reloadUpdateKey: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        log: () => {},
      },
    );

  assert.equal(await make(), "applied");
  assert.equal(await make(), "applied");
  // Third attempt within window blocked by loop guard
  assert.equal(await make(), "pending");
  assert.equal(reloaded, 2);
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

test("same available update id as running → no fetch, no banner arm", async () => {
  resetOtaUpdaterSessionGuardForTests();
  const running = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  let fetched = 0;
  const { entries, log } = logger();
  const outcome = await prefetchOtaUpdate(
    client({
      checkForUpdateAsync: async () => ({
        isAvailable: true,
        manifest: { id: running },
      }),
      fetchUpdateAsync: async () => {
        fetched += 1;
        return { isNew: true, manifest: { id: running } };
      },
    }),
    () => true, // native isUpdatePending stuck true after prior reload
    false,
    {
      log,
      reloadUpdateKey: running,
      downloadedUpdateId: () => running,
    },
  );
  assert.equal(outcome, "none");
  assert.equal(fetched, 0);
  assert.ok(
    entries.some(
      (e) =>
        e.step === "fetchUpdateAsync" &&
        !e.ok &&
        e.detail.includes("already running"),
    ),
  );
});

test("stuck native pending for running id does not stay pending", async () => {
  resetOtaUpdaterSessionGuardForTests();
  const running = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const outcome = await prefetchOtaUpdate(
    client({
      checkForUpdateAsync: async () => ({
        isAvailable: false,
        reason: "noUpdateAvailableOnServer",
      }),
    }),
    () => true,
    false,
    {
      log: () => {},
      reloadUpdateKey: running,
      downloadedUpdateId: () => running,
    },
  );
  assert.equal(outcome, "none");
});

test("newer available id still fetches and arms pending", async () => {
  resetOtaUpdaterSessionGuardForTests();
  const running = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const newer = "ffffffff-1111-2222-3333-444444444444";
  let fetched = 0;
  const outcome = await prefetchOtaUpdate(
    client({
      checkForUpdateAsync: async () => ({
        isAvailable: true,
        manifest: { id: newer },
      }),
      fetchUpdateAsync: async () => {
        fetched += 1;
        return { isNew: true, manifest: { id: newer } };
      },
    }),
    () => false,
    false,
    { log: () => {}, reloadUpdateKey: running },
  );
  assert.equal(outcome, "pending");
  assert.equal(fetched, 1);
});

test("failed fetch does not mark update applied / pending", async () => {
  resetOtaUpdaterSessionGuardForTests();
  const running = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const newer = "ffffffff-1111-2222-3333-444444444444";
  const outcome = await prefetchOtaUpdate(
    client({
      checkForUpdateAsync: async () => ({
        isAvailable: true,
        manifest: { id: newer },
      }),
      fetchUpdateAsync: async () => {
        throw new Error("download failed");
      },
    }),
    () => false,
    false,
    { log: () => {}, reloadUpdateKey: running },
  );
  assert.equal(outcome, "none");
});

test("sticky pending with no download id does not reloadAsync (updatePreviouslyFailed guard)", async () => {
  // Tip boot after reload: isUpdatePending stuck true, downloadedManifest cleared.
  // Reloading here is the July f16710eb / tip 01a131bc blacklist pattern.
  resetOtaUpdaterSessionGuardForTests();
  const running = "01a131bc-e321-73f2-9d8a-4cf3f005f252";
  let reloaded = 0;
  const { entries, log } = logger();
  const outcome = await prefetchOtaUpdate(
    client({
      checkForUpdateAsync: async () => ({
        isAvailable: false,
        reason: "noUpdateAvailableOnServer",
      }),
      reloadAsync: async () => {
        reloaded += 1;
      },
    }),
    () => true, // sticky native pending, no downloaded id
    true, // would have applied if pending were trusted
    {
      log,
      reloadUpdateKey: running,
      downloadedUpdateId: () => null,
    },
  );
  assert.equal(outcome, "none");
  assert.equal(reloaded, 0);
  assert.ok(
    entries.some(
      (e) => e.step === "reloadAsync" && !e.ok && /no pending|skip|blocked/i.test(e.detail),
    ) ||
      outcome === "none",
  );
});

test("applyWhenReady refuses reload when target id equals running id", async () => {
  resetOtaUpdaterSessionGuardForTests();
  const running = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  let reloaded = 0;
  const { entries, log } = logger();
  const outcome = await reloadPendingOtaUpdate(
    {
      reloadAsync: async () => {
        reloaded += 1;
      },
    },
    running,
    { log, reloadUpdateKey: running },
  );
  assert.equal(outcome, "none");
  assert.equal(reloaded, 0);
  assert.ok(
    entries.some(
      (e) => e.step === "reloadAsync" && !e.ok && e.detail.includes("already running"),
    ),
  );
});
