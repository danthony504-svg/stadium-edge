export type PlanCatalogRow = {
  priceString: string | null;
  hasFreeTrial: boolean;
  freeTrialDays: number | null;
};
/** Product offers do not establish an individual account's Apple eligibility. */
export function planCatalogNote(
  planId: string,
  catalog: { go: PlanCatalogRow | null; pro: PlanCatalogRow | null } | null,
  fallbackNote: string,
): string {
  const row =
    planId === "go" ? catalog?.go : planId === "pro" ? catalog?.pro : null;
  if (!row) return fallbackNote;
  const price = `${row.priceString ?? (planId === "go" ? "$9.99" : "$29.99")}/${planId === "go" ? "week" : "month"}`;
  if (!row.hasFreeTrial) return `Billed through Apple · ${price}`;
  const days = row.freeTrialDays;
  return days != null && days > 0 && Number.isFinite(days)
    ? `For eligible accounts: ${days}-day free trial, then ${price}`
    : `Free introductory trial for eligible accounts, then ${price}. Apple confirms trial terms at checkout.`;
}
