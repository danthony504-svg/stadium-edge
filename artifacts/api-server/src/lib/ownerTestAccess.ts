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
import {
  classifyClerkLookupError,
  type ClerkLookupFailureDiag,
} from "./clerkLookupDiag.js";
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
 * Temporary sanitized owner-access probe (no userId / email / tokens logged).
 * Does not change entitlement outcomes — diagnostics only.
 */
export type OwnerTestAccessDiag = {
  clerkUserLookupSucceeded: boolean;
  emailResolved: boolean;
  allowlistMatched: boolean;
  ownerAccess: boolean;
} & ClerkLookupFailureDiag;

const noFailure: ClerkLookupFailureDiag = {
  clerkHttpStatus: null,
  clerkErrorCode: null,
  clerkFailureCategory: "none",
};

export async function diagnoseOwnerTestAccess(
  userId: string | null | undefined,
): Promise<OwnerTestAccessDiag> {
  const fail = (
    failure: ClerkLookupFailureDiag = noFailure,
  ): OwnerTestAccessDiag => ({
    clerkUserLookupSucceeded: false,
    emailResolved: false,
    allowlistMatched: false,
    ownerAccess: false,
    ...failure,
  });
  if (!userId) return fail({ ...noFailure, clerkFailureCategory: "config" });
  const allowlist = readOwnerTestEmails();
  if (allowlist.length === 0) {
    return fail({ ...noFailure, clerkFailureCategory: "config" });
  }
  try {
    const user = await clerkClient.users.getUser(userId);
    const emails = emailsFromClerkUser(user);
    const emailResolved = emails.some((e) => normalizeReviewEmail(e).includes("@"));
    const allowlistMatched = clerkEmailsMatchAllowlist(emails, allowlist);
    return {
      clerkUserLookupSucceeded: true,
      emailResolved,
      allowlistMatched,
      ownerAccess: allowlistMatched,
      ...noFailure,
    };
  } catch (err) {
    // Sanitized only — never userId / email / token / secret.
    const classified = classifyClerkLookupError(err);
    logger.warn(
      {
        path: "owner-test-access",
        clerkHttpStatus: classified.clerkHttpStatus,
        clerkErrorCode: classified.clerkErrorCode,
        clerkFailureCategory: classified.clerkFailureCategory,
      },
      "owner test access: Clerk user lookup failed",
    );
    return fail(classified);
  }
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
    const classified = classifyClerkLookupError(err);
    logger.warn(
      {
        path: "owner-test-access",
        clerkHttpStatus: classified.clerkHttpStatus,
        clerkErrorCode: classified.clerkErrorCode,
        clerkFailureCategory: classified.clerkFailureCategory,
      },
      "owner test access: Clerk user lookup failed",
    );
    return false;
  }
}
