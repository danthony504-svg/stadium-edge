import assert from "node:assert/strict";
import test from "node:test";
import { computeAmbiguous, gameValueForMarket } from "../src/lib/propStatValue.ts";

test("maps a posted anytime-touchdown market to real touchdown results", () => {
  assert.equal(
    gameValueForMarket("player_anytime_td", { TD: "1" }, computeAmbiguous(["TD"])),
    1,
  );
});
