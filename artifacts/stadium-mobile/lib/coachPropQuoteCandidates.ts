import type { PropPoolEntry } from "./api";

/** Score an identical wager once at its best posted price; retain all source quotes for audit. */
export function bestPostedPropQuoteCandidates(pool: readonly PropPoolEntry[]): {
  selected: PropPoolEntry[];
  discarded: PropPoolEntry[];
} {
  const best = new Map<string, PropPoolEntry>();
  const discarded: PropPoolEntry[] = [];
  pool.forEach((row, index) => {
    // Incomplete identity is not sufficient evidence to merge two selections.
    const bindable =
      row.line != null &&
      Number.isFinite(row.line) &&
      row.sport &&
      row.eventId &&
      row.athleteId &&
      row.marketKey &&
      Number.isFinite(row.odds) &&
      row.odds !== 0;
    const key = bindable
      ? JSON.stringify([
          row.sport,
          row.eventId,
          row.athleteId,
          row.player,
          row.game,
          row.marketKey,
          row.side,
          row.line,
          row.playerTeamId ?? null,
          row.teamAbbr ?? null,
        ])
      : `unbound:${index}`;
    const previous = best.get(key);
    if (!previous) {
      best.set(key, row);
      return;
    }
    // American odds are ordered by payout across both signs (zero is invalid).
    if (row.odds > previous.odds) {
      best.set(key, row);
      discarded.push(previous);
    } else discarded.push(row);
  });
  return { selected: [...best.values()], discarded };
}
