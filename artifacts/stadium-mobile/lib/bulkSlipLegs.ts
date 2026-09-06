type SlipLegKey = { game: string; market: string; pick: string };

const keyFor = (leg: SlipLegKey) =>
  `${leg.game}|${leg.market}|${leg.pick}`.toLowerCase();

/**
 * Builds a single deduplicated slip update while preserving the original pick
 * objects and all of their Coach metadata. Pure so bulk-add behavior can be
 * tested without React state batching.
 */
export function addMissingSlipLegs<T extends SlipLegKey, U extends SlipLegKey>(
  existing: T[],
  displayed: U[],
  maxLegs: number,
  toStored: (pick: U) => T,
): { legs: T[]; sourceCount: number; existingCount: number; addedCount: number } {
  const seen = new Set(existing.map(keyFor));
  let existingCount = 0;
  let addedCount = 0;
  const legs = [...existing];
  for (const pick of displayed) {
    const key = keyFor(pick);
    if (seen.has(key)) {
      existingCount++;
      continue;
    }
    if (legs.length >= maxLegs) continue;
    seen.add(key);
    legs.push(toStored(pick));
    addedCount++;
  }
  return { legs, sourceCount: displayed.length, existingCount, addedCount };
}
