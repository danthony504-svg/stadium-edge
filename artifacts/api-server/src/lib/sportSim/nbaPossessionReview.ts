import { getFirstBasketOpening } from "../nbaFirstBasketService.js";
import { readFile, stat } from "node:fs/promises";
import { simulateNbaPossessions, summarizeNbaDraws, type NbaDraws, type NbaLine, type NbaPregame } from "./nbaPossessionV3.js";

let source: { path: string; stamp: number; snapshots: NbaPregame[] } | undefined;
const cache = new Map<string, { signature: string; draws: NbaDraws }>();

/** The review service receives authenticated pregame snapshots out of band. */
export async function nbaPossessionReview(input: {
  sport?: "nba" | "wnba"; eventId: string; homeId: string; awayId: string; queries: readonly NbaLine[]; retainOutcomes: boolean;
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
  const snapshot = source.snapshots.filter(s => (s.sport ?? "nba") === (input.sport ?? "nba") && s.eventId === input.eventId && s.home?.id === input.homeId &&
    s.away?.id === input.awayId && s.availableAt <= now && s.availableAt < s.startsAt)
    .sort((a, b) => b.availableAt - a.availableAt)[0];
  if (!snapshot) return null;
  // The odds thresholds requested by the UI are scored after retrieval.
  const opening = (input.sport ?? "nba") === "nba" ? await getFirstBasketOpening({
    eventId: input.eventId, homeTeamId: input.homeId, awayTeamId: input.awayId,
    starters: [snapshot.home, snapshot.away].map(team => team.players.filter(player => player.starter).map(player => player.id)),
  }).catch(() => null) : null;
  const simulationSnapshot = opening ? { ...snapshot, opening } : snapshot;
  const signature = JSON.stringify(simulationSnapshot);
  const key = `${input.sport ?? "nba"}:${input.eventId}`;
  let entry = cache.get(key);
  const cacheHit = entry?.signature === signature;
  if (!entry || entry.signature !== signature) {
    const seed = [...input.eventId].reduce((value, c) => Math.imul(value ^ c.charCodeAt(0), 16777619), 2166136261);
    entry = { signature, draws: simulateNbaPossessions(simulationSnapshot, seed) };
  }
  cache.delete(key);
  cache.set(key, entry);
  if (cache.size > 4) cache.delete(cache.keys().next().value!);
  return { ...summarizeNbaDraws(entry.draws, input.queries, input.retainOutcomes), nbaDrawCacheHit: cacheHit };
}
