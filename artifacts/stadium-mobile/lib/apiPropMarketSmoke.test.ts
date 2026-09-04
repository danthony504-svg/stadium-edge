import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

test("api.ts does not reference stale prop market map constant", () => {
  const apiSource = readFileSync(join(here, "api.ts"), "utf8");
  const stale = "PROP_MARKET" + "_LABEL_MAP";
  assert.equal(apiSource.includes(stale), false);
  assert.match(apiSource, /export \{ propMarketLabel, propMarketKeyForLabel \} from "\.\/propMarketLabel"/);
});
