import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activationAllowed,
  buildDedupeKey,
  buildSnapshotMeta,
  canSpend,
  createCreditLedger,
  estimateHistoricalFeaturedCredits,
  estimateLiveFeaturedCredits,
  estimateWeeklyCredits,
  historicalHeavyWeeklyEstimate,
  NCAAF_FORWARD_DEFAULT_SCHEDULE,
  NCAAF_FORWARD_FEATURED_MARKETS,
  NCAAF_FORWARD_REGIONS_LIVE,
  recordSpend,
  snapshotBucketIso,
} from "../src/lib/ncaafForwardCollector.ts";

test("live featured credits = markets × regions", () => {
  const e = estimateLiveFeaturedCredits(3, 1);
  assert.equal(e.creditsPerCall, 3);
  assert.equal(e.endpoint, "live_odds");
});

test("historical featured credits = 10 × markets × regions", () => {
  const e = estimateHistoricalFeaturedCredits(3, 1);
  assert.equal(e.creditsPerCall, 30);
  assert.equal(e.endpoint, "historical_odds");
});

test("default weekly cost uses live polls and stays well below historical-heavy band", () => {
  const w = estimateWeeklyCredits(NCAAF_FORWARD_DEFAULT_SCHEDULE);
  assert.equal(w.liveFeatured.creditsEach, 3);
  assert.equal(w.liveFeatured.polls, 16);
  assert.equal(w.totalCreditsPerWeek, 48);
  assert.equal(w.historicalT24h.credits, 0);
  assert.equal(w.historicalAlts.credits, 0);
  const heavy = historicalHeavyWeeklyEstimate();
  // 10 T-24h + 10 close × 30 = 600
  assert.equal(heavy.totalCreditsPerWeek, 600);
  assert.ok(w.totalCreditsPerWeek < heavy.totalCreditsPerWeek);
});

test("dedupe key normalizes market/region order and minute bucket", () => {
  const a = buildDedupeKey({
    sport: "americanfootball_ncaaf",
    mode: "dry_run",
    markets: ["totals", "h2h", "spreads"],
    regions: ["us"],
    snapshotBucketIso: "2026-10-16T20:07:33.000Z",
  });
  const b = buildDedupeKey({
    sport: "americanfootball_ncaaf",
    mode: "dry_run",
    markets: ["h2h", "spreads", "totals"],
    regions: ["us"],
    snapshotBucketIso: "2026-10-16T20:07:01.000Z",
  });
  assert.equal(a, b);
  assert.equal(snapshotBucketIso("2026-10-16T20:07:33.000Z"), "2026-10-16T20:07:00Z");
});

test("hard credit cap refuses overspend", () => {
  let ledger = createCreditLedger(10);
  assert.equal(canSpend(ledger, 3), true);
  ledger = recordSpend(ledger, 3);
  assert.equal(ledger.spent, 3);
  assert.equal(ledger.remaining, 7);
  assert.equal(canSpend(ledger, 8), false);
  assert.throws(() => recordSpend(ledger, 8), /credit cap exceeded/);
});

test("activationAllowed requires activate + cap + key without reading key value", () => {
  const denied = activationAllowed({
    NCAAF_FORWARD_ACTIVATE: "",
    NCAAF_FORWARD_CREDIT_CAP: "",
    ODDS_API_KEY: "",
  });
  assert.equal(denied.allowed, false);
  assert.ok(denied.reasons.includes("NCAAF_FORWARD_ACTIVATE!=1"));

  const ok = activationAllowed({
    NCAAF_FORWARD_ACTIVATE: "1",
    NCAAF_FORWARD_CREDIT_CAP: "50",
    ODDS_API_KEY: "redacted-not-logged",
  });
  assert.equal(ok.allowed, true);
  assert.deepEqual(ok.reasons, []);
});

test("snapshot meta never embeds the API key", () => {
  const meta = buildSnapshotMeta({
    captureTimestamp: "2026-10-16T21:00:00.000Z",
    mode: "dry_run",
    markets: NCAAF_FORWARD_FEATURED_MARKETS,
    regions: NCAAF_FORWARD_REGIONS_LIVE,
    creditsCharged: 0,
    eventCount: 0,
    oddsKeyConfigured: true,
  });
  const blob = JSON.stringify(meta);
  assert.equal(meta.credential, "ODDS_API_KEY:set");
  assert.equal(meta.activated, false);
  assert.ok(!blob.includes("redacted"));
  assert.ok(!/apiKey/i.test(blob) || blob.includes("ODDS_API_KEY:set"));
});
