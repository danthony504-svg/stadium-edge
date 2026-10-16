import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { detectCoachTicketStyle } from "./coachTicketQualityTiers.ts";
import {
  homeShortcutCoachAsk,
  resolveHomeShortcut,
} from "./homeShortcuts.ts";
import {
  markCoachHomeLaunch,
  resetCoachLaunchForTests,
  takeCoachLaunch,
} from "./coachSilentLaunch.ts";

test("home shortcuts resolve distinct destinations with sport preserved", () => {
  const hot = resolveHomeShortcut("hot_picks", "nfl");
  assert.equal(hot.kind, "coach");
  if (hot.kind === "coach") {
    assert.match(hot.autoMsg, /NFL/i);
    assert.match(hot.autoMsg, /best/i);
    assert.equal(hot.silent, true);
    assert.equal(detectCoachTicketStyle(hot.autoMsg), "balanced");
  }

  const easy = resolveHomeShortcut("easy_money", "nhl");
  assert.equal(easy.kind, "coach");
  if (easy.kind === "coach") {
    assert.match(easy.autoMsg, /NHL/i);
    assert.match(easy.autoMsg, /safe/i);
    assert.equal(detectCoachTicketStyle(easy.autoMsg), "safe");
  }

  const value = resolveHomeShortcut("best_value", "mlb", { propsSportSupported: true });
  assert.deepEqual(value, {
    id: "best_value",
    kind: "props",
    pathname: "/props",
    sport: "mlb",
  });

  const valueNoProps = resolveHomeShortcut("best_value", "ufc", {
    propsSportSupported: false,
  });
  assert.equal(valueNoProps.kind, "props");
  if (valueNoProps.kind === "props") assert.equal(valueNoProps.sport, null);

  const long = resolveHomeShortcut("longshots", "ncaaf");
  assert.deepEqual(long, {
    id: "longshots",
    kind: "steals",
    pathname: "/steals",
    sport: "ncaaf",
  });
});

test("coach silent launch queues autoMsg so tab param drops cannot kill Home taps", () => {
  resetCoachLaunchForTests();
  markCoachHomeLaunch({
    autoMsg: homeShortcutCoachAsk("hot_picks", "nfl"),
    hideBubble: true,
  });
  const launch = takeCoachLaunch();
  assert.ok(launch);
  assert.equal(launch!.freshThread, true);
  assert.equal(launch!.hideBubble, true);
  assert.match(String(launch!.autoMsg), /best NFL parlay/i);
  assert.equal(takeCoachLaunch(), null);
});

test("Home quick actions call runHomeShortcut (not dead Pressables)", () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../app/(tabs)/index.tsx"),
    "utf8",
  );
  assert.match(src, /runHomeShortcut\("hot_picks"\)/);
  assert.match(src, /runHomeShortcut\("easy_money"\)/);
  assert.match(src, /runHomeShortcut\("best_value"\)/);
  assert.match(src, /runHomeShortcut\("longshots"\)/);
  assert.match(src, /markCoachHomeLaunch\(\{\s*autoMsg:/);
});

test("Coach consumes autoMsg via takeCoachLaunch + send params", () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../app/(tabs)/coach.tsx"),
    "utf8",
  );
  assert.match(src, /useLocalSearchParams/);
  assert.match(src, /takeCoachLaunch\(\)/);
  assert.match(src, /autoSentRef/);
  assert.match(src, /sendRef\.current\(autoMsg\)/);
});
