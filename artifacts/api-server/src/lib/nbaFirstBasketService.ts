import { readFile, stat } from "node:fs/promises";
import { firstBasketMarkets, priceFirstBasket, validateFirstBasketSnapshot, type FirstBasketSnapshot, type OpeningGame } from "./nbaFirstBasketModel.js";
import { firstBasketQuotes } from "./nbaFirstBasketOdds.js";

type Capture = { snapshots: FirstBasketSnapshot[]; history: OpeningGame[] };
let capture: { path: string; modified: number; value: Capture } | undefined;

export async function readFirstBasketCapture() {
  const path = process.env.NBA_FIRST_BASKET_CAPTURE;
  if (!path) return null;
  const info = await stat(path);
  if (info.size > 20_000_000) throw new RangeError("First Basket capture too large");
  if (capture?.path !== path || capture.modified !== info.mtimeMs) {
    const value: Capture = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(value?.snapshots) || !Array.isArray(value.history)) throw new TypeError("Invalid First Basket capture");
    capture = { path, modified: info.mtimeMs, value };
  }
  return capture.value;
}

function latestMatchingSnapshot(data: Capture, input: { eventId: string; homeTeamId: string; awayTeamId: string }, now: number) {
  return data.snapshots.filter(snapshot => snapshot.eventId === input.eventId &&
    snapshot.home?.id === input.homeTeamId && snapshot.away?.id === input.awayTeamId &&
    snapshot.availableAt <= now).sort((a, b) => b.availableAt - a.availableAt)[0];
}

export async function getFirstBasketOpening(input: {
  eventId: string; homeTeamId: string; awayTeamId: string; starters: readonly string[][];
}) {
  const data = await readFirstBasketCapture();
  if (!data) return null;
  const now = Date.now();
  const game = latestMatchingSnapshot(data, input, now);
  if (!game || !validateFirstBasketSnapshot(game) || game.confirmedAt == null ||
      now - game.confirmedAt > 45 * 60_000 || ![game.home, game.away].every((team, side) =>
        input.starters[side]?.length === 5 && team.starters.every(player => input.starters[side]!.includes(player.id)))) return null;
  const result = priceFirstBasket(game, data.history, [], now);
  if (result.status !== "ready") return null;
  return {
    homeTipWin: result.homeTipWin, tipWinnerKeepsBall: result.tipWinnerKeepsBall,
    home: { scoringRate: result.openingRate[0]!, usage: result.openingUsage[0]! },
    away: { scoringRate: result.openingRate[1]!, usage: result.openingUsage[1]! },
  };
}

export async function getFirstBasketModel(input: { eventId: string; homeTeamId: string; awayTeamId: string }) {
  const data = await readFirstBasketCapture();
  if (!data) return { status: "waiting_for_starters" } as const;
  const now = Date.now();
  const game = latestMatchingSnapshot(data, input, now);
  if (!game || !validateFirstBasketSnapshot(game)) return { status: "waiting_for_starters" } as const;
  // Re-evaluate the latest capture on every request. A newer scratch may invalidate confirmation.
  if (now >= game.startsAt) return { status: "started" } as const;
  if (game.confirmedAt === null || now - game.confirmedAt > 45 * 60_000) return { status: "waiting_for_starters" } as const;
  const key = process.env.ODDS_API_KEY;
  const oddsId = game.oddsEventId;
  const hasOdds = key && oddsId && /^[a-f0-9]{32}$/i.test(oddsId) && game.bookRules?.length;
  const cachedJson = hasOdds ? (await import("./sports.js")).cachedJson : null;
  const lineupKey = [game.home, game.away].flatMap(team => team.starters.map(player => player.id)).join(",");
  const odds = cachedJson && key && oddsId && /^[a-f0-9]{32}$/i.test(oddsId) && game.bookRules?.length
    ? await cachedJson(`nba-first-basket-odds:v1:${oddsId}:${lineupKey}`, 60_000, async () => {
        const params = new URLSearchParams({ apiKey: key, markets: firstBasketMarkets.join(","), regions: "us", oddsFormat: "american" });
        const response = await fetch(`https://api.the-odds-api.com/v4/sports/basketball_nba/events/${oddsId}/odds?${params}`,
          { signal: AbortSignal.timeout(5000) });
        if (!response.ok) return null;
        return response.json();
      }).catch(() => null)
    : null;
  const current = Date.now();
  const latest = odds ? await readFirstBasketCapture() : data;
  if (!latest || latestMatchingSnapshot(latest, input, current) !== game) {
    // A lineup update arrived while quotes were being fetched. The next poll
    // rebinds this event to the replacement lineup.
    return { status: "waiting_for_starters" } as const;
  }
  return priceFirstBasket(game, data.history, odds ? firstBasketQuotes(game, odds, current) : [], current);
}
