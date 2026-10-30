/**
 * Server-verified internal research-tester authorization.
 *
 * Uses server env RESEARCH_TESTER_EMAILS only (never EXPO_PUBLIC_* / client claims).
 * Identity is Clerk userId → Clerk emails. Deny by default when unset/empty.
 * Grants research-only Coach/simulation access for NCAAF/NCAAB — never flips
 * subscriber releaseEligible / coachEnabled pipeline gates.
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

/** Parse server-only research-tester email allowlist. */
export function readResearchTesterEmails(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const raw = env.RESEARCH_TESTER_EMAILS ?? "";
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

export type ResearchTesterAccessDiag = {
  clerkUserLookupSucceeded: boolean;
  emailResolved: boolean;
  allowlistMatched: boolean;
  researchTesterAccess: boolean;
} & ClerkLookupFailureDiag;

const noFailure: ClerkLookupFailureDiag = {
  clerkHttpStatus: null,
  clerkErrorCode: null,
  clerkFailureCategory: "none",
};

export async function diagnoseResearchTesterAccess(
  userId: string | null | undefined,
): Promise<ResearchTesterAccessDiag> {
  const fail = (
    failure: ClerkLookupFailureDiag = noFailure,
  ): ResearchTesterAccessDiag => ({
    clerkUserLookupSucceeded: false,
    emailResolved: false,
    allowlistMatched: false,
    researchTesterAccess: false,
    ...failure,
  });
  if (!userId) return fail({ ...noFailure, clerkFailureCategory: "config" });
  const allowlist = readResearchTesterEmails();
  if (allowlist.length === 0) {
    return fail({ ...noFailure, clerkFailureCategory: "config" });
  }
  try {
    const user = await clerkClient.users.getUser(userId);
    const emails = emailsFromClerkUser(user);
    const emailResolved = emails.some((e) =>
      normalizeReviewEmail(e).includes("@"),
    );
    const allowlistMatched = clerkEmailsMatchAllowlist(emails, allowlist);
    return {
      clerkUserLookupSucceeded: true,
      emailResolved,
      allowlistMatched,
      researchTesterAccess: allowlistMatched,
      ...noFailure,
    };
  } catch (err) {
    const classified = classifyClerkLookupError(err);
    logger.warn(
      {
        path: "research-tester-access",
        clerkHttpStatus: classified.clerkHttpStatus,
        clerkErrorCode: classified.clerkErrorCode,
        clerkFailureCategory: classified.clerkFailureCategory,
      },
      "research tester access: Clerk user lookup failed",
    );
    return fail(classified);
  }
}

/**
 * True when the authenticated Clerk user matches RESEARCH_TESTER_EMAILS.
 * Fail closed when unset, Clerk errors, or no match.
 */
export async function isDesignatedResearchTester(
  userId: string | null | undefined,
): Promise<boolean> {
  if (!userId) return false;
  const allowlist = readResearchTesterEmails();
  if (allowlist.length === 0) return false;
  try {
    const user = await clerkClient.users.getUser(userId);
    return clerkEmailsMatchAllowlist(emailsFromClerkUser(user), allowlist);
  } catch (err) {
    const classified = classifyClerkLookupError(err);
    logger.warn(
      {
        path: "research-tester-access",
        clerkHttpStatus: classified.clerkHttpStatus,
        clerkErrorCode: classified.clerkErrorCode,
        clerkFailureCategory: classified.clerkFailureCategory,
      },
      "research tester access: Clerk user lookup failed",
    );
    return false;
  }
}

/** Fixed user-facing research disclaimer — never implies subscriber release. */
export const RESEARCH_NOT_VALIDATED_LABEL = "Research — not validated.";
