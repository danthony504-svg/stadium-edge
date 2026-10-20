import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { mapScanFailureCode } from "./coachReliabilityClassify.ts";
import {
  buildCoachReliabilityBody,
  reportCoachScanReliability,
} from "./coachReliabilityReporter.ts";
import { shouldSendCrashReports } from "./crashReportingGate.ts";
import { shouldAlertCoachEvent, parseCoachMeta } from "../../api-server/src/lib/coachReliabilitySanitize.ts";
import { parseCoachReliabilityIngestBody } from "../../api-server/src/lib/coachReliabilityIngest.ts";

test("mapScanFailureCode mirrors server grounding/alt/sim/freeze", () => {
  assert.equal(mapScanFailureCode("TEAM_IDS_UNRESOLVED")?.alertable, true);
  assert.equal(mapScanFailureCode("PROP_POOL_EMPTY")?.eventType, "coach_alt_market_failure");
  assert.equal(mapScanFailureCode("GAME_SIMS_FETCH_EMPTY")?.failureReason, "missing_sim_output");
  assert.equal(mapScanFailureCode("QUALITY_BAR_EMPTY")?.alertable, false);
});

test("1) props-only early return emits exactly one Coach reliability report", () => {
  const src = readFileSync(join(process.cwd(), "lib/coach/buildParlay.ts"), "utf8");
  // Isolate the props-only block (dedicated ticket builder → early return).
  // Match the call site, not the import — import.indexOf would include the
  // earlier NCAAF P0 game-line early-exit reporter (separate path).
  const start = src.indexOf("shouldBuildFootballPropsOnlyTicket({");
  const end = src.indexOf("Allowlisted / props-only pools must not re-expand");
  assert.ok(start >= 0 && end > start, "props-only block bounds");
  const block = src.slice(start, end);
  const emits = block.match(/reportCoachScanReliability\s*\(/g) ?? [];
  assert.equal(emits.length, 1, "exactly one reporter call in props-only path");
  assert.match(block, /Fire-and-forget reliability/);
  // Reporter must run before either early return.
  const reportAt = block.indexOf("reportCoachScanReliability");
  const returnEmptyAt = block.indexOf("built.picks.length > 0 && picks.length === 0");
  const returnFinalAt = block.lastIndexOf("return {");
  assert.ok(reportAt >= 0 && returnEmptyAt > reportAt);
  assert.ok(returnFinalAt > reportAt);
  assert.equal(/await\s+reportCoachScanReliability/.test(block), false);
});

test("2) valid thin slate => legitimate underfill, no immediate Telegram page", () => {
  const body = buildCoachReliabilityBody({
    requestedLegCount: 5,
    returnedLegCount: 2,
    realOddsAvailable: true,
    requestId: "greenfield-thin",
    sportCategory: "nfl",
    picks: [
      {
        game: "Minnesota Vikings @ New Orleans Saints",
        market: "Moneyline",
        teamAbbr: "NO",
        isProp: false,
      },
      {
        game: "Minnesota Vikings @ New Orleans Saints",
        market: "Spread",
        teamAbbr: "MIN",
        isProp: false,
      },
    ],
  });
  assert.equal(body?.eventType, "parlay_underfilled");
  assert.equal(body?.failureReason, "legitimate_underfill");
  const parsed = parseCoachReliabilityIngestBody(body);
  assert.ok(parsed);
  assert.equal(
    shouldAlertCoachEvent(parseCoachMeta(JSON.stringify(parsed))!),
    false,
  );
});

test("3) player/game mismatch => grounding failure, immediate alert", () => {
  const body = buildCoachReliabilityBody({
    requestedLegCount: 5,
    returnedLegCount: 2,
    realOddsAvailable: true,
    requestId: "greenfield-mismatch",
    sportCategory: "nfl",
    picks: [
      {
        game: "Minnesota Vikings @ New Orleans Saints",
        player: "Kyler Murray",
        teamAbbr: "ARI",
        isProp: true,
        market: "Pass TDs",
        propMarketKey: "player_pass_tds",
      },
      {
        game: "Minnesota Vikings @ New Orleans Saints",
        market: "Moneyline",
        teamAbbr: "NO",
        isProp: false,
      },
    ],
  });
  assert.equal(body?.eventType, "coach_grounding_failure");
  assert.equal(body?.failureReason, "grounding_failure");
  assert.equal(body?.rootCause, "player_game_grounding_mismatch");
  const parsed = parseCoachReliabilityIngestBody(body);
  assert.ok(parsed);
  assert.equal(parsed!.failureCategory, "grounding");
  assert.equal(
    shouldAlertCoachEvent(parseCoachMeta(JSON.stringify(parsed))!),
    true,
  );
});

test("4) affectedGame is populated when known", () => {
  const body = buildCoachReliabilityBody({
    requestedLegCount: 5,
    returnedLegCount: 1,
    realOddsAvailable: true,
    requestId: "greenfield-aff",
    picks: [
      {
        game: "Minnesota Vikings @ New Orleans Saints",
        player: "Kyler Murray",
        teamAbbr: "ARI",
        isProp: true,
        market: "Pass TDs",
      },
    ],
  });
  assert.equal(body?.affectedGame, "Minnesota Vikings @ New Orleans Saints");

  const thin = buildCoachReliabilityBody({
    requestedLegCount: 5,
    returnedLegCount: 2,
    realOddsAvailable: true,
    picks: [
      { game: "Buffalo Bills @ Miami Dolphins", market: "Spread", isProp: false },
    ],
  });
  assert.equal(thin?.affectedGame, "Buffalo Bills @ Miami Dolphins");
  assert.equal(thin?.failureReason, "legitimate_underfill");
});

test("5) reporter failure cannot block or break Coach response", async () => {
  const prevFetch = globalThis.fetch;
  const prevOptIn = process.env.EXPO_PUBLIC_CRASH_REPORTING;
  const prevDisabled = process.env.CRASH_REPORTING_DISABLED;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("network down");
  }) as typeof fetch;
  try {
    process.env.EXPO_PUBLIC_CRASH_REPORTING = "1";
    delete process.env.CRASH_REPORTING_DISABLED;
    assert.equal(shouldSendCrashReports(process.env), true);
    assert.doesNotThrow(() => {
      reportCoachScanReliability({
        requestedLegCount: 5,
        returnedLegCount: 2,
        realOddsAvailable: true,
        requestId: "greenfield-failsoft",
        picks: [
          {
            game: "Minnesota Vikings @ New Orleans Saints",
            teamAbbr: "ARI",
            player: "Kyler Murray",
            isProp: true,
          },
        ],
      });
    });
    // Allow fire-and-forget rejection to settle — must not become an unhandled rejection.
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(fetchCalls >= 1);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevOptIn === undefined) delete process.env.EXPO_PUBLIC_CRASH_REPORTING;
    else process.env.EXPO_PUBLIC_CRASH_REPORTING = prevOptIn;
    if (prevDisabled === undefined) delete process.env.CRASH_REPORTING_DISABLED;
    else process.env.CRASH_REPORTING_DISABLED = prevDisabled;
  }
});

test("buildCoachReliabilityBody distinguishes legit underfill vs freeze", () => {
  const under = buildCoachReliabilityBody({
    requestedLegCount: 6,
    returnedLegCount: 4,
    realOddsAvailable: true,
    requestId: "greenfield-1",
  });
  assert.equal(under?.eventType, "parlay_underfilled");
  assert.equal(under?.failureReason, "legitimate_underfill");

  const freeze = buildCoachReliabilityBody({
    timedOut: true,
    requestedLegCount: 8,
    returnedLegCount: 0,
    requestId: "greenfield-2",
  });
  assert.equal(freeze?.scanFailureCode, "ABSOLUTE_BUDGET");

  const ground = buildCoachReliabilityBody({
    scanFailureCode: "TEAM_ID_MAP_EMPTY",
    requestedLegCount: 5,
    returnedLegCount: 0,
  });
  assert.equal(ground?.scanFailureCode, "TEAM_ID_MAP_EMPTY");
});

test("fixtures flag is preserved for server reject path", () => {
  const body = buildCoachReliabilityBody({
    scanFailureCode: "SCAN_THREW",
    testFixture: true,
    requestId: "reliability-synthetic",
  });
  assert.equal(body?.testFixture, true);
});

test("Node tests do not open production coach reliability POSTs", () => {
  assert.equal(shouldSendCrashReports(process.env), false);
});

test("buildParlay wires observe-only reporter after finalize (main + props-only)", () => {
  const src = readFileSync(join(process.cwd(), "lib/coach/buildParlay.ts"), "utf8");
  assert.match(src, /reportCoachScanReliability/);
  assert.match(src, /Fire-and-forget reliability/);
  assert.equal(/await\s+reportCoachScanReliability/.test(src), false);
  // Main path still passes picks for grounding classification.
  assert.match(src, /picks,\s*\n\s*timedOut:/);
});

test("temporary coach-rel-diag: correlationId rides on alertable bodies only", () => {
  const body = buildCoachReliabilityBody({
    requestedLegCount: 8,
    returnedLegCount: 5,
    realOddsAvailable: true,
    requestId: "greenfield-diag",
    correlationId: "crdiag-fixed-1",
    sportCategory: "nfl",
    picks: [
      {
        game: "Minnesota Vikings @ New Orleans Saints",
        player: "Kyler Murray",
        teamAbbr: "MIN",
        isProp: true,
        market: "Pass TDs",
      },
    ],
  });
  assert.equal(body?.eventType, "parlay_underfilled");
  assert.equal(body?.correlationId, "crdiag-fixed-1");
  // Full ticket + grounded pick → no body (classification unchanged).
  const full = buildCoachReliabilityBody({
    requestedLegCount: 8,
    returnedLegCount: 8,
    realOddsAvailable: true,
    requestId: "greenfield-diag-full",
    correlationId: "crdiag-fixed-2",
    picks: [
      {
        game: "Minnesota Vikings @ New Orleans Saints",
        player: "Kyler Murray",
        teamAbbr: "MIN",
        isProp: true,
        market: "Pass TDs",
      },
    ],
  });
  assert.equal(full, null);
});

test("temporary coach-rel-diag logs call + post without throwing", async () => {
  const prevFetch = globalThis.fetch;
  const prevOptIn = process.env.EXPO_PUBLIC_CRASH_REPORTING;
  const prevDisabled = process.env.CRASH_REPORTING_DISABLED;
  const lines: string[] = [];
  const prevInfo = console.info;
  console.info = (...args: unknown[]) => {
    lines.push(
      args
        .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
        .join(" "),
    );
  };
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ ok: true }), { status: 202 })) as typeof fetch;
  try {
    process.env.EXPO_PUBLIC_CRASH_REPORTING = "1";
    delete process.env.CRASH_REPORTING_DISABLED;
    reportCoachScanReliability({
      requestedLegCount: 8,
      returnedLegCount: 5,
      realOddsAvailable: true,
      requestId: "greenfield-diag-log",
      correlationId: "crdiag-log-1",
      sportCategory: "nfl",
      picks: [
        {
          game: "Minnesota Vikings @ New Orleans Saints",
          player: "Kyler Murray",
          teamAbbr: "MIN",
          isProp: true,
          market: "Pass TDs",
        },
      ],
    });
    await new Promise((r) => setTimeout(r, 40));
    assert.ok(lines.some((l) => l.includes("[coach-rel-diag]") && l.includes("call")));
    assert.ok(lines.some((l) => l.includes("[coach-rel-diag]") && l.includes("post")));
    assert.ok(lines.some((l) => l.includes("crdiag-log-1")));
    assert.ok(lines.some((l) => l.includes("Kyler Murray")));
    assert.ok(lines.some((l) => l.includes("MIN")));
  } finally {
    console.info = prevInfo;
    globalThis.fetch = prevFetch;
    if (prevOptIn === undefined) delete process.env.EXPO_PUBLIC_CRASH_REPORTING;
    else process.env.EXPO_PUBLIC_CRASH_REPORTING = prevOptIn;
    if (prevDisabled === undefined) delete process.env.CRASH_REPORTING_DISABLED;
    else process.env.CRASH_REPORTING_DISABLED = prevDisabled;
  }
});

test("cancelled builds are recorded as cancellations rather than exceptions", () => {
  const body=buildCoachReliabilityBody({cancelled:true,requestedLegCount:2,returnedLegCount:0,durationMs:4909});
  assert.equal(body?.eventType,"coach_cancelled");
  assert.equal(body?.failureReason,"cancelled");
  assert.equal(body?.terminalStatus,"cancelled");
});
