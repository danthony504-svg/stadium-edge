/**
 * Account page scroll / Sign-out reachability.
 *
 * Device report: Sign out (red border) was clipped below the fold with no scroll.
 * Root cause: body content lived in a plain View — no ScrollView / bottom inset.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const SRC = readFileSync(join(process.cwd(), "app/account.tsx"), "utf8");

test("Account body scrolls via KeyboardAwareScrollViewCompat", () => {
  assert.match(SRC, /KeyboardAwareScrollViewCompat/);
  assert.match(
    SRC,
    /<KeyboardAwareScrollViewCompat[\s\S]*Sign out[\s\S]*<\/KeyboardAwareScrollViewCompat>/,
  );
  // Header title appears before the scroller (pinned title + close).
  const headerIdx = SRC.indexOf("Account");
  const scrollIdx = SRC.indexOf("<KeyboardAwareScrollViewCompat");
  assert.ok(headerIdx > 0 && scrollIdx > headerIdx, "scroll starts after Account header");
});

test("Account scroll content pads past the bottom safe area", () => {
  assert.match(SRC, /paddingBottom:\s*Math\.max\(\s*insets\.bottom/);
  assert.match(SRC, /keyboardShouldPersistTaps=["']handled["']/);
});

test("Sign out clears session and routes to sign-in", () => {
  const handlerStart = SRC.indexOf("await unregisterCurrentPushToken");
  assert.ok(handlerStart > 0, "expected push-token detach in Sign out handler");
  const handlerEnd = SRC.indexOf("accessibilityLabel=\"Sign out\"", handlerStart);
  assert.ok(handlerEnd > handlerStart, "expected Sign out accessibility label after handler");
  const signOutBlock = SRC.slice(handlerStart, handlerEnd);

  assert.match(signOutBlock, /await\s+signOut\s*\(\s*\)/);
  assert.match(signOutBlock, /router\.replace\(\s*["']\/sign-in["']\s*\)/);
  assert.doesNotMatch(signOutBlock, /router\.replace\(\s*["']\/["']\s*\)/);
});
