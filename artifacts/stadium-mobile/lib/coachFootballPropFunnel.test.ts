import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createCoachBoardScanManifestRecorder,
  formatCoachBoardScanManifest,
} from "./coachBoardScanManifest.ts";
import type { ParsedPick } from "../components/PickCard.tsx";

function nflPassPick(over = true): ParsedPick {
  return {
    game: "KC @ BUF",
    market: "Pass Yds",
    pick: over ? "Mahomes Over 274.5" : "Mahomes Under 274.5",
    odds: -110,
    isProp: true,
    player: "Mahomes",
    sport: "nfl",
    propLine: 274.5,
    propSide: over ? "Over" : "Under",
    propMarketKey: "player_pass_yds",
  } as ParsedPick;
}

function ncaafRushPick(): ParsedPick {
  return {
    game: "ALA @ UGA",
    market: "Rush Yds",
    pick: "Back Over 85.5",
    odds: -115,
    isProp: true,
    player: "Back",
    sport: "ncaaf",
    propLine: 85.5,
    propSide: "Over",
    propMarketKey: "player_rush_yds",
  } as ParsedPick;
}

test("football prop funnel records NFL/NCAAF stages and market breakdown", () => {
  const recorder = createCoachBoardScanManifestRecorder(8);
  const pass = nflPassPick();
  const rush = ncaafRushPick();
  recorder.recordPropPoolRow(pass);
  recorder.recordPropPoolRow(rush);
  recorder.recordPropSimBatch(2, false, [pass, rush]);

  const rejected = {
    ...pass,
    finalAiScore: {
      simHit: 0.48,
      edgePct: -1.2,
      grade: "C",
      confidencePct: 50,
      simAligned: true,
      composite: 40,
      recommends: false,
    },
  } as ParsedPick;
  recorder.recordEvaluatedPick(rejected, rejected.finalAiScore);

  const qualified = {
    ...rush,
    finalAiScore: {
      simHit: 0.58,
      edgePct: 4.5,
      grade: "B+",
      confidencePct: 62,
      simAligned: true,
      composite: 70,
      recommends: true,
    },
    ticketRole: "main" as const,
  } as ParsedPick;
  // Force qualify path via a pick that passes gates — if still rejected, funnel still logs graded.
  recorder.recordEvaluatedPick(qualified, qualified.finalAiScore);

  recorder.recordFootballPropDeliveryFunnel(
    [qualified].filter((p) => p.finalAiScore?.recommends),
    [],
  );

  const manifest = recorder.finalize({
    scanComplete: true,
    boardExhausted: true,
    deliveredLegs: 0,
  });

  assert.equal(manifest.footballPropFunnelBySport.nfl.raw_found, 1);
  assert.equal(manifest.footballPropFunnelBySport.nfl.normalized, 1);
  assert.ok(manifest.footballPropFunnelBySport.nfl.eligible >= 0);
  assert.equal(manifest.footballPropFunnelBySport.nfl.simulated, 1);
  assert.equal(manifest.footballPropFunnelBySport.ncaaf.raw_found, 1);
  assert.equal(manifest.footballPropFunnelBySport.ncaaf.simulated, 1);
  assert.ok((manifest.footballPropFoundByMarketBySport.nfl.player_pass_yds ?? 0) >= 1);
  assert.ok((manifest.footballPropFoundByMarketBySport.ncaaf.player_rush_yds ?? 0) >= 1);

  const text = formatCoachBoardScanManifest(manifest);
  assert.match(text, /NFL \/ NCAAF player-prop funnel/i);
  assert.match(text, /\*\*NFL\*\*/);
  assert.match(text, /\*\*NCAAF\*\*/);
  assert.match(text, /raw \/ found/i);
  assert.match(text, /Pass Yds/);
  assert.match(text, /Rush Yds/);
});

test("football rejected samples include score diagnostics", () => {
  const recorder = createCoachBoardScanManifestRecorder(6);
  const pick = nflPassPick();
  recorder.recordPropPoolRow(pick);
  recorder.recordPropSimBatch(1, false, [pick]);
  recorder.recordPreScoreGateFailure(pick, { simHit: null });
  const manifest = recorder.finalize({
    scanComplete: true,
    boardExhausted: true,
    deliveredLegs: 0,
  });
  assert.ok(manifest.footballPropRejectedSamples.length >= 1);
  const sample = manifest.footballPropRejectedSamples[0]!;
  assert.equal(sample.sport, "nfl");
  assert.equal(sample.player, "Mahomes");
  assert.ok(sample.reason);
  assert.ok(sample.stageStopped);
  assert.equal(typeof sample.odds, "number");
  assert.ok(sample.impliedProbPct == null || typeof sample.impliedProbPct === "number");
  const text = formatCoachBoardScanManifest(manifest);
  assert.match(text, /Sample rejected NFL\/NCAAF props/i);
  assert.match(text, /Mahomes/);
  assert.match(text, /stopped at/);
});

test("football funnel reject counts map integrity_mapping from not_sim_aligned", () => {
  const recorder = createCoachBoardScanManifestRecorder(4);
  const pick = nflPassPick();
  recorder.recordPropPoolRow(pick);
  recorder.recordPropSimBatch(1, false, [pick]);
  // simHit ≤ implied so propSimEdgeStagingQualifies is false; coreSimEdgeChecks
  // then returns not_sim_aligned before sim_below_implied when simAligned is false.
  const scored = {
    ...pick,
    finalAiScore: {
      simHit: 0.4,
      edgePct: 3,
      grade: "B",
      confidencePct: 60,
      simAligned: false,
      composite: 40,
      recommends: false,
    },
  } as ParsedPick;
  recorder.recomputeQualificationFromScored([
    {
      pick: scored,
      evPct: null,
      edgePct: 3,
      confidencePct: 60,
      impliedProbPct: null,
      lineShoppingScore: null,
      grade: "B",
      simHit: 0.4,
      composite: 40,
      rankScore: 0,
    },
  ]);
  const manifest = recorder.finalize({
    scanComplete: true,
    boardExhausted: true,
    deliveredLegs: 0,
  });
  assert.ok((manifest.footballPropRejectCountsBySport.nfl.integrity_mapping ?? 0) >= 1);
  assert.ok(
    manifest.footballPropRejectedSamples.some((s) => s.gate === "integrity_mapping"),
  );
});
