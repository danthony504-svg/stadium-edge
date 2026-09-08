import assert from "node:assert/strict";
import test from "node:test";

import {
  prefetchOtaUpdate,
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
  const outcome = await prefetchOtaUpdate(
    client({
      checkForUpdateAsync: async () => ({ isAvailable: true }),
      fetchUpdateAsync: async () => {
        fetched += 1;
        return { isNew: true };
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
        return { isAvailable: true };
      },
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
      checkForUpdateAsync: async () => ({ isAvailable: true }),
      fetchUpdateAsync: async () => ({ isNew: true }),
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
  assert.ok(entries.some((e) => e.step === "fetchUpdateAsync" && !e.ok && e.detail === "offline"));
});

test("no repeated reload loop under applyWhenReady", async () => {
  resetOtaUpdaterSessionGuardForTests();
  let reloaded = 0;
  const make = () =>
    prefetchOtaUpdate(
      client({
        checkForUpdateAsync: async () => ({ isAvailable: true }),
        fetchUpdateAsync: async () => ({ isNew: true }),
        reloadAsync: async () => {
          reloaded += 1;
        },
      }),
      () => false,
      true,
      { reloadUpdateKey: "loop-id", log: () => {} },
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
