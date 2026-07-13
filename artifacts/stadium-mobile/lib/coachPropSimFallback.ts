// When /sports/simulate/props returns null (stale server deploy, missing athleteId
// resolution, etc.), grade props from the same ESPN game logs the stats UI uses.
// Mirrors simulatorLocalSim — real history only, never fabricated.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { PropPoolEntry } from "./api.ts";
import { getPlayerHistory } from "./api.ts";
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

  await Promise.all(
    pending.map(async (pick) => {
      const poolRow = poolRowForPick(pick, pool);
      const athleteId = pick.athleteId ?? poolRow?.athleteId;
      if (!athleteId) return;
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
    const athleteId = pick.athleteId ?? poolRow?.athleteId;
    if (!athleteId) continue;
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
    if (local?.hitProbability == null) continue;
    out.set(key, { hitProbability: local.hitProbability, nullReason: null });
  }

  return out;
}
