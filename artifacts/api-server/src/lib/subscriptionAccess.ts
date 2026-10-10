/**
 * Server-side subscription entitlement DB lookup for premium API responses.
 */

import { eq } from "drizzle-orm";
import { db, subscriptionEntitlementsTable } from "@workspace/db";
import { isActivePaidEntitlement } from "./subscriptionEntitlement.js";

export { isActivePaidEntitlement } from "./subscriptionEntitlement.js";
export type { ServerEntitlementRow } from "./subscriptionEntitlement.js";

export async function userHasCoachPremiumAccess(userId: string | null): Promise<boolean> {
  if (!userId) return false;
  try {
    const rows = await db
      .select()
      .from(subscriptionEntitlementsTable)
      .where(eq(subscriptionEntitlementsTable.userId, userId))
      .limit(1);
    return isActivePaidEntitlement(rows[0]);
  } catch {
    return false;
  }
}
