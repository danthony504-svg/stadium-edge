import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyScanAuditMarketBucket,
  createCoachBoardScanAuditRecorder,
  formatCoachBoardScanAudit,
} from "./coachBoardScanAudit.ts";
import { createCoachBoardScanManifestRecorder } from "./coachBoardScanManifest.ts";

test("classifyScanAuditMarketBucket maps common markets", () => {
  assert.equal(
    classifyScanAuditMarketBucket({
      game: "A @ B",
      market: "Moneyline",
      pick: "A ML",
      odds: -110,
      isProp: false,
      sport: "nba",
    }),
    "moneyline",
  );
  assert.equal(
    classifyScanAuditMarketBucket({
      game: "A @ B",
      market: "Points",
      pick: "Star Over 24.5 Points",
      odds: -110,
      isProp: true,
      player: "Star",
      sport: "nba",
      propLine: 24.5,
      propSide: "Over",
    }),
    "nbaPoints",
  );
  assert.equal(
    classifyScanAuditMarketBucket({
      game: "A @ B",
      market: "Hits",
      pick: "Player Over 1.5 Hits",
      odds: -120,
      isProp: true,
      player: "Player",
      sport: "mlb",
      propLine: 1.5,
      propSide: "Over",
    }),
    "playerHits",
  );
});

test("audit funnel tracks pull, discard, score, and gate rejections", () => {
  const audit = createCoachBoardScanAuditRecorder("audit-1");
  const prop = {
    game: "A @ B",
    market: "Points",
    pick: "Star Over 24.5 Points",
    odds: -110,
    isProp: true,
    player: "Star",
    sport: "nba",
    propLine: 24.5,
    propSide: "Over",
  } as const;
  audit.recordPulledFromApi(prop);
  audit.recordDiscardedBeforeScoring(prop, "prop_sim_cap");
  audit.recordScored({
    pick: { ...prop, finalAiScore: { edgePct: -2, confidencePct: 40, simHit: 0.5, grade: "C", simAligned: true, composite: 1, recommends: false } },
    evPct: -2,
    edgePct: -2,
    confidencePct: 40,
    impliedProbPct: 52,
    lineShoppingScore: null,
    grade: "C",
    simHit: 0.5,
    composite: 1,
    rankScore: 1,
  });
  audit.recordGateRejection(prop, "negative_edge");
  const snap = audit.snapshot();
  assert.equal(snap.totals.pulledFromApi, 1);
  assert.equal(snap.totals.discardedBeforeScoring, 1);
  assert.equal(snap.totals.scored, 1);
  assert.equal(snap.totals.rejectedByEv, 1);
  assert.match(formatCoachBoardScanAudit(snap), /Markets pulled from API/);
  assert.match(formatCoachBoardScanAudit(snap), /NBA Points/);
});

test("manifest recorder embeds scan audit on finalize", () => {
  const recorder = createCoachBoardScanManifestRecorder(5, "req-audit");
  recorder.recordPropPoolRow({
    game: "A @ B",
    market: "Strikeouts",
    pick: "Pitcher Over 5.5 Strikeouts",
    odds: -115,
    isProp: true,
    player: "Pitcher",
    sport: "mlb",
    propLine: 5.5,
    propSide: "Over",
  });
  recorder.audit.recordBulkDiscardedBeforeScoring(
    [
      {
        game: "A @ B",
        market: "Walks",
        pick: "Pitcher Over 1.5 Walks",
        odds: +100,
        isProp: true,
        player: "Pitcher",
        sport: "mlb",
        propLine: 1.5,
        propSide: "Over",
      },
    ],
    "prop_sim_cap",
  );
  const manifest = recorder.finalize({
    scanComplete: true,
    boardExhausted: true,
    deliveredLegs: 0,
  });
  assert.ok(manifest.scanAudit);
  assert.equal(manifest.scanAudit!.totals.pulledFromApi, 1);
  assert.equal(manifest.scanAudit!.totals.discardedBeforeScoring, 1);
  assert.match(formatCoachBoardScanAudit(manifest.scanAudit!), /Strikeouts|prop_sim_cap/);
});
