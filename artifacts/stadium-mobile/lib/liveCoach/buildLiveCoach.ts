/**
 * Live Coach Phase 2A — build NBA/WNBA live main recommendations.
 *
 * Isolated from buildParlay / pregame Monte Carlo / ticket staging.
 * If only K of N requested picks qualify, return K — never lower gates.
 */

import type { ParsedPick } from "../../components/PickCard.tsx";
import { getLiveOdds, type LiveOddsFeed } from "../api.ts";
import {
  liveGameFromFeedRow,
  livePriceFromFeedRow,
  normalizeLiveMarkets,
} from "./liveMarketNormalize.ts";
import { isLiveRecommendationEligible } from "./liveEligibility.ts";
import {
  parseLiveCoachIntent,
  type LiveCoachIntent,
} from "./liveCoachIntent.ts";
import {
  gradeLiveMarket,
  liveConfidencePct,
  liveCoverQueryFromMarket,
  liveGradeLetter,
  type LiveMarketGrade,
} from "./liveMarketGrade.ts";
import {
  runRemainingGameSim,
  type LiveBasketballSport,
  type LiveCoverQuery,
  type RemainingGameSimResult,
} from "./remainingGameSim.ts";
import type { LiveGameStateRecord, NormalizedLiveMarket } from "./types.ts";

export type LiveCoachTeamBaseline = {
  eventId: string;
  homeBaselinePpg?: number | null;
  awayBaselinePpg?: number | null;
};

export type LiveCoachBuildOpts = {
  askText: string;
  signal?: AbortSignal;
  /** Injected feed for deterministic tests. */
  feed?: LiveOddsFeed;
  /** Optional pregame PPG by event when reliable data exists. */
  baselines?: LiveCoachTeamBaseline[];
  /** Fixed seed for remaining-game sims (tests). */
  seed?: number;
  nowMs?: number;
  onStatus?: (status: string) => void;
};

export type LiveCoachRecommendation = {
  market: NormalizedLiveMarket;
  grade: LiveMarketGrade;
  sim: RemainingGameSimResult;
  pick: ParsedPick;
};

export type LiveCoachBuildResult = {
  intent: LiveCoachIntent;
  recommendations: LiveCoachRecommendation[];
  picks: ParsedPick[];
  /** Why markets were skipped (eligibility / grade). */
  rejectedCount: number;
  note: string;
};

function formatAge(ageMs: number | null): string {
  if (ageMs == null || !Number.isFinite(ageMs)) return "age unknown";
  if (ageMs < 1000) return "<1s";
  if (ageMs < 60_000) return `${Math.round(ageMs / 1000)}s`;
  return `${Math.round(ageMs / 60_000)}m`;
}

function formatScore(m: NormalizedLiveMarket): string {
  const a = m.awayScore;
  const h = m.homeScore;
  if (a == null || h == null) return "—";
  return `${a}–${h}`;
}

function formatPeriodClock(m: NormalizedLiveMarket): string {
  const pl = m.periodLabel?.trim() || (m.period != null ? `Q${m.period}` : "—");
  const clock = m.clock?.trim() || "";
  return clock ? `${pl} ${clock}` : pl;
}

/**
 * Map a graded live market to a ParsedPick with visible LIVE metadata.
 */
export function liveRecommendationToPick(
  m: NormalizedLiveMarket,
  grade: LiveMarketGrade,
): ParsedPick {
  const conf = liveConfidencePct(grade);
  const letter = liveGradeLetter(grade);
  const edgeStr =
    grade.edgePct > 0 ? `+${grade.edgePct.toFixed(1)}%` : `${grade.edgePct.toFixed(1)}%`;
  return {
    game: m.matchup,
    market: m.market,
    pick: m.pick,
    odds: grade.price,
    sport: m.sport,
    isProp: false,
    edge: `LIVE · ${formatScore(m)} · ${formatPeriodClock(m)} · edge ${edgeStr} · ${formatAge(m.ageMs)}`,
    liveCoach: {
      live: true,
      matchup: m.matchup,
      score: formatScore(m),
      awayScore: m.awayScore,
      homeScore: m.homeScore,
      period: m.period,
      periodLabel: m.periodLabel,
      clock: m.clock,
      line: grade.line,
      price: grade.price,
      freshness: m.freshness,
      ageMs: m.ageMs,
      edgePct: grade.edgePct,
      fairProb: grade.fairProb,
      impliedProb: grade.impliedProb,
      confidencePct: conf,
      source: m.source,
      eventId: m.eventId,
    },
    finalAiScore: {
      grade: letter,
      confidencePct: conf,
      edgePct: grade.edgePct,
      simHit: grade.fairProb,
      simAligned: true,
      highRiskValuePlay: false,
      recommends: true,
      composite: Math.min(10, Math.max(1, 5 + grade.edgePct / 2)),
      factors: [
        {
          key: "simulation",
          label: "Live remaining sim",
          score: Math.min(10, Math.max(1, grade.fairProb * 10)),
          display: `${(grade.fairProb * 100).toFixed(1)}% fair`,
        },
        {
          key: "lineValue",
          label: "Live edge",
          score: Math.min(10, Math.max(1, 5 + grade.edgePct / 2)),
          display: `${grade.edgePct > 0 ? "+" : ""}${grade.edgePct.toFixed(1)}%`,
        },
      ],
      rubric: {
        scores: {
          matchup: null,
          trend: null,
          lineValue: Math.min(10, Math.max(1, 5 + grade.edgePct / 2)),
          injury: null,
          lineShopping: null,
          simulation: Math.min(10, Math.max(1, grade.fairProb * 10)),
        },
        composite: Math.min(10, Math.max(1, 5 + grade.edgePct / 2)),
        grade: letter,
        confidencePct: conf,
        edgePct: grade.edgePct,
      },
      propHolistic: null,
    },
  };
}

function sportList(intent: LiveCoachIntent): LiveBasketballSport[] {
  if (intent.sport === "nba") return ["nba"];
  if (intent.sport === "wnba") return ["wnba"];
  return ["nba", "wnba"];
}

function feedToNormalized(opts: {
  feed: LiveOddsFeed;
  sports: LiveBasketballSport[];
  nowMs?: number;
}): NormalizedLiveMarket[] {
  const sportSet = new Set(opts.sports);
  const games: LiveGameStateRecord[] = [];
  for (const g of opts.feed.games ?? []) {
    if (!sportSet.has(String(g.sport).toLowerCase() as LiveBasketballSport)) continue;
    games.push(
      liveGameFromFeedRow({
        ...g,
        game: g.game,
        state: g.state ?? g.status,
      }),
    );
  }
  const prices = [];
  for (const o of opts.feed.odds ?? []) {
    if (!sportSet.has(String(o.sport).toLowerCase() as LiveBasketballSport)) continue;
    // Live board quotes with finite odds are treated as open when status omitted
    // (ESPN pickcenter does not emit suspended flags on these rows).
    prices.push(
      livePriceFromFeedRow({
        ...o,
        game: o.game,
        odds: o.odds,
        marketStatus: (o as { marketStatus?: string | null }).marketStatus ?? "open",
      }),
    );
  }
  const { markets } = normalizeLiveMarkets({
    games,
    prices,
    nowMs: opts.nowMs,
  });
  return markets;
}

type EventSimBundle = {
  sim: RemainingGameSimResult;
  queryByMarketKey: Map<string, LiveCoverQuery>;
};

function marketKey(m: NormalizedLiveMarket): string {
  return `${m.eventId}|${m.market}|${m.pick}|${m.line ?? "ml"}|${m.price}`;
}

/**
 * Build Live Coach recommendations for NBA/WNBA live mains.
 */
export async function buildLiveCoachRecommendations(
  opts: LiveCoachBuildOpts,
): Promise<LiveCoachBuildResult> {
  const intent = parseLiveCoachIntent(opts.askText);
  if (!intent.wantsLive) {
    return {
      intent,
      recommendations: [],
      picks: [],
      rejectedCount: 0,
      note: "",
    };
  }

  const sports = sportList(intent);
  opts.onStatus?.("Pulling live NBA/WNBA board…");

  const feed =
    opts.feed ??
    (await getLiveOdds(sports, opts.signal));

  if (opts.signal?.aborted) {
    return {
      intent,
      recommendations: [],
      picks: [],
      rejectedCount: 0,
      note: "Cancelled.",
    };
  }

  const markets = feedToNormalized({
    feed,
    sports,
    nowMs: opts.nowMs,
  });

  const eligible: NormalizedLiveMarket[] = [];
  let rejectedCount = 0;
  for (const m of markets) {
    if (isLiveRecommendationEligible(m)) eligible.push(m);
    else rejectedCount += 1;
  }

  opts.onStatus?.("Running remaining-game Live Coach sims…");

  const baselineByEvent = new Map<string, LiveCoachTeamBaseline>();
  for (const b of opts.baselines ?? []) baselineByEvent.set(b.eventId, b);

  // Group eligible markets by event — one remaining-game sim per event.
  const byEvent = new Map<string, NormalizedLiveMarket[]>();
  for (const m of eligible) {
    const arr = byEvent.get(m.eventId) ?? [];
    arr.push(m);
    byEvent.set(m.eventId, arr);
  }

  const simByEvent = new Map<string, EventSimBundle>();
  for (const [eventId, eventMarkets] of byEvent) {
    const first = eventMarkets[0]!;
    const sport = String(first.sport).toLowerCase() as LiveBasketballSport;
    const queries: LiveCoverQuery[] = [];
    const queryByMarketKey = new Map<string, LiveCoverQuery>();
    for (const m of eventMarkets) {
      const q = liveCoverQueryFromMarket(m);
      if (!q) {
        rejectedCount += 1;
        continue;
      }
      queries.push(q);
      queryByMarketKey.set(marketKey(m), q);
    }
    if (!queries.length) continue;

    const baseline = baselineByEvent.get(eventId);
    // Seed mixes optional fixed seed with eventId for stability across events.
    const seed =
      opts.seed != null
        ? (opts.seed ^ hashStr(eventId)) >>> 0
        : undefined;

    const sim = runRemainingGameSim({
      sport,
      homeScore: first.homeScore!,
      awayScore: first.awayScore!,
      period: first.period!,
      clock: first.clock!,
      periodLabel: first.periodLabel,
      homeBaselinePpg: baseline?.homeBaselinePpg ?? null,
      awayBaselinePpg: baseline?.awayBaselinePpg ?? null,
      simulations: 10_000,
      seed,
      coverQueries: queries,
    });
    if (!sim) {
      rejectedCount += eventMarkets.length;
      continue;
    }
    simByEvent.set(eventId, { sim, queryByMarketKey });
  }

  const graded: LiveCoachRecommendation[] = [];
  for (const m of eligible) {
    const bundle = simByEvent.get(m.eventId);
    if (!bundle) continue;
    const q = bundle.queryByMarketKey.get(marketKey(m));
    if (!q) continue;
    const grade = gradeLiveMarket(m, bundle.sim, q);
    if (!grade.qualifies) {
      rejectedCount += 1;
      continue;
    }
    graded.push({
      market: m,
      grade,
      sim: bundle.sim,
      pick: liveRecommendationToPick(m, grade),
    });
  }

  // Best edge first; one pick per event to avoid same-game hammering on short tickets.
  graded.sort((a, b) => b.grade.edgePct - a.grade.edgePct);
  const picked: LiveCoachRecommendation[] = [];
  const usedEvents = new Set<string>();
  for (const row of graded) {
    if (picked.length >= intent.count) break;
    if (usedEvents.has(row.market.eventId)) continue;
    usedEvents.add(row.market.eventId);
    picked.push(row);
  }

  // If still short and other same-event markets qualify, fill without lowering gates.
  if (picked.length < intent.count) {
    for (const row of graded) {
      if (picked.length >= intent.count) break;
      if (picked.some((p) => p.pick.pick === row.pick.pick && p.pick.game === row.pick.game)) {
        continue;
      }
      picked.push(row);
    }
  }

  const sportLabel =
    intent.sport === "nba"
      ? "NBA"
      : intent.sport === "wnba"
        ? "WNBA"
        : "NBA/WNBA";

  let note = "";
  if (picked.length === 0) {
    note = `No qualifying LIVE ${sportLabel} moneyline/spread/total edges right now — freshness, clock, and quality gates held.`;
  } else if (picked.length < intent.count) {
    note = `LIVE Coach found ${picked.length} of ${intent.count} requested ${sportLabel} picks — quality/freshness not lowered to fill.`;
  }

  return {
    intent,
    recommendations: picked,
    picks: picked.map((p) => p.pick),
    rejectedCount,
    note,
  };
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
