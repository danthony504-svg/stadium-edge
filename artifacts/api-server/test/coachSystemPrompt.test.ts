import { test } from "node:test";
import assert from "node:assert/strict";
import { coachSystemPromptForProvider } from "../src/lib/coachSystemPrompt.ts";

const FAKE = [
  "You are Stadium Edge.\n",
  "MATCHUP-EDGE → ALT-LINE RULE: " + "a".repeat(20_000),
  "\nPLAYER-PROP ANALYTICS RULE: " + "b".repeat(20_000),
  "\nHOME-RUN EVALUATION RULE: keep for hr asks",
  "\nREQUEST TYPES — always keep",
].join("");

test("direct OpenAI trims heavy analytics sections to fit TPM", () => {
  const hr = coachSystemPromptForProvider("openai", FAKE, "top 3 home run plays");
  assert.ok(hr.length < FAKE.length);
  assert.match(hr, /HOME-RUN EVALUATION/);
  assert.doesNotMatch(hr, /MATCHUP-EDGE/);
  assert.doesNotMatch(hr, /PLAYER-PROP ANALYTICS/);
});

test("Replit keeps the full prompt", () => {
  assert.equal(coachSystemPromptForProvider("replit", FAKE, "hi"), FAKE);
});

test("direct OpenAI drops HR section when not asked", () => {
  const plain = coachSystemPromptForProvider("openai", FAKE, "hi");
  assert.doesNotMatch(plain, /HOME-RUN EVALUATION/);
});
