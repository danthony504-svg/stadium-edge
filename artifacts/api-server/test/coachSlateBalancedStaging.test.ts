import assert from "node:assert/strict";
import test from "node:test";
import { balancedMixSlots, BALANCED_MIX_FRACTIONS } from "../src/lib/coachSlateBalancedMix.js";
import {
  partitionServerRankedByCategory,
  serverBoardMarketCategory,
  ticketCategoryMix,
} from "../src/lib/coachSlateMarketPools.js";
import { stageServerTicketBalanced, stageServerTicketMarketAgnostic, isPrefixServerTicket } from "../src/lib/coachSlateBalancedStaging.js";
import type { ParsedPick } from "../src/lib/coachSlateTypes.js";

function pick(
  partial: Partial<ParsedPick> & Pick<ParsedPick, "game" | "market" | "pick" | "odds">,
): ParsedPick {
  return {
    isProp: false,
    sport: "nba",
    ...partial,
  };
}

test("BALANCED_MIX_FRACTIONS sum to 100%", () => {
  const sum = Object.values(BALANCED_MIX_FRACTIONS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 0.001);
});

test("balancedMixSlots targets ~50% props on a 10-leg ticket", () => {
  const slots = balancedMixSlots(10);
  assert.equal(slots.props, 5);
  assert.equal(slots.gameLines + slots.teamTotals + slots.alternateLines, 5);
});

test("serverBoardMarketCategory separates props, game lines, team totals, and alts", () => {
  assert.equal(
    serverBoardMarketCategory(
      pick({ game: "A @ B", market: "Points", pick: "Star Over 24.5", odds: -110, isProp: true, player: "Star" }),
    ),
    "props",
  );
  assert.equal(serverBoardMarketCategory(pick({ game: "A @ B", market: "Spread", pick: "A -3.5", odds: -110 })), "gameLines");
  assert.equal(
    serverBoardMarketCategory(pick({ game: "A @ B", market: "Team Total", pick: "Over 112.5", odds: -110 })),
    "teamTotals",
  );
  assert.equal(
    serverBoardMarketCategory(pick({ game: "A @ B", market: "Alt Spread", pick: "A -1.5", odds: -110 })),
    "alternateLines",
  );
});

test("stageServerTicketBalanced fills ~50% props when pool has depth", () => {
  const ranked = [
    { pick: pick({ game: "A @ B", market: "Points", pick: "P1 Over 20.5", odds: -110, isProp: true, player: "P1" }), rankScore: 100, isAlt: false },
    { pick: pick({ game: "A @ B", market: "Rebounds", pick: "P2 Over 8.5", odds: -110, isProp: true, player: "P2" }), rankScore: 95, isAlt: false },
    { pick: pick({ game: "A @ B", market: "Assists", pick: "P3 Over 5.5", odds: -110, isProp: true, player: "P3" }), rankScore: 90, isAlt: false },
    { pick: pick({ game: "A @ B", market: "Threes", pick: "P4 Over 2.5", odds: -110, isProp: true, player: "P4" }), rankScore: 85, isAlt: false },
    { pick: pick({ game: "A @ B", market: "Steals", pick: "P5 Over 1.5", odds: -110, isProp: true, player: "P5" }), rankScore: 80, isAlt: false },
    { pick: pick({ game: "C @ D", market: "Spread", pick: "C -4.5", odds: -110 }), rankScore: 75, isAlt: false },
    { pick: pick({ game: "C @ D", market: "Total", pick: "Over 220.5", odds: -110 }), rankScore: 70, isAlt: false },
    { pick: pick({ game: "E @ F", market: "Team Total", pick: "Over 112.5", odds: -110 }), rankScore: 65, isAlt: false },
    { pick: pick({ game: "E @ F", market: "Alt Spread", pick: "E -1.5", odds: -110 }), rankScore: 60, isAlt: true },
    { pick: pick({ game: "G @ H", market: "Moneyline", pick: "G ML", odds: -150 }), rankScore: 55, isAlt: false },
    { pick: pick({ game: "G @ H", market: "Alt Total", pick: "Over 228.5", odds: -110 }), rankScore: 50, isAlt: true },
  ];

  const pools = partitionServerRankedByCategory(ranked);
  assert.equal(pools.props.length, 5);
  assert.equal(pools.gameLines.length, 3);
  assert.equal(pools.teamTotals.length, 1);
  assert.equal(pools.alternateLines.length, 2);

  const { picks } = stageServerTicketBalanced(ranked, 10);
  const mix = ticketCategoryMix(picks);
  assert.equal(picks.length, 10);
  assert.ok(mix.props >= 4, `expected props >= 4, got ${mix.props}`);
  assert.ok(mix.propShare >= 0.4, `prop share ${mix.propShare} below 40%`);
});

test("stageServerTicketBalanced builds independent tickets per leg count", () => {
  const ranked = [
    { pick: pick({ game: "A @ B", market: "Points", pick: "P1 Over 20.5", odds: -110, isProp: true, player: "P1" }), rankScore: 100, isAlt: false },
    { pick: pick({ game: "A @ B", market: "Rebounds", pick: "P2 Over 8.5", odds: -110, isProp: true, player: "P2" }), rankScore: 95, isAlt: false },
    { pick: pick({ game: "A @ B", market: "Assists", pick: "P3 Over 5.5", odds: -110, isProp: true, player: "P3" }), rankScore: 90, isAlt: false },
    { pick: pick({ game: "A @ B", market: "Threes", pick: "P4 Over 2.5", odds: -110, isProp: true, player: "P4" }), rankScore: 85, isAlt: false },
    { pick: pick({ game: "A @ B", market: "Steals", pick: "P5 Over 1.5", odds: -110, isProp: true, player: "P5" }), rankScore: 80, isAlt: false },
    { pick: pick({ game: "C @ D", market: "Spread", pick: "C -4.5", odds: -110 }), rankScore: 75, isAlt: false },
    { pick: pick({ game: "C @ D", market: "Total", pick: "Over 220.5", odds: -110 }), rankScore: 70, isAlt: false },
    { pick: pick({ game: "E @ F", market: "Team Total", pick: "Over 112.5", odds: -110 }), rankScore: 65, isAlt: false },
    { pick: pick({ game: "E @ F", market: "Alt Spread", pick: "E -1.5", odds: -110 }), rankScore: 60, isAlt: true },
    { pick: pick({ game: "G @ H", market: "Moneyline", pick: "G ML", odds: -150 }), rankScore: 55, isAlt: false },
    { pick: pick({ game: "G @ H", market: "Alt Total", pick: "Over 228.5", odds: -110 }), rankScore: 50, isAlt: true },
    { pick: pick({ game: "I @ J", market: "Points", pick: "P6 Over 18.5", odds: -110, isProp: true, player: "P6" }), rankScore: 48, isAlt: false },
    { pick: pick({ game: "K @ L", market: "Points", pick: "P7 Over 17.5", odds: -110, isProp: true, player: "P7" }), rankScore: 46, isAlt: false },
    { pick: pick({ game: "M @ N", market: "Points", pick: "P8 Over 16.5", odds: -110, isProp: true, player: "P8" }), rankScore: 44, isAlt: false },
    { pick: pick({ game: "O @ P", market: "Spread", pick: "O -2.5", odds: -110 }), rankScore: 42, isAlt: false },
  ];

  const five = stageServerTicketBalanced(ranked, 5).picks;
  const fifteen = stageServerTicketBalanced(ranked, 15).picks;
  assert.equal(five.length, 5);
  assert.equal(fifteen.length, 15);
  assert.equal(isPrefixServerTicket(fifteen, five), false);
});

test("stageServerTicketMarketAgnostic selects the highest qualified ranks across families", () => {
  const ranked = [
    { pick: pick({ game: "A @ B", market: "Moneyline", pick: "A ML", odds: 120 }), rankScore: 100, isAlt: false },
    { pick: pick({ game: "C @ D", market: "Spread", pick: "C +3.5", odds: -110 }), rankScore: 99, isAlt: false },
    { pick: pick({ game: "E @ F", market: "Points", pick: "P Over 20.5", odds: -110, isProp: true, player: "P" }), rankScore: 98, isAlt: false },
    { pick: pick({ game: "G @ H", market: "Team Total", pick: "Over 108.5", odds: -110 }), rankScore: 97, isAlt: false },
  ];
  assert.deepEqual(
    stageServerTicketMarketAgnostic(ranked, 3).picks.map((row) => row.pick),
    ["A ML", "C +3.5", "P Over 20.5"],
  );
});
