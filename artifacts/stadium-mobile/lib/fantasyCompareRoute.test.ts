import assert from "node:assert/strict";
import test from "node:test";

import { fantasyCompareRoute } from "./fantasyCompareRoute.ts";

test("fantasyCompareRoute deep-links Start/Sit with player A preselected", () => {
  const route = fantasyCompareRoute("athlete-1");
  assert.equal(route.pathname, "/fantasy-start-sit");
  assert.equal(route.params.playerAId, "athlete-1");
});
