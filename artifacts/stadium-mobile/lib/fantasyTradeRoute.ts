/** Retain a valid saved-player deep-link selection when opening Trade Analyzer. */
export function preselectedTradeGiveIds(
  current: readonly string[],
  giveId: string | undefined,
  savedIds: ReadonlySet<string>,
): string[] {
  if (!giveId || !savedIds.has(giveId) || current.includes(giveId)) return [...current];
  return [giveId, ...current].slice(0, 2);
}
