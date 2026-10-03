import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  EXPLICIT_MARKET_LOCK_RULES,
  matchExplicitMarketLocks,
} from "../src/lib/explicitMarketLock.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("api-server explicitMarketLock matches stadium-mobile copy", () => {
  const api = readFileSync(join(root, "src/lib/explicitMarketLock.ts"), "utf8");
  const mobile = readFileSync(
    join(root, "../stadium-mobile/lib/explicitMarketLock.ts"),
    "utf8",
  );
  assert.equal(api, mobile);
});

test("chat route uses shared EXPLICIT_MARKET_LOCK_RULES", () => {
  const chat = readFileSync(join(root, "src/routes/chat.ts"), "utf8");
  assert.match(chat, /EXPLICIT_MARKET_LOCK_RULES/);
  assert.match(chat, /from ["'].*explicitMarketLock/);
  // Inline MARKET_KEYWORDS catalog must not be reintroduced.
  assert.doesNotMatch(chat, /const MARKET_KEYWORDS:\s*Array<\{ re: RegExp; markets: string\[]; label: string \}>\s*=\s*\[/);
});

test("shared lock covers required families and precedence", () => {
  assert.ok(EXPLICIT_MARKET_LOCK_RULES.length >= 20);

  const sb = matchExplicitMarketLocks("5 leg SB");
  assert.deepEqual(sb?.allowedMarketKeys, ["batter_stolen_bases"]);

  const steals = matchExplicitMarketLocks("5 leg steals");
  assert.deepEqual(steals?.allowedMarketKeys, ["player_steals"]);

  const sot = matchExplicitMarketLocks("SOT props");
  assert.deepEqual(sot?.allowedMarketKeys, ["player_shots_on_target"]);

  const ks = matchExplicitMarketLocks("5 leg Ks");
  assert.deepEqual(ks?.allowedMarketKeys, ["pitcher_strikeouts"]);

  const blocks = matchExplicitMarketLocks("NBA blocks");
  assert.deepEqual(blocks?.allowedMarketKeys, ["player_blocks"]);

  const hr = matchExplicitMarketLocks("3 leg home runs");
  assert.deepEqual(hr?.allowedMarketKeys, ["batter_home_runs"]);
});
