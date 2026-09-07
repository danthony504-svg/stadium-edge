import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyLearningSettlement, learningIdentity, parseCoachPicks } from "../src/lib/coachLearningCore.ts";

test("captures only valid delivered Coach PICK lines", () => {
  const picks = parseCoachPicks("PICK: Away @ Home | Spread | Away +3.5 | -110\nEDGE: real input");
  assert.deepEqual(picks, [{ game: "Away @ Home", market: "Spread", selection: "Away +3.5", odds: "-110" }]);
});

test("stable learning identity deduplicates formatting retries", () => {
  const pick = { game: "Away @ Home", market: "Spread", selection: "Away +3.5", odds: "-110" };
  assert.equal(learningIdentity(pick, "nfl", "evt-1"), learningIdentity({ ...pick, game: "other" }, "NFL", "evt-1"));
});

test("unresolved event identity remains explicit and does not become a guessed id", () => {
  const pick = { game: "Away @ Home", market: "Moneyline", selection: "Away", odds: "+120" };
  assert.match(learningIdentity(pick, null, null), /^unresolved\|unresolved\|/);
});

test("verified provider cancellation settles void", () => {
  assert.deepEqual(
    classifyLearningSettlement("Postponed", { result: "ungraded", detail: "game not final" }),
    { status: "void", reason: "provider status: Postponed" },
  );
});

test("unsupported or unavailable result is ungraded, never void", () => {
  assert.deepEqual(
    classifyLearningSettlement("Final", { result: "ungraded", detail: "combo market" }),
    { status: "ungraded", reason: "combo market" },
  );
  assert.deepEqual(
    classifyLearningSettlement(null, null),
    { status: "ungraded", reason: "provider result unresolved" },
  );
});

test("verified grader decisions retain their result and reason", () => {
  assert.deepEqual(
    classifyLearningSettlement("Final", { result: "push", detail: "100 = 100" }),
    { status: "push", reason: "100 = 100" },
  );
});
