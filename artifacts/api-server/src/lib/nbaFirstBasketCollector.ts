import { randomUUID } from "node:crypto";
import { archiveOddsPlan, MINUTE, oddsQuotaHeaders, readFirstBasketArchiveDay, slateDate, storeFirstBasketRecord, type OddsRecord } from "./nbaFirstBasketArchive.js";
import { firstBasketMarkets, validateFirstBasketSnapshot, type FirstBasketSnapshot } from "./nbaFirstBasketModel.js";
import type { RawFirstBasketOdds } from "./nbaFirstBasketOdds.js";
import type { FirstBasketCapture } from "./nbaFirstBasketInput.js";

const MAX_CHARGE = firstBasketMarkets.length;
type Limits = { creditsPerGame: number; creditsPerSlate: number; reserve: number };
const debited = (row: OddsRecord) => row.credits ?? row.reservedCredits ?? MAX_CHARGE;

function quotePayload(raw: unknown, id: string, secrets: readonly string[]): RawFirstBasketOdds | null {
  if (!raw || typeof raw !== "object" || !("id" in raw) || raw.id !== id) return null;
  const data = raw as RawFirstBasketOdds;
  const safe = (value: unknown) => typeof value === "string" && !secrets.some(secret => secret && value.includes(secret)) &&
    !/:\/\/|(?:api[-_]?key|authorization|bearer)\s*[:=]/i.test(value) ? value : undefined;
  return {
    id, commence_time: safe(data.commence_time),
    bookmakers: (Array.isArray(data.bookmakers) ? data.bookmakers : []).flatMap(book => {
      const key = safe(book?.key);
      if (!key) return [];
      return [{ key, markets: (Array.isArray(book.markets) ? book.markets : []).flatMap(market => {
        const marketKey = safe(market?.key);
        if (!marketKey || !firstBasketMarkets.some(allowed => marketKey === allowed)) return [];
        return [{ key: marketKey, last_update: safe(market.last_update),
          outcomes: (Array.isArray(market.outcomes) ? market.outcomes : []).flatMap(outcome => {
            const name = safe(outcome?.name);
            const description = safe(outcome?.description);
            if (!name || (outcome.description != null && !description) || typeof outcome.price !== "number" || !Number.isFinite(outcome.price)) return [];
            return [{ name, description, price: outcome.price }];
          }) }];
      }) }];
    }),
  };
}

export async function collectFirstBasket(root: string, input: FirstBasketCapture, options: {
  now: () => number;
  requestOdds?: (id: string) => Promise<Response>;
  readRemaining?: () => Promise<number | null>;
  limits?: Limits;
  fastReserve?: number;
  secrets?: readonly string[];
}) {
  const { limits } = options;
  if (options.requestOdds && (!options.readRemaining || !limits ||
      Object.values(limits).some(value => !Number.isSafeInteger(value) || value < 1))) {
    throw new RangeError("First Basket odds collection requires hard budgets and a quota reader");
  }
  const at = options.now();
  const snapshots = input.snapshots.filter(game => validateFirstBasketSnapshot(game) &&
    game.availableAt <= at && game.startsAt > at && game.startsAt - at <= 2 * 86_400_000);
  const games = new Map<string, FirstBasketSnapshot>();
  for (const game of snapshots) {
    if ((games.get(game.eventId)?.availableAt ?? 0) <= game.availableAt) games.set(game.eventId, game);
    await storeFirstBasketRecord(root, { kind: "lineup", at, snapshot: game }, slateDate(game.startsAt));
  }
  const days = new Set([slateDate(at - 45 * MINUTE), slateDate(at), ...[...games.values()].map(game => slateDate(game.startsAt))]);
  const existing = (await Promise.all([...days].map(async day => ({ day, calls: await readFirstBasketArchiveDay(root, day, "odds") })))).flatMap(({ day, calls }) =>
    calls.flatMap(row => row.kind === "odds" && row.at <= at ? [{ day, row }] : []));
  const spentByGame = new Map<string, number>(), spentBySlate = new Map<string, number>();
  const byKey = new Map<string, OddsRecord>();
  let quota: OddsRecord | undefined;
  for (const { day, row } of existing.sort((a, b) => b.row.at - a.row.at)) {
    if (!byKey.has(row.key)) byKey.set(row.key, row);
    quota ??= row;
    spentByGame.set(row.eventId, (spentByGame.get(row.eventId) ?? 0) + debited(row));
    spentBySlate.set(day, (spentBySlate.get(day) ?? 0) + debited(row));
  }
  let requests = 0;
  const stops = { game: 0, slate: 0, reserve: 0, quotaUnavailable: 0 };
  if (options.requestOdds && options.readRemaining && limits) {
    for (const game of [...games.values()].sort((a, b) => a.startsAt - b.startsAt)) {
      const now = options.now(), day = slateDate(game.startsAt);
      const plan = archiveOddsPlan(game, now, quota, options.fastReserve);
      const previous = plan && byKey.get(plan.key);
      if (!plan || (previous && now - previous.at < plan.ttlMs)) continue;
      const gameSpent = spentByGame.get(game.eventId) ?? 0;
      const slateSpent = spentBySlate.get(day) ?? 0;
      if (gameSpent + MAX_CHARGE > limits.creditsPerGame) { stops.game++; continue; }
      if (slateSpent + MAX_CHARGE > limits.creditsPerSlate) { stops.slate++; continue; }

      // The discovery endpoint is free. Use a fresh balance before every paid
      // attempt since this account can also be used by other processes.
      const remaining = await options.readRemaining().catch(() => null);
      if (remaining == null || !Number.isSafeInteger(remaining)) { stops.quotaUnavailable++; continue; }
      if (remaining - MAX_CHARGE < limits.reserve) { stops.reserve++; continue; }
      if (options.now() >= game.startsAt) continue;
      const next: OddsRecord = {
        kind: "odds", at: options.now(), eventId: game.eventId, key: plan.key, attemptId: randomUUID(),
        reservedCredits: MAX_CHARGE,
        pricingLineupStatus: plan.key.endsWith(":pending") ? "unconfirmed" : "confirmed",
        status: null, credits: null, remaining: null, response: null,
      };
      // Reserve the maximum on disk before invoking the provider. If the
      // response is lost or the worker exits, the next poll keeps that debit.
      await storeFirstBasketRecord(root, next, day);
      try {
        const response = await options.requestOdds(plan.oddsId);
        next.status = response.status;
        Object.assign(next, oddsQuotaHeaders(response.headers));
        if (response.ok) next.response = quotePayload(await response.json(), plan.oddsId, options.secrets ?? []);
      } catch {
        // Preserve the reservation without serializing provider exceptions.
      }
      next.at = options.now();
      await storeFirstBasketRecord(root, next, day);
      spentByGame.set(game.eventId, gameSpent + debited(next));
      spentBySlate.set(day, slateSpent + debited(next));
      byKey.set(plan.key, next);
      quota = next;
      requests++;
    }
  }
  await storeFirstBasketRecord(root, { kind: "poll", at, eventsSeen: games.size });
  return { eventsSeen: games.size, requests, stops };
}

export function fetchFirstBasketArchiveOdds(apiKey: string, oddsId: string) {
  const query = new URLSearchParams({ apiKey, regions: "us", markets: firstBasketMarkets.join(","), oddsFormat: "american" });
  return fetch(`https://api.the-odds-api.com/v4/sports/basketball_nba/events/${oddsId}/odds?${query}`,
    { redirect: "error", signal: AbortSignal.timeout(5000) });
}

export async function firstBasketRemainingCredits(apiKey: string) {
  const query = new URLSearchParams({ apiKey });
  const response = await fetch(`https://api.the-odds-api.com/v4/sports?${query}`, {
    redirect: "error", signal: AbortSignal.timeout(5000),
  });
  await response.body?.cancel();
  return response.ok ? oddsQuotaHeaders(response.headers).remaining : null;
}
