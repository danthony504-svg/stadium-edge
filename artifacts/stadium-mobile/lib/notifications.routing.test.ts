import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { routeForNotificationData } from "./notificationsRouting.ts";

test("routeForNotificationData maps backend notification types", () => {
  assert.equal(routeForNotificationData({ type: "dailyPicks" }), "/props");
  assert.equal(routeForNotificationData({ type: "upsetAlert" }), "/");
  assert.equal(routeForNotificationData({ type: "edgeLock" }), "/arbitrage");
  assert.equal(routeForNotificationData({ type: "coachReady" }), "/coach");
  assert.equal(
    routeForNotificationData({ type: "coachReady", buildId: "abc 1" }),
    "/coach?buildId=abc%201",
  );
  assert.equal(routeForNotificationData({ type: "unknown" }), "/");
  assert.equal(routeForNotificationData(undefined), "/");
});

test("app.json expo-notifications plugin sets production aps mode", () => {
  const appJson = JSON.parse(readFileSync(join(process.cwd(), "app.json"), "utf8"));
  const plugins = appJson.expo.plugins as unknown[];
  const notif = plugins.find(
    (p) => Array.isArray(p) && p[0] === "expo-notifications",
  ) as [string, { mode?: string }] | undefined;
  assert.ok(notif);
  assert.equal(notif![1]?.mode, "production");
});
