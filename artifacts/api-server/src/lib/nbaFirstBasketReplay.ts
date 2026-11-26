import { reviewFirstBasket, type FirstBasketCapture } from "./nbaFirstBasketService.js";
import { captureOpeningGame } from "./nbaFirstBasketCapture.js";
import type { RawFirstBasketOdds } from "./nbaFirstBasketOdds.js";

type Frame<T> = { at: number; value: T };
export type FirstBasketReplay = {
  matchup: Parameters<typeof reviewFirstBasket>[0];
  polls: readonly number[];
  captures: readonly Frame<FirstBasketCapture>[];
  odds: readonly Frame<RawFirstBasketOdds>[];
  finalOpeningFeed?: Parameters<typeof captureOpeningGame>[0];
};
function requireOrdered(values: readonly number[]) {
  if (values.some((at, i) => !Number.isFinite(at) || (i > 0 && at <= values[i - 1]!))) {
    throw new RangeError("Replay timestamps must be finite and strictly increasing");
  }
}
const latest = <T>(frames: readonly Frame<T>[], at: number) => [...frames].reverse().find(frame => frame.at <= at)?.value ?? null;

/** Run the live review path against captured snapshots on a virtual clock with no provider calls. */
export async function replayFirstBasket(input: FirstBasketReplay) {
  requireOrdered(input.polls);
  requireOrdered(input.captures.map(frame => frame.at));
  requireOrdered(input.odds.map(frame => frame.at));
  const cache = new Map<string, { expires: number; value: RawFirstBasketOdds | null }>();
  const requests: { at: number; key: string; maxCredits: number }[] = [];
  const results = [];
  for (const at of input.polls) {
    const result = await reviewFirstBasket(input.matchup, {
      now: () => at,
      capture: async () => latest(input.captures, at),
      odds: async plan => {
        const hit = cache.get(plan.key);
        if (hit && hit.expires > at) return hit.value;
        const value = latest(input.odds, at);
        requests.push({ at, key: plan.key, maxCredits: plan.markets.length });
        cache.set(plan.key, { expires: at + plan.ttlMs, value });
        return value;
      },
    });
    results.push({ at, result });
  }
  const final = input.finalOpeningFeed ? captureOpeningGame(input.finalOpeningFeed) : null;
  if (input.finalOpeningFeed && (!final || final.eventId !== input.matchup.eventId ||
      final.teams[0].id !== input.matchup.homeTeamId || final.teams[1].id !== input.matchup.awayTeamId)) {
    throw new RangeError("Replay final opening feed could not be verified for the selected event");
  }
  return { results, requests, final, maxCredits: requests.reduce((total, request) => total + request.maxCredits, 0) };
}
