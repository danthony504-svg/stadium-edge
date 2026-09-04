import test from "node:test";
import assert from "node:assert/strict";

test("api.ts loads without PROP_MARKET_LABEL_MAP reference", async () => {
  const api = await import("./api.ts");
  assert.equal(typeof api.getSync, "function");
  assert.equal(typeof api.propMarketLabel, "function");
  assert.equal((api as Record<string, unknown>).PROP_MARKET_LABEL_MAP, undefined);
  assert.equal((api as Record<string, unknown>).propMarketKeyForLabel, undefined);
});
