import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../components/ScoreBreakdown.tsx"),
  "utf8",
);

test("ScoreBreakdown labels coveragePct as input coverage (not calibrated accuracy)", () => {
  assert.match(SRC, /coveragePct\}% input coverage/);
  assert.doesNotMatch(SRC, /context grounded/);
});
