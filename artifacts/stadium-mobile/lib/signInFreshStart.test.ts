import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  freshSignInLocalState,
  shouldArmSecondFactor,
  shouldShowVerifyScreen,
} from "./signInFreshStart.ts";

const INCORRECT = "Incorrect verification code";

type TicketResult =
  | { ok: true; ticket: string }
  | { ok: false; reason: "unavailable" | "rejected" | "network" };

/** Mirrors sign-in handleVerify ticket-then-Clerk branching (no secrets). */
async function simulateVerify(opts: {
  emailAddress: string;
  code: string;
  requestTicket: (email: string, code: string) => Promise<TicketResult>;
  clerkOtpOk: boolean;
  ticketSignInOk?: boolean;
}): Promise<{
  outcome: "home" | "error";
  message?: string;
  postedEmail?: string;
}> {
  let postedEmail: string | undefined;
  const review = await opts.requestTicket(opts.emailAddress, opts.code);
  postedEmail = opts.emailAddress;
  if (review.ok) {
    if (opts.ticketSignInOk !== false) {
      return { outcome: "home", postedEmail };
    }
    return {
      outcome: "error",
      message: "Couldn't finish App Review sign-in. Please try again.",
      postedEmail,
    };
  }
  if (opts.clerkOtpOk) return { outcome: "home", postedEmail };
  return { outcome: "error", message: INCORRECT, postedEmail };
}

describe("sign-in fresh start / MFA gate", () => {
  it("stale needs_second_factor on route entry → email/password screen", () => {
    const fresh = freshSignInLocalState();
    assert.equal(fresh.awaitingSecondFactor, false);
    assert.equal(
      shouldShowVerifyScreen(fresh.awaitingSecondFactor, "needs_second_factor"),
      false,
    );
  });

  it("stale needs_client_trust on route entry → email/password screen", () => {
    const fresh = freshSignInLocalState();
    assert.equal(
      shouldShowVerifyScreen(fresh.awaitingSecondFactor, "needs_client_trust"),
      false,
    );
  });

  it("fresh password submit returning needs_second_factor → Verify screen", () => {
    const status = "needs_second_factor";
    assert.equal(shouldArmSecondFactor(status), true);
    const awaiting = shouldArmSecondFactor(status);
    assert.equal(shouldShowVerifyScreen(awaiting, status), true);
  });

  it("fresh password submit returning needs_client_trust → Verify screen", () => {
    const status = "needs_client_trust";
    assert.equal(shouldArmSecondFactor(status), true);
    assert.equal(shouldShowVerifyScreen(true, status), true);
  });

  it("current email survives MFA transition and is sent to requestAppReviewTicket", async () => {
    const emailAddress = "review-user@example.com";
    // Stale clerk status alone must not show Verify
    assert.equal(shouldShowVerifyScreen(false, "needs_second_factor"), false);

    // After this visit's credential submit arms the gate, email is unchanged
    const awaiting = shouldArmSecondFactor("needs_second_factor");
    assert.equal(shouldShowVerifyScreen(awaiting, "needs_second_factor"), true);

    let seenEmail = "";
    const out = await simulateVerify({
      emailAddress,
      code: "000000",
      requestTicket: async (email) => {
        seenEmail = email;
        return { ok: false, reason: "rejected" };
      },
      clerkOtpOk: false,
    });
    assert.equal(seenEmail, emailAddress);
    assert.equal(out.postedEmail, emailAddress);
  });

  it("wrong review code still shows Incorrect verification code", async () => {
    const out = await simulateVerify({
      emailAddress: "review-user@example.com",
      code: "wrong",
      requestTicket: async () => ({ ok: false, reason: "rejected" }),
      clerkOtpOk: false,
    });
    assert.equal(out.outcome, "error");
    assert.equal(out.message, INCORRECT);
  });

  it("successful review ticket still completes sign-in", async () => {
    const out = await simulateVerify({
      emailAddress: "review-user@example.com",
      code: "ok-code",
      requestTicket: async (email, code) => {
        assert.equal(email, "review-user@example.com");
        assert.ok(code.length > 0);
        return { ok: true, ticket: "ticket_test" };
      },
      clerkOtpOk: false,
      ticketSignInOk: true,
    });
    assert.deepEqual(
      { outcome: out.outcome, postedEmail: out.postedEmail },
      { outcome: "home", postedEmail: "review-user@example.com" },
    );
  });

  it("freshSignInLocalState clears email, code, formError, and second-factor arm", () => {
    const fresh = freshSignInLocalState();
    assert.deepEqual(fresh, {
      emailAddress: "",
      code: "",
      formError: "",
      awaitingSecondFactor: false,
      mode: "signin",
    });
  });
});
