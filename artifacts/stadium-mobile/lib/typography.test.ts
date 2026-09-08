import assert from "node:assert/strict";
import test from "node:test";

import { FONT, TYPE, numType, withTabular } from "./typography.ts";

test("FONT uses Inter for all weights", () => {
  assert.match(FONT.regular, /^Inter_/);
  assert.match(FONT.bold, /^Inter_/);
  assert.equal(FONT.display, FONT.bold);
  assert.equal(FONT.displaySemi, FONT.semibold);
});

test("TYPE scale matches design tokens", () => {
  assert.equal(TYPE.displayTitle.fontSize, 34);
  assert.equal(TYPE.screenTitle.fontSize, 28);
  assert.equal(TYPE.sectionHeader.fontSize, 24);
  assert.equal(TYPE.cardTitle.fontSize, 20);
  assert.equal(TYPE.playerName.fontSize, 18);
  assert.equal(TYPE.body.fontSize, 16);
  assert.equal(TYPE.secondary.fontSize, 14);
  assert.equal(TYPE.caption.fontSize, 13);
  assert.equal(TYPE.button.fontSize, 17);
});

test("numType applies tabular figures", () => {
  assert.deepEqual(numType("secondary").fontVariant, ["tabular-nums"]);
  assert.deepEqual(withTabular(TYPE.body).fontVariant, ["tabular-nums"]);
});
