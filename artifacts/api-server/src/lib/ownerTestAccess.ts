/**
 * Server-verified owner / internal test authorization.
 *
 * Uses server env OWNER_TEST_EMAILS or ADMIN_EMAILS (never EXPO_PUBLIC_*).
 * Identity is Clerk userId → Clerk emails. Client email claims are ignored.
 * Does not create a RevenueCat / paid subscription row.
 */

import { clerkClient } from "@clerk/express";
import {
  clerkEmailsMatchAllowlist,
  normalizeReviewEmail,
} from "./appReviewAuth.js";
import { logger } from "./logger.js";

/** Parse server-only owner/admin email allowlist. */
export function readOwnerTestEmails(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const raw = env.OWNER_TEST_EMAILS ?? env.ADMIN_EMAILS ?? "";
  if (!raw || typeof raw !== "string") return [];
  return raw
    .split(/[,;\s]+/)
    .map((e) => normalizeReviewEmail(e))
    .filter((e) => e.includes("@"));
}

function emailsFromClerkUser(user: {
  emailAddresses?: readonly { emailAddress?: string | null }[] | null;
  primaryEmailAddress?: { emailAddress?: string | null } | null;
}): string[] {
  const out: string[] = [];
  const primary = user.primaryEmailAddress?.emailAddress;
  if (primary) out.push(primary);
  for (const row of user.emailAddresses ?? []) {
    if (row?.emailAddress) out.push(row.emailAddress);
  }
  return out;
}

/**
 * True when the authenticated Clerk user matches a server owner-test email.
 * Fail closed when unset, Clerk errors, or no match.
 */
export async function isDesignatedOwnerTestUser(
  userId: string | null | undefined,
): Promise<boolean> {
  if (!userId) return false;
  const allowlist = readOwnerTestEmails();
  if (allowlist.length === 0) return false;
  try {
    const user = await clerkClient.users.getUser(userId);
    return clerkEmailsMatchAllowlist(emailsFromClerkUser(user), allowlist);
  } catch (err) {
    logger.warn(
      { err, path: "owner-test-access", userId },
      "owner test access: Clerk user lookup failed",
    );
    return false;
  }
}
