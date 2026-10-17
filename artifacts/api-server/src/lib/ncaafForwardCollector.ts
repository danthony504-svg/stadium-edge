/**
 * NCAAF forward odds/injury collector — planning + dry-run helpers.
 *
 * Activation requires explicit NCAAF_FORWARD_ACTIVATE=1 AND a hard credit
 * budget. Default path never calls The Odds API (no paid retrieval).
 *
 * Credential: reuse process.env.ODDS_API_KEY (same as api-server odds routes).
 * Never log, print, or persist the key value.
 */

export const NCAAF_FORWARD_SPORT = "americanfootball_ncaaf" as const;

/** Featured markets for bulk /odds (and historical /odds). */
export const NCAAF_FORWARD_FEATURED_MARKETS = ["h2h", "spreads", "totals"] as const;

/** ALT markets require per-event endpoints (live or historical-event). */
export const NCAAF_FORWARD_ALT_MARKETS = ["alternate_spreads"] as const;

/**
 * Forward live polls use a single US region to keep weekly credits low.
 * (Production `/odds` often uses us,us2 — that doubles live cost; not default here.)
 */
export const NCAAF_FORWARD_REGIONS_LIVE = ["us"] as const;

/** Historical as-of snaps: one region unless explicitly widened. */
export const NCAAF_FORWARD_REGIONS_HISTORICAL = ["us"] as const;

export type CollectorMode = "dry_run" | "live_upcoming" | "historical_asof";

export type CreditEstimate = {
  endpoint: "live_odds" | "historical_odds" | "historical_event_odds" | "espn_injury";
  markets: number;
  regions: number;
  events?: number;
  creditsPerCall: number;
  formula: string;
};

/** Live/upcoming featured: cost = markets × regions. */
export function estimateLiveFeaturedCredits(
  markets = NCAAF_FORWARD_FEATURED_MARKETS.length,
  regions = NCAAF_FORWARD_REGIONS_LIVE.length,
): CreditEstimate {
  const creditsPerCall = markets * regions;
  return {
    endpoint: "live_odds",
    markets,
    regions,
    creditsPerCall,
    formula: "markets × regions",
  };
}

/** Historical featured bulk: cost = 10 × markets × regions. */
export function estimateHistoricalFeaturedCredits(
  markets = NCAAF_FORWARD_FEATURED_MARKETS.length,
  regions = NCAAF_FORWARD_REGIONS_HISTORICAL.length,
): CreditEstimate {
  const creditsPerCall = 10 * markets * regions;
  return {
    endpoint: "historical_odds",
    markets,
    regions,
    creditsPerCall,
    formula: "10 × markets × regions",
  };
}

/**
 * Historical (or live) ALT per event: featured ALTs on event-odds.
 * Historical event-odds: 10 × markets × regions per event.
 */
export function estimateHistoricalAltCreditsPerEvent(
  markets = NCAAF_FORWARD_ALT_MARKETS.length,
  regions = NCAAF_FORWARD_REGIONS_HISTORICAL.length,
): CreditEstimate {
  const creditsPerCall = 10 * markets * regions;
  return {
    endpoint: "historical_event_odds",
    markets,
    regions,
    events: 1,
    creditsPerCall,
    formula: "10 × markets × regions × events",
  };
}

export type WeeklySchedule = {
  sport: typeof NCAAF_FORWARD_SPORT;
  liveRegions: readonly string[];
  featuredMarkets: readonly string[];
  altMarkets: readonly string[];
  /** Live featured polls per calendar week (upcoming slate). */
  liveFeaturedPollsPerWeek: number;
  /** Optional historical T−24h as-of snaps per week (kickoff buckets). */
  historicalT24hBucketsPerWeek: number;
  /** Optional historical close as-of snaps per week. */
  historicalCloseBucketsPerWeek: number;
  /** Events for which ALT historical-event odds are fetched (0 = skip ALTs). */
  altEventsPerWeek: number;
  injuryEspnFreezesPerWeek: number;
};

/** Default forward schedule — reconciled cost model (no activation). */
export const NCAAF_FORWARD_DEFAULT_SCHEDULE: WeeklySchedule = {
  sport: NCAAF_FORWARD_SPORT,
  liveRegions: NCAAF_FORWARD_REGIONS_LIVE,
  featuredMarkets: NCAAF_FORWARD_FEATURED_MARKETS,
  altMarkets: NCAAF_FORWARD_ALT_MARKETS,
  // Sat–heavy FBS: poll live board ~4×/day Fri–Sun + 1× Mon–Thu ≈ 16/week
  liveFeaturedPollsPerWeek: 16,
  // Prefer live for forward; historical reserved for eval backfill (off by default)
  historicalT24hBucketsPerWeek: 0,
  historicalCloseBucketsPerWeek: 0,
  altEventsPerWeek: 0,
  injuryEspnFreezesPerWeek: 14, // 2×/day ESPN freezes (free)
};

export type WeeklyCostBreakdown = {
  schedule: WeeklySchedule;
  liveFeatured: { polls: number; creditsEach: number; credits: number };
  historicalT24h: { buckets: number; creditsEach: number; credits: number };
  historicalClose: { buckets: number; creditsEach: number; credits: number };
  historicalAlts: { events: number; creditsEach: number; credits: number };
  injuryEspn: { freezes: number; credits: 0 };
  totalCreditsPerWeek: number;
  note: string;
};

export function estimateWeeklyCredits(
  schedule: WeeklySchedule = NCAAF_FORWARD_DEFAULT_SCHEDULE,
): WeeklyCostBreakdown {
  const liveEach = estimateLiveFeaturedCredits(
    schedule.featuredMarkets.length,
    schedule.liveRegions.length,
  ).creditsPerCall;
  const histEach = estimateHistoricalFeaturedCredits(
    schedule.featuredMarkets.length,
    schedule.liveRegions.length,
  ).creditsPerCall;
  const altEach = estimateHistoricalAltCreditsPerEvent(
    schedule.altMarkets.length,
    schedule.liveRegions.length,
  ).creditsPerCall;

  const liveFeatured = {
    polls: schedule.liveFeaturedPollsPerWeek,
    creditsEach: liveEach,
    credits: schedule.liveFeaturedPollsPerWeek * liveEach,
  };
  const historicalT24h = {
    buckets: schedule.historicalT24hBucketsPerWeek,
    creditsEach: histEach,
    credits: schedule.historicalT24hBucketsPerWeek * histEach,
  };
  const historicalClose = {
    buckets: schedule.historicalCloseBucketsPerWeek,
    creditsEach: histEach,
    credits: schedule.historicalCloseBucketsPerWeek * histEach,
  };
  const historicalAlts = {
    events: schedule.altEventsPerWeek,
    creditsEach: altEach,
    credits: schedule.altEventsPerWeek * altEach,
  };

  return {
    schedule,
    liveFeatured,
    historicalT24h,
    historicalClose,
    historicalAlts,
    injuryEspn: { freezes: schedule.injuryEspnFreezesPerWeek, credits: 0 },
    totalCreditsPerWeek:
      liveFeatured.credits +
      historicalT24h.credits +
      historicalClose.credits +
      historicalAlts.credits,
    note:
      "Prior 300–800/week assumed HISTORICAL featured snaps (10×). Default forward schedule uses LIVE featured (1×) and leaves historical/ALT at 0 until eval backfill is authorized.",
  };
}

/** Scenario matching the old 300–800 historical-heavy estimate. */
export function historicalHeavyWeeklyEstimate(): WeeklyCostBreakdown {
  return estimateWeeklyCredits({
    ...NCAAF_FORWARD_DEFAULT_SCHEDULE,
    liveFeaturedPollsPerWeek: 0,
    historicalT24hBucketsPerWeek: 10,
    historicalCloseBucketsPerWeek: 10,
    altEventsPerWeek: 0, // ALTs explode cost if enabled
  });
}

export type DedupeKeyParts = {
  sport: string;
  mode: CollectorMode;
  markets: string[];
  regions: string[];
  /** ISO minute bucket for the requested as-of / capture time. */
  snapshotBucketIso: string;
};

export function snapshotBucketIso(captureIso: string): string {
  const d = new Date(captureIso);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid captureIso: ${captureIso}`);
  return d.toISOString().slice(0, 16) + ":00Z";
}

export function buildDedupeKey(parts: DedupeKeyParts): string {
  const markets = [...parts.markets].map((m) => m.trim()).filter(Boolean).sort();
  const regions = [...parts.regions].map((r) => r.trim()).filter(Boolean).sort();
  return [
    parts.sport,
    parts.mode,
    markets.join(","),
    regions.join(","),
    snapshotBucketIso(parts.snapshotBucketIso),
  ].join("|");
}

export type CreditLedger = {
  hardCap: number;
  spent: number;
  remaining: number;
};

export function createCreditLedger(hardCap: number): CreditLedger {
  if (!(hardCap >= 0) || !Number.isFinite(hardCap)) {
    throw new Error("hardCap must be a non-negative finite number");
  }
  return { hardCap, spent: 0, remaining: hardCap };
}

export function canSpend(ledger: CreditLedger, credits: number): boolean {
  return credits >= 0 && ledger.spent + credits <= ledger.hardCap;
}

export function recordSpend(ledger: CreditLedger, credits: number): CreditLedger {
  if (!canSpend(ledger, credits)) {
    throw new Error(
      `credit cap exceeded: need ${credits}, remaining ${ledger.remaining}, cap ${ledger.hardCap}`,
    );
  }
  const spent = ledger.spent + credits;
  return { hardCap: ledger.hardCap, spent, remaining: ledger.hardCap - spent };
}

export type SnapshotMeta = {
  captureTimestamp: string;
  dedupeKey: string;
  sport: string;
  mode: CollectorMode;
  markets: string[];
  regions: string[];
  creditsCharged: number;
  eventCount: number;
  /** Key present without value. */
  credential: "ODDS_API_KEY:set" | "ODDS_API_KEY:unset";
  activated: false;
};

export function buildSnapshotMeta(opts: {
  captureTimestamp: string;
  mode: CollectorMode;
  markets: readonly string[];
  regions: readonly string[];
  creditsCharged: number;
  eventCount: number;
  oddsKeyConfigured: boolean;
}): SnapshotMeta {
  const markets = [...opts.markets];
  const regions = [...opts.regions];
  return {
    captureTimestamp: opts.captureTimestamp,
    dedupeKey: buildDedupeKey({
      sport: NCAAF_FORWARD_SPORT,
      mode: opts.mode,
      markets,
      regions,
      snapshotBucketIso: opts.captureTimestamp,
    }),
    sport: NCAAF_FORWARD_SPORT,
    mode: opts.mode,
    markets,
    regions,
    creditsCharged: opts.creditsCharged,
    eventCount: opts.eventCount,
    credential: opts.oddsKeyConfigured ? "ODDS_API_KEY:set" : "ODDS_API_KEY:unset",
    activated: false,
  };
}

export function activationAllowed(env: NodeJS.ProcessEnv = process.env): {
  allowed: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  const activate = String(env.NCAAF_FORWARD_ACTIVATE ?? "").trim() === "1";
  if (!activate) reasons.push("NCAAF_FORWARD_ACTIVATE!=1");
  const cap = Number(env.NCAAF_FORWARD_CREDIT_CAP ?? "");
  if (!Number.isFinite(cap) || cap <= 0) reasons.push("NCAAF_FORWARD_CREDIT_CAP unset or ≤0");
  const key = Boolean(String(env.ODDS_API_KEY ?? "").trim());
  if (!key) reasons.push("ODDS_API_KEY unset");
  // Explicitly refuse paid path in prepare-only agent turns unless all set —
  // callers still must not fetch when allowed is false.
  return { allowed: reasons.length === 0, reasons };
}
