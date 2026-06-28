import { test } from "node:test";
import assert from "node:assert/strict";
import { coachSystemPromptForProvider, trimLockedContextForDirectOpenAI } from "../src/lib/coachSystemPrompt.ts";

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

test("trimLockedContextForDirectOpenAI enforces byte budget", () => {
  const hist: Record<string, unknown> = {};
  for (let i = 0; i < 40; i++) {
    hist[`Player ${i}#${i}`] = {
      player: `Player ${i}`,
      recent: Array.from({ length: 20 }, (_, j) => ({ pts: j })),
    };
  }
  const ctx = {
    realProps: Array.from({ length: 200 }, (_, i) => ({ game: `A${i} @ B${i}`, player: `P${i}` })),
    realOdds: Array.from({ length: 100 }, (_, i) => ({ game: `A${i} @ B${i}` })),
    playerHistory: hist,
    matchupHistory: Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [`A${i} @ B${i}`, { h2h: { meetings: Array(10).fill({}) } }]),
    ),
  };
  const trimmed = trimLockedContextForDirectOpenAI(ctx)!;
  assert.ok(JSON.stringify(trimmed).length < JSON.stringify(ctx).length);
  assert.ok(JSON.stringify(trimmed).length <= 40_000);
});
