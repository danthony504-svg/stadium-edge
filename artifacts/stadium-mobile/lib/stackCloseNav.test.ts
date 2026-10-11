/**
 * Regression: locked premium screens (Notifications paywall, Fantasy, Weather, Props,
 * Simulator, Edge Lock, Steals, Model Report) must expose an Account/Plans-style Close
 * that returns to the previous screen — never trap Free users with no exit control.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { closeStackOrHome } from "./stackCloseNav.ts";

test("closeStackOrHome prefers router.back when history exists", () => {
  const calls: string[] = [];
  closeStackOrHome({
    canGoBack: () => true,
    back: () => calls.push("back"),
    replace: () => calls.push("replace"),
  });
  assert.deepEqual(calls, ["back"]);
});

test("closeStackOrHome falls back to Discover without remounting the app", () => {
  const calls: string[] = [];
  closeStackOrHome({
    canGoBack: () => false,
    back: () => calls.push("back"),
    replace: (href) => calls.push(`replace:${href}`),
  });
  assert.deepEqual(calls, ["replace:/"]);
});

test("PremiumFeatureGate locked UI wires Close via closeStackOrHome", () => {
  const src = readFileSync(join(process.cwd(), "components/PremiumFeatureGate.tsx"), "utf8");

  assert.match(src, /import\s*\{\s*closeStackOrHome\s*\}\s*from\s*"@\/lib\/stackCloseNav"/);
  assert.match(src, /accessibilityLabel=["']Close["']/);
  assert.match(src, /onPress=\{\(\)\s*=>\s*closeStackOrHome\(router\)\}/);
  assert.match(src, /name=["']x["']/);

  // Close must live on the locked branch (after !allowed), not only inside children.
  const allowedIdx = src.indexOf("if (allowed) return <>{children}</>");
  assert.ok(allowedIdx > 0, "expected allowed early return");
  const locked = src.slice(allowedIdx);
  assert.match(locked, /accessibilityLabel=["']Close["']/);
  assert.match(locked, /closeStackOrHome\(router\)/);
});

test("unlocked Notifications still keeps its own Close control for subscribed/admin", () => {
  const src = readFileSync(join(process.cwd(), "app/notifications.tsx"), "utf8");
  assert.match(src, /<PremiumFeatureGate\s+featureId=["']notifications["']>/);
  assert.match(src, /accessibilityLabel=["']Close["']/);
  assert.match(
    src,
    /onPress=\{\(\)\s*=>\s*\(router\.canGoBack\(\)\s*\?\s*router\.back\(\)\s*:\s*router\.replace\(["']\/["']\)\)\}/,
  );
});

test("locked premium destinations all wrap with PremiumFeatureGate (inherit Close)", () => {
  const gated = [
    ["app/notifications.tsx", "notifications"],
    ["app/(tabs)/fantasy.tsx", "fantasy"],
    ["app/(tabs)/weather.tsx", "weather"],
    ["app/(tabs)/props.tsx", "props"],
    ["app/(tabs)/simulator.tsx", "simulator"],
    ["app/(tabs)/arbitrage.tsx", "edge_lock"],
    ["app/(tabs)/steals.tsx", "steals"],
    ["app/(tabs)/report.tsx", "model_report"],
  ] as const;

  for (const [rel, featureId] of gated) {
    const src = readFileSync(join(process.cwd(), rel), "utf8");
    assert.match(
      src,
      new RegExp(`<PremiumFeatureGate\\s+featureId=["']${featureId}["']>`),
      `${rel} must wrap with PremiumFeatureGate featureId=${featureId}`,
    );
  }
});
