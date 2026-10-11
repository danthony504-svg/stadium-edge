/**
 * Prove crash fixtures never reach production ingest from Node tests / CI / agents,
 * even when EXPO_PUBLIC_DOMAIN points at the live API host.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  hasRealOtaIdentity,
  isBlankCrashMeta,
  isLikelyReactNativeRuntime,
  shouldSendCrashReports,
} from "./crashReportingGate.ts";
import {
  _resetCrashReporterForTests,
  reportCrash,
} from "./crashReporter.ts";

test("blank meta helpers treat em-dash / unknown as empty", () => {
  assert.equal(isBlankCrashMeta("—"), true);
  assert.equal(isBlankCrashMeta("unknown"), true);
  assert.equal(isBlankCrashMeta("01a1283b-9959-701e-aa25-63ef471e321f"), false);
  assert.equal(hasRealOtaIdentity({ updateId: "—", runtimeVersion: "—", channel: "—" }), false);
  assert.equal(
    hasRealOtaIdentity({
      updateId: "01a1283b-9959-701e-aa25-63ef471e321f",
      runtimeVersion: "1.1.0",
      channel: "production",
    }),
    true,
  );
});

test("Node / CI / test env cannot enable crash POSTs via production domain alone", () => {
  const prodDomainEnv = {
    EXPO_PUBLIC_DOMAIN: "stadium-edge.onrender.com",
    NODE_ENV: "test",
  } as NodeJS.ProcessEnv;
  assert.equal(
    shouldSendCrashReports(prodDomainEnv, { isReactNative: false }),
    false,
    "NODE_ENV=test must block even with production domain",
  );

  assert.equal(
    shouldSendCrashReports(
      {
        EXPO_PUBLIC_DOMAIN: "stadium-edge.onrender.com",
        CI: "true",
      } as NodeJS.ProcessEnv,
      { isReactNative: false },
    ),
    false,
    "CI Node jobs must not POST",
  );

  assert.equal(
    shouldSendCrashReports(
      {
        EXPO_PUBLIC_DOMAIN: "stadium-edge.onrender.com",
        GITHUB_ACTIONS: "true",
      } as NodeJS.ProcessEnv,
      { isReactNative: false },
    ),
    false,
  );

  assert.equal(
    shouldSendCrashReports(
      {
        EXPO_PUBLIC_DOMAIN: "stadium-edge.onrender.com",
        CRASH_REPORTING_DISABLED: "1",
      } as NodeJS.ProcessEnv,
      { isReactNative: true, hasHermes: true },
    ),
    false,
    "explicit disable wins over RN",
  );
});

test("production mobile (RN/Hermes) remains enabled by default", () => {
  assert.equal(
    shouldSendCrashReports({} as NodeJS.ProcessEnv, {
      isReactNative: true,
      hasHermes: true,
    }),
    true,
  );
  assert.equal(
    shouldSendCrashReports(
      { EXPO_PUBLIC_CRASH_REPORTING: "0" } as NodeJS.ProcessEnv,
      { isReactNative: true },
    ),
    false,
    "prod kill switch",
  );
});

test("default Node runtime (cloud agent / local node:test) is not RN", () => {
  assert.equal(isLikelyReactNativeRuntime({}), false);
  assert.equal(
    shouldSendCrashReports({
      EXPO_PUBLIC_DOMAIN: "stadium-edge.onrender.com",
    } as NodeJS.ProcessEnv),
    false,
  );
});

test("reportCrash with production domain does not fetch the live API from Node", async () => {
  _resetCrashReporterForTests();
  const previousDomain = process.env.EXPO_PUBLIC_DOMAIN;
  const previousDisable = process.env.CRASH_REPORTING_DISABLED;
  const previousNodeEnv = process.env.NODE_ENV;
  const previousFlag = process.env.EXPO_PUBLIC_CRASH_REPORTING;

  process.env.EXPO_PUBLIC_DOMAIN = "stadium-edge.onrender.com";
  delete process.env.CRASH_REPORTING_DISABLED;
  delete process.env.EXPO_PUBLIC_CRASH_REPORTING;
  // Even if NODE_ENV is unset (agent shells), RN detection still fails in Node.
  delete process.env.NODE_ENV;

  const originalFetch = globalThis.fetch;
  let calls = 0;
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls += 1;
    urls.push(String(input));
    return new Response(JSON.stringify({ ok: true }), { status: 202 });
  }) as typeof fetch;

  try {
    assert.doesNotThrow(() =>
      reportCrash({
        errorMessage: "startup-render-fail",
        errorStack: "Error: startup-render-fail",
      }),
    );
    assert.doesNotThrow(() =>
      reportCrash({
        errorMessage: "fixture-should-never-reach-prod",
        errorStack: "Error: fixture-should-never-reach-prod",
      }),
    );
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(calls, 0, "no network POST from Node test runtime");
    assert.equal(urls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousDomain === undefined) delete process.env.EXPO_PUBLIC_DOMAIN;
    else process.env.EXPO_PUBLIC_DOMAIN = previousDomain;
    if (previousDisable === undefined) delete process.env.CRASH_REPORTING_DISABLED;
    else process.env.CRASH_REPORTING_DISABLED = previousDisable;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousFlag === undefined) delete process.env.EXPO_PUBLIC_CRASH_REPORTING;
    else process.env.EXPO_PUBLIC_CRASH_REPORTING = previousFlag;
  }
});
