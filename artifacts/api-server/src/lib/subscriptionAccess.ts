/**
 * Server-side subscription entitlement DB lookup for premium API responses.
 */

import { eq } from "drizzle-orm";
import { db, subscriptionEntitlementsTable } from "@workspace/db";
import {
  isDesignatedAppReviewUser,
  resolvePremiumApiAccess,
} from "./appReviewAccess.js";
import { isActivePaidEntitlement } from "./subscriptionEntitlement.js";

export { isActivePaidEntitlement } from "./subscriptionEntitlement.js";
export type { ServerEntitlementRow } from "./subscriptionEntitlement.js";

/**
 * Coach / premium API access: RevenueCat-backed paid entitlement OR
 * server-verified designated App Review account (Clerk userId → APP_REVIEW_EMAIL).
 * Never trusts client planId / email / premium flags.
 */
export async function userHasCoachPremiumAccess(userId: string | null): Promise<boolean> {
  if (!userId) return false;
  try {
    const designatedAppReview = await isDesignatedAppReviewUser(userId);
    if (designatedAppReview) {
      return resolvePremiumApiAccess({
        paidEntitlement: false,
        designatedAppReview: true,
      });
    }
    const rows = await db
      .select()
      .from(subscriptionEntitlementsTable)
      .where(eq(subscriptionEntitlementsTable.userId, userId))
      .limit(1);
    return resolvePremiumApiAccess({
      paidEntitlement: isActivePaidEntitlement(rows[0]),
      designatedAppReview: false,
    });
  } catch {
    return false;
  }
}
