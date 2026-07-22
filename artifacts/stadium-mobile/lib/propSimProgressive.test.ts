import test from "node:test";
import assert from "node:assert/strict";

import {
  assistantMessagePatchSignature,
  patchAssistantMessageIfChanged,
  patchLastAssistantPicks,
  type AssistantMessagePick,
} from "./assistantMessagePatch.ts";
import type { FinalAiScore } from "./finalAiScore.ts";

type Msg = {
  role: string;
  picks?: AssistantMessagePick[];
  content?: string;
  legNote?: string;
  coachDetailNote?: string;
  ticketLegTarget?: number;
};

function samplePick(overrides: Partial<AssistantMessagePick> = {}): AssistantMessagePick {
  return {
    game: "A @ B",
    market: "Spread",
    pick: "A -1.5",
    odds: -110,
    ...overrides,
  };
}

function sampleFinalAiScore(
  overrides: Pick<FinalAiScore, "grade" | "simHit">,
): FinalAiScore {
  return {
    composite: null,
    confidencePct: null,
    edgePct: null,
    simAligned: false,
    highRiskValuePlay: false,
    recommends: false,
    factors: [],
    rubric: {
      scores: {
        matchup: null,
        trend: null,
        lineValue: null,
        injury: null,
        lineShopping: null,
        simulation: null,
      },
      composite: null,
      grade: null,
      confidencePct: null,
      edgePct: null,
    },
    ...overrides,
  };
}

function runSetMessages<T>(
  initial: T[],
  fn: (setMessages: (updater: (prev: T[]) => T[]) => void) => boolean,
): { next: T[]; changed: boolean } {
  let next = initial;
  const setMessages = (updater: (prev: T[]) => T[]) => {
    next = updater(next);
  };
  const changed = fn(setMessages);
  return { next, changed };
}

test("assistantMessagePatchSignature ignores identical pick payloads", () => {
  const picks = [samplePick({ finalAiScore: sampleFinalAiScore({ grade: "B+", simHit: 0.54 }) })];
  const a = assistantMessagePatchSignature({ picks, legNote: "note" });
  const b = assistantMessagePatchSignature({ picks: [...picks], legNote: "note" });
  assert.equal(a, b);
});

test("assistantMessagePatchSignature changes when sim grade updates", () => {
  const before = [samplePick({ finalAiScore: sampleFinalAiScore({ grade: "B", simHit: 0.5 }) })];
  const after = [samplePick({ finalAiScore: sampleFinalAiScore({ grade: "A-", simHit: 0.62 }) })];
  assert.notEqual(
    assistantMessagePatchSignature({ picks: before }),
    assistantMessagePatchSignature({ picks: after }),
  );
});

test("patchAssistantMessageIfChanged returns prev when nothing changed", () => {
  const picks = [samplePick()];
  const initial: Msg[] = [
    { role: "user", content: "build" },
    { role: "assistant", picks, content: "" },
  ];
  const { next, changed } = runSetMessages(initial, (setMessages) =>
    patchAssistantMessageIfChanged(setMessages, { picks, content: "" }),
  );
  assert.equal(changed, false);
  assert.equal(next, initial);
});

test("patchLastAssistantPicks skips clone when picks are unchanged", () => {
  const picks = [samplePick()];
  const initial: Msg[] = [
    { role: "user", content: "build" },
    { role: "assistant", picks, content: "", legNote: "same" },
  ];
  const first = runSetMessages(initial, (setMessages) =>
    patchLastAssistantPicks(setMessages, picks, "same"),
  );
  assert.equal(first.changed, false);
  assert.equal(first.next, initial);

  const upgraded = [samplePick({ finalAiScore: sampleFinalAiScore({ grade: "A", simHit: 0.7 }) })];
  const second = runSetMessages(first.next, (setMessages) =>
    patchLastAssistantPicks(setMessages, upgraded, "same"),
  );
  assert.equal(second.changed, true);
  assert.notEqual(second.next, initial);
  assert.equal(second.next[1]?.picks, upgraded);
});
