import { readFile, stat } from "node:fs/promises";
import { createSingleFlight } from "./singleFlight.js";
import { firstBasketMarkets, priceFirstBasket, supportedVoidRule, validateFirstBasketSnapshot, type FirstBasketSnapshot, type OpeningGame } from "./nbaFirstBasketModel.js";
import { firstBasketQuotes, type RawFirstBasketOdds } from "./nbaFirstBasketOdds.js";

export type FirstBasketCapture = { snapshots: FirstBasketSnapshot[]; history: OpeningGame[] };
let capture: { path: string; modified: number; value: FirstBasketCapture } | undefined;
const captureFlight = createSingleFlight();

export async function readFirstBasketCapture() {
  const path = process.env.NBA_FIRST_BASKET_CAPTURE;
  if (!path) return null;
  return captureFlight(path, async () => {
    const info = await stat(path);
    if (info.size > 20_000_000) throw new RangeError("First Basket capture too large");
    if (capture?.path !== path || capture.modified !== info.mtimeMs) {
      const value: FirstBasketCapture = JSON.parse(await readFile(path, "utf8"));
      if (!Array.isArray(value?.snapshots) || !Array.isArray(value.history)) throw new TypeError("Invalid First Basket capture");
      capture = { path, modified: info.mtimeMs, value };
    }
    return capture.value;
  });
}

function latestMatchingSnapshot(data: FirstBasketCapture, input: { eventId: string; homeTeamId: string; awayTeamId: string }, now: number) {
  return data.snapshots.filter(snapshot => snapshot.eventId === input.eventId &&
    snapshot.home?.id === input.homeTeamId && snapshot.away?.id === input.awayTeamId &&
    snapshot.availableAt <= now).sort((a, b) => b.availableAt - a.availableAt)[0];
}

const openingModel = new WeakMap<FirstBasketSnapshot, { history: OpeningGame[]; result: ReturnType<typeof priceFirstBasket> }>();

export async function getFirstBasketOpening(input: {
  eventId: string; homeTeamId: string; awayTeamId: string; starters: readonly string[][];
}) {
  const data = await readFirstBasketCapture();
  if (!data) return null;
  const now = Date.now();
  const game = latestMatchingSnapshot(data, input, now);
  if (!game || !validateFirstBasketSnapshot(game) || game.confirmedAt == null || now >= game.startsAt ||
      now - game.confirmedAt > 45 * 60_000 || ![game.home, game.away].every((team, side) =>
        input.starters[side]?.length === 5 && team.starters.every(player => input.starters[side]!.includes(player.id)))) return null;
  const cached = openingModel.get(game);
  const result = cached && cached.history === data.history ? cached.result : priceFirstBasket(game, data.history, [], now);
  openingModel.set(game, { history: data.history, result });
  if (result.status !== "ready") return null;
  return {
    homeTipWin: result.homeTipWin, tipWinnerKeepsBall: result.tipWinnerKeepsBall,
    home: { scoringRate: result.openingRate[0]!, usage: result.openingUsage[0]! },
    away: { scoringRate: result.openingRate[1]!, usage: result.openingUsage[1]! },
  };
}

const PREGAME_WINDOW_MS = 45 * 60_000;
const ODDS_REFRESH_MS = 3 * 60_000;
type Matchup = { eventId: string; homeTeamId: string; awayTeamId: string };
type OddsPlan = NonNullable<ReturnType<typeof firstBasketOddsPlan>>;
export function firstBasketOddsPlan(game: FirstBasketSnapshot, now: number) {
  const oddsId = game.oddsEventId;
  if (!oddsId || !/^[a-f0-9]{32}$/i.test(oddsId) || game.confirmedAt == null ||
      now - game.confirmedAt > PREGAME_WINDOW_MS || now < game.startsAt - PREGAME_WINDOW_MS || now >= game.startsAt) return null;
  const markets = firstBasketMarkets.filter(market => game.bookRules?.some(book => book.market === market &&
    supportedVoidRule(book.voidRule) && (book.rule === "points" || book.rule === "field_goal")));
  if (!markets.length) return null;
  const lineupKey = [game.home, game.away].map(team => team.starters.map(player => player.id).sort().join(",")).join(":");
  return { oddsId, markets, ttlMs: ODDS_REFRESH_MS, key: `nba-first-basket-odds:v2:${oddsId}:${lineupKey}:${markets.join(",")}` };
}

const readyBoard = new WeakMap<FirstBasketSnapshot, {
  history: OpeningGame[]; quoteKey: string; value: ReturnType<typeof priceFirstBasket>;
}>();

export async function reviewFirstBasket(input: Matchup, source: {
  now: () => number; capture: () => Promise<FirstBasketCapture | null>;
  odds: (plan: OddsPlan) => Promise<RawFirstBasketOdds | null>;
}) {
  const data = await source.capture();
  if (!data) return { status: "waiting_for_starters" } as const;
  const now = source.now();
  const game = latestMatchingSnapshot(data, input, now);
  if (!game || !validateFirstBasketSnapshot(game)) return { status: "waiting_for_starters" } as const;
  if (now >= game.startsAt) return { status: "started" } as const;
  if (game.confirmedAt === null || now - game.confirmedAt > PREGAME_WINDOW_MS) return { status: "waiting_for_starters" } as const;
  const plan = firstBasketOddsPlan(game, now);
  const odds = plan ? await source.odds(plan).catch(() => null) : null;
  const current = source.now();
  const latest = plan ? await source.capture() : data;
  if (!latest || latestMatchingSnapshot(latest, input, current) !== game) return { status: "waiting_for_starters" } as const;
  if (current >= game.startsAt) return { status: "started" } as const;
  if (current - game.confirmedAt > PREGAME_WINDOW_MS) return { status: "waiting_for_starters" } as const;
  const quotes = odds ? firstBasketQuotes(game, odds, current) : [];
  const quoteKey = JSON.stringify(quotes);
  const hit = readyBoard.get(game);
  if (hit && hit.history === latest.history && hit.quoteKey === quoteKey) return hit.value;
  const value = priceFirstBasket(game, latest.history, quotes, current);
  readyBoard.set(game, { history: latest.history, quoteKey, value });
  return value;
}

export function getFirstBasketModel(input: Matchup) {
  const key = process.env.ODDS_API_KEY;
  return reviewFirstBasket(input, {
    now: Date.now,
    capture: readFirstBasketCapture,
    odds: async plan => {
      if (!key) return null;
      const { cachedJson } = await import("./sports.js");
      return cachedJson<RawFirstBasketOdds | null>(plan.key, plan.ttlMs, async () => {
        const params = new URLSearchParams({ apiKey: key, markets: plan.markets.join(","), regions: "us", oddsFormat: "american" });
        try {
          const response = await fetch(`https://api.the-odds-api.com/v4/sports/basketball_nba/events/${plan.oddsId}/odds?${params}`,
            { signal: AbortSignal.timeout(5000) });
          if (!response.ok) return null;
          return await response.json() as RawFirstBasketOdds;
        } catch {
          return null;
        }
      });
    },
  });
}
