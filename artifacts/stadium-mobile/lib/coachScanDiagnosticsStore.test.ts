import assert from "node:assert/strict";
import test from "node:test";

import type { ParsedPick } from "../components/PickCard.tsx";
import { emptyCoachBoardScanManifest } from "./coachBoardScanManifest.ts";
import {
  clearCoachScanDiagnostics,
  formatCoachScanDiagnosticsReport,
  getCoachScanDiagnostics,
  recordCoachScanDiagnostics,
} from "./coachScanDiagnosticsStore.ts";

function fakePick(over: Partial<ParsedPick> = {}): ParsedPick {
  return {
    game: "KC @ BUF",
    market: "Rushing Yards",
    pick: "Over 62.5",
    odds: -110,
    isProp: true,
    player: "Josh Allen",
    sport: "NFL",
    ...over,
  };
}

test("recordCoachScanDiagnostics stores delivered picks + manifest without throwing", () => {
  clearCoachScanDiagnostics();
  const manifest = emptyCoachBoardScanManifest(5);
  manifest.scanComplete = true;
  manifest.boardExhausted = true;
  manifest.deliveredLegs = 1;
  manifest.marketsFound = 12;
  manifest.rejectedSamples.push({
    game: "DAL @ PHI",
    market: "Passing Yards",
    pick: "Over 249.5",
    category: "props",
    family: "playerProps",
    gate: "negative_edge",
    reason: "Edge below threshold",
  });

  recordCoachScanDiagnostics({
    askText: "  5 leg NFL rushing and receiving yards only  ",
    requestedLegs: 5,
    picks: [fakePick()],
    note: "Built a 5-leg ticket.",
    timedOut: false,
    propPoolSize: 80,
    manifest,
  });

  const snap = getCoachScanDiagnostics();
  assert.ok(snap);
  assert.equal(snap!.askText, "5 leg NFL rushing and receiving yards only");
  assert.equal(snap!.requestedLegs, 5);
  assert.equal(snap!.deliveredLegs, 1);
  assert.equal(snap!.deliveredPicks[0]?.player, "Josh Allen");
  assert.equal(snap!.manifest?.marketsFound, 12);
  assert.equal(snap!.manifest?.rejectedSamples[0]?.gate, "negative_edge");
});

test("formatCoachScanDiagnosticsReport includes ticket + reject reasons", () => {
  clearCoachScanDiagnostics();
  const manifest = emptyCoachBoardScanManifest(6);
  manifest.scanComplete = true;
  manifest.boardExhausted = true;
  manifest.deliveredLegs = 1;
  manifest.marketsFound = 4;
  manifest.marketsSimulated = 4;
  manifest.totalEvaluated = 3;
  manifest.gateFailureCounts = { negative_edge: 2 };
  manifest.rejectedSamples = [
    {
      game: "ATL @ PIT",
      market: "Receiving Yards",
      pick: "Over 44.5",
      category: "props",
      family: "playerProps",
      gate: "negative_edge",
      reason: "Edge below threshold",
    },
  ];

  recordCoachScanDiagnostics({
    askText: "6 leg mix",
    requestedLegs: 6,
    picks: [fakePick({ pick: "Over 70.5", market: "Receiving Yards", player: "CeeDee Lamb" })],
    note: "Short note",
    propPoolSize: 40,
    manifest,
  });

  const report = formatCoachScanDiagnosticsReport(getCoachScanDiagnostics());
  assert.match(report, /Coach Scan Diagnostics/);
  assert.match(report, /CeeDee Lamb/);
  assert.match(report, /On ticket|Delivered on ticket/);
  assert.match(report, /Edge below threshold|edge/i);
  assert.match(report, /Scan manifest/);
  assert.match(report, /does not change Coach/i);
});

test("empty diagnostics report is safe before any Coach build", () => {
  clearCoachScanDiagnostics();
  const report = formatCoachScanDiagnosticsReport(null);
  assert.match(report, /No Coach board scan recorded yet/);
});

test("recordCoachScanDiagnostics never throws on bad input", () => {
  clearCoachScanDiagnostics();
  assert.doesNotThrow(() =>
    recordCoachScanDiagnostics({
      requestedLegs: 5,
      // @ts-expect-error intentional bad shape for resilience
      picks: null,
      manifest: null,
    }),
  );
});
