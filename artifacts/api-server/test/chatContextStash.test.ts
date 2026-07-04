import assert from "node:assert/strict";
import test from "node:test";
import { getChatContextStash, putChatContextStash } from "../src/lib/chatContextStash.ts";

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
