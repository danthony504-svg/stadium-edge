/**
 * Server-verified App Review premium authorization.
 *
 * Identity comes from the authenticated Clerk userId → Clerk email list,
 * compared to server APP_REVIEW_EMAIL. Client-supplied emails / flags are
 * never consulted. Does not write a paid subscription entitlement row.
 */

import { clerkClient } from "@clerk/express";
import {
  clerkEmailsMatchDesignatedReview,
  readAppReviewEmail,
} from "./appReviewAuth.js";
import { logger } from "./logger.js";

/** Pure combine of RevenueCat paid access + designated review / owner test. */
export function resolvePremiumApiAccess(opts: {
  paidEntitlement: boolean;
  designatedAppReview: boolean;
  designatedOwnerTest?: boolean;
}): boolean {
  return (
    opts.paidEntitlement === true ||
    opts.designatedAppReview === true ||
    opts.designatedOwnerTest === true
  );
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
 * True when the authenticated Clerk user owns the designated APP_REVIEW_EMAIL.
 * Fail closed on missing config, Clerk errors, or email mismatch.
 */
export async function isDesignatedAppReviewUser(
  userId: string | null | undefined,
): Promise<boolean> {
  if (!userId) return false;
  const designated = readAppReviewEmail();
  if (!designated) return false;
  try {
    const user = await clerkClient.users.getUser(userId);
    return clerkEmailsMatchDesignatedReview(emailsFromClerkUser(user), designated);
  } catch (err) {
    logger.warn(
      { err, path: "app-review-access", userId },
      "app review access: Clerk user lookup failed",
    );
    return false;
  }
}
