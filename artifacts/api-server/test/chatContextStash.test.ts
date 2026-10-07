import assert from "node:assert/strict";
import test from "node:test";
import {
  getChatContextStash,
  putChatContextStash,
  resolveChatRequestContext,
} from "../src/lib/chatContextStash.ts";

test("chat context stash round-trips until TTL", () => {
  putChatContextStash("build-123", { realOdds: [{ game: "A @ B" }] });
  const ctx = getChatContextStash("build-123");
  assert.ok(ctx);
  assert.equal(Array.isArray((ctx as { realOdds?: unknown[] }).realOdds), true);
  assert.ok(getChatContextStash("build-123"));
});

test("missing stash returns null", () => {
  assert.equal(getChatContextStash("missing-id"), null);
});

test("resolveChatRequestContext prefers stash over empty inline (large-build path)", () => {
  putChatContextStash("stash-live-board", {
    realProps: [
      {
        player: "Ashton Jeanty",
        sport: "nfl",
        team: "Las Vegas Raiders",
        market: "player_rush_yds",
        line: 72.5,
      },
    ],
    realOdds: [{ game: "Las Vegas Raiders @ Denver Broncos", sport: "nfl" }],
    fightAnalysis: { "A @ B": { eventId: "ufc-1" } },
    tennisAnalysis: { "X @ Y": { eventId: "ten-1" } },
  });

  // Mobile omits inline context when contextStashId is set.
  const resolved = resolveChatRequestContext({
    inlineContext: undefined,
    contextStashId: "stash-live-board",
  });
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  assert.equal(resolved.fromStash, true);
  assert.ok(resolved.context);
  assert.equal(
    (resolved.context!.realProps as unknown[]).length,
    1,
  );
  assert.ok(resolved.context!.fightAnalysis);
  assert.ok(resolved.context!.tennisAnalysis);
  // Caller must assign this to lockedContext — prove the stash is the live board.
  const lockedContext = resolved.context;
  assert.equal(
    (lockedContext!.realProps as Array<{ player?: string }>)[0]?.player,
    "Ashton Jeanty",
  );
});

test("resolveChatRequestContext returns expired when stash missing", () => {
  const resolved = resolveChatRequestContext({
    inlineContext: { realProps: [] },
    contextStashId: "never-stored",
  });
  assert.equal(resolved.ok, false);
  if (resolved.ok) return;
  assert.equal(resolved.reason, "expired");
});

test("resolveChatRequestContext uses inline when no stash id", () => {
  const inline = { realGames: [{ game: "A @ B" }] };
  const resolved = resolveChatRequestContext({
    inlineContext: inline,
    contextStashId: null,
  });
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  assert.equal(resolved.fromStash, false);
  assert.equal(resolved.context, inline);
});
