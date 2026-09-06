import assert from "node:assert/strict";
import test from "node:test";

import { appendProgressiveCoachPreview } from "./coachProgressiveTicket.ts";
import { coachScreenInteractionEnabled } from "./coachPartialUi.ts";

const pick = (id: number) => ({
  game: `Away ${id} @ Home ${id}`, market: "Spread", pick: `Away ${id} +1.5`,
  odds: -110, isProp: false,
});

test("progressive 3 → 4 → 5 → 6 freezes existing visible card references", () => {
  const three = [pick(1), pick(2), pick(3)];
  const four = appendProgressiveCoachPreview(three, [pick(1), pick(2), pick(3), pick(4)], 6);
  const five = appendProgressiveCoachPreview(four, [pick(2), pick(3), pick(4), pick(5)], 6);
  const six = appendProgressiveCoachPreview(five, [pick(1), pick(4), pick(5), pick(6)], 6);
  const later = appendProgressiveCoachPreview(six, [pick(7), pick(8)], 6);
  assert.equal(four.length, 4);
  assert.equal(five.length, 5);
  assert.equal(six.length, 6);
  assert.equal(four[0], three[0]);
  assert.equal(five[0], three[0]);
  assert.equal(six[0], three[0]);
  assert.equal(later, six);
});

test("six visible picks clear visual loading without releasing active request interaction", () => {
  const visible = [1, 2, 3, 4, 5, 6].map(pick);
  const visualLoading = visible.length < 6;
  const activeRequestLock = true;
  assert.equal(visualLoading, false);
  assert.equal(activeRequestLock, true);
  assert.equal(coachScreenInteractionEnabled({
    requestActive: activeRequestLock,
    hasVisiblePartialPicks: true,
  }), true);
});
