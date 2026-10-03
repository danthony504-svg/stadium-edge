import test from "node:test";
import assert from "node:assert/strict";
import {
  maxLegsPerGame,
  maxPropsPerGame,
  legsPerGameCapForAsk,
  parlayCorrelationPenalty,
  progressiveLegsPerGameRelaxation,
  selectCorrelationAwareBoardLegs,
  wouldExceedMaxLegsPerGame,
  wouldExceedMaxPropsPerGame,
  wouldRepeatPlayerProp,
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

test("progressiveLegsPerGameRelaxation climbs to ceil(target/2)", () => {
  assert.deepEqual(progressiveLegsPerGameRelaxation(10), [3, 4, 5]);
  assert.deepEqual(progressiveLegsPerGameRelaxation(8), [3, 4]);
  assert.deepEqual(progressiveLegsPerGameRelaxation(10, 5), []);
  assert.deepEqual(progressiveLegsPerGameRelaxation(3), []);
});

test("college team-market stacks raise progressive seat ceiling", () => {
  // Cap already at 4 for a 7-leg college ask — still climbs toward 5.
  assert.deepEqual(
    progressiveLegsPerGameRelaxation(7, 4, { collegeTeamMarketStacks: true }),
    [5],
  );
  assert.deepEqual(progressiveLegsPerGameRelaxation(7, 4), []);
});

test("legsPerGameCapForAsk keeps college team stacks at ≥4 seats", () => {
  assert.equal(
    legsPerGameCapForAsk(7, { gameLinesOnly: true, collegeTeamMarketStacks: true }),
    4,
  );
  // Bare college mix is NOT gameLinesOnly — stacks still raise the floor.
  assert.equal(
    legsPerGameCapForAsk(7, { gameLinesOnly: false, collegeTeamMarketStacks: true }),
    4,
  );
  assert.equal(legsPerGameCapForAsk(7, { gameLinesOnly: true }), 4);
  assert.equal(legsPerGameCapForAsk(5, { gameLinesOnly: true }), 3);
  assert.equal(
    legsPerGameCapForAsk(5, { gameLinesOnly: true, collegeTeamMarketStacks: true }),
    4,
  );
  assert.equal(legsPerGameCapForAsk(7, { gameLinesOnly: false }), null);
});

test("near-identical same-team team-total alts get heavy correlation penalty", () => {
  const g = "Boston College Eagles @ SMU Mustangs";
  const main = leg(g, "Team Total", "SMU Mustangs Over 24.5");
  const nearAlt = leg(g, "Alt Team Total", "SMU Mustangs Over 27.5");
  const farAlt = leg(g, "Alt Team Total", "SMU Mustangs Over 45.5");
  const otherTeam = leg(g, "Team Total", "Boston College Eagles Over 17.5");
  assert.ok(parlayCorrelationPenalty(nearAlt, [main]) >= 28);
  assert.ok(parlayCorrelationPenalty(farAlt, [main]) < 28);
  assert.ok(parlayCorrelationPenalty(otherTeam, [main]) < 28);
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

test("hard block: one player prop per athlete (Meidroth stack)", () => {
  const g = "Chicago White Sox @ Cleveland Guardians";
  const hits = leg(g, "Hits", "Chase Meidroth Over 0.5 Hits", true, "Chase Meidroth");
  const tb = leg(g, "Total Bases", "Chase Meidroth Over 0.5 Total Bases", true, "Chase Meidroth");
  const hrr = leg(
    g,
    "Hits+Runs+RBIs",
    "Chase Meidroth Over 0.5 Hits+Runs+RBIs",
    true,
    "Chase Meidroth",
  );
  assert.equal(wouldRepeatPlayerProp(tb, [hits]), true);
  assert.equal(wouldRepeatPlayerProp(hrr, [hits, tb]), true);
  assert.equal(
    wouldRepeatPlayerProp(
      leg(g, "Hits", "Miguel Vargas Over 0.5 Hits", true, "Miguel Vargas"),
      [hits],
    ),
    false,
  );

  const ranked = [
    { pick: hits, rankScore: 100 },
    { pick: tb, rankScore: 99 },
    { pick: hrr, rankScore: 98 },
    {
      pick: leg(g, "Hits", "Colson Montgomery Under 0.5 Hits", true, "Colson Montgomery"),
      rankScore: 90,
    },
    {
      pick: leg("A @ B", "Points", "Player X Over 20.5", true, "Player X"),
      rankScore: 80,
    },
    { pick: leg("C @ D", "Spread", "C +3"), rankScore: 70 },
  ];
  const out = selectCorrelationAwareBoardLegs(ranked, 4);
  const meidroth = out.filter((p) => /meidroth/i.test(String(p.player ?? "")));
  assert.equal(meidroth.length, 1, `expected one Meidroth prop, got ${meidroth.length}`);
  assert.ok(out.length >= 3);
});

test("max 2 props per game on 9-leg mix tickets", () => {
  const g = "Chicago White Sox @ Cleveland Guardians";
  const ticket = [
    leg(g, "Hits", "A Over 0.5", true, "Player A"),
    leg(g, "Hits", "B Under 0.5", true, "Player B"),
  ];
  assert.equal(maxPropsPerGame(9), 2);
  assert.equal(
    wouldExceedMaxPropsPerGame(leg(g, "Hits", "C Over 0.5", true, "Player C"), ticket, 2),
    true,
  );
  assert.equal(
    wouldExceedMaxPropsPerGame(
      leg("Other @ Game", "Hits", "D Over 0.5", true, "Player D"),
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
