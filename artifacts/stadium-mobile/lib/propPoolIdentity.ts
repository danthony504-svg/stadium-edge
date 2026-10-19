import { isBinaryNullLineMarket } from "./binaryPropMarket.ts";
import { propSharedDistributionMarketKey } from "./propSharedDistribution.ts";

type PoolIdentity = { player: string; side: string; line: number | null;
  marketKey?: string | null; game?: string; sport?: string | null;
  athleteId?: string | null; eventId?: string | null };
type PickIdentity = { player?: string; propSide?: string | null; propLine?: number | null;
  propMarketKey?: string | null; game?: string; sport?: string | null;
  athleteId?: string | null; eventId?: string | null };

/** Never borrow another stat, side or rematch's quote/identity metadata. */
export function findExactPropPoolRow<T extends PoolIdentity>(pick: PickIdentity, pool: readonly T[]): T | undefined {
  const side = pick.propSide === "Yes" ? "Over" : pick.propSide === "No" ? "Under" : pick.propSide;
  const market = propSharedDistributionMarketKey(pick.propMarketKey);
  const line = pick.propLine ?? (isBinaryNullLineMarket(pick.propMarketKey) ? 0.5 : null);
  if (!pick.player || !side || line == null) return undefined;
  const matches = pool.filter(row => {
    if (row.player !== pick.player || row.side !== side) return false;
    if (market && propSharedDistributionMarketKey(row.marketKey) !== market) return false;
    if (pick.game && row.game !== pick.game) return false;
    for (const key of ["sport", "athleteId", "eventId"] as const) {
      if (pick[key] && row[key] && pick[key] !== row[key]) return false;
    }
    return row.line === line || (row.line == null && line === 0.5 && isBinaryNullLineMarket(row.marketKey));
  });
  const identities = new Set(matches.map(row => [row.sport, row.eventId ?? row.game,
    row.athleteId ?? row.player, propSharedDistributionMarketKey(row.marketKey)].join("|")));
  return identities.size === 1 ? matches[0] : undefined;
}
