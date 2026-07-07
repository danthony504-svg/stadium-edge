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

test("direct OpenAI keeps Summer League futures section when asked", () => {
  const big =
    FAKE +
    "\nNBA SUMMER LEAGUE FUTURES ANALYSIS RULE — keep for summer league championship asks\n" +
    "z".repeat(60_000);
  const sl = coachSystemPromptForProvider(
    "openai",
    big,
    "who wins Vegas Summer League championship",
  );
  assert.match(sl, /NBA SUMMER LEAGUE FUTURES/);
});

test("direct OpenAI keeps Universal Sport Analysis section when asked", () => {
  const big =
    FAKE +
    "\nUNIVERSAL SPORT ANALYSIS FRAMEWORK — keep for full game analysis asks\n" +
    "z".repeat(60_000);
  const analysis = coachSystemPromptForProvider(
    "openai",
    big,
    "who wins Lakers vs Celtics — give me your full analysis",
  );
  assert.match(analysis, /UNIVERSAL SPORT ANALYSIS FRAMEWORK/);
});

test("direct OpenAI drops Universal Sport Analysis section when not asked", () => {
  const big =
    FAKE +
    "\nUNIVERSAL SPORT ANALYSIS FRAMEWORK — drop when not analysis ask\n" +
    "z".repeat(60_000);
  const plain = coachSystemPromptForProvider("openai", big, "build me a 5 leg parlay");
  assert.doesNotMatch(plain, /UNIVERSAL SPORT ANALYSIS FRAMEWORK/);
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
  assert.ok(JSON.stringify(trimmed).length <= 28_000);
});
