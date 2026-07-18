// When /sports/simulate/props returns null (stale server deploy, missing athleteId
// resolution, etc.), grade props from the same ESPN game logs the stats UI uses.
// Mirrors simulatorLocalSim — real history only, never fabricated.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { PropPoolEntry } from "./api.ts";
import { getPlayerHistory, searchPlayer } from "./api.ts";
import { pickPlayerSearchResult } from "./playerSearchPick.ts";
import type { PlayerHistorySlice } from "./pickScoreContext.ts";
import { propSimLookupKey } from "./propSelection.ts";
import { localPropSimulation, type LocalHistorySlice } from "./simulatorLocalSim.ts";

export type PropSimHit = { hitProbability: number | null; nullReason?: string | null };

export type EnrichCoachPropSimResult = {
  hits: Map<string, PropSimHit>;
  /** Player#athleteId slices for holistic trend/form scoring during board scan. */
  playerHistory: Record<string, PlayerHistorySlice>;
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
  };
}

/** Fill null server MC hits using /sports/player-history + localPropSimulation. */
export async function enrichCoachPropSimHits(
  batch: ParsedPick[],
  pool: PropPoolEntry[],
  hits: Map<string, PropSimHit>,
  signal?: AbortSignal,
): Promise<EnrichCoachPropSimResult> {
  const out = new Map(hits);
  const playerHistory: Record<string, PlayerHistorySlice> = {};
  if (signal?.aborted) return { hits: out, playerHistory };
  const pending: ParsedPick[] = [];

  for (const pick of batch) {
    const key = simKeyForPick(pick, pool);
    if (!key) continue;
    const row = out.get(key);
    if (row?.hitProbability != null && Number.isFinite(row.hitProbability)) continue;
    pending.push(pick);
  }

  if (!pending.length) return { hits: out, playerHistory };

  const historyCache = new Map<string, LocalHistorySlice>();
  const athleteIdCache = new Map<string, string | null>();

  async function athleteIdForPick(pick: ParsedPick): Promise<string | null> {
    const poolRow = poolRowForPick(pick, pool);
    const direct = pick.athleteId ?? poolRow?.athleteId;
    if (direct) return String(direct);
    const player = pick.player;
    if (!player) return null;
    const sport = (pick.sport ?? poolRow?.sport ?? "nba").toLowerCase();
    const cacheKey = `${sport}:${player}`;
    if (athleteIdCache.has(cacheKey)) return athleteIdCache.get(cacheKey) ?? null;
    const resolved = await resolveAthleteId(player, sport, signal);
    athleteIdCache.set(cacheKey, resolved);
    return resolved;
  }

  await Promise.all(
    pending.map(async (pick) => {
      const athleteId = await athleteIdForPick(pick);
      if (!athleteId || !pick.player) return;
      const poolRow = poolRowForPick(pick, pool);
      const sport = (pick.sport ?? poolRow?.sport ?? "nba").toLowerCase();
      const cacheKey = `${sport}:${athleteId}`;
      if (historyCache.has(cacheKey)) return;
      try {
        const h = await getPlayerHistory({ sport, athleteId }, signal);
        if (!h.recent?.length) return;
        historyCache.set(cacheKey, {
          labels: h.labels,
          recent: h.recent.map((g) => ({ stats: g.stats })),
        });
        playerHistory[`${pick.player}#${athleteId}`] = historySliceFromApi(pick.player, h);
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
    const sport = (pick.sport ?? poolRow?.sport ?? "nba").toLowerCase();
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

  return { hits: out, playerHistory };
}
