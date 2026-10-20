import assert from "node:assert/strict";
import test from "node:test";
import { teamSearchFallbackQuery } from "../src/lib/teamSearchQuery.js";
test("club aliases preserve identifying names", () => {
  assert.equal(teamSearchFallbackQuery("ŠK Slovan Bratislava"), "Slovan Bratislava");
  assert.equal(teamSearchFallbackQuery("FK Bodø Glimt"), "Bodø Glimt");
  assert.equal(teamSearchFallbackQuery("AS Roma"), null);
  assert.equal(teamSearchFallbackQuery("Los Angeles Lakers"), null);
  assert.equal(teamSearchFallbackQuery("FC Barcelona"), null);
});
