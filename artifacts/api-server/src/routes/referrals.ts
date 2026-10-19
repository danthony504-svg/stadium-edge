import { Router, type Request, type Response } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import { pool } from "@workspace/db";
import { rateLimit } from "../lib/sports.js";
import { logger } from "../lib/logger.js";
import {
  APP_STORE_URL,
  isNewReferralAccount,
  normalizeReferralCode,
  referralEmailHash,
  referralProgramEnabled,
  REFERRAL_MILESTONES,
} from "../lib/referralPolicy.js";
import { ReferralError, referralStore } from "../lib/referralStore.js";

const store = referralStore(pool);
const limiter = rateLimit({ windowMs: 60_000, max: 15, name: "referrals" });
const router = Router();
const apiOrigin = () => {
  const url = new URL(
    process.env.REFERRAL_PUBLIC_ORIGIN || "https://stadium-edge.onrender.com",
  );
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("Invalid referral origin");
  return url.origin;
};
async function verifiedAccount(req: Request) {
  const userId = getAuth(req)?.userId;
  if (
    !userId ||
    (req.get("X-Referral-User") && req.get("X-Referral-User") !== userId)
  )
    throw new ReferralError(401, "Sign in to use referrals.");
  if (!referralProgramEnabled())
    throw new ReferralError(503, "Referral rewards are not available yet.");
  const user = await clerkClient.users.getUser(userId);
  const email = user.emailAddresses.find(
    (e) =>
      e.id === user.primaryEmailAddressId &&
      e.verification?.status === "verified",
  );
  if (!email)
    throw new ReferralError(403, "Verify your primary email to use referrals.");
  const joinedAt = new Date(user.createdAt);
  const profile = await store.account(
    userId,
    referralEmailHash(email.emailAddress),
    joinedAt,
  );
  return {
    userId,
    joinedAt,
    hash: profile.identity_hash as string,
    code: profile.code as string,
  };
}
function fail(res: Response, error: unknown) {
  if (error instanceof ReferralError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  // Never log encrypted vouchers, invite request bodies, user email or raw codes.
  const code = (error as { code?: string })?.code;
  if (code === "23505") {
    res
      .status(409)
      .json({
        error: "This verified email is already registered for referrals.",
      });
    return;
  }
  logger.warn(
    { errorType: code || "referral_failure" },
    "Referral request failed",
  );
  res
    .status(503)
    .json({
      error: "Referrals are temporarily unavailable. Please try again later.",
    });
}
router.get("/referrals/me", limiter, async (req, res) => {
  try {
    const a = await verifiedAccount(req);
    res.json({
      ...(await store.status(a.userId)),
      link: `${apiOrigin()}/invite/${a.code}`,
      code: a.code,
      canApplyInvite: isNewReferralAccount(a.joinedAt.getTime()),
    });
  } catch (e) {
    fail(res, e);
  }
});
router.post("/referrals/apply", limiter, async (req, res) => {
  try {
    const code = normalizeReferralCode(req.body?.code);
    if (!code) throw new ReferralError(400, "Enter a valid invite code.");
    const a = await verifiedAccount(req);
    if (!isNewReferralAccount(a.joinedAt.getTime()))
      throw new ReferralError(
        409,
        "Invites apply only to verified accounts created in the last 7 days.",
      );
    res.json(await store.convert(a.userId, a.hash, code, a.joinedAt));
  } catch (e) {
    fail(res, e);
  }
});
router.post("/referrals/claim", limiter, async (req, res) => {
  try {
    const milestone = req.body?.milestone;
    if (!REFERRAL_MILESTONES.some((m) => m.count === milestone))
      throw new ReferralError(400, "Invalid reward milestone.");
    const a = await verifiedAccount(req);
    res.json(await store.claim(a.userId, milestone));
  } catch (e) {
    fail(res, e);
  }
});
export default router;

export const referralPublicRouter = Router();
// Compatibility for old /?ref= links. No arbitrary URL redirection.
referralPublicRouter.get("/", (req, res, next) => {
  if (!req.query.ref) {
    next();
    return;
  }
  const code = normalizeReferralCode(req.query.ref);
  if (!code) {
    res.status(400).send("Invalid invite code.");
    return;
  }
  res.redirect(302, `/invite/${code}`);
});
referralPublicRouter.get("/invite/:code", limiter, async (req, res) => {
  res.set({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
  });
  const code = normalizeReferralCode(req.params.code);
  if (!code) {
    res.status(404).send("Invite not found.");
    return;
  }
  try {
    const owner = await pool.query(
      `SELECT 1 FROM referral_accounts WHERE code=$1`,
      [code],
    );
    if (!owner.rowCount || !referralProgramEnabled()) {
      res
        .status(404)
        .send(
          `This invite is unavailable. Ask your friend for a fresh link. Download Stadium Edge: ${APP_STORE_URL}`,
        );
      return;
    }
    res
      .type("html")
      .send(
        `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>You're invited to Stadium Edge</title><style>body{margin:0;background:#0f172a;color:#f8fafc;font:18px system-ui;display:grid;min-height:100dvh;place-items:center}main{max-width:480px;padding:28px}a{display:block;background:#3781f4;color:white;padding:16px;border-radius:14px;text-align:center;text-decoration:none;margin:20px 0}code{font-size:26px;color:#60a5fa;user-select:all}p{line-height:1.55;color:#cbd5e1}</style><main><h1>Join Stadium Edge</h1><p>Your friend invited you. Get real odds, simulations and AI Coach picks.</p><p>Your invite code: <code>${code}</code></p><a href="stadium-mobile://invite?code=${code}">Open Stadium Edge</a><a href="${APP_STORE_URL}">Download on the App Store</a><p>New here? Create an account and verify your email. Open this invite again, or enter the code under Account → Refer a friend within 7 days. The App Store download does not carry your code automatically.</p><p>The inviter earns a free week at 3 verified new friends and a free month at 10. Each reward is available once and redeemed through Apple. Apple displays offer eligibility and renewal terms. Sharing is optional.</p></main></html>`,
      );
  } catch {
    res
      .status(503)
      .send("Invites are temporarily unavailable. Please try again later.");
  }
});
