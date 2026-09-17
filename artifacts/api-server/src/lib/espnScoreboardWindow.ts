/**
 * ESPN scoreboard date helpers.
 *
 * As of 2026-09, ESPN rejects hyphenated date ranges (`YYYYMMDD-YYYYMMDD`) and
 * comma lists with HTTP 400 "Failed to get events endpoint." Single-day
 * `?dates=YYYYMMDD` still works. Build a day list and merge responses instead.
 */

export function espnUtcDayKey(d: Date): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Inclusive UTC day keys from `daysBack` before now through `daysForward` after. */
export function espnScoreboardDayKeys(
  nowMs: number,
  daysBack = 1,
  daysForward = 7,
): string[] {
  const now = new Date(nowMs);
  const keys: string[] = [];
  for (let i = -daysBack; i <= daysForward; i++) {
    keys.push(espnUtcDayKey(new Date(now.getTime() + i * 24 * 60 * 60 * 1000)));
  }
  return keys;
}

export type EspnEventLike = { id?: string };

/** Dedupe ESPN events by id, preserving first-seen order. */
export function mergeEspnEventsById<T extends EspnEventLike>(batches: T[][]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const batch of batches) {
    for (const e of batch) {
      const id = e?.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(e);
    }
  }
  return out;
}
