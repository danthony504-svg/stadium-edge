import { Router, type IRouter } from "express";
import { clerkClient } from "@clerk/express";
import { rateLimit } from "../lib/sports";
import { logger } from "../lib/logger";
import {
  matchesAppReviewCredentials,
  normalizeReviewCode,
  normalizeReviewEmail,
  readAppReviewEnv,
} from "../lib/appReviewAuth";

/**
 * POST /auth/app-review-ticket
 *
 * App Review–only path: when Apple enters the fixed review verification code
 * for the designated demo account, mint a Clerk sign-in ticket so they can
 * finish sign-in without a temporary emailed OTP.
 *
 * - Does not disable auth globally
 * - Does not bypass verification for other emails
 * - Credential check is server-side (APP_REVIEW_EMAIL / APP_REVIEW_CODE)
 * - Response never includes passwords; logs never include codes or tickets
 */

const ticketLimiter = rateLimit({
  windowMs: 60_000,
  max: 12,
  name: "app-review-ticket",
});

/** Temporary probe — max 3/hour. Remove after App Review verification. */
const selfcheckLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: 3,
  name: "app-review-selfcheck",
});

const router: IRouter = Router();

/**
 * POST /auth/app-review-selfcheck
 *
 * TEMPORARY production probe. Does not accept email/code from the client.
 * When APP_REVIEW_SELFCHECK=1, reads APP_REVIEW_EMAIL / APP_REVIEW_CODE from
 * the server env, mints a Clerk ticket the same way as the real route, then
 * discards it. Response is only PASS / FAIL + status — never email, code, or
 * ticket. Does not change login behavior. Disable by unsetting
 * APP_REVIEW_SELFCHECK (or set ≠ 1); delete this route after verification.
 */
router.post("/auth/app-review-selfcheck", selfcheckLimiter, async (req, res) => {
  if ((process.env.APP_REVIEW_SELFCHECK ?? "").trim() !== "1") {
    res.status(404).json({ result: "FAIL", status: 404 });
    return;
  }

  const configured = readAppReviewEnv();
  if (!configured) {
    res.status(200).json({ result: "FAIL", status: 404 });
    return;
  }

  try {
    const list = await clerkClient.users.getUserList({
      emailAddress: [configured.email],
      limit: 1,
    });
    const user = list.data?.[0];
    if (!user?.id) {
      logger.info(
        { path: "app-review-selfcheck", outcome: "user_missing" },
        "app review selfcheck: review user missing",
      );
      res.status(200).json({ result: "FAIL", status: 404 });
      return;
    }

    const signInToken = await clerkClient.signInTokens.createSignInToken({
      userId: user.id,
      expiresInSeconds: 60,
    });
    // Intentionally discard the token — never put it in the response or logs.
    if (!signInToken.token) {
      res.status(200).json({ result: "FAIL", status: 502 });
      return;
    }

    logger.info(
      { path: "app-review-selfcheck", outcome: "pass", userId: user.id },
      "app review selfcheck: PASS (ticket minted and discarded)",
    );
    res.status(200).json({ result: "PASS" });
  } catch (err) {
    logger.error(
      { err, path: "app-review-selfcheck", outcome: "error" },
      "app review selfcheck: failed",
    );
    res.status(200).json({ result: "FAIL", status: 500 });
  }
});

router.post("/auth/app-review-ticket", ticketLimiter, async (req, res) => {
  const configured = readAppReviewEnv();
  const email = normalizeReviewEmail(
    typeof req.body?.email === "string" ? req.body.email : "",
  );
  const code = typeof req.body?.code === "string" ? req.body.code : "";
  const codeNormalized = normalizeReviewCode(code);

  // TEMPORARY safe diagnostics — booleans + status only. Remove after Build 78 triage.
  // Never log email, domain, codes, tickets, or env values.
  const emailPresent = email.length > 0;
  const codePresent = codeNormalized.length > 0;
  const emailMatchesConfiguredReviewEmail = !!(
    configured && emailPresent && email === configured.email
  );
  const codeMatchesConfiguredReviewCode = !!(
    configured && codePresent && codeNormalized === configured.code
  );
  const logTicketDiag = (finalHttpStatus: number) => {
    logger.info(
      {
        path: "app-review-ticket",
        emailPresent,
        emailMatchesConfiguredReviewEmail,
        codePresent,
        codeMatchesConfiguredReviewCode,
        finalHttpStatus,
      },
      "app-review-ticket request received",
    );
  };

  if (!configured) {
    // Path not configured — fail closed without revealing whether the feature exists.
    logTicketDiag(404);
    res.status(404).json({ error: "not available" });
    return;
  }

  if (!email || !code) {
    logTicketDiag(400);
    res.status(400).json({ error: "email and code required" });
    return;
  }

  if (!matchesAppReviewCredentials(email, code, configured)) {
    // Same generic response for wrong email or wrong code — no account oracle.
    logTicketDiag(401);
    res.status(401).json({ error: "invalid credentials" });
    return;
  }

  try {
    const list = await clerkClient.users.getUserList({
      emailAddress: [configured.email],
      limit: 1,
    });
    const user = list.data?.[0];
    if (!user?.id) {
      logger.warn(
        { path: "app-review-ticket", outcome: "user_missing" },
        "app review ticket: designated review user not found in Clerk",
      );
      logTicketDiag(404);
      res.status(404).json({ error: "review account not found" });
      return;
    }

    // Short-lived ticket for a single client sign-in completion.
    const signInToken = await clerkClient.signInTokens.createSignInToken({
      userId: user.id,
      expiresInSeconds: 60 * 10,
    });
    const ticket = signInToken.token;
    if (!ticket) {
      logger.error(
        { path: "app-review-ticket", outcome: "token_empty", userId: user.id },
        "app review ticket: Clerk returned empty token",
      );
      logTicketDiag(502);
      res.status(502).json({ error: "could not mint ticket" });
      return;
    }

    logger.info(
      {
        path: "app-review-ticket",
        outcome: "issued",
        userId: user.id,
        tokenId: signInToken.id,
        expiresInSeconds: 60 * 10,
      },
      "app review ticket: issued for designated review account",
    );

    logTicketDiag(200);
    res.json({ ok: true, ticket });
  } catch (err) {
    logger.error(
      { err, path: "app-review-ticket", outcome: "error" },
      "app review ticket: failed",
    );
    logTicketDiag(500);
    res.status(500).json({ error: "ticket failed" });
  }
});

export default router;
