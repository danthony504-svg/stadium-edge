import test from "node:test";
import assert from "node:assert/strict";
import { parlayCorrelationPenalty, selectCorrelationAwareBoardLegs } from "./parlayCorrelationScore.ts";

const leg = (game: string, market: string, pick: string, isProp = false, player = "") => ({
  game,
  market,
  pick,
  odds: -110,
  isProp,
  player: isProp ? player : undefined,
});

test("parlayCorrelationPenalty penalizes same-game stacks", () => {
  const a = leg("A @ B", "Spread", "A +3");
  const b = leg("A @ B", "Total", "Over 220");
  assert.ok(parlayCorrelationPenalty(b, [a]) > parlayCorrelationPenalty(leg("C @ D", "Spread", "C +1"), [a]));
});

test("parlayCorrelationPenalty penalizes duplicate stolen bases more than duplicate strikeouts", () => {
  const sb1 = leg("A @ B", "Stolen Bases", "Player A Over 0.5 Stolen Bases", true, "Player A");
  const sb2 = leg("C @ D", "Stolen Bases", "Player C Over 0.5 Stolen Bases", true, "Player C");
  const k2 = leg("E @ F", "Strikeouts", "Player E Over 5.5 Strikeouts", true, "Player E");
  assert.ok(parlayCorrelationPenalty(sb2, [sb1]) > parlayCorrelationPenalty(k2, [sb1]));
});

test("selectCorrelationAwareBoardLegs spreads across games when possible", () => {
  const ranked = [
    { pick: leg("A @ B", "Spread", "A +3"), rankScore: 100 },
    { pick: leg("A @ B", "Total", "Over 220"), rankScore: 99 },
    { pick: leg("C @ D", "Spread", "C +1"), rankScore: 90 },
  ];
  const out = selectCorrelationAwareBoardLegs(ranked, 2);
  assert.equal(out.length, 2);
  const games = new Set(out.map((p) => p.game));
  assert.equal(games.size, 2);
});
