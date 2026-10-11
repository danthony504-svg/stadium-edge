import test from "node:test";
import assert from "node:assert/strict";
import {
  parlayCorrelationPenalty,
  selectCorrelationAwareBoardLegs,
  maxPropsPerGame,
  maxLegsPerGame,
  wouldRepeatPlayerProp,
  wouldExceedMaxPropsPerGame,
} from "./parlayCorrelationScore.ts";
import { wouldRepeatMarketLadder } from "./marketLadderKey.ts";

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

test("multi-event caps remain 2 props / 2 GL per game for deep asks", () => {
  assert.equal(maxPropsPerGame(8), 2);
  assert.equal(maxPropsPerGame(10), 2);
  assert.equal(maxLegsPerGame(8), 2);
  assert.equal(maxLegsPerGame(5), 2);
  assert.equal(maxPropsPerGame(4), 3);
});

test("wouldRepeatPlayerProp and wouldRepeatMarketLadder stay hard gates", () => {
  const a = leg("A @ B", "Pass Yds", "Carr Over 249.5", true, "Derek Carr");
  const b = leg("A @ B", "Rush Yds", "Carr Over 20.5", true, "Derek Carr");
  assert.equal(wouldRepeatPlayerProp(b, [a]), true);
  const alt = {
    ...a,
    market: "Pass Yds Alt",
    pick: "Carr Over 274.5",
    propSide: "Over",
    propLine: 274.5,
  };
  assert.equal(wouldRepeatMarketLadder(alt, [a]), true);
});

test("selectCorrelationAwareBoardLegs honors maxPropsPerGame on multi-event", () => {
  const g = "A @ B";
  const ranked = [
    { pick: leg(g, "Pass Yds", "P1 Over 1", true, "P1"), rankScore: 100 },
    { pick: leg(g, "Rush Yds", "P2 Over 1", true, "P2"), rankScore: 99 },
    { pick: leg(g, "Rec Yds", "P3 Over 1", true, "P3"), rankScore: 98 },
    { pick: leg(g, "Receptions", "P4 Over 1", true, "P4"), rankScore: 97 },
  ];
  const out = selectCorrelationAwareBoardLegs(ranked, 4, { ticketTarget: 8 });
  assert.ok(out.length <= maxPropsPerGame(8));
  assert.equal(
    wouldExceedMaxPropsPerGame(ranked[2]!.pick, out.slice(0, 2), maxPropsPerGame(8)),
    true,
  );
});
