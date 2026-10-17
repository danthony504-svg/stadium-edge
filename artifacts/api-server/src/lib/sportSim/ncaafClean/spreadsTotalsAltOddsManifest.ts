/**
 * Deduplicated Odds request manifest for missing FINAL_EVAL spreads / totals / ALTs.
 * Dry-run only — never fetches. Reuses membership kickoff buckets + h2h archive IDs.
 */

import {
  buildDedupeKey,
  estimateHistoricalAltCreditsPerEvent,
  estimateHistoricalFeaturedCredits,
  snapshotBucketIso,
} from "../../ncaafForwardCollector.ts";

export const ODDS_PROVIDER = {
  name: "The Odds API",
  sport: "americanfootball_ncaaf",
  region: "us",
  historicalFeaturedEndpoint:
    "GET /v4/historical/sports/americanfootball_ncaaf/odds",
  historicalEventEndpoint:
    "GET /v4/historical/sports/americanfootball_ncaaf/events/{eventId}/odds",
  supports: {
    h2h: true,
    spreads: true,
    totals: true,
    alternate_spreads: true,
    alternate_totals: true,
  },
  note: "Featured markets on historical /odds; ALTs on historical event-odds (per event)",
} as const;

export type ManifestGame = {
  eventId: string;
  kickoffIso: string;
};

export type BucketRequest = {
  bucketIso: string;
  eventIds: string[];
  nEvents: number;
  endpoint: string;
  query: Record<string, string>;
  dedupeKey: string;
  creditsIfFetched: number;
  skipHttp: boolean;
  skipReason: string | null;
};

export type SpreadsTotalsAltManifestBundle = {
  generatedAt: string;
  paidRetrieval: false;
  fetchExecuted: false;
  provider: typeof ODDS_PROVIDER;
  cacheReuse: {
    finalEvalH2hArchive: {
      path: string;
      markets: string[];
      nGames: number;
      reuse: string;
    };
    tuningCloses: {
      path: string;
      hasSpreads: boolean;
      hasTotals: boolean;
      bucketOverlapWithFinalEval: number;
      reuse: string;
    };
    phaseECloses: {
      path: string;
      hasSpreads: boolean;
      hasTotals: boolean;
      reuse: string;
    };
  };
  featuredSpreadsTotals: {
    id: string;
    markets: string[];
    whyOmitH2h: string;
    nGames: number;
    nPrimaryBuckets: number;
    nBucketsToFetch: number;
    nBucketsSkipped: number;
    creditsPerBucket: number;
    creditMath: {
      formula: string;
      baseCredits: number;
      retryBufferCredits: number;
      hardCap: number;
      fitsInHardCap: boolean;
    };
    extractFields: string[];
    requests: BucketRequest[];
  };
  alternateSpreads: {
    id: string;
    markets: string[];
    nEvents: number;
    creditsPerEvent: number;
    creditMath: {
      formula: string;
      baseCredits: number;
      retryBufferCredits: number;
      hardCap: number;
      fitsInHardCap: boolean;
      samplingNote: string;
    };
    endpoint: string;
    eventIds: string[];
  };
  proposedCaps: {
    featuredSpreadsTotalsHardCap: number;
    altSpreadsHardCap: number;
    combinedMaximumIfBoth: number;
    recommendation: string;
  };
  oddsApiKey: "UNSET" | "SET";
};

function minuteBucket(kickoffIso: string): string {
  const iso = kickoffIso.endsWith("Z") || kickoffIso.includes("+")
    ? kickoffIso
    : `${kickoffIso}Z`;
  return snapshotBucketIso(iso);
}

export function buildSpreadsTotalsAltManifest(opts: {
  membershipGames: ManifestGame[];
  h2hArchiveGameIds: string[];
  tuningCloseBuckets: Set<string>;
  oddsKeyConfigured: boolean;
  featuredHardCap?: number;
  altHardCap?: number;
}): SpreadsTotalsAltManifestBundle {
  const markets = ["spreads", "totals"] as const;
  const creditsEach = estimateHistoricalFeaturedCredits(markets.length, 1)
    .creditsPerCall; // 20

  const bucketToGames = new Map<string, string[]>();
  for (const g of opts.membershipGames) {
    const b = minuteBucket(g.kickoffIso);
    const arr = bucketToGames.get(b) ?? [];
    arr.push(g.eventId);
    bucketToGames.set(b, arr);
  }

  const overlap = [...bucketToGames.keys()].filter((b) =>
    opts.tuningCloseBuckets.has(b),
  ).length;

  const requests: BucketRequest[] = [...bucketToGames.keys()]
    .sort()
    .map((bucket) => {
      const dedupeKey = buildDedupeKey({
        sport: ODDS_PROVIDER.sport,
        mode: "historical_close_spreads_totals",
        markets: [...markets],
        regions: [ODDS_PROVIDER.region],
        snapshotBucketIso: bucket,
      });
      // Different markets than h2h archive → cannot skip HTTP for market reuse.
      // Tuning overlap is reported but FINAL_EVAL season rarely overlaps.
      const inTuning = opts.tuningCloseBuckets.has(bucket);
      return {
        bucketIso: bucket,
        eventIds: bucketToGames.get(bucket)!,
        nEvents: bucketToGames.get(bucket)!.length,
        endpoint: ODDS_PROVIDER.historicalFeaturedEndpoint,
        query: {
          regions: ODDS_PROVIDER.region,
          markets: markets.join(","),
          oddsFormat: "american",
          date: bucket,
        },
        dedupeKey,
        creditsIfFetched: creditsEach,
        skipHttp: false,
        skipReason: inTuning
          ? "tuning_bucket_time_overlap_but_markets_differ_still_fetch"
          : null,
      };
    });

  // Force fetch all — skipReason is informational only when markets differ.
  for (const r of requests) {
    r.skipHttp = false;
  }

  const toFetch = requests.filter((r) => !r.skipHttp);
  const baseCredits = toFetch.length * creditsEach;
  const retryBuffer = Math.ceil(baseCredits * 0.25);
  const featuredHardCap = opts.featuredHardCap ?? 4200;

  const altCreditsEach = estimateHistoricalAltCreditsPerEvent(1, 1)
    .creditsPerCall; // 10
  // Default ALT cohort = h2h-scored games (known Odds-listed); cap separately.
  const altIds = [...new Set(opts.h2hArchiveGameIds)].sort();
  const altBase = altIds.length * altCreditsEach;
  const altRetry = Math.ceil(altBase * 0.25);
  const altHardCap = opts.altHardCap ?? 4200;

  return {
    generatedAt: new Date().toISOString(),
    paidRetrieval: false,
    fetchExecuted: false,
    provider: ODDS_PROVIDER,
    cacheReuse: {
      finalEvalH2hArchive: {
        path: "test/fixtures/ncaaf-final-eval-close-h2h-archive.json",
        markets: ["h2h"],
        nGames: opts.h2hArchiveGameIds.length,
        reuse:
          "Reuse kickoff/request buckets + game IDs; do NOT re-fetch h2h (omit from markets). Cannot supply spreads/totals/ALTs.",
      },
      tuningCloses: {
        path: "test/fixtures/ncaaf-tuning-2025-w1-7-closing-lines.json",
        hasSpreads: true,
        hasTotals: false,
        bucketOverlapWithFinalEval: overlap,
        reuse:
          "TUNING-only; 0 expected bucket overlap with FINAL_EVAL — not a FINAL_EVAL spreads substitute",
      },
      phaseECloses: {
        path: "test/fixtures/ncaaf-phase-e-closing-lines.json",
        hasSpreads: true,
        hasTotals: false,
        reuse:
          "2023–2024 holdout — wrong split for FINAL_EVAL; proves Odds can return spreads, not totals",
      },
    },
    featuredSpreadsTotals: {
      id: "FINAL_EVAL_close_spreads_totals",
      markets: [...markets],
      whyOmitH2h:
        "FINAL_EVAL h2h archive already vendored (403/408); re-fetching h2h wastes 10 credits/bucket",
      nGames: opts.membershipGames.length,
      nPrimaryBuckets: bucketToGames.size,
      nBucketsToFetch: toFetch.length,
      nBucketsSkipped: requests.length - toFetch.length,
      creditsPerBucket: creditsEach,
      creditMath: {
        formula: "10 × markets × regions (markets=2 → 20/bucket)",
        baseCredits,
        retryBufferCredits: retryBuffer,
        hardCap: featuredHardCap,
        fitsInHardCap: baseCredits + retryBuffer <= featuredHardCap,
      },
      extractFields: [
        "closeSpreadHome",
        "closeSpreadAway",
        "closeSpreadOddsHome",
        "closeSpreadOddsAway",
        "closeTotal",
        "closeOverOdds",
        "closeUnderOdds",
      ],
      requests,
    },
    alternateSpreads: {
      id: "FINAL_EVAL_close_alternate_spreads",
      markets: ["alternate_spreads"],
      nEvents: altIds.length,
      creditsPerEvent: altCreditsEach,
      creditMath: {
        formula: "10 × markets × regions × events (1 ALT market)",
        baseCredits: altBase,
        retryBufferCredits: altRetry,
        hardCap: altHardCap,
        fitsInHardCap: altBase + altRetry <= altHardCap,
        samplingNote:
          altBase + altRetry > altHardCap
            ? "Full 403-event ALT pull exceeds 4200 — authorize higher cap or sample ≤336 events (336×10×1.25=4200)"
            : "Full ALT cohort fits hard cap",
      },
      endpoint: ODDS_PROVIDER.historicalEventEndpoint,
      eventIds: altIds,
    },
    proposedCaps: {
      featuredSpreadsTotalsHardCap: featuredHardCap,
      altSpreadsHardCap: altHardCap,
      combinedMaximumIfBoth: featuredHardCap + altHardCap,
      recommendation:
        "Authorize featured spreads+totals first (cap 4200). Defer ALTs until totals/spreads land, or authorize separate ALT cap / sampled event list.",
    },
    oddsApiKey: opts.oddsKeyConfigured ? "SET" : "UNSET",
  };
}
