import assert from "node:assert/strict";
import test from "node:test";

import type { ParsedPick } from "../components/PickCard.ts";
import {
  applyCoachResultToAssistantMessage,
  bindCoachResultRequest,
  buildCoachSuccessLegNote,
  canPublishCoachNoPicksResult,
  coachNoPicksMessage,
  isCoachNoPicksLead,
  isCoachResultRequestStale,
  pickShowsPreliminaryGrade,
  preliminaryGradeCaption,
  preliminaryHolisticCoverageCaption,
  recordCoachPipelineComplete,
  resetCoachResultStateForTests,
  ticketContextPreliminary,
} from "./coachResultState.ts";

function propPick(id: string): ParsedPick {
  return {
    game: `Game ${id}`,
    market: "Points",
    pick: `Over ${id}`,
    odds: -110,
    isProp: true,
    player: `Player ${id}`,
    finalAiScore: {
      composite: 8,
      grade: "B+",
      edgePct: 14,
      simHit: 0.55,
      simAligned: true,
      recommends: false,
      propHolistic: {
        composite: 7.5,
        grade: "B+",
        confidencePct: 58,
        coveragePct: 50,
        missingCount: 4,
        applicableCount: 8,
        factors: [
          { key: "simulation", label: "10k Simulation", score: 8, applicable: true, present: true },
          { key: "sportsbookValue", label: "Expected Value", score: 7, applicable: true, present: true },
          { key: "matchup", label: "Matchup", score: null, applicable: true, present: false },
          { key: "recentForm", label: "Recent Form", score: null, applicable: true, present: false },
          { key: "injury", label: "Injuries", score: null, applicable: true, present: false },
        ],
        recommends: false,
      },
    },
  };
}

test("early zero candidates does not publish no-picks before pipeline completes", () => {
  resetCoachResultStateForTests();
  bindCoachResultRequest("req-a", 5);
  const applied = applyCoachResultToAssistantMessage({
    prev: { role: "assistant", content: "", parlayBuild: true },
    requestId: "req-a",
    picks: [],
    legTarget: 5,
    pipelineComplete: false,
  });
  assert.equal(applied, null);
  assert.equal(canPublishCoachNoPicksResult("req-a"), false);
});

test("early zero then 5 final picks shows only success and removes stale no-picks", () => {
  resetCoachResultStateForTests();
  bindCoachResultRequest("req-b", 5);
  const stale = coachNoPicksMessage();
  const picks = Array.from({ length: 5 }, (_, i) => propPick(`p${i}`));
  const applied = applyCoachResultToAssistantMessage({
    prev: {
      role: "assistant",
      content: stale,
      legNote: stale,
      coachDetailNote: stale,
      parlayBuild: true,
    },
    requestId: "req-b",
    picks,
    legTarget: 5,
    pipelineComplete: true,
  });
  assert.ok(applied);
  assert.equal(applied!.picks?.length, 5);
  assert.equal(isCoachNoPicksLead(applied!.content ?? ""), false);
  assert.equal(isCoachNoPicksLead(applied!.legNote ?? ""), false);
  assert.equal(isCoachNoPicksLead(applied!.coachDetailNote ?? ""), false);
  assert.match(applied!.legNote ?? "", /\*\*5\*\* picks found/i);
  assert.equal(applied!.coachResultOutcome, "success");
});

test("final zero picks shows one no-picks message after pipeline complete", () => {
  resetCoachResultStateForTests();
  bindCoachResultRequest("req-c", 5);
  recordCoachPipelineComplete("req-c", 0, 5);
  assert.equal(canPublishCoachNoPicksResult("req-c"), true);
  const applied = applyCoachResultToAssistantMessage({
    prev: { role: "assistant", content: "", parlayBuild: true },
    requestId: "req-c",
    picks: [],
    legTarget: 5,
    pipelineComplete: true,
  });
  assert.ok(applied);
  assert.equal(applied!.picks?.length ?? 0, 0);
  assert.match(applied!.content ?? "", /no legs cleared delivery gates/i);
  assert.equal(applied!.coachResultOutcome, "no-qualifying-picks");
});

test("partial-data cards are labeled preliminary", () => {
  const picks = [propPick("a"), propPick("b")];
  const ctx = ticketContextPreliminary(picks);
  assert.equal(ctx.preliminary, true);
  const note = buildCoachSuccessLegNote(2, 5, true);
  assert.match(note, /preliminary/i);
  assert.match(preliminaryGradeCaption("B+"), /Preliminary B\+/i);
  assert.match(
    preliminaryHolisticCoverageCaption({ coveragePct: 50, missingCount: 4 }, ["Matchup", "Recent Form"]),
    /Preliminary/i,
  );
  assert.equal(pickShowsPreliminaryGrade(picks[0]!, picks[0]!.finalAiScore!), true);
});

test("one requestId cannot overwrite another request result", () => {
  resetCoachResultStateForTests();
  bindCoachResultRequest("req-new", 5);
  assert.equal(isCoachResultRequestStale("req-old", "req-new"), true);
  const applied = applyCoachResultToAssistantMessage({
    prev: { role: "assistant", content: "", coachRequestId: "req-old" },
    requestId: "req-old",
    picks: [propPick("x")],
    legTarget: 5,
    pipelineComplete: true,
  });
  assert.ok(applied);
  assert.equal(applied!.coachRequestId, "req-old");
});
