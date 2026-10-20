import test from "node:test";
import assert from "node:assert/strict";
import { sendPush } from "../src/lib/push.js";
const messages = Array.from({ length: 3 }, (_, i) => ({
  to: `ExpoPushToken[test-${i}]`,
  title: "Fixture",
  body: "Never delivered: mocked fetch",
}));
test("Expo acceptance, explicit rejection and missing tickets remain distinct", async () => {
  const old = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    assert.ok(init?.signal);
    return Response.json({
      data: [
        { status: "ok" },
        { status: "error", details: { error: "DeviceNotRegistered" } },
      ],
    });
  };
  try {
    const r = await sendPush(messages);
    assert.deepEqual(r, {
      sent: 1,
      invalidTokens: [messages[1]!.to],
      accepted: [0],
      rejected: [1],
      unknown: [2],
    });
  } finally {
    globalThis.fetch = old;
  }
});
test("transport loss is unknown; explicit rate limiting is retryable", async () => {
  const old = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      throw Error("fixture transport loss");
    };
    const lost = await sendPush(messages);
    assert.deepEqual(lost.unknown, [0, 1, 2]);
    assert.deepEqual(lost.rejected, []);
    globalThis.fetch = async () =>
      new Response("rate limited", { status: 429 });
    const throttled = await sendPush(messages);
    assert.deepEqual(throttled.rejected, [0, 1, 2]);
    assert.deepEqual(throttled.unknown, []);
  } finally {
    globalThis.fetch = old;
  }
});
test("chunk results retain global message indices", async () => {
  const old = globalThis.fetch;
  globalThis.fetch = async (_url, init) =>
    Response.json({
      data: JSON.parse(String(init?.body)).map(() => ({ status: "ok" })),
    });
  try {
    const r = await sendPush(Array.from({ length: 101 }, () => messages[0]!));
    assert.equal(r.sent, 101);
    assert.equal(r.accepted[100], 100);
  } finally {
    globalThis.fetch = old;
  }
});
