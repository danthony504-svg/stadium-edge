import { archiveOddsPlan, MINUTE, oddsQuotaHeaders, readFirstBasketArchiveDay, slateDate, storeFirstBasketRecord, type OddsRecord } from "./nbaFirstBasketArchive.js";
import { firstBasketMarkets, validateFirstBasketSnapshot, type FirstBasketSnapshot } from "./nbaFirstBasketModel.js";
import type { RawFirstBasketOdds } from "./nbaFirstBasketOdds.js";
import type { FirstBasketCapture } from "./nbaFirstBasketService.js";

export async function collectFirstBasket(root: string, input: FirstBasketCapture, options: {
  now: () => number;
  requestOdds?: (id: string) => Promise<Response>;
  fastReserve?: number;
}) {
  const at = options.now();
  const snapshots = input.snapshots.filter(game => validateFirstBasketSnapshot(game) &&
    game.availableAt <= at && game.startsAt > at && game.startsAt - at <= 2 * 86_400_000);
  const games = new Map<string, FirstBasketSnapshot>();
  for (const game of snapshots) {
    if ((games.get(game.eventId)?.availableAt ?? 0) <= game.availableAt) games.set(game.eventId, game);
    await storeFirstBasketRecord(root, { kind: "lineup", at, snapshot: game }, slateDate(game.startsAt));
  }
  const days = new Set([slateDate(at - 45 * MINUTE), slateDate(at), ...[...games.values()].map(game => slateDate(game.startsAt))]);
  const existing = (await Promise.all([...days].map(day => readFirstBasketArchiveDay(root, day, "odds")))).flat();
  const odds = existing.filter((item): item is OddsRecord => item.kind === "odds" && item.at <= at)
    .sort((a, b) => b.at - a.at);
  const byKey = new Map<string, OddsRecord>();
  for (const record of odds) if (!byKey.has(record.key)) byKey.set(record.key, record);
  let quota = odds[0];
  let requests = 0;
  if (options.requestOdds) {
    for (const game of [...games.values()].sort((a, b) => a.startsAt - b.startsAt)) {
      const now = options.now();
      const plan = archiveOddsPlan(game, now, quota, options.fastReserve);
      const previous = plan && byKey.get(plan.key);
      if (!plan || (previous && now - previous.at < plan.ttlMs) ||
          (quota && now - quota.at < 5 * MINUTE && quota.remaining != null && quota.remaining < firstBasketMarkets.length)) continue;
      const next: OddsRecord = {
        kind: "odds", at: now, eventId: game.eventId, key: plan.key, status: null, credits: null, remaining: null, response: null,
      };
      try {
        const response = await options.requestOdds(plan.oddsId);
        next.status = response.status;
        Object.assign(next, oddsQuotaHeaders(response.headers));
        if (response.ok) {
          const body = await response.json() as RawFirstBasketOdds;
          if (body?.id === plan.oddsId) next.response = body;
        }
      } catch {
        // Archive the attempt and any returned quota headers even if decoding failed.
      }
      next.at = options.now();
      await storeFirstBasketRecord(root, next, slateDate(game.startsAt));
      byKey.set(plan.key, next);
      quota = next;
      requests++;
    }
  }
  await storeFirstBasketRecord(root, { kind: "poll", at, eventsSeen: games.size });
  return { eventsSeen: games.size, requests };
}

export function fetchFirstBasketArchiveOdds(apiKey: string, oddsId: string) {
  const query = new URLSearchParams({ apiKey, regions: "us", markets: firstBasketMarkets.join(","), oddsFormat: "american" });
  return fetch(`https://api.the-odds-api.com/v4/sports/basketball_nba/events/${oddsId}/odds?${query}`,
    { signal: AbortSignal.timeout(5000) });
}
