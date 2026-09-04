import assert from "node:assert/strict";
import test from "node:test";

import {
  coachScreenInteractionEnabled,
  coachSubmitIsBlocked,
  shouldEmitPartialUpdate,
} from "./coachPartialUi.ts";

test("visible partial results keep Coach interactions enabled while blocking a conflicting submit", () => {
  assert.equal(
    coachScreenInteractionEnabled({ requestActive: true, hasVisiblePartialPicks: true }),
    true,
  );
  assert.equal(
    coachSubmitIsBlocked({ requestActive: true, hasVisiblePartialPicks: true }),
    true,
  );
});

test("partial scan updates are coalesced without changing displayed pick state", () => {
  assert.equal(shouldEmitPartialUpdate(1_000, 0, 400), true);
  assert.equal(shouldEmitPartialUpdate(1_200, 1_000, 400), false);
  assert.equal(shouldEmitPartialUpdate(1_400, 1_000, 400), true);

  const slip = ["already-added-pick"];
  const partialPicks = ["existing-pick", "new-pick"];
  assert.deepEqual(slip, ["already-added-pick"]);
  assert.deepEqual(partialPicks, ["existing-pick", "new-pick"]);
});

test("inactive requests do not restrict Coach interactions or submission", () => {
  assert.equal(
    coachScreenInteractionEnabled({ requestActive: false, hasVisiblePartialPicks: false }),
    true,
  );
  assert.equal(
    coachSubmitIsBlocked({ requestActive: false, hasVisiblePartialPicks: false }),
    false,
  );
});
