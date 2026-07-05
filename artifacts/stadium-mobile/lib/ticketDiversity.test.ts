import assert from "node:assert/strict";
import test from "node:test";
import {
  dedupeSameTeamGameLegs,
  rotatePool,
  prepareDeepParlaySeed,
  needsParlayBackfill,
  shouldComposeDeepParlayFromBoard,
  isChalkHeavyParlay,
  assembleDeepParlayFromBoard,
  topUpDeepParlayToTarget,
  finalizeDeepParlayTicket,
} from "./ticketDiversity.ts";

test("dedupeSameTeamGameLegs keeps one Braves side leg", () => {
  const picks = [
    { game: "Mets @ Braves", market: "Moneyline", pick: "Braves ML", odds: -112, isProp: false },
    { game: "Mets @ Braves", market: "Spread", pick: "Braves -1.5", odds: 168, isProp: false },
    { game: "Pirates @ Nationals", market: "Moneyline", pick: "Pirates ML", odds: 116, isProp: false },
  ];
  const { picks: out, dropped } = dedupeSameTeamGameLegs(picks);
  assert.equal(dropped, 1);
  assert.equal(out.filter((p) => p.game === "Mets @ Braves").length, 1);
});

test("dedupeSameTeamGameLegs matches nickname vs full team name", () => {
  const picks = [
    { game: "Mets @ Braves", market: "Moneyline", pick: "Atlanta Braves ML", odds: -112, isProp: false },
    { game: "Mets @ Braves", market: "Spread", pick: "Braves +1.5", odds: -175, isProp: false },
  ];
  const { picks: out, dropped } = dedupeSameTeamGameLegs(picks);
  assert.equal(dropped, 1);
  assert.equal(out.length, 1);
});

test("shouldComposeDeepParlayFromBoard true for generic 6-leg", () => {
  assert.equal(shouldComposeDeepParlayFromBoard(6), true);
  assert.equal(shouldComposeDeepParlayFromBoard(6, { explicitSingleGame: true }), false);
});

test("rebalance removed — seed always clears model game scaffold", () => {
  const gameLegs = Array.from({ length: 6 }, (_, i) => ({
    game: `Away${i} @ Home${i}`,
    market: "Moneyline",
    pick: `Home${i} ML`,
    odds: -110,
    isProp: false,
  }));
  const { picks } = prepareDeepParlaySeed(gameLegs, 6);
  assert.ok(picks.length <= 3);
});

test("prepareDeepParlaySeed clears chalk game scaffold", () => {
  const picks = Array.from({ length: 15 }, (_, i) => ({
    game: `Away${i} @ Home${i}`,
    market: "Moneyline",
    pick: `Home${i} ML`,
    odds: -110,
    isProp: false,
  }));
  const { picks: out, stripped } = prepareDeepParlaySeed(picks, 15);
  assert.ok(stripped >= 13);
  assert.ok(out.length <= 3);
});

test("prepareDeepParlaySeed strips 12-leg ML+spread scaffold", () => {
  const picks = Array.from({ length: 6 }, (_, i) => [
    {
      game: `Away${i} @ Home${i}`,
      market: "Moneyline",
      pick: `Home${i} ML`,
      odds: -110,
      isProp: false,
    },
    {
      game: `Away${i} @ Home${i}`,
      market: "Spread",
      pick: `Home${i} +1.5`,
      odds: -165,
      isProp: false,
    },
  ]).flat();
  const { picks: out, stripped } = prepareDeepParlaySeed(picks, 12);
  assert.equal(stripped, 9);
  assert.ok(out.length <= 3);
});

test("needsParlayBackfill true when longshot is all chalk", () => {
  const picks = Array.from({ length: 15 }, () => ({
    game: "A @ B",
    market: "Moneyline",
    pick: "B ML",
    odds: -110,
    isProp: false,
  }));
  assert.equal(needsParlayBackfill(picks, 15, { longshotAsk: true }), true);
});

test("needsParlayBackfill true for 12-leg chalk without longshot keyword", () => {
  const picks = Array.from({ length: 6 }, (_, i) => [
    {
      game: `Away${i} @ Home${i}`,
      market: "Moneyline",
      pick: `Home${i} ML`,
      odds: -110,
      isProp: false,
    },
    {
      game: `Away${i} @ Home${i}`,
      market: "Spread",
      pick: `Home${i} +1.5`,
      odds: -165,
      isProp: false,
    },
  ]).flat();
  assert.equal(needsParlayBackfill(picks, 12, { deepParlay: true }), true);
});

test("isChalkHeavyParlay true for all-ML 9-leg scaffold", () => {
  const picks = Array.from({ length: 9 }, (_, i) => ({
    game: `Away${i} @ Home${i}`,
    market: "Moneyline",
    pick: `Home${i} ML`,
    odds: -110,
    isProp: false,
  }));
  assert.equal(isChalkHeavyParlay(picks, 9), true);
});

test("assembleDeepParlayFromBoard props-first then capped game lines", () => {
  const kick = "2026-07-05T23:00:00.000Z";
  const propPool = Array.from({ length: 12 }, (_, i) => ({
    game: `Away${i % 4} @ Home${i % 4}`,
    player: `Player${i}`,
    marketLabel: "Strikeouts",
    marketKey: "pitcher_strikeouts",
    line: 5.5,
    side: "Over" as const,
    odds: -110,
    sport: "mlb",
    startsAt: kick,
  }));
  const realOdds = Array.from({ length: 6 }, (_, i) => ({
    game: `Away${i} @ Home${i}`,
    market: "Moneyline",
    pick: `Home${i} ML`,
    odds: -110,
    sport: "mlb",
    startsAt: kick,
  }));
  const picks = assembleDeepParlayFromBoard(9, propPool, realOdds, [], {});
  assert.ok(picks.filter((p) => p.isProp).length >= 5);
  assert.ok(picks.filter((p) => !p.isProp).length <= 3);
});

test("topUpDeepParlayToTarget caps game legs on longshot top-up", () => {
  const kick = "2026-07-05T23:00:00.000Z";
  const existing = Array.from({ length: 6 }, (_, i) => ({
    game: `Away${i} @ Home${i}`,
    market: "Moneyline",
    pick: `Home${i} ML`,
    odds: -110,
    isProp: false,
  }));
  const propPool = Array.from({ length: 20 }, (_, i) => ({
    game: `Away${i % 5} @ Home${i % 5}`,
    player: `Player${i}`,
    marketLabel: "Strikeouts",
    marketKey: "k",
    line: 5.5,
    side: "Over" as const,
    odds: 110,
    sport: "mlb",
    startsAt: kick,
  }));
  const realOdds = Array.from({ length: 10 }, (_, i) => ({
    game: `Away${i} @ Home${i}`,
    market: "Moneyline",
    pick: `Home${i} ML`,
    odds: -110,
    sport: "mlb",
    startsAt: kick,
  }));
  const out = topUpDeepParlayToTarget(existing, 15, propPool, realOdds, [], { longshotAsk: true });
  assert.ok(out.filter((p) => p.isProp).length >= 8);
  assert.ok(out.filter((p) => !p.isProp).length <= 2);
});

test("finalizeDeepParlayTicket strips model moneylines and rebuilds", () => {
  const kick = "2026-07-05T23:00:00.000Z";
  const chalkMl = Array.from({ length: 15 }, (_, i) => ({
    game: `Away${i % 6} @ Home${i % 6}`,
    market: "Moneyline",
    pick: `Home${i % 6} ML`,
    odds: -110,
    isProp: false,
  }));
  const propPool = Array.from({ length: 20 }, (_, i) => ({
    game: `Away${i % 5} @ Home${i % 5}`,
    player: `Player${i}`,
    marketLabel: "Strikeouts",
    marketKey: "k",
    line: 5.5,
    side: "Over" as const,
    odds: 110,
    sport: "mlb",
    startsAt: kick,
  }));
  const realOdds = Array.from({ length: 10 }, (_, i) => ({
    game: `Away${i} @ Home${i}`,
    market: "Moneyline",
    pick: `Home${i} ML`,
    odds: -110,
    sport: "mlb",
    startsAt: kick,
  }));
  const out = finalizeDeepParlayTicket(chalkMl, 15, propPool, realOdds, [], { longshotAsk: true });
  assert.equal(out.filter((p) => /^moneyline$/i.test(p.market)).length, 0);
  assert.ok(out.filter((p) => p.isProp).length >= 8);
});
