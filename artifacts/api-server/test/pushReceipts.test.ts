import assert from "node:assert/strict";
import { mock, test } from "node:test";

test("fetchExpoInvalidTokensFromReceipts maps DeviceNotRegistered receipts to tokens", async () => {
  const pending = [
    { ticketId: "t-ok", token: "ExponentPushToken[alive]" },
    { ticketId: "t-dead", token: "ExponentPushToken[dead]" },
  ];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock.fn(async () => {
    return new Response(
      JSON.stringify({
        data: {
          "t-ok": { status: "ok" },
          "t-dead": {
            status: "error",
            details: { error: "DeviceNotRegistered" },
          },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as unknown as typeof fetch;

  try {
    const { fetchExpoInvalidTokensFromReceipts } = await import("../src/lib/push.ts");
    const dead = await fetchExpoInvalidTokensFromReceipts(pending);
    assert.deepEqual(dead, ["ExponentPushToken[dead]"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("scheduleExpoReceiptCheck does not invoke prune synchronously", async () => {
  const { scheduleExpoReceiptCheck } = await import("../src/lib/push.ts");
  let called = false;
  scheduleExpoReceiptCheck(
    [{ ticketId: "t1", token: "ExponentPushToken[x]" }],
    async () => {
      called = true;
    },
  );
  assert.equal(called, false);
});
