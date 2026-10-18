import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./buildParlay.ts", import.meta.url), "utf8");
const block = source.slice(
  source.indexOf("let scanTimeout:"),
  source.indexOf("// Finalization starts", source.indexOf("let scanTimeout:")),
);

test("scan, grace, and drain races release timers after either winner", () => {
  assert.ok(block.length > 0, "scan and terminalization section must exist");
  for (const name of ["scanTimeout", "graceTimeout", "drainTimeout"]) {
    assert.match(block, new RegExp("if \\("+name+" !== null\\) clearTimeout\\("+name+"\\)"), name);
  }
  assert.match(block, /finally \{[\s\S]*?scanArm\.dispose\(\)/);
});

test("scan/grace abort listeners are removed even on fast completion", () => {
  assert.match(block, /opts\.signal\.removeEventListener\("abort", scanAbortListener\)/);
  assert.match(block, /scanArm\.signal\.removeEventListener\("abort", scanAbortListener\)/);
  assert.match(block, /opts\.signal\.removeEventListener\("abort", graceAbortListener\)/);
});

test("post-deadline grace uses remaining budget and finalization follows drain", () => {
  assert.match(block, /const graceRemaining = coachRemainingBudgetMs\(/);
  assert.match(block, /const drainMs = Math\.min\(/);
  assert.match(source, /if \(timed\.timedOut\) deliveryTerminalized = true/);
});
