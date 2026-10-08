/**
 * Delivery-time odds integrity: revalidate stale legs when possible, else drop.
 * Never invents replacement prices.
 */

import type { ParsedPick } from "../components/PickCard.tsx";
import {
  coachOddsIntegrityNote,
  legOddsSnapshotIsDeliverable,
} from "./coachOddsFreshness.ts";

/** Minimal props refresh shape — avoids importing the full api.ts client graph. */
export type OddsIntegrityPropRow = {
  player: string;
  market: string;
  line: number | null;
  overPrice: number | null;
  underPrice: number | null;
  overBook?: string | null;
  underBook?: string | null;
  position?: string | null;
};

export type OddsIntegrityPropsResponse = {
  home?: string | null;
  away?: string | null;
  bookmaker?: string | null;
  props: OddsIntegrityPropRow[];
  provider?: string | null;
  eventId?: string | null;
  fetchedAt?: string | null;
  providerLastUpdate?: string | null;
  source?: string | null;
};

export type OddsIntegrityFetchProps = (
  opts: {
    sport: string;
    eventId: string;
    home?: string;
    away?: string;
    startsAt?: string;
  },
  signal?: AbortSignal,
) => Promise<OddsIntegrityPropsResponse>;

export type OddsIntegrityFilterResult = {
  picks: ParsedPick[];
  droppedStale: number;
  droppedUnverifiable: number;
  droppedProviderOutage: number;
  revalidated: number;
  note: string;
};

function applyPropRefresh(
  pick: ParsedPick,
  resp: OddsIntegrityPropsResponse,
): ParsedPick | null {
  if (!pick.isProp || !pick.player || pick.propLine == null || !pick.propSide) {
    return null;
  }
  const side = String(pick.propSide).toLowerCase();
  const market = String(pick.propMarketKey ?? "").toLowerCase();
  const match = (resp.props ?? []).find((p) => {
    if (p.player !== pick.player) return false;
    if (p.line !== pick.propLine) return false;
    if (market && String(p.market).toLowerCase() !== market) return false;
    if (side === "over") return p.overPrice != null;
    if (side === "under") return p.underPrice != null;
    return false;
  });
  if (!match) return null;
  const price = side === "over" ? match.overPrice : match.underPrice;
  const book = side === "over" ? match.overBook : match.underBook;
  if (price == null || !Number.isFinite(price)) return null;
  if (!resp.fetchedAt || !String(resp.eventId ?? pick.eventId ?? "").trim()) {
    return null;
  }
  return {
    ...pick,
    odds: price,
    sportsbook: book ?? resp.bookmaker ?? pick.sportsbook ?? null,
    eventId: resp.eventId ?? pick.eventId ?? null,
    oddsFetchedAt: resp.fetchedAt,
    providerLastUpdate: resp.providerLastUpdate ?? null,
    oddsProvider: resp.provider ?? resp.source ?? pick.oddsProvider ?? null,
    position: match.position ?? pick.position ?? null,
  };
}

async function defaultFetchProps(
  opts: {
    sport: string;
    eventId: string;
    home?: string;
    away?: string;
    startsAt?: string;
  },
  signal?: AbortSignal,
): Promise<OddsIntegrityPropsResponse> {
  // Lazy import keeps unit tests free of the Expo/api client graph.
  const { getProps } = await import("./api.ts");
  return getProps(opts, signal) as Promise<OddsIntegrityPropsResponse>;
}

/**
 * Filter ticket picks for deliverable odds provenance.
 * Stale props: attempt one re-fetch per eventId; update in place if still posted.
 */
export async function filterPicksForOddsIntegrity(
  picks: ParsedPick[],
  opts?: {
    nowMs?: number;
    revalidate?: boolean;
    signal?: AbortSignal;
    /** Defaults to live `getProps` (lazy). Inject in tests. */
    fetchProps?: OddsIntegrityFetchProps;
  },
): Promise<OddsIntegrityFilterResult> {
  const nowMs = opts?.nowMs ?? Date.now();
  const revalidate = opts?.revalidate !== false;
  const fetchProps = opts?.fetchProps ?? defaultFetchProps;
  const out: ParsedPick[] = [];
  let droppedStale = 0;
  let droppedUnverifiable = 0;
  let droppedProviderOutage = 0;
  let revalidated = 0;

  const refreshCache = new Map<string, OddsIntegrityPropsResponse | null>();

  for (const pick of picks) {
    const snapPick: ParsedPick = { ...pick };
    const check = legOddsSnapshotIsDeliverable(snapPick, { nowMs });
    if (check.ok) {
      out.push(snapPick);
      continue;
    }

    if (
      revalidate &&
      snapPick.isProp &&
      check.reason === "stale_odds" &&
      snapPick.eventId &&
      snapPick.sport
    ) {
      const cacheKey = `${snapPick.sport}|${snapPick.eventId}`;
      let resp = refreshCache.get(cacheKey);
      if (resp === undefined) {
        try {
          const parts = String(snapPick.game ?? "").split(" @ ");
          resp = await fetchProps(
            {
              sport: snapPick.sport,
              eventId: String(snapPick.eventId),
              home: parts[1]?.trim() || undefined,
              away: parts[0]?.trim() || undefined,
              startsAt: snapPick.startsAt ?? undefined,
            },
            opts?.signal,
          );
          if (!resp.props?.length) {
            droppedProviderOutage += 1;
            refreshCache.set(cacheKey, null);
            continue;
          }
          refreshCache.set(cacheKey, resp);
        } catch {
          refreshCache.set(cacheKey, null);
          droppedProviderOutage += 1;
          continue;
        }
      }
      if (resp == null) {
        droppedProviderOutage += 1;
        continue;
      }
      const refreshed = applyPropRefresh(snapPick, resp);
      if (refreshed) {
        const again = legOddsSnapshotIsDeliverable(refreshed, { nowMs });
        if (again.ok) {
          revalidated += 1;
          out.push(refreshed);
          continue;
        }
      }
      droppedStale += 1;
      continue;
    }

    if (check.reason === "stale_odds") {
      droppedStale += 1;
    } else {
      droppedUnverifiable += 1;
    }
  }

  return {
    picks: out,
    droppedStale,
    droppedUnverifiable,
    droppedProviderOutage,
    revalidated,
    note: coachOddsIntegrityNote({
      stale: droppedStale,
      unverifiable: droppedUnverifiable,
      providerOutage: droppedProviderOutage,
    }),
  };
}
