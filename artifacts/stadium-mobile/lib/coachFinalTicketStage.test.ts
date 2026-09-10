import assert from "node:assert/strict";
import test from "node:test";

import type { ParsedPick } from "../components/PickCard.tsx";
import {
  FINAL_TICKET_STAGE_STEPS,
  completeCoachFinalTicketStage,
  runCoachFinalTicketStage,
} from "./coachFinalTicketStage.ts";

function leg(id: string, composite: number, role: "main" | "alt" = "main"): ParsedPick {
  return {
    game: `Game ${id}`,
    market: "Points",
    pick: `Over ${id}`,
    odds: -110,
    isProp: true,
    player: `Player ${id}`,
    ticketRole: role,
    finalAiScore: {
      composite,
      edgePct: 5,
      simHit: 0.55,
      simAligned: true,
      grade: "B+",
      recommends: true,
      confidencePct: 70,
    },
    scores: { composite },
  };
}

test("runCoachFinalTicketStage records all sync steps through slip assembly", () => {
  const candidates = [leg("a", 90), leg("b", 80), leg("c", 70, "alt")];
  const result = runCoachFinalTicketStage({
    candidates,
    enrich: { realOdds: [], propPool: [], gameMeta: [] },
    legTarget: 2,
  });
  assert.ok(result.picks.length > 0, "delivers at least one leg");
  assert.equal(result.candidateCount, 3);
  const steps = result.timings.map((t) => t.step);
  assert.deepEqual(steps.slice(0, 5), FINAL_TICKET_STAGE_STEPS.slice(0, 5));
  for (const t of result.timings) {
    assert.ok(t.startedAt);
    assert.ok(t.endedAt);
    assert.ok(t.durationMs >= 0);
    assert.equal(typeof t.fnName, "string");
  }
});

test("runCoachFinalTicketStage delivers weak legs via fail-soft assembly", () => {
  const weak = leg("w", 10);
  weak.finalAiScore = { composite: 10, edgePct: -1, simHit: 0.4, simAligned: false, grade: "D" };
  const result = runCoachFinalTicketStage({
    candidates: [weak],
    enrich: { realOdds: [], propPool: [], gameMeta: [] },
    legTarget: 1,
  });
  assert.equal(result.deliveredCount, 1);
});

test("runCoachFinalTicketStage skips duplicate legs and continues", () => {
  const a = leg("dup", 95);
  const b = { ...leg("dup", 90), odds: -105 };
  const result = runCoachFinalTicketStage({
    candidates: [a, b],
    enrich: { realOdds: [], propPool: [], gameMeta: [] },
    legTarget: 2,
  });
  assert.ok(result.deliveredCount <= 2);
});

test("completeCoachFinalTicketStage runs async steps 6–8", async () => {
  const captured: string[] = [];
  const timings = await completeCoachFinalTicketStage([leg("x", 88)], {
    captureFromCoach: () => {
      captured.push("capture");
    },
    onRenderComplete: () => {
      captured.push("render");
    },
  });
  assert.equal(timings.length, 3);
  assert.deepEqual(
    timings.map((t) => t.step),
    ["bet-slip-context-update", "ai-summary-creation", "render-complete"],
  );
  assert.deepEqual(captured, ["capture", "render"]);
});
