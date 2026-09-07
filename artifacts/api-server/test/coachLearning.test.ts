import assert from "node:assert/strict";
import { test } from "node:test";

import { learningIdentity, parseCoachPicks } from "../src/lib/coachLearningCore.ts";

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
