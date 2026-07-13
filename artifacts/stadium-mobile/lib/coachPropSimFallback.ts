// When /sports/simulate/props returns null (stale server deploy, missing athleteId
// resolution, etc.), grade props from the same ESPN game logs the stats UI uses.
// Mirrors simulatorLocalSim — real history only, never fabricated.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { PropPoolEntry } from "./api.ts";
import { getPlayerHistory, searchPlayer } from "./api.ts";
import { pickPlayerSearchResult } from "./playerSearchPick.ts";
import { propSimKey } from "./propSelection.ts";
import { localPropSimulation, type LocalHistorySlice } from "./simulatorLocalSim.ts";

export type PropSimHit = { hitProbability: number | null; nullReason?: string | null };

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
  if (!pick.isProp || !pick.player || pick.propLine == null) return null;
  const side = pick.propSide === "Under" ? "Under" : pick.propSide === "Over" ? "Over" : null;
  if (!side) return null;
  const poolRow = poolRowForPick(pick, pool);
  const market = pick.propMarketKey ?? poolRow?.marketKey ?? pick.market ?? "";
  return propSimKey(pick.player, market, pick.propLine, side);
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

/** Fill null server MC hits using /sports/player-history + localPropSimulation. */
export async function enrichCoachPropSimHits(
  batch: ParsedPick[],
  pool: PropPoolEntry[],
  hits: Map<string, PropSimHit>,
  signal?: AbortSignal,
): Promise<Map<string, PropSimHit>> {
  const out = new Map(hits);
  const pending: ParsedPick[] = [];

  for (const pick of batch) {
    const key = simKeyForPick(pick, pool);
    if (!key) continue;
    const row = out.get(key);
    if (row?.hitProbability != null && Number.isFinite(row.hitProbability)) continue;
    pending.push(pick);
  }

  if (!pending.length) return out;

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
      if (!athleteId) return;
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

  return out;
}
