import assert from "node:assert/strict";
import test from "node:test";

import { looksLikeCorruptOtaBundle } from "./otaCorruptBundle.ts";

test("looksLikeCorruptOtaBundle flags phantom property errors", () => {
  assert.equal(looksLikeCorruptOtaBundle("Property 'pickSheetDisplayLabel' doesn't exist"), true);
});

test("looksLikeCorruptOtaBundle flags coach fingerprint garbage", () => {
  assert.equal(
    looksLikeCorruptOtaBundle('fingerprint: "pick@/static/v1/slate/"\ndomain: "coach"'),
    true,
  );
});

test("looksLikeCorruptOtaBundle flags garbled pick/update module paths", () => {
  assert.equal(
    looksLikeCorruptOtaBundle('Property "pickBreadHicks/update?" doesn\'t exist'),
    true,
  );
  assert.equal(looksLikeCorruptOtaBundle("pushNotifications/update"), true);
});

test("looksLikeCorruptOtaBundle ignores normal errors", () => {
  assert.equal(looksLikeCorruptOtaBundle("Network request failed"), false);
});
