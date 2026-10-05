// When /sports/simulate/props returns null (stale server deploy, missing athleteId
// resolution, etc.), grade props from the same ESPN game logs the stats UI uses.
// Mirrors simulatorLocalSim — real history only, never fabricated.
//
// Phase 2.3: prefer authoritative history returned with prop-sim (same ESPN
// material propsim-ctx already loaded). Still runs enrichment — does not skip —
// but avoids duplicate provider acquisition when shareable fields overlap.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { PropPoolEntry, PropSimPlayerHistoryPayload } from "./api.ts";
import { getPlayerHistory, searchPlayer } from "./api.ts";
import { pickPlayerSearchResult } from "./playerSearchPick.ts";
import type { PlayerHistorySlice } from "./pickScoreContext.ts";
import { propSimLookupKey } from "./propSelection.ts";
import { localPropSimulation, type LocalHistorySlice } from "./simulatorLocalSim.ts";
import { clipPropSimHitForGrade } from "./simMarketSupport.ts";
import { normalizeHistorySport } from "./coachFootballPropsOnlyGrade.ts";
import {
  COACH_CONTEXT_TTL_MS,
  rememberCoachContextCache,
} from "./coachContextCache.ts";

export type PropSimHit = { hitProbability: number | null; nullReason?: string | null };

export type EnrichCoachPropSimResult = {
  hits: Map<string, PropSimHit>;
  /** Player#athleteId slices for holistic trend/form scoring during board scan. */
  playerHistory: Record<string, PlayerHistorySlice>;
  /** How many athletes reused prop-sim authoritative history (no client HTTP). */
  historyReused: number;
  /** How many athletes still required getPlayerHistory. */
  historyFetched: number;
};

function poolRowForPick(pick: ParsedPick, pool: PropPoolEntry[]): PropPoolEntry | undefined {
  const side = pick.propSide === "Under" ? "Under" : pick.propSide === "Over" ? "Over" : null;
  if (!side || pick.propLine == null) return undefined;
  return (
    pool.find(
      (e) =>
        e.player === pick.player &&
        e.side === side &&
        e.line === pick.propLine &&
        (pick.game ? e.game === pick.game : true),
    ) ?? pool.find((e) => e.player === pick.player && e.side === side)
  );
}

function simKeyForPick(pick: ParsedPick, pool: PropPoolEntry[]): string | null {
  return propSimLookupKey(pick, poolRowForPick(pick, pool));
}

async function resolveAthleteId(
  player: string,
  sport: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const sr = await searchPlayer(player, signal);
    const hit = pickPlayerSearchResult(sr.results ?? [], player, sport);
    return hit?.athleteId ?? null;
  } catch {
    return null;
  }
}

function historySliceFromApi(
  player: string,
  h: Awaited<ReturnType<typeof getPlayerHistory>>,
): PlayerHistorySlice {
  return {
    player,
    recent: (h.recent ?? []).slice(0, 10).map((g) => ({
      date: g.date ?? undefined,
      opp: g.opponentName ?? undefined,
      stats: g.stats,
    })),
    vsOpponent: (h.vsOpponent ?? []).slice(0, 5).map((g) => ({
      date: g.date ?? undefined,
      stats: g.stats,
    })),
    minutesTrend: h.minutesTrend ?? null,
  };
}

function historySliceFromShared(
  player: string,
  h: PropSimPlayerHistoryPayload,
): PlayerHistorySlice {
  return {
    player,
    labels: h.labels,
    recent: (h.recent ?? []).slice(0, 10).map((g) => ({
      date: g.date ?? undefined,
      opp: g.opponentName ?? undefined,
      stats: g.stats,
    })),
    vsOpponent: (h.vsOpponent ?? []).slice(0, 5).map((g) => ({
      date: g.date ?? undefined,
      stats: g.stats,
    })),
    minutesTrend: h.minutesTrend
      ? {
          l5: h.minutesTrend.l5 ?? null,
          l10: h.minutesTrend.l10 ?? null,
          season: h.minutesTrend.season ?? null,
          direction: h.minutesTrend.direction ?? null,
        }
      : null,
  };
}

function localSliceFromShared(h: PropSimPlayerHistoryPayload): LocalHistorySlice {
  return {
    labels: h.labels,
    recent: (h.recent ?? []).map((g) => ({ stats: g.stats ?? {} })),
  };
}

function seedClientHistoryCache(h: PropSimPlayerHistoryPayload): void {
  // Seed the same path key getPlayerHistory would use so concurrent callers
  // join the warm entry instead of issuing a duplicate provider HTTP.
  const q = new URLSearchParams({ sport: h.sport, athleteId: h.athleteId });
  const path = `/sports/player-history?${q.toString()}`;
  rememberCoachContextCache(
    path,
    {
      sport: h.sport,
      athleteId: h.athleteId,
      labels: h.labels,
      recent: h.recent,
      vsOpponent: h.vsOpponent ?? [],
      minutesTrend: h.minutesTrend ?? null,
    },
    COACH_CONTEXT_TTL_MS.playerHistory,
  );
}

/** Fill null server MC hits using shared prop-sim history and/or /sports/player-history. */
export async function enrichCoachPropSimHits(
  batch: ParsedPick[],
  pool: PropPoolEntry[],
  hits: Map<string, PropSimHit>,
  signal?: AbortSignal,
  sharedHistories?: Record<string, PropSimPlayerHistoryPayload>,
): Promise<EnrichCoachPropSimResult> {
  const out = new Map(hits);
  const playerHistory: Record<string, PlayerHistorySlice> = {};
  const pending: ParsedPick[] = [];
  let historyReused = 0;
  let historyFetched = 0;

  // Always materialize player history for holistic matchup/form — not only when
  // MC is null. Phase 2.3 reuses authoritative shared history when present.
  const historyNeeded: typeof pending = [];
  for (const pick of batch) {
    const key = simKeyForPick(pick, pool);
    if (!key) continue;
    const row = out.get(key);
    historyNeeded.push(pick);
    // Exact 0/1 on binary TD markets is not a usable grade — soft-clip in place
    // (or fall through to local history) instead of treating as "already simulated".
    if (row?.hitProbability != null && Number.isFinite(row.hitProbability)) {
      const clipped = clipPropSimHitForGrade(pick, row.hitProbability);
      if (clipped != null && clipped !== row.hitProbability) {
        out.set(key, { hitProbability: clipped, nullReason: null });
        continue;
      }
      if (row.hitProbability > 0 && row.hitProbability < 1) continue;
      // Unclipped extreme 0/1 on non-binary markets: try local fallback.
    }
    pending.push(pick);
  }

  if (!pending.length && !historyNeeded.length) {
    return { hits: out, playerHistory, historyReused, historyFetched };
  }

  const historyCache = new Map<string, LocalHistorySlice>();
  const athleteIdCache = new Map<string, string | null>();

  async function athleteIdForPick(pick: ParsedPick): Promise<string | null> {
    const poolRow = poolRowForPick(pick, pool);
    const direct = pick.athleteId ?? poolRow?.athleteId;
    if (direct) return String(direct);
    const player = pick.player;
    if (!player) return null;
    const sport = normalizeHistorySport(pick.sport ?? poolRow?.sport) || "nba";
    const cacheKey = `${sport}:${player}`;
    if (athleteIdCache.has(cacheKey)) return athleteIdCache.get(cacheKey) ?? null;
    const resolved = await resolveAthleteId(player, sport, signal);
    athleteIdCache.set(cacheKey, resolved);
    return resolved;
  }

  await Promise.all(
    historyNeeded.map(async (pick) => {
      const athleteId = await athleteIdForPick(pick);
      if (!athleteId || !pick.player) return;
      const poolRow = poolRowForPick(pick, pool);
      const sport = normalizeHistorySport(pick.sport ?? poolRow?.sport) || "nba";
      const cacheKey = `${sport}:${athleteId}`;
      if (historyCache.has(cacheKey)) return;

      const shared = sharedHistories?.[athleteId];
      if (shared?.recent?.length) {
        seedClientHistoryCache(shared);
        historyCache.set(cacheKey, localSliceFromShared(shared));
        playerHistory[`${pick.player}#${athleteId}`] = historySliceFromShared(pick.player, shared);
        historyReused += 1;
        return;
      }

      try {
        const h = await getPlayerHistory({ sport, athleteId }, signal);
        if (!h.recent?.length) return;
        historyCache.set(cacheKey, {
          labels: h.labels,
          recent: h.recent.map((g) => ({ stats: g.stats })),
        });
        playerHistory[`${pick.player}#${athleteId}`] = historySliceFromApi(pick.player, h);
        historyFetched += 1;
      } catch {
        /* honest skip */
      }
    }),
  );

  for (const pick of pending) {
    const key = simKeyForPick(pick, pool);
    if (!key) continue;
    const poolRow = poolRowForPick(pick, pool);
    const athleteId = await athleteIdForPick(pick);
    if (!athleteId) {
      if (!out.has(key) || out.get(key)?.hitProbability == null) {
        out.set(key, { hitProbability: null, nullReason: "missing_athlete_id" });
      }
      continue;
    }
    const sport = normalizeHistorySport(pick.sport ?? poolRow?.sport) || "nba";
    const hist = historyCache.get(`${sport}:${athleteId}`);
    const market = pick.propMarketKey ?? poolRow?.marketKey;
    const side = pick.propSide === "Under" ? "Under" : "Over";
    if (!market || pick.propLine == null) continue;

    const local = localPropSimulation(hist, {
      player: pick.player!,
      market,
      line: pick.propLine,
      side,
    });
    if (local?.hitProbability == null) {
      if (!out.has(key) || out.get(key)?.hitProbability == null) {
        out.set(key, {
          hitProbability: null,
          nullReason: hist?.recent?.length ? "insufficient_game_log" : "no_player_history",
        });
      }
      continue;
    }
    out.set(key, { hitProbability: local.hitProbability, nullReason: null });
  }

  return { hits: out, playerHistory, historyReused, historyFetched };
}
