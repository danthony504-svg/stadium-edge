import assert from "node:assert/strict";
import test from "node:test";
import { createCoachBoardScanManifestRecorder } from "./coachBoardScanManifest.ts";

test("zero-pick audit logs candidate metrics and gate breakdown", () => {
  const recorder = createCoachBoardScanManifestRecorder(6);
  const info = console.info;
  const warn = console.warn;
  const infoCalls: unknown[][] = [];
  const warnCalls: unknown[][] = [];
  console.info = (...args: unknown[]) => infoCalls.push(args);
  console.warn = (...args: unknown[]) => warnCalls.push(args);

  try {
    recorder.recordPreScoreGateFailure(
      {
        game: "A @ B",
        market: "Points",
        pick: "Star Over 24.5 Points",
        odds: -110,
        isProp: true,
        player: "Star",
        sport: "nba",
        propLine: 24.5,
        propSide: "Over",
      },
      { simHit: null },
    );
    const manifest = recorder.finalize({
      scanComplete: true,
      boardExhausted: true,
      deliveredLegs: 0,
    });

    assert.equal(infoCalls[0]?.[0], "[Coach candidate audit]");
    const candidate = infoCalls[0]?.[1] as Record<string, unknown>;
    assert.equal(candidate.market, "Points");
    assert.equal(candidate.simulatedProbabilityPct, null);
    assert.equal(candidate.gate, "no_sim_grade");
    assert.equal(candidate.rejectionReason, "No simulation result (10k MC not complete)");
    assert.equal(warnCalls[0]?.[0], "[Coach zero-pick audit]");
    const summary = warnCalls[0]?.[1] as Record<string, unknown>;
    assert.equal(summary.requestedLegs, 6);
    assert.deepEqual(summary.gateFailureCounts, manifest.gateFailureCounts);
  } finally {
    console.info = info;
    console.warn = warn;
  }
});
