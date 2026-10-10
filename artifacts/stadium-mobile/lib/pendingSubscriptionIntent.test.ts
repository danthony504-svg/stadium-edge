import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  draftPlanFromReturnParams,
  parseSubscriptionIntent,
  parseSubscriptionIntentJson,
  plansHrefForSubscriptionIntent,
  resolveAppleAuthNavigateHref,
  resolvePostAuthHref,
  signInHrefForSubscriptionIntent,
  signInHrefPreservingReturn,
  signUpHrefPreservingReturn,
} from "./pendingSubscriptionIntent.ts";

describe("pendingSubscriptionIntent", () => {
  it("parses purchase and restore intents; rejects junk", () => {
    assert.deepEqual(parseSubscriptionIntent({ intent: "purchase", planId: "go" }), {
      intent: "purchase",
      planId: "go",
    });
    assert.deepEqual(parseSubscriptionIntent({ intent: "purchase", planId: "pro" }), {
      intent: "purchase",
      planId: "pro",
    });
    assert.deepEqual(parseSubscriptionIntent({ intent: "restore" }), {
      intent: "restore",
    });
    assert.equal(parseSubscriptionIntent({ intent: "purchase", planId: "free" }), null);
    assert.equal(parseSubscriptionIntent(null), null);
    assert.equal(parseSubscriptionIntentJson("{not json"), null);
  });

  it("builds sign-in href that preserves plan without auto-purchase flag beyond intent", () => {
    const href = signInHrefForSubscriptionIntent({ intent: "purchase", planId: "pro" });
    assert.match(href, /^\/sign-in\?/);
    assert.match(href, /returnTo=plans/);
    assert.match(href, /plan=pro/);
    assert.match(href, /intent=purchase/);
    assert.doesNotMatch(href, /autoBuy|autostart|purchaseNow/i);
  });

  it("returns to /plans with selection after auth — never home when intent present", () => {
    assert.equal(
      resolvePostAuthHref({
        returnTo: "plans",
        plan: "go",
        intent: "purchase",
        stored: null,
      }),
      "/plans?plan=go",
    );
    assert.equal(
      resolvePostAuthHref({
        returnTo: "plans",
        intent: "restore",
        stored: { intent: "restore", planId: "pro" },
      }),
      "/plans?intent=restore&plan=pro",
    );
    // Cancelled / unrelated sign-in must not hijack to Plans via stale storage.
    assert.equal(
      resolvePostAuthHref({
        returnTo: null,
        stored: { intent: "purchase", planId: "go" },
      }),
      "/",
    );
    assert.equal(resolvePostAuthHref({ returnTo: null, stored: null }), "/");
  });

  it("draft plan prefers URL then storage; cancelled sign-in leaves storage readable", () => {
    assert.equal(
      draftPlanFromReturnParams({ plan: "pro", stored: { intent: "purchase", planId: "go" } }),
      "pro",
    );
    assert.equal(
      draftPlanFromReturnParams({
        plan: null,
        stored: { intent: "purchase", planId: "go" },
        fallback: "pro",
      }),
      "go",
    );
  });

  it("plans href for restore does not encode a purchase action", () => {
    const href = plansHrefForSubscriptionIntent({ intent: "restore" });
    assert.equal(href, "/plans?intent=restore");
    assert.doesNotMatch(href, /intent=purchase/);
  });

  it("preserves return query when linking to sign-up", () => {
    assert.equal(
      signUpHrefPreservingReturn("returnTo=plans&plan=go&intent=purchase"),
      "/sign-up?returnTo=plans&plan=go&intent=purchase",
    );
    assert.equal(signUpHrefPreservingReturn(""), "/sign-up");
  });

  it("preserves return query when linking sign-up back to sign-in", () => {
    assert.equal(
      signInHrefPreservingReturn("returnTo=plans&plan=pro&intent=purchase"),
      "/sign-in?returnTo=plans&plan=pro&intent=purchase",
    );
    assert.equal(signInHrefPreservingReturn(""), "/sign-in");
  });

  it("Apple auth navigate honors Plans intent and never auto-buys", () => {
    assert.equal(
      resolveAppleAuthNavigateHref({
        returnTo: "plans",
        plan: "go",
        intent: "purchase",
        stored: null,
      }),
      "/plans?plan=go",
    );
    assert.equal(
      resolveAppleAuthNavigateHref({
        returnTo: "plans",
        plan: "pro",
        intent: "purchase",
        stored: { intent: "purchase", planId: "go" },
      }),
      "/plans?plan=pro",
    );
    const href = resolveAppleAuthNavigateHref({
      returnTo: "plans",
      intent: "restore",
      stored: { intent: "restore" },
    });
    assert.equal(href, "/plans?intent=restore");
    assert.doesNotMatch(href, /autoBuy|autostart|purchaseNow|startPurchase/i);
    // Unrelated Apple sign-in (no returnTo) must not hijack via storage alone.
    assert.equal(
      resolveAppleAuthNavigateHref({
        returnTo: null,
        stored: { intent: "purchase", planId: "pro" },
      }),
      "/",
    );
  });
});
