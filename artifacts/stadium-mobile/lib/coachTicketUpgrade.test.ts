import test from "node:test";
import assert from "node:assert/strict";

import { coachTicketUpgraded } from "./coachTicketUpgrade.ts";

test("coachTicketUpgraded detects line swap after deep sim", () => {
  const before = [
    {
      game: "A @ B",
      market: "Spread",
      pick: "A -1.5",
      odds: -110,
      finalAiScore: { composite: 6.5 },
    },
  ];
  const after = [
    {
      game: "A @ B",
      market: "Alt Spread",
      pick: "A +3.5",
      odds: -105,
      finalAiScore: { composite: 7.2 },
    },
  ];
  assert.equal(coachTicketUpgraded(before as never, after as never), true);
});

test("coachTicketUpgraded is false when only composite nudges slightly", () => {
  const leg = {
    game: "A @ B",
    market: "Spread",
    pick: "A -1.5",
    odds: -110,
    finalAiScore: { composite: 6.5 },
  };
  assert.equal(
    coachTicketUpgraded([leg as never], [{ ...leg, finalAiScore: { composite: 6.6 } } as never]),
    false,
  );
});
