import { timingSafeEqual } from "node:crypto";

/**
 * App Review–only credential helpers.
 *
 * Secrets live in server env (APP_REVIEW_EMAIL / APP_REVIEW_CODE). Never ship
 * them in the client bundle. Comparison is constant-time where lengths match.
 */

export function normalizeReviewEmail(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

export function normalizeReviewCode(raw: string | null | undefined): string {
  return (raw ?? "").trim();
}

function safeEqualUtf8(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length || aBuf.length === 0) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export type AppReviewEnv = {
  email: string;
  code: string;
};

/**
 * Designated review account email only (no code). Used for authenticated
 * premium authorization after Clerk sign-in — never trust client-supplied email.
 */
export function readAppReviewEmail(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const email = normalizeReviewEmail(env.APP_REVIEW_EMAIL);
  if (!email || !email.includes("@")) return null;
  return email;
}

/** Read configured review credentials from process env. Empty = path disabled. */
export function readAppReviewEnv(
  env: NodeJS.ProcessEnv = process.env,
): AppReviewEnv | null {
  const email = readAppReviewEmail(env);
  const code = normalizeReviewCode(env.APP_REVIEW_CODE);
  if (!email || !code) return null;
  return { email, code };
}

/**
 * True when any Clerk-linked email matches one of the designated allowlist
 * emails. Pure helper — callers must supply emails from Clerk (authenticated userId).
 */
export function clerkEmailsMatchAllowlist(
  clerkEmails: readonly (string | null | undefined)[] | null | undefined,
  allowlist: readonly (string | null | undefined)[] | null | undefined,
): boolean {
  const targets = (allowlist ?? [])
    .map((e) => normalizeReviewEmail(e))
    .filter((e) => e.includes("@"));
  if (targets.length === 0) return false;
  for (const raw of clerkEmails ?? []) {
    const email = normalizeReviewEmail(raw);
    if (!email) continue;
    for (const target of targets) {
      if (safeEqualUtf8(email, target)) return true;
    }
  }
  return false;
}

/**
 * True when any Clerk-linked email matches the server APP_REVIEW_EMAIL.
 * Pure helper — callers must supply emails from Clerk (authenticated userId).
 */
export function clerkEmailsMatchDesignatedReview(
  clerkEmails: readonly (string | null | undefined)[] | null | undefined,
  designatedEmail: string | null | undefined,
): boolean {
  return clerkEmailsMatchAllowlist(clerkEmails, [designatedEmail]);
}

/**
 * True only when the submitted email + code match the designated App Review
 * account configured on the server. Wrong email or wrong code → false
 * (normal users stay on Clerk OTP).
 */
export function matchesAppReviewCredentials(
  email: string,
  code: string,
  configured: AppReviewEnv | null,
): boolean {
  if (!configured) return false;
  const submittedEmail = normalizeReviewEmail(email);
  const submittedCode = normalizeReviewCode(code);
  if (!submittedEmail || !submittedCode) return false;
  return (
    safeEqualUtf8(submittedEmail, configured.email) &&
    safeEqualUtf8(submittedCode, configured.code)
  );
}
