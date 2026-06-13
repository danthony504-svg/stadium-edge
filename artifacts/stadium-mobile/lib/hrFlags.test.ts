import { test } from "node:test";
import assert from "node:assert/strict";
import { computeHrFlags, type HrFlag } from "./hrFlags.ts";

const has = (flags: HrFlag[], key: string) => flags.some((f) => f.key === key);
const get = (flags: HrFlag[], key: string) => flags.find((f) => f.key === key);

test("all green conditions met => every green flag lights, no reds", () => {
  const f = computeHrFlags({
    hrPer9: 1.6,
    oppOPS: 0.78,
    flyBallPct: 0.48,
    kPer9: 6.5,
    hardHitPctAllowed: 43,
    barrelPctAllowed: 9.5,
    battedBallEvents: 150,
    batterHand: "L",
    pitcherThrows: "R",
    hrIndex: 112,
    venue: "Coors Field",
    tempF: 78,
    dome: false,
  });
  assert.deepEqual(
    f.green.map((g) => g.key).sort(),
    ["barrel", "flyball", "hardhit", "hr9", "k9", "oppOPS", "park", "platoon"].sort(),
  );
  assert.equal(f.red.length, 0);
  assert.equal(get(f.green, "park")!.value, "Coors Field · 112 HR index");
  assert.equal(get(f.green, "oppOPS")!.value, ".780 opp OPS");
  assert.equal(get(f.green, "platoon")!.value, "LHB vs RHP");
  assert.equal(f.windOmitted, true); // outdoor => wind flags omitted
});

test("all red conditions met => every red flag lights, no greens", () => {
  const f = computeHrFlags({
    hrPer9: 0.7,
    oppOPS: 0.6,
    flyBallPct: 0.3, // ground-ball lean
    kPer9: 10.2,
    hrIndex: 88, // pitcher's park
    venue: "Oracle Park",
    tempF: 44, // cold
    dome: false,
  });
  assert.deepEqual(
    f.red.map((r) => r.key).sort(),
    ["cold", "flyball", "hr9", "k9", "oppOPS", "park"].sort(),
  );
  assert.equal(f.green.length, 0);
  assert.equal(get(f.red, "cold")!.value, "44\u00b0F");
  assert.equal(get(f.red, "hr9")!.value, "0.70 HR/9");
});

test("neutral values between thresholds light NO flag", () => {
  const f = computeHrFlags({
    hrPer9: 1.1, // between 1.0 and 1.4
    oppOPS: 0.7, // between .650 and .750
    flyBallPct: 0.4, // between .35 and .45
    kPer9: 8.0, // between 7.0 and 9.0
    hrIndex: 100, // between 95 and 105
    tempF: 65, // above 50
    dome: false,
  });
  assert.equal(f.green.length, 0);
  assert.equal(f.red.length, 0);
});

test("missing data => no flag, never a guess", () => {
  const f = computeHrFlags({});
  assert.equal(f.green.length, 0);
  assert.equal(f.red.length, 0);
  assert.equal(f.windOmitted, false); // dome unknown => no outdoor wind note
});

test("Statcast flags require a confirmed sample (>= 40 BBE)", () => {
  const thin = computeHrFlags({ hardHitPctAllowed: 45, barrelPctAllowed: 11, battedBallEvents: 12 });
  assert.equal(has(thin.green, "hardhit"), false);
  assert.equal(has(thin.green, "barrel"), false);

  const unknown = computeHrFlags({ hardHitPctAllowed: 45, barrelPctAllowed: 11, battedBallEvents: null });
  assert.equal(has(unknown.green, "hardhit"), false);
  assert.equal(has(unknown.green, "barrel"), false);

  const solid = computeHrFlags({ hardHitPctAllowed: 45, barrelPctAllowed: 11, battedBallEvents: 80 });
  assert.equal(has(solid.green, "hardhit"), true);
  assert.equal(has(solid.green, "barrel"), true);
});

test("switch hitter always has the platoon advantage", () => {
  const f = computeHrFlags({ batterHand: "S", pitcherThrows: "R" });
  assert.equal(get(f.green, "platoon")!.value, "Switch hitter");
});

test("same-hand matchup is NOT a platoon advantage (no flag)", () => {
  const f = computeHrFlags({ batterHand: "R", pitcherThrows: "R" });
  assert.equal(has(f.green, "platoon"), false);
});

test("platoon needs the pitcher's hand for a non-switch batter", () => {
  const f = computeHrFlags({ batterHand: "L", pitcherThrows: null });
  assert.equal(has(f.green, "platoon"), false);
});

test("dome suppresses the cold-weather flag and the wind note", () => {
  const f = computeHrFlags({ tempF: 40, dome: true });
  assert.equal(has(f.red, "cold"), false);
  assert.equal(f.windOmitted, false);
});

test("park flag omits the venue prefix when venue is missing", () => {
  const f = computeHrFlags({ hrIndex: 110 });
  assert.equal(get(f.green, "park")!.value, "110 HR index");
});

// The flags card renders independently of the weighted HR Target Score. oppOPS
// and kPer9 are flag-only inputs (the score never weighs them), so a starter
// with ONLY those two values lights flags even though the score would be null.
// This guards the decoupled render path.
test("oppOPS / K-9 alone light flags (score-independent inputs)", () => {
  const f = computeHrFlags({ oppOPS: 0.79, kPer9: 6.4 });
  assert.equal(has(f.green, "oppOPS"), true);
  assert.equal(has(f.green, "k9"), true);
  assert.equal(f.red.length, 0);
});
