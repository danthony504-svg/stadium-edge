import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createSportRegistry } from "../src/registry";
import { createMlbAdapter } from "../src/sports/mlb";

describe("coach-data sport registry", () => {
  it("registers and resolves adapters by sport id", () => {
    const registry = createSportRegistry([createMlbAdapter()]);
    assert.equal(registry.has("mlb"), true);
    assert.equal(registry.get("MLB")?.sportId, "mlb");
    assert.equal(registry.has("nba"), false);
  });

  it("allows runtime registration of new sports", () => {
    const registry = createSportRegistry();
    registry.register(createMlbAdapter());
    assert.deepEqual(registry.sportIds(), ["mlb"]);
  });
});
