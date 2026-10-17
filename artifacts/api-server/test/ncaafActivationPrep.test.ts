/**
 * Activation / retrieval prep — no purchase, no fetch, no unlock.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  buildInjuryCollectorActivationPackage,
  buildScoreTapeProvenanceReport,
  buildSpreadsTotalsAltManifest,
  verifyScoreTapeDocsSamples,
  INJURY_SAMPLE_FLOORS,
  SCORETAPE_SETUP,
} from "../src/lib/sportSim/ncaafClean/index.ts";

test("injury activation package schedule math is 20/week; floors locked", () => {
  const p = buildInjuryCollectorActivationPackage();
  assert.equal(p.frozenMlUnchanged, true);
  assert.equal(p.productGatesUnchanged, true);
  assert.equal(p.schedule.freezesPerWeek, 20);
  assert.equal(p.schedule.costUsdPerWeek, 0);
  assert.equal(INJURY_SAMPLE_FLOORS.N1_minDecidedCloseMlWithJoinAttempt, 60);
  assert.equal(INJURY_SAMPLE_FLOORS.N2_minInjuryKnownTrue, 20);
  assert.ok(p.deploymentDiff.activateCommand.includes("NCAAF_INJURY_COLLECTOR_ACTIVE=1"));
  assert.ok(existsSync(join(process.cwd(), "scripts/ncaafInjuryCollectorCron.sh")));
  assert.ok(existsSync(join(process.cwd(), "scripts/ncaaf-injury-collector.cron")));
  assert.match(
    readFileSync(join(process.cwd(), "scripts/ncaaf-injury-collector.cron"), "utf8"),
    /20 freezes\/week/,
  );
});

test("ScoreTape docs samples prove captured_ms schema", () => {
  const d = verifyScoreTapeDocsSamples();
  assert.equal(d.restCapturedParseable, true);
  assert.equal(d.webhookCapturedMsParseable, true);
  assert.ok(d.webhookCapturedIso?.startsWith("2026-06-12"));
  assert.equal(SCORETAPE_SETUP.costUsd, 0);
  const report = buildScoreTapeProvenanceReport({
    healthHttpStatus: 200,
    healthBody: { data: { clickhouse: true, status: "ok" } },
    keyPresent: false,
    espnCaptureTimestamp: "2026-10-16T20:06:40.154Z",
  });
  assert.equal(report.cfbLiveRowsVerified, false);
  assert.equal(report.verdict, "SCHEMA_AND_HEALTH_OK — CFB_ROWS_PENDING_EXPLORER_KEY");
  assert.equal(report.espnLocalFixture.preKickJoinDemoOk, true);
});

test("Odds spreads+totals manifest omits h2h; fits 4200; no fetch", () => {
  const membership = JSON.parse(
    readFileSync(
      join(process.cwd(), "test/fixtures/ncaaf-final-eval-membership-games.json"),
      "utf8",
    ),
  ) as { games: Array<{ eventId: string; kickoffIso: string }> };
  const h2h = JSON.parse(
    readFileSync(
      join(process.cwd(), "test/fixtures/ncaaf-final-eval-close-h2h-archive.json"),
      "utf8",
    ),
  ) as { games: Array<{ gameId: string }> };

  const m = buildSpreadsTotalsAltManifest({
    membershipGames: membership.games,
    h2hArchiveGameIds: h2h.games.map((g) => g.gameId),
    tuningCloseBuckets: new Set(),
    oddsKeyConfigured: false,
  });
  assert.equal(m.fetchExecuted, false);
  assert.equal(m.paidRetrieval, false);
  assert.deepEqual(m.featuredSpreadsTotals.markets, ["spreads", "totals"]);
  assert.ok(!m.featuredSpreadsTotals.markets.includes("h2h"));
  assert.equal(m.featuredSpreadsTotals.nPrimaryBuckets, 167);
  assert.equal(m.featuredSpreadsTotals.creditsPerBucket, 20);
  assert.equal(m.featuredSpreadsTotals.creditMath.fitsInHardCap, true);
  assert.equal(
    m.featuredSpreadsTotals.creditMath.baseCredits +
      m.featuredSpreadsTotals.creditMath.retryBufferCredits,
    4175,
  );
  // Full ALT cohort exceeds 4200
  assert.equal(m.alternateSpreads.creditMath.fitsInHardCap, false);
  assert.match(m.alternateSpreads.creditMath.samplingNote, /exceeds 4200/);
  assert.equal(m.provider.supports.totals, true);
  assert.equal(m.provider.supports.alternate_spreads, true);
});
