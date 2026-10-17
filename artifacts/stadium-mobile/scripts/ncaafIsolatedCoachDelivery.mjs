#!/usr/bin/env node
/**
 * Isolated NCAAF Coach delivery exercise.
 *
 * Monkey-patches the product P0 gate ONLY inside this process so a real
 * simulation → selection → delivery path can run with NCAAF game lines.
 * Does NOT modify NCAAF_GAME_LINE_SIM_VALIDATED in source (stays false).
 *
 * Usage (from artifacts/stadium-mobile):
 *   node --import ./test/register-hooks.mjs ../stadium-mobile/scripts/ncaafIsolatedCoachDelivery.mjs
 * or:
 *   node --import ./test/register-hooks.mjs /path/to/this/file.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

process.chdir("/workspace/artifacts/stadium-mobile");
process.env.EXPO_PUBLIC_DOMAIN = process.env.EXPO_PUBLIC_DOMAIN || "stadium-edge.onrender.com";
process.env.EXPO_PUBLIC_CRASH_REPORTING = "1";
process.env.NCAAF_ISOLATED_COACH_UNLOCK = "1";
process.env.NCAAF_ISOLATED_COACH_UNLOCK_ACK = "research-only-not-product";

const gateUrl = pathToFileURL(
  "/workspace/artifacts/stadium-mobile/lib/coachP0UnvalidatedTotals.ts",
).href;
const gate = await import(gateUrl);
if (gate.NCAAF_GAME_LINE_SIM_VALIDATED !== false) {
  console.error("REFUSING: product gate is not false — abort isolated unlock");
  process.exit(2);
}
if (!gate.ncaafIsolatedResearchUnlockActive()) {
  console.error("REFUSING: isolated research unlock env not active");
  process.exit(2);
}

const { buildCoachParlay } = await import(
  pathToFileURL("/workspace/artifacts/stadium-mobile/lib/coach/buildParlay.ts").href
);
const {
  reportCoachScanReliability,
  buildCoachReliabilityBody,
} = await import(
  pathToFileURL("/workspace/artifacts/stadium-mobile/lib/coachReliabilityReporter.ts").href
);

const posts = [];
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input?.url || String(input);
  if (String(url).includes("/reliability/coach-events") && init?.method === "POST") {
    try {
      posts.push(JSON.parse(String(init.body || "{}")));
    } catch {
      posts.push({});
    }
  }
  return realFetch(input, init);
};

const ask = process.env.NCAAF_ISOLATED_ASK || "3 leg college";
const legs = Number(process.env.NCAAF_ISOLATED_LEGS || 3);
const t0 = Date.now();
const requestId = `ncaaf-isolated-delivery-${t0}`;
const ac = new AbortController();
const hard = setTimeout(() => ac.abort(), 180_000);

let result;
let error = null;
try {
  result = await buildCoachParlay({
    requestedLegs: legs,
    askText: ask,
    signal: ac.signal,
    reliabilityRequestId: requestId,
    onStatus: (s) => console.error("[status]", s),
  });
} catch (e) {
  error = e instanceof Error ? e.message : String(e);
} finally {
  clearTimeout(hard);
}

const durationMs = Date.now() - t0;
const picks = result?.picks ?? [];
const ncaafPicks = picks.filter((p) => {
  const s = String(p.sport || p.providerSport || "").toLowerCase();
  return s === "ncaaf" || s === "college-football" || s.includes("ncaaf");
});
const full = picks.length >= legs && !result?.timedOut;

if (full) {
  reportCoachScanReliability({
    requestId,
    sportCategory: "ncaaf",
    requestedLegCount: legs,
    returnedLegCount: picks.length,
    durationMs,
    picks,
    deliveryCommitted: true,
    realOddsAvailable: true,
  });
  await new Promise((r) => setTimeout(r, 1500));
}

const assembleOnly = buildCoachReliabilityBody({
  requestId,
  requestedLegCount: legs,
  returnedLegCount: picks.length,
  picks,
  deliveryCommitted: false,
  timedOut: result?.timedOut,
  realOddsAvailable: true,
});

const report = {
  isolated: true,
  productGateConstant: false,
  unlockMechanism:
    "NCAAF_ISOLATED_COACH_UNLOCK=1 + NCAAF_ISOLATED_COACH_UNLOCK_ACK=research-only-not-product (product constant stays false)",
  ask,
  requestId,
  durationMs,
  error,
  timedOut: result?.timedOut ?? null,
  pickCount: picks.length,
  ncaafPickCount: ncaafPicks.length,
  requestedLegs: legs,
  fullDelivered: full,
  propPoolSize: result?.propPoolSize ?? null,
  picks: picks.map((p) => ({
    sport: p.sport ?? p.providerSport ?? null,
    market: p.market ?? null,
    player: p.player ?? null,
    game: p.game ?? p.eventName ?? null,
    line: p.line ?? p.point ?? null,
    side: p.side ?? null,
  })),
  posts: posts.map((p) => ({
    eventType: p.eventType ?? null,
    failureReason: p.failureReason ?? null,
    requestId: p.requestId ?? null,
  })),
  fulfilledCount: posts.filter((p) => p.eventType === "parlay_fulfilled").length,
  assembleOnlyIsNull: assembleOnly === null,
  liveApi: process.env.EXPO_PUBLIC_DOMAIN,
  ok: false,
  note: "",
};

if (error) {
  report.note = "buildCoachParlay threw";
  report.ok = false;
} else if (full && ncaafPicks.length > 0 && assembleOnly === null) {
  // Reliability POST may be gated in headless Cloud Agent (reporting_gated).
  // Delivery success is full NCAAF ticket + assemble-only body null.
  report.ok = true;
  report.note =
    "Isolated NCAAF sim→selection→delivery succeeded; product gate still false in source" +
    (report.fulfilledCount === 0
      ? "; reliability POST gated/unavailable in this environment"
      : "");
} else if (full && ncaafPicks.length === 0) {
  report.ok = false;
  report.note =
    "Full ticket without NCAAF legs — slate may lack college game lines or unlock did not reach scanner";
} else {
  report.ok = false;
  report.note = "Incomplete / timed out under isolated unlock";
}

mkdirSync("/opt/cursor/artifacts", { recursive: true });
writeFileSync(
  "/opt/cursor/artifacts/ncaaf-isolated-coach-delivery.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
