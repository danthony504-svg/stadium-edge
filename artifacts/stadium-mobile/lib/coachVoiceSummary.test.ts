import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEnergeticAnalystSummary,
  stripCoachReplyForSpeech,
} from "./coachVoiceSummary.ts";

test("stripCoachReplyForSpeech drops PICK/ALT lines and markdown", () => {
  const raw = [
    "Here's the board.",
    "PICK: Lakers ML -140",
    "ALT: Lakers -3.5",
    "---",
    "**Strong** edge on the total.",
    "* pace favors overs",
  ].join("\n");
  const stripped = stripCoachReplyForSpeech(raw);
  assert.equal(stripped.includes("PICK:"), false);
  assert.equal(stripped.includes("ALT:"), false);
  assert.match(stripped, /Strong edge/);
  assert.match(stripped, /Here's the board/);
});

test("buildEnergeticAnalystSummary adds opener and caps length", () => {
  const long = "word ".repeat(200);
  const spoken = buildEnergeticAnalystSummary(long, { pickCount: 5 });
  assert.match(spoken, /5-leg read coming in hot/i);
  assert.ok(spoken.length <= 480);
});

test("buildEnergeticAnalystSummary handles empty body with pick count", () => {
  const spoken = buildEnergeticAnalystSummary("PICK: only", { pickCount: 3 });
  assert.match(spoken, /3 solid legs/i);
});
