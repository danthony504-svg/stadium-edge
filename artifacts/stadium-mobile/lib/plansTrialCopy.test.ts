/**
 * Trial copy honesty — never promise a 7-day trial unless StoreKit reports
 * a free introductory offer (hasFreeTrial).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

type CatalogProduct = {
  priceString: string | null;
  hasFreeTrial: boolean;
  freeTrialDays: number | null;
};

function planNote(
  planId: "go" | "pro",
  catalog: { go: CatalogProduct | null; pro: CatalogProduct | null } | null,
  fallbackNote: string,
): string {
  const row = planId === "go" ? catalog?.go : catalog?.pro;
  if (!row) return fallbackNote;
  const price = row.priceString
    ? planId === "go"
      ? `${row.priceString}/week`
      : `${row.priceString}/month`
    : planId === "go"
      ? "$9.99/week"
      : "$29.99/month";
  if (row.hasFreeTrial) {
    const days = row.freeTrialDays ?? 7;
    return `${days}-day free trial, then ${price}`;
  }
  return `Billed through Apple · ${price}`;
}

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
