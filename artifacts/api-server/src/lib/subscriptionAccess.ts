/**
 * Server-side subscription entitlement DB lookup for premium API responses.
 */

import { eq } from "drizzle-orm";
import { db, subscriptionEntitlementsTable } from "@workspace/db";
import {
  isDesignatedAppReviewUser,
  resolvePremiumApiAccess,
} from "./appReviewAccess.js";
import { isDesignatedOwnerTestUser } from "./ownerTestAccess.js";
import { isDesignatedResearchTester } from "./researchTesterAccess.js";
import { isActivePaidEntitlement } from "./subscriptionEntitlement.js";

export { isActivePaidEntitlement } from "./subscriptionEntitlement.js";
export type { ServerEntitlementRow } from "./subscriptionEntitlement.js";

/**
 * Coach / premium API access:
 *   - RevenueCat-backed paid entitlement, OR
 *   - server-verified App Review account, OR
 *   - server-verified owner test account (OWNER_TEST_EMAILS / ADMIN_EMAILS), OR
 *   - server-verified research tester (RESEARCH_TESTER_EMAILS) for internal
 *     NCAAF/NCAAB research Coach only — never subscriber release approval.
 * Never trusts client planId / email / premium flags / EXPO_PUBLIC allowlists.
 */
export async function userHasCoachPremiumAccess(userId: string | null): Promise<boolean> {
  if (!userId) return false;
  try {
    const [designatedAppReview, designatedOwnerTest, designatedResearchTester] =
      await Promise.all([
        isDesignatedAppReviewUser(userId),
        isDesignatedOwnerTestUser(userId),
        isDesignatedResearchTester(userId),
      ]);
    if (designatedAppReview || designatedOwnerTest || designatedResearchTester) {
      return resolvePremiumApiAccess({
        paidEntitlement: false,
        designatedAppReview,
        designatedOwnerTest,
        designatedResearchTester,
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
      designatedOwnerTest: false,
      designatedResearchTester: false,
    });
  } catch {
    return false;
  }
}
