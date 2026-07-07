/**
 * Compat shim for stale OTA bundles that call oddsQuerySelectors.getOddsSelector().
 * Lazy-loads api so boot-entry can register globals before the heavy module graph.
 */
import type { OddsGame } from "@/lib/api";

export type OddsQuerySelector = {
  queryKey: readonly ["odds", string];
  queryFn: (ctx: { signal?: AbortSignal }) => Promise<OddsGame[]>;
};

export function getOddsSelector(sport: string): OddsQuerySelector {
  const league = String(sport ?? "");
  return {
    queryKey: ["odds", league] as const,
    queryFn: async ({ signal }) => {
      const { getOdds } = await import("@/lib/api");
      return getOdds(league, signal).catch(() => [] as OddsGame[]);
    },
  };
}

export const oddsQuerySelectors = {
  getOddsSelector,
};

export default oddsQuerySelectors;

/** Install on global for stale eval() / mixed Hermes bundles. */
export function installOddsSelectorCompat(): void {
  const g = globalThis as typeof globalThis & {
    oddsQuerySelectors?: typeof oddsQuerySelectors;
    getOddsSelector?: typeof getOddsSelector;
  };
  g.oddsQuerySelectors = oddsQuerySelectors;
  g.getOddsSelector = getOddsSelector;
}

installOddsSelectorCompat();
