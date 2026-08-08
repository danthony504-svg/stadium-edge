import assert from "node:assert/strict";
import test from "node:test";

import { qualifiesServerAiLine } from "../src/lib/coachSlateGameSims.js";

test("qualifiesServerAiLine uses completed simulation versus implied price when provider edge is absent", () => {
  assert.equal(
    qualifiesServerAiLine(
      {
        sport: "mlb",
        game: "Away @ Home",
        market: "Run Line",
        pick: "Away +1.5",
        odds: -110,
        edge: null,
      },
      0.57,
    ),
    true,
  );
});

test("qualifiesServerAiLine rejects an incomplete simulation instead of treating optional edge as a grade", () => {
  assert.equal(
    qualifiesServerAiLine(
      {
        sport: "mlb",
        game: "Away @ Home",
        market: "Run Line",
        pick: "Away +1.5",
        odds: -110,
        edge: 5,
      },
      null,
    ),
    false,
  );
});
