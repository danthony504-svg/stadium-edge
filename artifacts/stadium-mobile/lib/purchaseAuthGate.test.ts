import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isBillingAuthBlocked,
  resolveBillingAuth,
  shouldUnlockFromServerVerify,
} from "./purchaseAuthGate.ts";

describe("purchaseAuthGate", () => {
  it("blocks purchase/restore while auth is loading", () => {
    const r = resolveBillingAuth({
      authLoaded: false,
      isSignedIn: false,
      userId: null,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "auth_loading");
    assert.equal(
      isBillingAuthBlocked({ authLoaded: false, isSignedIn: true, userId: "user_1" }),
      true,
    );
  });

  it("blocks logged-out purchase attempts (needs sign-in)", () => {
    const r = resolveBillingAuth({
      authLoaded: true,
      isSignedIn: false,
      userId: null,
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, "signed_out");
      assert.match(r.message, /sign in/i);
    }
  });

  it("blocks signed-in sessions without a Clerk user id", () => {
    const r = resolveBillingAuth({
      authLoaded: true,
      isSignedIn: true,
      userId: "   ",
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "missing_user_id");
  });

  it("allows billing only with loaded auth + Clerk user id", () => {
    const r = resolveBillingAuth({
      authLoaded: true,
      isSignedIn: true,
      userId: "user_abc",
    });
    assert.deepEqual(r, { ok: true, userId: "user_abc" });
    assert.equal(
      isBillingAuthBlocked({
        authLoaded: true,
        isSignedIn: true,
        userId: "user_abc",
      }),
      false,
    );
  });

  it("unlocks premium UI only after server-verified Go/Pro", () => {
    assert.equal(
      shouldUnlockFromServerVerify({
        ok: true,
        storeKitActive: true,
        planId: "go",
      }),
      true,
    );
    assert.equal(
      shouldUnlockFromServerVerify({
        ok: true,
        storeKitActive: true,
        planId: "pro",
      }),
      true,
    );
    assert.equal(
      shouldUnlockFromServerVerify({
        ok: true,
        storeKitActive: true,
        planId: "free",
      }),
      false,
    );
    assert.equal(
      shouldUnlockFromServerVerify({
        ok: false,
        storeKitActive: true,
        planId: "go",
      }),
      false,
    );
    assert.equal(
      shouldUnlockFromServerVerify({
        ok: true,
        storeKitActive: false,
        planId: "go",
      }),
      false,
    );
  });

  it("treats expired / inactive server entitlement as locked", () => {
    assert.equal(
      shouldUnlockFromServerVerify({
        ok: true,
        storeKitActive: false,
        planId: null,
      }),
      false,
    );
  });
});
