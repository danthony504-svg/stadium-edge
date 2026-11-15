/** Keep independently verified owner access when the paid entitlement read fails. */
export async function readPaidEntitlementForOwner<T>(
  ownerAccess: boolean,
  read: () => Promise<T | undefined>,
): Promise<{ row: T | undefined; paidReadUnavailable: boolean }> {
  try {
    return { row: await read(), paidReadUnavailable: false };
  } catch (error) {
    if (!ownerAccess) throw error;
    // No paid plan is asserted. The response carries the separate Clerk flag.
    return { row: undefined, paidReadUnavailable: true };
  }
}
