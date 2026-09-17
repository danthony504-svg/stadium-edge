import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PROMO_SEED,
  checkPromoRedeemWindow,
  computePromoUnlock,
  isUnlockActive,
  normalizePromoCode,
  promoFailMessage,
} from "../src/lib/promoRedeem.ts";

const DAY = 24 * 60 * 60 * 1000;

test("normalizePromoCode uppercases and strips spaces", () => {
  assert.equal(normalizePromoCode("  ab cd  "), "ABCD");
  assert.equal(normalizePromoCode(null), "");
});

test("seed catalog includes lifetime and flash codes", () => {
  const codes = DEFAULT_PROMO_SEED.map((c) => c.code);
  assert.ok(codes.includes("7VXHVPOR"));
  assert.ok(codes.includes("6EUSDWFI"));
  const flash = DEFAULT_PROMO_SEED.find((c) => c.code === "6EUSDWFI")!;
  assert.equal(flash.maxRedemptions, 500);
  assert.equal(flash.kind, "days");
});

test("computePromoUnlock lifetime / days / until", () => {
  const now = Date.parse("2026-09-17T12:00:00Z");
  const life = computePromoUnlock(
    {
      code: "7VXHVPOR",
      kind: "lifetime",
      label: "VIP",
      active: true,
    },
    now,
  );
  assert.equal(life.ok, true);
  if (life.ok) {
    assert.equal(life.unlock.lifetime, true);
    assert.equal(isUnlockActive(life.unlock, now + 400 * DAY), true);
  }

  const week = computePromoUnlock(
    {
      code: "KFXD4X2B",
      kind: "days",
      days: 7,
      label: "7d",
      active: true,
    },
    now,
  );
  assert.equal(week.ok, true);
  if (week.ok) {
    assert.equal(week.unlock.expiresAtMs, now + 7 * DAY);
    assert.equal(isUnlockActive(week.unlock, now + 8 * DAY), false);
  }

  const until = computePromoUnlock(
    {
      code: "8VZV43WK",
      kind: "until",
      unlockUntilMs: Date.parse("2027-01-01T00:00:00Z"),
      label: "season",
      active: true,
    },
    now,
  );
  assert.equal(until.ok, true);
  if (until.ok) {
    assert.equal(until.unlock.expiresAtMs, Date.parse("2027-01-01T00:00:00Z"));
  }
});

test("flash redeem window rejects early and late", () => {
  const flash = DEFAULT_PROMO_SEED.find((c) => c.code === "6EUSDWFI")!;
  assert.equal(
    checkPromoRedeemWindow(flash, Date.parse("2026-09-16T12:00:00Z")),
    "not_yet",
  );
  assert.equal(
    checkPromoRedeemWindow(flash, Date.parse("2026-09-20T12:00:00Z")),
    null,
  );
  assert.equal(
    checkPromoRedeemWindow(flash, Date.parse("2026-10-18T00:00:00Z")),
    "redeem_expired",
  );
  assert.match(promoFailMessage("limit_reached"), /limit/i);
});
