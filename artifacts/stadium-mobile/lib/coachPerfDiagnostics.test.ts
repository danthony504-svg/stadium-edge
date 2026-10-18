/**
 * Observe-only Coach performance diagnostics regressions.
 * Never exercises selection / sim counts / floors / provenance.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  coachPerfBodyFields,
  coachPerfElapsedMs,
  coachPerfNowMs,
  createCoachPerfCounters,
  deriveCoachTerminalStatus,
  normalizeEffectiveSports,
  resolveCoachClientUpdateId,
  roundPerfMs,
} from "./coachPerfDiagnostics.ts";
import {
  buildCoachReliabilityBody,
  reportCoachScanReliability,
  resetCoachReliabilityFulfilledDedupeForTests,
} from "./coachReliabilityReporter.ts";
import { parseCoachReliabilityIngestBody } from "../../api-server/src/lib/coachReliabilityIngest.ts";
import {
  parseCoachMeta,
  serializeCoachMeta,
  type CoachReliabilityMeta,
} from "../../api-server/src/lib/coachReliabilitySanitize.ts";
import { setExpoUpdatesModuleForTests } from "./expoUpdatesAccess.ts";

const SAMPLE_UPDATE_ID = "01a14f8c-aaaa-bbbb-cccc-ddddeeee0001";

function groundedPick() {
  return {
    game: "Minnesota Vikings @ New Orleans Saints",
    market: "Moneyline",
    teamAbbr: "NO",
    isProp: false,
  };
}

test("roundPerfMs / normalizeEffectiveSports / counters seed", () => {
  assert.equal(roundPerfMs(12.4), 12);
  assert.equal(roundPerfMs(-3), 0);
  assert.equal(roundPerfMs(undefined), null);
  assert.deepEqual(normalizeEffectiveSports(["NFL", "nfl", "NBA"]), [
    "nfl",
    "nba",
  ]);
  const c = createCoachPerfCounters({ propSimMs: 10 });
  assert.equal(c.propSimMs, 10);
  assert.equal(c.gameSimMs, null);
});

test("resolveCoachClientUpdateId reads Expo Updates.updateId", () => {
  setExpoUpdatesModuleForTests({
    updateId: SAMPLE_UPDATE_ID,
  } as never);
  try {
    assert.equal(resolveCoachClientUpdateId(), SAMPLE_UPDATE_ID);
  } finally {
    setExpoUpdatesModuleForTests(undefined);
  }
});

test("coachPerfBodyFields maps enrichmentMs and omits nulls", () => {
  const fields = coachPerfBodyFields({
    updateId: SAMPLE_UPDATE_ID,
    enrichmentMs: 1234.6,
    propSimMs: 200,
    gameSimMs: null,
    qualificationMs: 40,
    finalizationMs: 50,
    terminalStatus: "fulfilled",
    requestedSport: "mlb",
    effectiveSports: ["mlb"],
    candidatesPoolBefore: 100,
    candidatesPoolAfter: 80,
    qualifiedCount: 6,
  });
  assert.equal(fields.updateId, SAMPLE_UPDATE_ID);
  assert.equal(fields.enrichmentMs, 1235);
  assert.equal(fields.propSimMs, 200);
  assert.equal("gameSimMs" in fields, false);
  assert.equal(fields.terminalStatus, "fulfilled");
  assert.deepEqual(fields.effectiveSports, ["mlb"]);
});

test("deriveCoachTerminalStatus covers success/shortfall/timeout/cancel/error", () => {
  assert.equal(
    deriveCoachTerminalStatus({
      deliveryCommitted: true,
      requestedLegCount: 6,
      returnedLegCount: 6,
    }),
    "fulfilled",
  );
  assert.equal(
    deriveCoachTerminalStatus({
      requestedLegCount: 6,
      returnedLegCount: 3,
    }),
    "shortfall",
  );
  assert.equal(
    deriveCoachTerminalStatus({ timedOut: true, requestedLegCount: 6 }),
    "timed_out",
  );
  assert.equal(
    deriveCoachTerminalStatus({ cancelled: true }),
    "cancelled",
  );
  assert.equal(
    deriveCoachTerminalStatus({
      eventType: "coach_exception",
      failureReason: "exception",
    }),
    "error",
  );
  assert.equal(
    deriveCoachTerminalStatus({ requestedLegCount: 6, returnedLegCount: 0 }),
    "empty",
  );
});

test("1) successful Coach ticket — one terminal with updateId + enrichmentMs", () => {
  setExpoUpdatesModuleForTests({
    updateId: SAMPLE_UPDATE_ID,
  } as never);
  try {
    const body = buildCoachReliabilityBody({
      requestId: "perf-success-1",
      sportCategory: "mlb",
      requestedLegCount: 6,
      returnedLegCount: 6,
      deliveryCommitted: true,
      enrichmentMs: 2_100,
      loadMs: 4_000,
      propSimMs: 8_500,
      gameSimMs: 12_000,
      qualificationMs: 120,
      finalizationMs: 80,
      totalMs: 45_000,
      lastCompletedPhase: "finalization",
      requestedSport: "mlb",
      effectiveSports: ["mlb"],
      candidatesPoolBefore: 240,
      candidatesPoolAfter: 180,
      candidatesSelected: 40,
      deepSimRequested: 12,
      deepSimCompleted: 12,
      qualifiedCount: 6,
      picks: Array.from({ length: 6 }, groundedPick),
    });
    assert.ok(body);
    assert.equal(body!.eventType, "parlay_fulfilled");
    assert.equal(body!.terminalStatus, "fulfilled");
    assert.equal(body!.updateId, SAMPLE_UPDATE_ID);
    assert.equal(body!.requestId, "perf-success-1");
    assert.equal(body!.enrichmentMs, 2_100);
    assert.equal(body!.propSimMs, 8_500);
    assert.equal(body!.gameSimMs, 12_000);
    assert.equal(body!.qualificationMs, 120);
    assert.equal(body!.finalizationMs, 80);
    assert.equal(body!.candidatesPoolBefore, 240);
    assert.equal(body!.qualifiedCount, 6);
    const parsed = parseCoachReliabilityIngestBody(body);
    assert.ok(parsed);
    assert.equal(parsed!.updateId, SAMPLE_UPDATE_ID);
    assert.equal(parsed!.enrichmentMs, 2_100);
    assert.equal(parsed!.terminalStatus, "fulfilled");
  } finally {
    setExpoUpdatesModuleForTests(undefined);
  }
});

test("2) honest shortfall — terminalStatus shortfall + funnel counts", () => {
  const body = buildCoachReliabilityBody({
    requestId: "perf-shortfall-1",
    updateId: SAMPLE_UPDATE_ID,
    sportCategory: "nfl",
    requestedLegCount: 8,
    returnedLegCount: 3,
    enrichmentMs: 900,
    propSimMs: 3_000,
    qualificationMs: 50,
    candidatesPoolBefore: 90,
    candidatesPoolAfter: 70,
    candidatesSelected: 20,
    deepSimRequested: 8,
    deepSimCompleted: 8,
    qualifiedCount: 3,
    picks: [groundedPick(), groundedPick(), groundedPick()],
  });
  assert.equal(body?.eventType, "parlay_underfilled");
  assert.equal(body?.terminalStatus, "shortfall");
  assert.equal(body?.updateId, SAMPLE_UPDATE_ID);
  assert.equal(body?.candidatesPoolBefore, 90);
  assert.equal(body?.qualifiedCount, 3);
});

test("3) deadline timeout during loading", () => {
  const body = buildCoachReliabilityBody({
    requestId: "perf-timeout-load",
    updateId: SAMPLE_UPDATE_ID,
    requestedLegCount: 6,
    returnedLegCount: 0,
    timedOut: true,
    timeoutReason: "load_deadline",
    lastCompletedPhase: "load",
    loadMs: 90_000,
    enrichmentMs: null,
    totalMs: 90_000,
  });
  assert.equal(body?.eventType, "coach_scan_freeze");
  assert.equal(body?.terminalStatus, "timed_out");
  assert.equal(body?.timeoutReason, "load_deadline");
  assert.equal(body?.lastCompletedPhase, "load");
  assert.equal(body?.updateId, SAMPLE_UPDATE_ID);
  assert.equal("enrichmentMs" in (body ?? {}), false);
});

test("4) timeout during simulation", () => {
  const body = buildCoachReliabilityBody({
    requestId: "perf-timeout-sim",
    updateId: SAMPLE_UPDATE_ID,
    requestedLegCount: 6,
    returnedLegCount: 1,
    timedOut: true,
    timeoutReason: "scan_deadline",
    lastCompletedPhase: "scan",
    loadMs: 8_000,
    enrichmentMs: 1_500,
    scanMs: 70_000,
    gameSimMs: 40_000,
    propSimMs: 25_000,
    totalMs: 90_000,
    picks: [groundedPick()],
  });
  assert.equal(body?.eventType, "coach_scan_freeze");
  assert.equal(body?.terminalStatus, "timed_out");
  assert.equal(body?.timeoutReason, "scan_deadline");
  assert.equal(body?.gameSimMs, 40_000);
  assert.equal(body?.enrichmentMs, 1_500);
});

test("5) cancellation", () => {
  const body = buildCoachReliabilityBody({
    requestId: "perf-cancel-1",
    updateId: SAMPLE_UPDATE_ID,
    requestedLegCount: 6,
    returnedLegCount: 2,
    cancelled: true,
    enrichmentMs: 400,
    picks: [groundedPick(), groundedPick()],
  });
  assert.equal(body?.eventType, "coach_exception");
  assert.equal(body?.terminalStatus, "cancelled");
  assert.equal(body?.rootCause, "user_cancelled");
  assert.equal(body?.updateId, SAMPLE_UPDATE_ID);
});

test("6) exception", () => {
  const body = buildCoachReliabilityBody({
    requestId: "perf-exception-1",
    updateId: SAMPLE_UPDATE_ID,
    requestedLegCount: 6,
    returnedLegCount: 2,
    eventType: "coach_exception",
    failureReason: "exception",
    rootCause: "build_exception",
    enrichmentMs: 100,
    picks: [groundedPick(), groundedPick()],
  });
  assert.equal(body?.eventType, "coach_exception");
  assert.equal(body?.terminalStatus, "error");
  assert.equal(body?.rootCause, "build_exception");
  // Must not be reclassified as shortfall despite returned < requested.
  assert.notEqual(body?.failureReason, "legitimate_underfill");
});

test("7) consecutive requests — distinct requestIds each emit once", async () => {
  resetCoachReliabilityFulfilledDedupeForTests();
  const prevFetch = globalThis.fetch;
  const prevOptIn = process.env.EXPO_PUBLIC_CRASH_REPORTING;
  const prevDisabled = process.env.CRASH_REPORTING_DISABLED;
  const bodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body ?? "{}")));
    return new Response(JSON.stringify({ ok: true }), { status: 202 });
  }) as typeof fetch;
  try {
    process.env.EXPO_PUBLIC_CRASH_REPORTING = "1";
    delete process.env.CRASH_REPORTING_DISABLED;
    setExpoUpdatesModuleForTests({
      updateId: SAMPLE_UPDATE_ID,
    } as never);
    reportCoachScanReliability({
      requestId: "perf-consec-a",
      requestedLegCount: 5,
      returnedLegCount: 2,
      enrichmentMs: 10,
      picks: [groundedPick(), groundedPick()],
    });
    reportCoachScanReliability({
      requestId: "perf-consec-b",
      requestedLegCount: 5,
      returnedLegCount: 2,
      enrichmentMs: 20,
      picks: [groundedPick(), groundedPick()],
    });
    // Duplicate cancel on A must be dropped.
    reportCoachScanReliability({
      requestId: "perf-consec-a",
      requestedLegCount: 5,
      returnedLegCount: 2,
      cancelled: true,
    });
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0]!.requestId, "perf-consec-a");
    assert.equal(bodies[1]!.requestId, "perf-consec-b");
    assert.equal(bodies[0]!.updateId, SAMPLE_UPDATE_ID);
    assert.equal(bodies[1]!.updateId, SAMPLE_UPDATE_ID);
    assert.equal(bodies[0]!.terminalStatus, "shortfall");
  } finally {
    globalThis.fetch = prevFetch;
    setExpoUpdatesModuleForTests(undefined);
    if (prevOptIn === undefined) delete process.env.EXPO_PUBLIC_CRASH_REPORTING;
    else process.env.EXPO_PUBLIC_CRASH_REPORTING = prevOptIn;
    if (prevDisabled === undefined) {
      delete process.env.CRASH_REPORTING_DISABLED;
    } else {
      process.env.CRASH_REPORTING_DISABLED = prevDisabled;
    }
    resetCoachReliabilityFulfilledDedupeForTests();
  }
});

test("8) parallel phases — enrichmentMs is one wall, not a sum", () => {
  // enrichmentMs aliases contextMs (Promise.all wall). Body fields must not
  // invent a summed parallel total.
  const fields = coachPerfBodyFields({
    enrichmentMs: 1_000,
    // hypothetical parallel leg walls — must not appear as enrichmentMs
    propSimMs: 800,
    gameSimMs: 900,
  });
  assert.equal(fields.enrichmentMs, 1_000);
  assert.ok(
    (fields.enrichmentMs as number) <
      (fields.propSimMs as number) + (fields.gameSimMs as number),
  );
});

test("9) missing optional metrics — body still valid without sub-phases", () => {
  const body = buildCoachReliabilityBody({
    requestId: "perf-sparse-1",
    updateId: SAMPLE_UPDATE_ID,
    requestedLegCount: 6,
    returnedLegCount: 0,
    timedOut: true,
    timeoutReason: "load_deadline",
    loadMs: 90_000,
    totalMs: 90_000,
  });
  assert.ok(body);
  assert.equal(body!.updateId, SAMPLE_UPDATE_ID);
  assert.equal(body!.terminalStatus, "timed_out");
  assert.equal("propSimMs" in body!, false);
  assert.equal("qualificationMs" in body!, false);
  assert.equal("candidatesPoolBefore" in body!, false);
  const parsed = parseCoachReliabilityIngestBody(body);
  assert.ok(parsed);
  assert.equal(parsed!.propSimMs ?? null, null);
});

test("server meta round-trip keeps compact perf fields", () => {
  const meta: CoachReliabilityMeta = {
    eventType: "parlay_underfilled",
    sportCategory: "mlb",
    questionKind: "parlay_build",
    requestedLegCount: 6,
    returnedLegCount: 2,
    durationMs: 12_000,
    failureReason: "legitimate_underfill",
    failureCategory: "fulfillment",
    realOddsAvailable: true,
    qualificationFiltersEliminated: true,
    answered: null,
    requestId: "perf-meta-1",
    affectedGame: null,
    rootCause: "thin_slate",
    updateId: SAMPLE_UPDATE_ID,
    enrichmentMs: 1_100,
    propSimMs: 2_200,
    terminalStatus: "shortfall",
    requestedSport: "mlb",
    effectiveSports: ["mlb"],
    candidatesPoolBefore: 50,
    qualifiedCount: 2,
  };
  const raw = serializeCoachMeta(meta);
  assert.ok(raw.length <= 1800);
  assert.ok(!raw.includes("access_token"));
  assert.ok(!raw.includes("password"));
  const back = parseCoachMeta(raw);
  assert.ok(back);
  assert.equal(back!.updateId, SAMPLE_UPDATE_ID);
  assert.equal(back!.enrichmentMs, 1_100);
  assert.equal(back!.terminalStatus, "shortfall");
  assert.equal(back!.candidatesPoolBefore, 50);
});

test("monotonic now helper advances", () => {
  const a = coachPerfNowMs();
  const b = coachPerfNowMs();
  assert.ok(b >= a);
  assert.equal(coachPerfElapsedMs(a) >= 0, true);
});

test("sample sanitized terminal event shape (review artifact)", () => {
  const sample = buildCoachReliabilityBody({
    requestId: "req_preview_01a14f8c_sample",
    updateId: SAMPLE_UPDATE_ID,
    sportCategory: "mlb",
    requestedLegCount: 6,
    returnedLegCount: 6,
    deliveryCommitted: true,
    loadMs: 5_200,
    enrichmentMs: 1_840,
    propSimMs: 9_100,
    gameSimMs: 14_300,
    qualificationMs: 95,
    scanMs: 38_000,
    finalizationMs: 110,
    totalMs: 52_400,
    lastCompletedPhase: "finalization",
    terminalStatus: "fulfilled",
    requestedSport: "mlb",
    effectiveSports: ["mlb"],
    candidatesPoolBefore: 212,
    candidatesPoolAfter: 168,
    candidatesSelected: 36,
    deepSimRequested: 14,
    deepSimCompleted: 14,
    qualifiedCount: 6,
    picks: Array.from({ length: 6 }, groundedPick),
  });
  assert.ok(sample);
  // Sanitized review sample — no PII / tokens.
  const json = JSON.stringify(sample, null, 2);
  assert.ok(!/Bearer |sk-|password|email@/i.test(json));
  assert.equal(sample!.updateId, SAMPLE_UPDATE_ID);
  assert.equal(sample!.requestId, "req_preview_01a14f8c_sample");
  assert.equal(sample!.terminalStatus, "fulfilled");
  assert.equal(sample!.enrichmentMs, 1_840);
});
