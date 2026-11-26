import { readFile, stat } from "node:fs/promises";
import { simulateNbaPossessions, summarizeNbaDraws, type NbaDraws, type NbaLine, type NbaPregame } from "./nbaPossessionV3.js";

let source: { path: string; stamp: number; snapshots: NbaPregame[] } | undefined;
const cache = new Map<string, { signature: string; draws: NbaDraws }>();

/** The review service receives authenticated pregame snapshots out of band. */
export async function nbaPossessionReview(input: {
  eventId: string; homeId: string; awayId: string; queries: readonly NbaLine[]; retainOutcomes: boolean;
}) {
  const path = process.env.NBA_POSSESSION_REVIEW_SNAPSHOTS;
  if (!path) return null;
  const info = await stat(path);
  if (info.size > 10_000_000) throw new RangeError("NBA snapshot file too large");
  if (!source || source.path !== path || source.stamp !== info.mtimeMs) {
    const snapshots: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(snapshots)) throw new RangeError("NBA snapshots must be an array");
    source = { path, stamp: info.mtimeMs, snapshots };
  }
  const now = Date.now();
  const snapshot = source.snapshots.filter(s => s.eventId === input.eventId && s.home?.id === input.homeId &&
    s.away?.id === input.awayId && s.availableAt <= now && s.availableAt < s.startsAt)
    .sort((a, b) => b.availableAt - a.availableAt)[0];
  if (!snapshot) return null;
  // The odds thresholds requested by the UI are scored after retrieval.
  const signature = JSON.stringify(snapshot);
  let entry = cache.get(input.eventId);
  const cacheHit = entry?.signature === signature;
  if (!entry || entry.signature !== signature) {
    const seed = [...input.eventId].reduce((value, c) => Math.imul(value ^ c.charCodeAt(0), 16777619), 2166136261);
    entry = { signature, draws: simulateNbaPossessions(snapshot, seed) };
  }
  cache.delete(input.eventId);
  cache.set(input.eventId, entry);
  if (cache.size > 4) cache.delete(cache.keys().next().value!);
  return { ...summarizeNbaDraws(entry.draws, input.queries, input.retainOutcomes), nbaDrawCacheHit: cacheHit };
}
