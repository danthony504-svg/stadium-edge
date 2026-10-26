import test from "node:test";
import assert from "node:assert/strict";
import { ncaabCoachEnablementDecision } from "../src/lib/ncaabCoachReadiness.js";

test("NCAAB enablement is BLOCKED and does not inherit NCAAF validation", () => {
  const d = ncaabCoachEnablementDecision({
    oddsEvents: 7,
    playerPropsEventsWithRows: 0,
    now: new Date("2026-10-26T17:00:00Z"),
  });
  assert.equal(d.decision, "BLOCKED");
  assert.equal(d.researchPipelineExists, false);
  assert.equal(d.validatedApprovedModelExists, false);
  assert.equal(d.coachReleaseEligible, false);
  assert.equal(d.mobileP0GameLineGate, "none_armed_today");
  assert.ok(d.unmet.includes("no_ncaab_research_pipeline_or_holdout_ledger"));
  assert.ok(
    d.earliestEvidenceBasedPath.some((s) => s.includes("NCAAB-specific")),
  );
  assert.equal(d.liveMarketsObserved?.playerPropsEventsWithRows, 0);
});
