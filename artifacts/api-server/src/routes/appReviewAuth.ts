import { Router, type IRouter } from "express";
import { clerkClient } from "@clerk/express";
import { rateLimit } from "../lib/sports";
import { logger } from "../lib/logger";
import {
  matchesAppReviewCredentials,
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

const router: IRouter = Router();

router.post("/auth/app-review-ticket", ticketLimiter, async (req, res) => {
  const configured = readAppReviewEnv();
  if (!configured) {
    // Path not configured — fail closed without revealing whether the feature exists.
    res.status(404).json({ error: "not available" });
    return;
  }

  const email = normalizeReviewEmail(
    typeof req.body?.email === "string" ? req.body.email : "",
  );
  const code = typeof req.body?.code === "string" ? req.body.code : "";

  if (!email || !code) {
    res.status(400).json({ error: "email and code required" });
    return;
  }

  if (!matchesAppReviewCredentials(email, code, configured)) {
    // Same generic response for wrong email or wrong code — no account oracle.
    logger.info(
      { path: "app-review-ticket", outcome: "rejected", emailDomain: email.split("@")[1] ?? null },
      "app review ticket: credentials rejected",
    );
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

    res.json({ ok: true, ticket });
  } catch (err) {
    logger.error(
      { err, path: "app-review-ticket", outcome: "error" },
      "app review ticket: failed",
    );
    res.status(500).json({ error: "ticket failed" });
  }
});

export default router;
