import assert from "node:assert/strict";
import test from "node:test";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { captureOpeningGame } from "../src/lib/nbaFirstBasketCapture.ts";
import { openingGameSummary, priceFirstBasket, teamScoresFirst, type FirstBasketSnapshot } from "../src/lib/nbaFirstBasketModel.ts";
import { firstBasketQuotes } from "../src/lib/nbaFirstBasketOdds.ts";
import { getFirstBasketModel, getFirstBasketOpening } from "../src/lib/nbaFirstBasketService.ts";

const now = 1_800_000_000_000;
const team = (id: string) => ({
  id, jumperId: id + "1",
  starters: [1, 2, 3, 4, 5].map(number => ({
    id: id + number, name: `Starter ${id} ${number}`, usage: [.2, .2, .2] as const,
  })),
});
const snapshot: FirstBasketSnapshot = {
  eventId: "event", home: team("1"), away: team("2"), startsAt: now + 60_000,
  confirmedAt: now - 5_000, availableAt: now - 4_000, source: "test",
  oddsEventId: "event-odds", bookRules: [
    { book: "book", market: "player_first_basket", rule: "points" },
    { book: "book", market: "player_first_team_basket", rule: "field_goal" },
    { book: "book", market: "player_method_of_first_basket", rule: "field_goal" },
  ],
};
const source = {
  eventId: "past", finalAt: now - 120_000, availableAt: now - 110_000,
  teams: [snapshot.home, snapshot.away].map(side => ({
    id: side.id, jumperId: side.jumperId, starters: side.starters.map(player => player.id),
  })) as unknown as Parameters<typeof captureOpeningGame>[0]["teams"],
  actions: [
    { actionNumber: 1, period: 1, clock: "PT12M00.00S", actionType: "jumpball", jumpBallWonPersonId: 11, jumpBallLostPersonId: 21 },
    { actionNumber: 2, period: 1, clock: "11:50", actionType: "Free Throw", description: "Starter 2 2 makes free throw", teamId: 2, personId: 22, possessionIndex: 0, possessionTeamId: 2 },
    { actionNumber: 3, period: 1, clock: "11:40", actionType: "Made Shot", description: "Starter 1 3 makes 3PT", teamId: 1, personId: 13, possessionIndex: 1, possessionTeamId: 1 },
  ],
};

test("opening capture separates the tip, first possession, first points and first field goal", () => {
  const result = captureOpeningGame(source);
  assert.ok(result);
  assert.equal(result.tipWinner, 0);
  assert.equal(result.firstPossession, 1);
  assert.equal(result.firstPoints.method, "FT");
  assert.equal(result.firstPoints.playerId, "22");
  assert.equal(result.firstFieldGoal.method, "3");
  assert.equal(result.firstFieldGoal.clock, "11:40");
  const v3 = { ...source, actions: [
    { actionNumber: 1, period: 1, clock: "12:00", description: "Jump Ball A vs. B: Tip to C" }, ...source.actions.slice(1),
  ] };
  assert.equal(captureOpeningGame(v3), null);
  assert.equal(captureOpeningGame({ ...v3, verifiedTipWinnerId: "11" })?.firstPossession, 1);
  assert.equal(openingGameSummary({ ...result, firstPossession: 0 }), null);
});

function oddsData(books: unknown[]) {
  return { id: "event-odds", commence_time: new Date(snapshot.startsAt).toISOString(), bookmakers: books } as Parameters<typeof firstBasketQuotes>[1];
}
const updated = new Date(now - 1_000).toISOString();
const book = { key: "book", markets: [
  { key: "player_first_basket", last_update: updated, outcomes: [
    { name: "Yes", description: "Starter 1 1", price: 700 },
    { name: "No", description: "Starter 1 1", price: -1000 },
  ] },
  { key: "player_first_team_basket", last_update: updated, outcomes: snapshot.home.starters.map(player => ({ name: player.name, price: 300 })) },
  { key: "player_method_of_first_basket", last_update: updated, outcomes: [
    { name: "3-Pointer", description: "Starter 1 3", price: 4500 },
  ] },
] };

test("de-vigs the correct yes/no pair or a complete team field and preserves book rules", () => {
  const quotes = firstBasketQuotes(snapshot, oddsData([book, { ...book, key: "unknown" }]), now);
  assert.equal(quotes.length, 7);
  assert.equal(quotes[0]!.rule, "points");
  assert.ok(Math.abs(quotes[0]!.noVig! - .125 / (.125 + 1000 / 1100)) < 1e-12);
  assert.equal(quotes[1]!.rule, "field_goal");
  assert.equal(quotes[1]!.noVig, .2);
  assert.equal(quotes[6]!.method, "3");
  assert.equal(quotes[6]!.noVig, null);
  assert.deepEqual(firstBasketQuotes(snapshot, oddsData([book]), now + 600_000), []);
});

test("prices exact outcomes with conditional team scoring and ignores future history", () => {
  assert.equal(teamScoresFirst(.5, .5, 1), 2 / 3);
  assert.equal(teamScoresFirst(.5, .5, 0), 1 / 3);
  assert.equal(teamScoresFirst(.5, .5, .5), .5);
  const past = captureOpeningGame(source)!;
  assert.equal(priceFirstBasket(snapshot, [{ ...past, availableAt: now }], [], now).status, "insufficient_history");
  assert.equal(priceFirstBasket({ ...snapshot, confirmedAt: null }, [past], [], now).status, "waiting_for_starters");
  const result = priceFirstBasket(snapshot, [past], firstBasketQuotes(snapshot, oddsData([book]), now), now);
  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.equal(result.historyGames, 1);
  assert.ok(result.homeFirstPossession < result.homeTipWin);
  assert.equal(result.groups.find(group => group.market === "player_first_team_basket" && group.rule === "field_goal")?.rows.length, 3);
  const method = result.groups.find(group => group.market === "player_method_of_first_basket" && group.rule === "field_goal")?.rows[0];
  assert.ok(method && method.positiveEvProbability >= 0 && method.positiveEvProbability <= 1);
});

test("capture refresh invalidates confirmed prices and the opening sim when a starter is scratched", async () => {
  const dir = await mkdtemp(join(tmpdir(), "first-basket-"));
  const path = join(dir, "capture.json");
  const env = process.env.NBA_FIRST_BASKET_CAPTURE;
  const localNow = Date.now();
  const game = { ...snapshot, startsAt: localNow + 120_000, availableAt: localNow - 2_000, confirmedAt: localNow - 3_000 };
  const historical = captureOpeningGame({ ...source, finalAt: localNow - 500_000, availableAt: localNow - 400_000 })!;
  const matchup = { eventId: snapshot.eventId, homeTeamId: snapshot.home.id, awayTeamId: snapshot.away.id };
  try {
    process.env.NBA_FIRST_BASKET_CAPTURE = path;
    await writeFile(path, JSON.stringify({ snapshots: [game], history: [historical] }));
    const starters = [game.home, game.away].map(side => side.starters.map(player => player.id));
    assert.equal((await getFirstBasketModel(matchup)).status, "ready");
    assert.ok(await getFirstBasketOpening({ ...matchup, starters }));
    await new Promise(resolve => setTimeout(resolve, 15));
    await writeFile(path, JSON.stringify({ snapshots: [game, { ...game, confirmedAt: null, availableAt: localNow - 1_000 }], history: [historical] }));
    assert.equal((await getFirstBasketModel(matchup)).status, "waiting_for_starters");
    assert.equal(await getFirstBasketOpening({ ...matchup, starters }), null);
  } finally {
    if (env === undefined) delete process.env.NBA_FIRST_BASKET_CAPTURE;
    else process.env.NBA_FIRST_BASKET_CAPTURE = env;
    await rm(dir, { recursive: true, force: true });
  }
});
