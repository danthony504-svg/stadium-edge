import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../app/(tabs)/coach.tsx"),
  "utf8",
);

test("Coach composer sticks to keyboard with dismiss chevron (no KeyboardAvoidingView gap)", () => {
  assert.match(SRC, /KeyboardStickyView/);
  assert.doesNotMatch(SRC, /KeyboardAvoidingView/);
  assert.match(SRC, /chevron-down/);
  assert.match(SRC, /Dismiss keyboard/);
  assert.match(SRC, /Keyboard\.dismiss/);
  // While open, drop home-indicator padding so the input sits flush above KB.
  assert.match(SRC, /keyboardOpen \? 8 : Math\.max\(insets\.bottom/);
  // Draft state must not be cleared on dismiss — only Keyboard.dismiss.
  assert.match(
    SRC,
    /const dismissKeyboard = useCallback\(\(\) => \{\s*Keyboard\.dismiss\(\);\s*\}, \[\]\)/,
  );
});
