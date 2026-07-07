/**
 * Compat shim for stale OTA bundles that call oddsQuerySelectors.getOddsSelector().
 * Current Home uses inline useQuery + getOdds(); this module exists so mixed bundles
 * never see undefined.getOddsSelector during boot.
 */
import { getOdds, type OddsGame } from "@/lib/api";

export type OddsQuerySelector = {
  queryKey: readonly ["odds", string];
  queryFn: (ctx: { signal?: AbortSignal }) => Promise<OddsGame[]>;
};

export function getOddsSelector(sport: string): OddsQuerySelector {
  const league = String(sport ?? "");
  return {
    queryKey: ["odds", league] as const,
    queryFn: ({ signal }) => getOdds(league, signal).catch(() => [] as OddsGame[]),
  };
}

/** Shape expected by some stale table-tennis browse bundles. */
export const oddsQuerySelectors = {
  getOddsSelector,
};

// Stale mixed OTAs sometimes default-import this object.
export default oddsQuerySelectors;
