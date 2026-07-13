import assert from "node:assert/strict";
import test from "node:test";

import { stageServerTicketBalanced, isPrefixServerTicket } from "../src/lib/coachSlateBalancedStaging.js";
import { buildSlateTicketsIndex } from "../src/lib/coachSlateTickets.js";
import type { ParsedPick } from "../src/lib/coachSlateTypes.js";

function pick(
  partial: Partial<ParsedPick> & Pick<ParsedPick, "game" | "market" | "pick" | "odds">,
): ParsedPick {
  return { isProp: false, sport: "wnba", ...partial };
}

function wnbaRanked() {
  return [
    { pick: pick({ game: "Sparks @ Dream", market: "Assists", pick: "Allisha Gray Under 3.5 Assists", odds: -260, isProp: true, player: "Allisha Gray" }), rankScore: 100, isAlt: false },
    { pick: pick({ game: "Mercury @ Lynx", market: "Assists", pick: "Natasha Howard Over 1.5 Assists", odds: -188, isProp: true, player: "Natasha Howard" }), rankScore: 95, isAlt: false },
    { pick: pick({ game: "Sparks @ Dream", market: "3-Pointers", pick: "Allisha Gray Under 1.5 3-Pointers", odds: 110, isProp: true, player: "Allisha Gray" }), rankScore: 90, isAlt: false },
    { pick: pick({ game: "Sparks @ Dream", market: "Rebounds", pick: "Jordin Canada Under 4.5 Rebounds", odds: -152, isProp: true, player: "Jordin Canada" }), rankScore: 85, isAlt: false },
    { pick: pick({ game: "Mercury @ Lynx", market: "Pts+Reb", pick: "Kahleah Copper Over 23.5 Pts+Reb", odds: -114, isProp: true, player: "Kahleah Copper" }), rankScore: 80, isAlt: false },
    { pick: pick({ game: "Sparks @ Dream", market: "Rebounds", pick: "Ariel Atkins Under 3.5 Rebounds", odds: -170, isProp: true, player: "Ariel Atkins" }), rankScore: 75, isAlt: false },
    ...Array.from({ length: 12 }, (_, i) => ({
      pick: pick({ game: `G${i} @ H${i}`, market: "Points", pick: `Player ${i} Over 20.5`, odds: -110, isProp: true, player: `Player ${i}` }),
      rankScore: 70 - i,
      isAlt: false,
    })),
    { pick: pick({ game: "E @ F", market: "Spread", pick: "Away +3.5", odds: -110 }), rankScore: 50, isAlt: false },
    { pick: pick({ game: "G @ H", market: "Total", pick: "Over 220.5", odds: -110 }), rankScore: 45, isAlt: false },
  ];
}

function legFingerprint(p: ParsedPick): string {
  if (p.isProp) return `prop|${p.game}|${p.player}|${p.market}`;
  return `game|${p.game}|${p.market}|${p.pick}`;
}

test("production sequence: server 4-leg must not prefix-match first 4 of 15-leg", () => {
  const ranked = wnbaRanked();
  const four = stageServerTicketBalanced(ranked, 4).picks;
  const fifteen = stageServerTicketBalanced(ranked, 15).picks;
  assert.equal(four.length, 4);
  assert.equal(fifteen.length, 15);
  assert.equal(
    isPrefixServerTicket(fifteen, four),
    false,
    `server 4-leg must differ from 15-leg prefix.\n4: ${four.map(legFingerprint).join(",")}\n15-prefix: ${fifteen.slice(0, 4).map(legFingerprint).join(",")}`,
  );
});

test("production sequence: server 8-leg must not prefix-match first 8 of 15-leg", () => {
  const ranked = wnbaRanked();
  const eight = stageServerTicketBalanced(ranked, 8).picks;
  const fifteen = stageServerTicketBalanced(ranked, 15).picks;
  assert.equal(eight.length, 8);
  assert.equal(fifteen.length, 15);
  assert.equal(
    isPrefixServerTicket(fifteen, eight),
    false,
    `server 8-leg must differ from 15-leg prefix.\n8: ${eight.map(legFingerprint).join(",")}\n15: ${fifteen.slice(0, 8).map(legFingerprint).join(",")}`,
  );
});

test("buildSlateTicketsIndex stores independent 8 and 15 tickets", () => {
  const ranked = wnbaRanked();
  const ctx = {
    evalLinesByGame: new Map(),
    gameSimulations: new Map(),
    totalScanned: 100,
    sports: ["wnba"],
  };
  const tickets = buildSlateTicketsIndex(ranked, ctx, stageServerTicketBalanced);
  const eight = tickets.global[8]?.picks ?? [];
  const fifteen = tickets.global[15]?.picks ?? [];
  assert.equal(eight.length, 8);
  assert.equal(fifteen.length, 15);
  assert.equal(isPrefixServerTicket(fifteen, eight), false);
});
