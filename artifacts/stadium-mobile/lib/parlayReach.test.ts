import assert from "node:assert/strict";
import test from "node:test";
import {
  buildParlayShortfallNote,
  mergeParlayRejects,
  reachParlayMix,
  selectParlayBackupPicks,
} from "./parlayReachCore.ts";

test("reachParlayMix allows more game legs for 15-leg tickets", () => {
  const mix = reachParlayMix(15);
  assert.ok(mix.maxGameLegs >= 5);
  assert.ok(mix.minProps <= 6);
});

test("selectParlayBackupPicks returns near-miss legs not on ticket", () => {
  const ticket = [
    {
      game: "A @ B",
      market: "Spread",
      pick: "B +1.5",
      odds: -110,
      isProp: false,
    },
  ];
  const rejects = [
    {
      pick: { game: "C @ D", market: "Hits", pick: "Player O 1.5 Hits", odds: 200, isProp: true },
      reason: "sim 48%",
      nearScore: 40,
    },
    {
      pick: { game: "E @ F", market: "Alt Spread", pick: "F +3.5", odds: -105, isProp: false },
      reason: "edge -1%",
      nearScore: 35,
    },
  ];
  const backups = selectParlayBackupPicks(ticket, rejects, 2);
  assert.equal(backups.length, 2);
  assert.notEqual(backups[0]!.game, ticket[0]!.game);
});

test("buildParlayShortfallNote mentions backup cards", () => {
  const note = buildParlayShortfallNote(15, 11, [], 4, "today's real odds");
  assert.match(note, /11/);
  assert.match(note, /backup card/);
});

test("mergeParlayRejects dedupes by leg fingerprint", () => {
  const pick = { game: "A @ B", market: "ML", pick: "B ML", odds: -120, isProp: false };
  const a = { pick, reason: "r1", nearScore: 10 };
  const b = { pick, reason: "r1", nearScore: 20 };
  const merged = mergeParlayRejects([a], [b]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.nearScore, 20);
});
