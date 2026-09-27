import test from "node:test";
import assert from "node:assert/strict";
import {
  maxLegsPerGame,
  parlayCorrelationPenalty,
  selectCorrelationAwareBoardLegs,
  wouldExceedMaxLegsPerGame,
} from "./parlayCorrelationScore.ts";

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

test("maxLegsPerGame is 2 for deep fixed-leg asks", () => {
  assert.equal(maxLegsPerGame(10), 2);
  assert.equal(maxLegsPerGame(8), 2);
  assert.equal(maxLegsPerGame(5), 2);
  assert.equal(maxLegsPerGame(3), 3);
  assert.equal(maxLegsPerGame(1), 99);
  assert.equal(maxLegsPerGame(10, 5), 5);
});

test("props do not consume the per-game hard cap", () => {
  const g1 = "Los Angeles Chargers @ Buffalo Bills";
  const ticket = [
    leg(g1, "Total", "Over 50"),
    leg(g1, "Spread", "Chargers +3.5"),
  ];
  assert.equal(wouldExceedMaxLegsPerGame(leg(g1, "Q1 Spread", "Chargers +3"), ticket, 2), true);
  assert.equal(
    wouldExceedMaxLegsPerGame(
      leg(g1, "player_rush_yds", "Over 65.5", true, "Dobbins"),
      ticket,
      2,
    ),
    false,
  );
});

test("10-leg NFL period stack cannot take more than 2 legs per game", () => {
  // Phone regression: Q1/Q2/1H/2H/Q4/FG from Chargers@Bills + Panthers@Browns.
  const g1 = "Los Angeles Chargers @ Buffalo Bills";
  const g2 = "Carolina Panthers @ Cleveland Browns";
  const periods = ["Q1 Spread", "Q2 Spread", "1H Spread", "2H Spread", "Q4 Spread", "Spread", "Total"];
  const ranked = [
    ...periods.map((m, i) => ({
      pick: leg(g1, m, `Chargers +${i + 1}.5`),
      rankScore: 100 - i,
    })),
    ...periods.map((m, i) => ({
      pick: leg(g2, m, `Panthers +${i + 1}.5`),
      rankScore: 90 - i,
    })),
    // Lower-ranked but other games — must be used to fill seats.
    ...Array.from({ length: 8 }, (_, i) => ({
      pick: leg(`Team${i}A @ Team${i}B`, "Spread", `Team${i}A +3.5`),
      rankScore: 70 - i,
    })),
  ];
  const out = selectCorrelationAwareBoardLegs(ranked, 10, { ticketTarget: 10 });
  assert.equal(out.length, 10);
  const byGame = new Map<string, number>();
  for (const p of out) {
    byGame.set(p.game, (byGame.get(p.game) ?? 0) + 1);
  }
  for (const [game, n] of byGame) {
    assert.ok(n <= 2, `${game} has ${n} legs (max 2)`);
  }
  assert.ok(byGame.size >= 5, `expected ≥5 games, got ${byGame.size}`);
  const g1Legs = out.filter((p) => p.game === g1);
  assert.ok(g1Legs.length <= 2);
  assert.equal(
    wouldExceedMaxLegsPerGame(leg(g1, "Alt Spread", "Chargers +9.5"), g1Legs, 2),
    g1Legs.length >= 2,
  );
});
