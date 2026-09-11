import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  canShowFixedLegBoardScanPicks,
  shouldHoldIncompleteBoardScanPickDisplay,
} from "./coachBoardScanDisplay.ts";

test("proof: 2→5 of 6 mid-scan cannot show cards; 6 of 6 can", () => {
  for (const n of [2, 3, 4, 5]) {
    assert.equal(
      canShowFixedLegBoardScanPicks({
        legTarget: 6,
        pickCount: n,
        scanComplete: false,
      }),
      false,
    );
    assert.equal(
      shouldHoldIncompleteBoardScanPickDisplay({
        scanComplete: false,
        legTarget: 6,
        readyPickCount: n,
      }),
      true,
    );
  }
  assert.equal(
    canShowFixedLegBoardScanPicks({
      legTarget: 6,
      pickCount: 6,
      scanComplete: false,
    }),
    true,
  );
});

test("coach.tsx no longer stamps scan-continues under-count legNote mid-scan", () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../app/(tabs)/coach.tsx"),
    "utf8",
  );
  assert.doesNotMatch(
    src,
    /showing \*\*\$\{ticket\.length\}\*\* while the full-board scan continues/,
  );
  assert.match(src, /canShowFixedLegBoardScanPicks/);
  assert.match(src, /Absolute UI lock: never render mid-scan under-count cards/);
});
