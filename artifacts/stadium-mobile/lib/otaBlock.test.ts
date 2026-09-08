import assert from "node:assert/strict";
import test from "node:test";

import {
  blockOtaReload,
  isOtaReloadBlocked,
  resetOtaReloadBlockForTests,
  subscribeOtaReloadBlock,
} from "./otaBlock.ts";

test("blockOtaReload notifies subscribers on block and unblock", () => {
  resetOtaReloadBlockForTests();
  const events: boolean[] = [];
  const unsub = subscribeOtaReloadBlock(() => {
    events.push(isOtaReloadBlocked());
  });

  const release = blockOtaReload();
  assert.equal(isOtaReloadBlocked(), true);
  assert.deepEqual(events, [true]);

  release();
  assert.equal(isOtaReloadBlocked(), false);
  assert.deepEqual(events, [true, false]);

  unsub();
});
