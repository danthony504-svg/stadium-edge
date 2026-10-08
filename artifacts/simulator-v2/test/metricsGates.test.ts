import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SIM_V2_ACCEPTANCE_THRESHOLDS,
  brierScore,
  evaluateAcceptanceGate,
  expectedCalibrationError,
  logLoss,
  marketCoverage,
  summarizeLatency,
} from "../src/index.js";

describe("metrics + acceptance gates", () => {
  it("computes Brier, log loss, ECE", () => {
    const rows = [
      { p: 0.7, y: 1 as const },
      { p: 0.3, y: 0 as const },
      { p: 0.6, y: 1 as const },
      { p: 0.4, y: 0 as const },
    ];
    assert.ok(brierScore(rows)! < 0.2);
    assert.ok(logLoss(rows)! > 0);
    assert.ok(expectedCalibrationError(rows)! >= 0);
  });

  it("reports market coverage", () => {
    const cov = marketCoverage({
      listed: 100,
      settledOk: 40,
      unsupported: 50,
      missingData: 5,
      integrityReject: 5,
    });
    assert.equal(cov.coveragePct, 40);
    assert.equal(cov.rejectPct, 60);
  });

  it("summarizes latency", () => {
    const stats = summarizeLatency([10, 20, 30, 40, 50, 100]);
    assert.equal(stats.count, 6);
    assert.ok(stats.p95Ms != null);
  });

  it("rejects Phase A fixture models at acceptance gate", () => {
    const obs = Array.from({ length: SIM_V2_ACCEPTANCE_THRESHOLDS.minOosSample }, () => ({
      p: 0.5,
      y: 1 as const,
    }));
    const decision = evaluateAcceptanceGate({
      sport: "nfl",
      family: "total",
      modelId: "fixture.phase_a",
      modelVersion: "0.1.0",
      oosObservations: obs,
      integrityRejectRate: 0,
      correctRejectLabelRate: 1,
      deepLatency: { count: 10, p50Ms: 100, p95Ms: 200, maxMs: 300, meanMs: 120 },
      shadowSoakComplete: true,
      contractTestsGreen: true,
    });
    assert.equal(decision.accepted, false);
    assert.ok(decision.reasons.includes("fixture_or_forbidden_model_id"));
  });

  it("rejects undersized OOS samples", () => {
    const decision = evaluateAcceptanceGate({
      sport: "nba",
      family: "spread",
      modelId: "nba.possession.v2",
      modelVersion: "2.0.0",
      oosObservations: [{ p: 0.55, y: 1 }],
      integrityRejectRate: 0,
      correctRejectLabelRate: 1,
      deepLatency: { count: 1, p50Ms: 10, p95Ms: 10, maxMs: 10, meanMs: 10 },
      shadowSoakComplete: true,
      contractTestsGreen: true,
    });
    assert.equal(decision.accepted, false);
    assert.ok(decision.reasons.some((r) => r.startsWith("oos_sample_")));
  });
});
