import assert from "node:assert/strict";
import test from "node:test";
import {
  dedupeSameTeamGameLegs,
  rebalanceDeepParlayTicket,
  rotatePool,
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

test("rotatePool changes order deterministically", () => {
  const a = rotatePool([1, 2, 3, 4], "seed-a");
  const b = rotatePool([1, 2, 3, 4], "seed-b");
  assert.notDeepEqual(a, [1, 2, 3, 4]);
  assert.notDeepEqual(a, b);
});
