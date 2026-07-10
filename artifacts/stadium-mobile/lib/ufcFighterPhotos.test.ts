import assert from "node:assert/strict";
import test from "node:test";

import { parseSherdogFighterPhoto } from "./ufcSupplement.ts";

test("parseSherdogFighterPhoto extracts Sherdog headshot URL", () => {
  const html = '<img src="/image_crop/200/300/_images/fighter/1737120544aby.jpg" class="profile">';
  assert.equal(
    parseSherdogFighterPhoto(html),
    "https://www.sherdog.com/image_crop/200/300/_images/fighter/1737120544aby.jpg",
  );
});
