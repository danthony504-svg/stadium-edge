import { readFile, stat } from "node:fs/promises";
import { simulateEventResearch, summarizeEventResearch } from "./eventSimResearch.js";
import type { EventSnapshot } from "./eventKernels.js";
import type { NbaLine } from "./nbaPossessionV3.js";

let source: { path: string; mtime: number; snapshots: EventSnapshot[] } | undefined;
const cache = new Map<string, { signature: string; draws: ReturnType<typeof simulateEventResearch> }>();

export async function eventSimReview(input: {
  sport: string; eventId: string; homeId: string; awayId: string; queries: readonly NbaLine[]; retainOutcomes: boolean;
}) {
  const path = process.env.SPORT_EVENT_REVIEW_SNAPSHOTS;
  if (!path) return null;
  const info = await stat(path);
  if (info.size > 15_000_000) throw new RangeError("Event snapshot file too large");
  if (!source || source.path !== path || source.mtime !== info.mtimeMs) {
    const snapshots: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(snapshots)) throw new RangeError("Event snapshots must be an array");
    source = { path, mtime: info.mtimeMs, snapshots };
  }
  const snapshot = source.snapshots.filter(s => s.sport === input.sport && s.eventId === input.eventId &&
    s.home?.id === input.homeId && s.away?.id === input.awayId &&
    s.availableAt <= Date.now() && s.availableAt < s.startsAt).sort((a, b) => b.availableAt - a.availableAt)[0];
  if (!snapshot) return null;
  const key = JSON.stringify([snapshot.sport, snapshot.eventId]);
  const signature = JSON.stringify(snapshot);
  let entry = cache.get(key);
  const cacheHit = entry?.signature === signature;
  if (!entry || !cacheHit) {
    const seed = [...key].reduce((v, c) => Math.imul(v ^ c.charCodeAt(0), 16777619), 2166136261);
    entry = { signature, draws: simulateEventResearch(snapshot, seed) };
  }
  cache.delete(key);
  cache.set(key, entry);
  if (cache.size > 8) cache.delete(cache.keys().next().value!);
  return { ...summarizeEventResearch(entry.draws, input.queries, input.retainOutcomes), eventDrawCacheHit: cacheHit };
}
