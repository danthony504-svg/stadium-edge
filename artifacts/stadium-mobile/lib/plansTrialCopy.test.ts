/**
 * Trial copy honesty — never promise a 7-day trial unless StoreKit reports
 * a free introductory offer (hasFreeTrial).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { planCatalogNote as planNote } from "./planCatalogCopy.ts";

describe("plans trial copy honesty", () => {
  it("does not mention free trial when StoreKit reports no intro offer", () => {
    const note = planNote(
      "go",
      {
        go: { priceString: "$9.99", hasFreeTrial: false, freeTrialDays: null },
        pro: null,
      },
      "Billed through Apple · $9.99/week",
    );
    assert.doesNotMatch(note, /free trial/i);
    assert.match(note, /\$9\.99/);
  });

  it("mentions trial days only when hasFreeTrial is true", () => {
    const note = planNote(
      "go",
      {
        go: { priceString: "$9.99", hasFreeTrial: true, freeTrialDays: 7 },
        pro: null,
      },
      "fallback",
    );
    assert.match(note, /7-day free trial/i);
  });

  it("uses StoreKit-reported trial length, not a hard-coded promise for ineligible users", () => {
    const note = planNote(
      "pro",
      {
        go: null,
        pro: { priceString: "$29.99", hasFreeTrial: true, freeTrialDays: 3 },
      },
      "fallback",
    );
    assert.match(note, /3-day free trial/i);
    assert.doesNotMatch(note, /7-day/);
  });
});

it("never invents seven days when the actual offer duration is unavailable", () => {
  const note = planNote("go", { go: { priceString: "$9.99", hasFreeTrial: true, freeTrialDays: null }, pro: null }, "fallback");
  assert.doesNotMatch(note, /7-day/); assert.match(note, /eligible accounts/); assert.match(note, /checkout/);
});
