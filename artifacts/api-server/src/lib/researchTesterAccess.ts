/**
 * Server-verified internal research-tester authorization.
 *
 * Uses server env RESEARCH_TESTER_EMAILS only (never EXPO_PUBLIC_* / client claims).
 * Identity is Clerk userId → verified Clerk emails only. Deny by default when
 * unset/empty, lookup fails, or addresses are unverified. Grants research-only
 * Coach/simulation access for NCAAF/NCAAB — never flips subscriber
 * releaseEligible / coachEnabled pipeline gates.
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

type ClerkEmailRow = {
  id?: string | null;
  emailAddress?: string | null;
  verification?: { status?: string | null } | null;
};

type ClerkUserEmails = {
  emailAddresses?: readonly ClerkEmailRow[] | null;
  primaryEmailAddressId?: string | null;
  primaryEmailAddress?: ClerkEmailRow | null;
};

/**
 * Verified Clerk emails only. Unverified / missing verification never match.
 * Pure helper — unit-tested without Clerk network.
 */
export function verifiedEmailsFromClerkUser(user: ClerkUserEmails): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const consider = (row: ClerkEmailRow | null | undefined) => {
    const email = row?.emailAddress;
    if (!email || typeof email !== "string") return;
    if (row.verification?.status !== "verified") return;
    const normalized = normalizeReviewEmail(email);
    if (!normalized.includes("@") || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(email);
  };
  // Prefer primary when verified, then all verified addresses.
  if (user.primaryEmailAddress) {
    consider(user.primaryEmailAddress);
  }
  for (const row of user.emailAddresses ?? []) {
    consider(row);
  }
  return out;
}

/**
 * True when any verified Clerk email matches the server allowlist.
 * Client-supplied emails are never accepted — only `verifiedEmails`.
 */
export function researchTesterAllowlistMatch(opts: {
  verifiedEmails: readonly string[];
  allowlist: readonly string[];
}): boolean {
  if (!opts.allowlist.length) return false;
  if (!opts.verifiedEmails.length) return false;
  return clerkEmailsMatchAllowlist(opts.verifiedEmails, opts.allowlist);
}

export type ResearchTesterAccessDiag = {
  clerkUserLookupSucceeded: boolean;
  emailResolved: boolean;
  /** At least one Clerk email has verification.status === "verified". */
  verifiedEmailResolved: boolean;
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
    extra: Partial<ResearchTesterAccessDiag> = {},
  ): ResearchTesterAccessDiag => ({
    clerkUserLookupSucceeded: false,
    emailResolved: false,
    verifiedEmailResolved: false,
    allowlistMatched: false,
    researchTesterAccess: false,
    ...failure,
    ...extra,
  });
  if (!userId) return fail({ ...noFailure, clerkFailureCategory: "config" });
  const allowlist = readResearchTesterEmails();
  if (allowlist.length === 0) {
    return fail({ ...noFailure, clerkFailureCategory: "config" });
  }
  try {
    const user = await clerkClient.users.getUser(userId);
    const allEmails = [
      user.primaryEmailAddress?.emailAddress,
      ...(user.emailAddresses ?? []).map((e) => e?.emailAddress),
    ].filter((e): e is string => typeof e === "string" && e.includes("@"));
    const verifiedEmails = verifiedEmailsFromClerkUser(user);
    const emailResolved = allEmails.length > 0;
    const verifiedEmailResolved = verifiedEmails.length > 0;
    const allowlistMatched = researchTesterAllowlistMatch({
      verifiedEmails,
      allowlist,
    });
    return {
      clerkUserLookupSucceeded: true,
      emailResolved,
      verifiedEmailResolved,
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
 * True when the authenticated Clerk user has a verified email on
 * RESEARCH_TESTER_EMAILS. Fail closed when unset, Clerk errors, unverified
 * addresses, or no match. Never trusts client email claims.
 */
export async function isDesignatedResearchTester(
  userId: string | null | undefined,
): Promise<boolean> {
  if (!userId) return false;
  const allowlist = readResearchTesterEmails();
  if (allowlist.length === 0) return false;
  try {
    const user = await clerkClient.users.getUser(userId);
    return researchTesterAllowlistMatch({
      verifiedEmails: verifiedEmailsFromClerkUser(user),
      allowlist,
    });
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
