// When /sports/simulate/props returns null (stale server deploy, missing athleteId
// resolution, etc.), grade props from the same ESPN game logs the stats UI uses.
// Mirrors simulatorLocalSim — real history only, never fabricated.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { PropPoolEntry } from "./api.ts";
import { getPlayerHistory, searchPlayer } from "./api.ts";
import {
  athleteMemoKey,
  createCoachPropSimHistoryMemo,
  historyMemoKey,
  type CoachPropSimHistoryMemo,
} from "./coachPropSimHistoryMemo.ts";
import { pickPlayerSearchResult } from "./playerSearchPick.ts";
import type { PlayerHistorySlice } from "./pickScoreContext.ts";
import { propSimLookupKey } from "./propSelection.ts";
import { localPropSimulation, type LocalHistorySlice } from "./simulatorLocalSim.ts";

export type PropSimHit = { hitProbability: number | null; nullReason?: string | null };

export type EnrichCoachPropSimResult = {
  hits: Map<string, PropSimHit>;
  /** Player#athleteId slices for holistic trend/form scoring during board scan. */
  playerHistory: Record<string, PlayerHistorySlice>;
  memo: CoachPropSimHistoryMemo;
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
      date: g.date,
      opp: g.opponentName,
      stats: g.stats,
    })),
    vsOpponent: (h.vsOpponent ?? []).slice(0, 5).map((g) => ({
      date: g.date,
      stats: g.stats,
    })),
  };
}

function toLocalHistory(
  h: Awaited<ReturnType<typeof getPlayerHistory>>,
): LocalHistorySlice {
  return {
    labels: h.labels,
    recent: h.recent.map((g) => ({ stats: g.stats })),
  };
}

/**
 * Fill null server MC hits using /sports/player-history + localPropSimulation.
 * Pass a request-scoped `memo` so history is reused across prop-sim batches
 * within one Coach request (no cross-request cache).
 */
export async function enrichCoachPropSimHits(
  batch: ParsedPick[],
  pool: PropPoolEntry[],
  hits: Map<string, PropSimHit>,
  signal?: AbortSignal,
  memo: CoachPropSimHistoryMemo = createCoachPropSimHistoryMemo(),
): Promise<EnrichCoachPropSimResult> {
  const out = new Map(hits);
  const pending: ParsedPick[] = [];

  for (const pick of batch) {
    const key = simKeyForPick(pick, pool);
    if (!key) continue;
    const row = out.get(key);
    if (row?.hitProbability != null && Number.isFinite(row.hitProbability)) {
      memo.stats.fallbackSkippedServerHit += 1;
      continue;
    }
    pending.push(pick);
  }

  if (!pending.length) {
    return { hits: out, playerHistory: { ...memo.playerHistory }, memo };
  }

  async function athleteIdForPick(pick: ParsedPick): Promise<string | null> {
    const poolRow = poolRowForPick(pick, pool);
    const direct = pick.athleteId ?? poolRow?.athleteId;
    if (direct) return String(direct);
    const player = pick.player;
    if (!player) return null;
    const sport = (pick.sport ?? poolRow?.sport ?? "nba").toLowerCase();
    const cacheKey = athleteMemoKey(sport, player);
    if (memo.athleteIdByPlayer.has(cacheKey)) {
      memo.stats.athleteIdCacheHits += 1;
      return memo.athleteIdByPlayer.get(cacheKey) ?? null;
    }
    const inflight = memo.athleteIdInflight.get(cacheKey);
    if (inflight) {
      memo.stats.athleteIdCacheHits += 1;
      return inflight;
    }
    memo.stats.athleteIdCacheMisses += 1;
    const work = resolveAthleteId(player, sport, signal).then((resolved) => {
      memo.athleteIdByPlayer.set(cacheKey, resolved);
      memo.athleteIdInflight.delete(cacheKey);
      return resolved;
    });
    memo.athleteIdInflight.set(cacheKey, work);
    return work;
  }

  async function loadHistory(
    sport: string,
    athleteId: string,
    player: string,
  ): Promise<LocalHistorySlice | null> {
    const cacheKey = historyMemoKey(sport, athleteId);
    if (memo.historyByAthlete.has(cacheKey)) {
      memo.stats.historyCacheHits += 1;
      return memo.historyByAthlete.get(cacheKey) ?? null;
    }
    const inflight = memo.historyInflight.get(cacheKey);
    if (inflight) {
      memo.stats.historyCacheHits += 1;
      return inflight;
    }
    memo.stats.historyCacheMisses += 1;
    const work = (async (): Promise<LocalHistorySlice | null> => {
      try {
        memo.stats.historyFetches += 1;
        const h = await getPlayerHistory({ sport, athleteId }, signal);
        if (!h.recent?.length) {
          memo.historyByAthlete.set(cacheKey, null);
          return null;
        }
        const local = toLocalHistory(h);
        memo.historyByAthlete.set(cacheKey, local);
        memo.playerHistory[`${player}#${athleteId}`] = historySliceFromApi(player, h);
        return local;
      } catch {
        memo.historyByAthlete.set(cacheKey, null);
        return null;
      } finally {
        memo.historyInflight.delete(cacheKey);
      }
    })();
    memo.historyInflight.set(cacheKey, work);
    return work;
  }

  await Promise.all(
    pending.map(async (pick) => {
      const athleteId = await athleteIdForPick(pick);
      if (!athleteId || !pick.player) return;
      const poolRow = poolRowForPick(pick, pool);
      const sport = (pick.sport ?? poolRow?.sport ?? "nba").toLowerCase();
      await loadHistory(sport, athleteId, pick.player);
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
    const sport = (pick.sport ?? poolRow?.sport ?? "nba").toLowerCase();
    const hist = memo.historyByAthlete.get(historyMemoKey(sport, athleteId)) ?? null;
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

  return { hits: out, playerHistory: { ...memo.playerHistory }, memo };
}
