import assert from "node:assert/strict";
import test from "node:test";
import { parseRevenueCatSubscriberPayload } from "../src/lib/revenueCatSubscriber.ts";

const NOW = Date.parse("2026-10-13T03:00:00Z");
const go = "com.stadiumedge.app.go.weekly";
const pro = "com.stadiumedge.app.pro.monthly";
const future = new Date(NOW + 60_000).toISOString();

test("restore rejects expired, boundary, invalid and missing subscription expiration", () => {
  for (const expires_date of [new Date(NOW - 1).toISOString(), new Date(NOW).toISOString(), "invalid", null, undefined]) {
    const result = parseRevenueCatSubscriberPayload({ subscriber: {
      entitlements: { pro: { expires_date: new Date(NOW - 1).toISOString(), product_identifier: pro } },
      subscriptions: { [pro]: { expires_date } },
    } }, NOW);
    assert.deepEqual(result, { ok: false, reason: "inactive" });
  }
});

test("expired Pro cannot upgrade an active Go subscription", () => {
  const result = parseRevenueCatSubscriberPayload({ subscriber: { subscriptions: {
    [pro]: { expires_date: new Date(NOW - 1).toISOString() },
    [go]: { expires_date: future },
  } } }, NOW);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.planId, "go");
    assert.deepEqual(result.productIds, [go]);
    assert.equal(result.productId, go);
  }
});

test("cancelled subscription retains access until paid expiration", () => {
  const result = parseRevenueCatSubscriberPayload({ subscriber: { subscriptions: {
    [go]: { expires_date: future, unsubscribe_detected_at: new Date(NOW - 1).toISOString() },
  } } }, NOW);
  assert.equal(result.ok, true);
});

test("active Pro wins regardless of subscription insertion order", () => {
  for (const ids of [[go, pro], [pro, go]]) {
    const result = parseRevenueCatSubscriberPayload({ subscriber: {
      subscriptions: Object.fromEntries(ids.map(id => [id, { expires_date: future }])),
    } }, NOW);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.planId, "pro");
  }
});
