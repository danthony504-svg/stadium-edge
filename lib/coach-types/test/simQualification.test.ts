import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  coachSimDisqualifier,
  coachSimEvidenceQualifies,
  evaluateSimulationGate,
  type CoachSimEvidence,
} from "../src/index";

const deepEvidence = (overrides: Partial<CoachSimEvidence> = {}): CoachSimEvidence => ({
  legFingerprint: "mlb:game:prop",
  tier: "deep",
  iterations: 10_000,
  hitProbability: 0.61,
  engineId: "player-prop",
  provenance: "api_prop_simulate",
  computedAt: "2026-08-12T00:00:00.000Z",
  sampleGames: 5,
  ...overrides,
});

describe("Coach simulation evidence", () => {
  it("qualifies a completed 10k real simulation", () => {
    assert.equal(coachSimEvidenceQualifies(deepEvidence()), true);
    assert.equal(evaluateSimulationGate(deepEvidence()).pass, true);
  });

  it("rejects an under-10k result even with a favorable hit probability", () => {
    const evidence = deepEvidence({ iterations: 9_999 });
    assert.equal(coachSimDisqualifier(evidence), "iterations_insufficient");
    assert.equal(evaluateSimulationGate(evidence).reasonCode, "sim_iterations_insufficient");
  });

  it("rejects a player prop without enough real input games", () => {
    assert.equal(coachSimDisqualifier(deepEvidence({ sampleGames: 2 })), "insufficient_sample");
  });

  it("rejects a missing or invalid simulation rather than promoting a proxy", () => {
    assert.equal(coachSimDisqualifier(null), "missing_simulation");
    assert.equal(coachSimDisqualifier(deepEvidence({ hitProbability: 1 })), "missing_hit_probability");
  });
});
