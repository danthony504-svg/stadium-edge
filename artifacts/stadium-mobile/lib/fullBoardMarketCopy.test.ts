import assert from "node:assert/strict";
import test from "node:test";

import { fullBoardScanSuccessNote } from "./fullBoardMarketCopy.ts";

test("fullBoardScanSuccessNote is hidden from Coach chat", () => {
  assert.equal(fullBoardScanSuccessNote(10590, 7), "");
});
