import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { focalSportsFromText } from "./chatContextPriority.ts";
import {
  detectCoachTicketStyle,
  resolveCoachTicketStyle,
} from "./coachTicketQualityTiers.ts";
import {
  homeShortcutCoachAsk,
  homeShortcutTicketStyle,
  resolveHomeShortcut,
} from "./homeShortcuts.ts";
import {
  markCoachHomeLaunch,
  resetCoachLaunchForTests,
  takeCoachLaunch,
} from "./coachSilentLaunch.ts";

test("home shortcuts all open Coach all-sports with explicit ticketStyle (no Home sport)", () => {
  const hot = resolveHomeShortcut("hot_picks");
  assert.equal(hot.kind, "coach");
  assert.equal(hot.ticketStyle, "balanced");
  assert.match(hot.autoMsg, /balanced/i);
  assert.match(hot.autoMsg, /across tonight's board/i);
  assert.equal(hot.silent, true);
  assert.equal(focalSportsFromText(hot.autoMsg).size, 0);
  assert.equal(detectCoachTicketStyle(hot.autoMsg), "balanced");
  assert.equal(resolveCoachTicketStyle(hot.ticketStyle, "ignored lottery text"), "balanced");

  const easy = resolveHomeShortcut("easy_money");
  assert.equal(easy.kind, "coach");
  assert.equal(easy.ticketStyle, "safe");
  assert.match(easy.autoMsg, /safe|lower-risk/i);
  assert.equal(focalSportsFromText(easy.autoMsg).size, 0);
  assert.equal(detectCoachTicketStyle(easy.autoMsg), "safe");

  const value = resolveHomeShortcut("best_value");
  assert.equal(value.kind, "coach");
  assert.equal(value.ticketStyle, "value");
  assert.match(value.autoMsg, /value|positive-EV/i);
  assert.equal(focalSportsFromText(value.autoMsg).size, 0);
  assert.equal(homeShortcutTicketStyle("best_value"), "value");
  assert.equal(resolveCoachTicketStyle(value.ticketStyle, "safe chalk lock"), "value");

  const long = resolveHomeShortcut("longshots");
  assert.equal(long.kind, "coach");
  assert.equal(long.ticketStyle, "longshot");
  assert.match(long.autoMsg, /lottery|longshot/i);
  assert.equal(focalSportsFromText(long.autoMsg).size, 0);
  assert.equal(detectCoachTicketStyle(long.autoMsg), "longshot");
});

test("Home shortcut asks do not embed NFL/MLB/CFB sport tokens from Home pill", () => {
  for (const id of ["hot_picks", "easy_money", "best_value", "longshots"] as const) {
    const ask = homeShortcutCoachAsk(id);
    assert.doesNotMatch(ask, /\bNFL\b|\bMLB\b|\bCFB\b|\bNBA\b|\bNHL\b/i);
    assert.equal(focalSportsFromText(ask).size, 0);
  }
});

test("typed Coach sport asks still resolve focal sports", () => {
  assert.ok(focalSportsFromText("Build me an NFL parlay for tonight").has("nfl"));
  assert.ok(focalSportsFromText("lottery longshot MLB parlay").has("mlb"));
});

test("Best Value and Longshots never route to Props or Steals", () => {
  for (const id of ["best_value", "longshots"] as const) {
    const dest = resolveHomeShortcut(id);
    assert.equal(dest.kind, "coach");
    assert.notEqual((dest as { pathname?: string }).pathname, "/props");
    assert.notEqual((dest as { pathname?: string }).pathname, "/steals");
  }
});

test("coach silent launch queues autoMsg + ticketStyle so param drops cannot kill Home taps", () => {
  resetCoachLaunchForTests();
  markCoachHomeLaunch({
    autoMsg: homeShortcutCoachAsk("best_value"),
    hideBubble: true,
    ticketStyle: "value",
  });
  const launch = takeCoachLaunch();
  assert.ok(launch);
  assert.equal(launch!.freshThread, true);
  assert.equal(launch!.hideBubble, true);
  assert.equal(launch!.ticketStyle, "value");
  assert.match(String(launch!.autoMsg), /value|positive-EV/i);
  assert.equal(takeCoachLaunch(), null);
});

test("Home quick actions call runHomeShortcut without sport and pass ticketStyle", () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../app/(tabs)/index.tsx"),
    "utf8",
  );
  assert.match(src, /runHomeShortcut\("hot_picks"\)/);
  assert.match(src, /runHomeShortcut\("easy_money"\)/);
  assert.match(src, /runHomeShortcut\("best_value"\)/);
  assert.match(src, /runHomeShortcut\("longshots"\)/);
  assert.match(src, /resolveHomeShortcut\(id\)/);
  assert.doesNotMatch(src, /resolveHomeShortcut\(id,\s*sport\)/);
  assert.match(src, /ticketStyle:\s*ticketStyle/);
  assert.match(src, /askCoach\(dest\.autoMsg,\s*dest\.silent,\s*dest\.ticketStyle\)/);
});

test("Coach consumes autoMsg + ticketStyle via takeCoachLaunch and auto-sends once", () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../app/(tabs)/coach.tsx"),
    "utf8",
  );
  assert.match(src, /takeCoachLaunch\(\)/);
  assert.match(src, /ticketStyleRef/);
  assert.match(src, /ticketStyle:\s*explicitTicketStyle/);
  assert.match(src, /params\.ticketStyle/);
});

test("buildCoachParlay accepts explicit ticketStyle", () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "./coach/buildParlay.ts"),
    "utf8",
  );
  assert.match(src, /ticketStyle\?:\s*CoachTicketStyle/);
  assert.match(src, /resolveCoachTicketStyle\(opts\.ticketStyle/);
});
