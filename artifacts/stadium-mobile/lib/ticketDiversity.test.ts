import assert from "node:assert/strict";
import test from "node:test";
import {
  dedupeSameTeamGameLegs,
  rebalanceDeepParlayTicket,
  rotatePool,
  prepareDeepParlaySeed,
  needsParlayBackfill,
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

test("rebalanceDeepParlayTicket trims game legs for prop room", () => {
  const gameLegs = Array.from({ length: 12 }, (_, i) => ({
    game: `Away${i} @ Home${i}`,
    market: "Moneyline",
    pick: `Home${i} ML`,
    odds: -110,
    isProp: false,
  }));
  const { picks } = rebalanceDeepParlayTicket(gameLegs, { legTarget: 15 });
  assert.ok(picks.length < 12);
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
