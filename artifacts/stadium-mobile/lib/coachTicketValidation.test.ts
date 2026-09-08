import assert from "node:assert/strict";
import { test } from "node:test";

import { filterValidCoachPicks, isValidCoachPick } from "./coachTicketValidation.ts";

test("isValidCoachPick rejects malformed legs", () => {
  assert.equal(isValidCoachPick(null), false);
  assert.equal(isValidCoachPick({ game: "", market: "Spread", pick: "Team A", odds: -110 }), false);
  assert.equal(isValidCoachPick({ game: "A @ B", market: "Spread", pick: "Team A", odds: NaN }), false);
  assert.equal(
    isValidCoachPick({ game: "A @ B", market: "Spread", pick: "Team A -3.5", odds: -110 }),
    true,
  );
});

test("filterValidCoachPicks keeps valid legs only", () => {
  const out = filterValidCoachPicks([
    { game: "A @ B", market: "Spread", pick: "Team A -3.5", odds: -110 },
    { game: "", market: "Total", pick: "Over 8.5", odds: -105 },
  ]);
  assert.equal(out.length, 1);
});
