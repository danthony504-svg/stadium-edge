/**
 * Prove /ota-debug open (and deep-link cold launch via the same static path)
 * performs zero OTA network/update actions while startup is running.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  canRunLiveOtaProbe,
  LIVE_PROBE_STARTUP_WAIT_MESSAGE,
  OTA_DEBUG_IDLE_CHECK_RESULT,
} from "./otaDebugOpenPolicy.ts";
import {
  createOtaDebugNetworkSpy,
  runOtaDebugLiveProbePath,
  runOtaDebugOpenStaticPath,
} from "./otaDebugStaticOpen.ts";

const ROOT = process.cwd();

test("mount /ota-debug while isStartupProcedureRunning=true → zero check/fetch/reload", async () => {
  const { spy, counts } = createOtaDebugNetworkSpy();
  await runOtaDebugOpenStaticPath({
    isStartupProcedureRunning: true,
    spy,
  });
  assert.equal(counts.checkForUpdateAsync, 0);
  assert.equal(counts.fetchUpdateAsync, 0);
  assert.equal(counts.reloadAsync, 0);
  assert.equal(counts.readLogEntriesAsync, 0);
});

test("deep-link cold launch has the same zero-call behavior", async () => {
  const { spy, counts } = createOtaDebugNetworkSpy();
  // Cold deep-link + remount share the static open path.
  await runOtaDebugOpenStaticPath({ isStartupProcedureRunning: true, spy });
  await runOtaDebugOpenStaticPath({ isStartupProcedureRunning: true, spy });
  assert.equal(counts.checkForUpdateAsync, 0);
  assert.equal(counts.fetchUpdateAsync, 0);
  assert.equal(counts.reloadAsync, 0);
});

test("live probe button blocked while startup running (zero check calls)", async () => {
  const { spy, counts } = createOtaDebugNetworkSpy();
  const result = await runOtaDebugLiveProbePath({
    isStartupProcedureRunning: true,
    spy,
  });
  assert.equal(result, "blocked");
  assert.equal(counts.checkForUpdateAsync, 0);
  assert.equal(canRunLiveOtaProbe(true), false);
  assert.equal(LIVE_PROBE_STARTUP_WAIT_MESSAGE.length > 0, true);
});

test("live probe button may check once startup finishes", async () => {
  const { spy, counts } = createOtaDebugNetworkSpy();
  const result = await runOtaDebugLiveProbePath({
    isStartupProcedureRunning: false,
    spy,
  });
  assert.equal(result, "ran");
  assert.equal(counts.checkForUpdateAsync, 1);
  assert.equal(counts.fetchUpdateAsync, 0);
  assert.equal(counts.reloadAsync, 0);
});

test("/ota-debug + otaDebug source contracts enforce static-only open", () => {
  const screen = readFileSync(join(ROOT, "app/ota-debug.tsx"), "utf8");
  const debug = readFileSync(join(ROOT, "lib/otaDebug.ts"), "utf8");

  const mountEffect = screen.match(
    /useEffect\(\(\) => \{\s*\/\/ Static state only on open[\s\S]*?\}, \[refreshStatic\]\);/,
  );
  assert.ok(mountEffect, "mount useEffect must refresh static only");
  assert.match(mountEffect![0], /void refreshStatic\(\);/);
  // Strip // comments so the "no automatic checkForUpdateAsync" note does not false-positive.
  const mountCode = mountEffect![0].replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(
    mountCode,
    /collectOtaLiveProbeDiagnostics|collectOtaFullDiagnostics|forceOtaCheckFetchAndReload|probeOtaCheckOnly|checkForUpdateAsync/,
  );
  assert.doesNotMatch(screen, /checkResult:\s*["']loading/);
  assert.match(screen, /LIVE_PROBE_STARTUP_WAIT_MESSAGE/);
  assert.match(screen, /canRunLiveOtaProbe/);
  assert.match(screen, /OTA_DEBUG_IDLE_CHECK_RESULT/);

  // Static collect must not call checkForUpdateAsync (only probeOtaCheckOnly may).
  const staticFn = debug.slice(
    debug.indexOf("export async function collectOtaStaticDiagnostics"),
    debug.indexOf("export async function collectOtaLiveProbeDiagnostics"),
  );
  assert.doesNotMatch(staticFn, /Updates\.checkForUpdateAsync/);
  assert.doesNotMatch(staticFn, /Updates\.fetchUpdateAsync/);
  assert.doesNotMatch(staticFn, /Updates\.reloadAsync/);
  assert.match(staticFn, /isStartupProcedureRunning/);
  assert.match(debug, /OTA_DEBUG_IDLE_CHECK_RESULT/);
  assert.doesNotMatch(OTA_DEBUG_IDLE_CHECK_RESULT, /loading/i);
});
