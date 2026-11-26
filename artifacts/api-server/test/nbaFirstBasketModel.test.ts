import assert from "node:assert/strict";
import test from "node:test";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { captureOpeningGame } from "../src/lib/nbaFirstBasketCapture.ts";
import { openingGameSummary, priceFirstBasket, teamScoresFirst, type FirstBasketSnapshot } from "../src/lib/nbaFirstBasketModel.ts";
import { firstBasketQuotes } from "../src/lib/nbaFirstBasketOdds.ts";
import { archivedFirstBasketCases, backtestNbaFirstBasket } from "../src/lib/nbaFirstBasketBacktest.ts";
import { archiveOddsPlan, firstBasketWeek, MINUTE, readFirstBasketArchiveDay, slateDate } from "../src/lib/nbaFirstBasketArchive.ts";
import { collectFirstBasket } from "../src/lib/nbaFirstBasketCollector.ts";
import { tuneFirstBasketUsage } from "../src/lib/nbaFirstBasketTuneUsage.ts";
import { replayFirstBasket } from "../src/lib/nbaFirstBasketReplay.ts";
import { getFirstBasketModel, getFirstBasketOpening } from "../src/lib/nbaFirstBasketService.ts";

const now = 1_800_000_000_000;
const team = (id: string) => ({
  id, jumperId: id + "1",
  starters: [1, 2, 3, 4, 5].map(number => ({
    id: id + number, name: `Starter ${id} ${number}`, usage: [.2, .2, .2] as const,
  })),
});
const voidRule = { notStarter: "void", didNotPlay: "void" } as const;
const oddsEventId = "a".repeat(32);
const snapshot: FirstBasketSnapshot = {
  eventId: "event", home: team("1"), away: team("2"), startsAt: now + 60_000,
  confirmedAt: now - 5_000, availableAt: now - 4_000, source: "test",
  oddsEventId, bookRules: [
    { book: "book", market: "player_first_basket", rule: "points", voidRule },
    { book: "book", market: "player_first_team_basket", rule: "field_goal", voidRule, exhaustiveStarterField: true },
    { book: "book", market: "player_method_of_first_basket", rule: "field_goal", voidRule },
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
  return { id: oddsEventId, commence_time: new Date(snapshot.startsAt).toISOString(), bookmakers: books } as Parameters<typeof firstBasketQuotes>[1];
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
  assert.equal(method?.price, 4500);
  assert.equal(method?.noVig, null);
  assert.equal(method?.positiveEvProbability, null);
  assert.equal(method?.grade, null);
  assert.equal(result.posteriorDraws, 4096);
});

test("capture refresh invalidates confirmed prices and the opening sim when a starter is scratched", async () => {
  const dir = await mkdtemp(join(tmpdir(), "first-basket-"));
  const path = join(dir, "capture.json");
  const env = process.env.NBA_FIRST_BASKET_CAPTURE;
  const oddsKey = process.env.ODDS_API_KEY;
  delete process.env.ODDS_API_KEY;
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
    if (oddsKey !== undefined) process.env.ODDS_API_KEY = oddsKey;
    await rm(dir, { recursive: true, force: true });
  }
});

test("partial fields and fields without verified coverage retain only posted prices", () => {
  const market = book.markets[1]!;
  const partial = firstBasketQuotes(snapshot, oddsData([{ ...book, markets: [{ ...market, outcomes: market.outcomes.slice(0, 4) }] }]), now);
  assert.equal(partial.length, 4);
  assert.ok(partial.every(quote => quote.noVig === null && !quote.completeField));
  const fieldWithoutTerms = { ...snapshot, bookRules: [{ ...snapshot.bookRules![1]!, exhaustiveStarterField: false }] };
  assert.ok(firstBasketQuotes(fieldWithoutTerms, oddsData([book]), now).every(quote => quote.noVig === null));
  const unsupported = { ...snapshot, bookRules: [{ ...snapshot.bookRules![1]!, voidRule: { ...voidRule, didNotPlay: "loss" as const } }] };
  assert.deepEqual(firstBasketQuotes(unsupported, oddsData([book]), now), []);
  const benchAction = { ...snapshot, bookRules: [{ ...snapshot.bookRules![1]!, voidRule: { ...voidRule, notStarter: "action_if_plays" as const } }] };
  assert.ok(firstBasketQuotes(benchAction, oddsData([book]), now).every(quote => quote.noVig === null));
});

test("the pregame tip mixes likely jumpers and excludes late shots from opening shares", () => {
  const games = Array.from({ length: 20 }, (_, i) => ({
    ...captureOpeningGame(source)!, eventId: `past-${i}`,
  }));
  const candidate = (ids: string[], weights: number[]) => ids.map((playerId, i) => ({ playerId, weight: weights[i]! }));
  const mix = { ...snapshot, home: { ...snapshot.home, likelyJumpers: candidate(["11", "12"], [.25, .75]) } };
  const otherJumper = { ...snapshot, home: { ...snapshot.home, jumperId: "12" } };
  const a = priceFirstBasket(snapshot, games, [], now);
  const b = priceFirstBasket(otherJumper, games, [], now);
  const c = priceFirstBasket(mix, games, [], now);
  assert.ok(a.status === "ready" && b.status === "ready" && c.status === "ready");
  assert.ok(Math.abs(c.homeTipWin - (.25 * a.homeTipWin + .75 * b.homeTipWin)) < .012);
  const addedLateShots = games.map(game => ({ ...game, possessions: [...game.possessions,
    { side: 0 as const, clock: "8:00", shots: [{ clock: "7:55", method: "2" as const, made: true, playerId: "15" }] },
  ] }));
  const after = priceFirstBasket(snapshot, addedLateShots, [], now);
  assert.deepEqual(after, a);
});

test("recorded-format staging shares odds across polls and fetches immediately on confirmed scratch", async () => {
  const past = captureOpeningGame(source)!;
  const replacement = { id: "16", name: "Replacement", usage: [.2, .2, .2] as const };
  const home = { ...snapshot.home, starters: snapshot.home.starters.map(player => player.id === "11" ? replacement : player), jumperId: replacement.id };
  const pending = { ...snapshot, availableAt: now + 10_000, confirmedAt: null };
  const scratched = { ...snapshot, availableAt: now + 20_000, confirmedAt: now + 20_000, home };
  const quotes = (name: string, at: number) => oddsData([{ ...book, markets: [{
    key: "player_first_basket", last_update: new Date(at).toISOString(),
    outcomes: [{ name: "Yes", description: name, price: 700 }, { name: "No", description: name, price: -1000 }],
  }] }]);
  const result = await replayFirstBasket({
    matchup: { eventId: snapshot.eventId, homeTeamId: "1", awayTeamId: "2" },
    polls: [now, now + 5_000, now + 10_000, now + 20_000, now + 30_000, snapshot.startsAt],
    captures: [
      { at: now - 4_000, value: { snapshots: [snapshot], history: [past] } },
      { at: now + 10_000, value: { snapshots: [snapshot, pending], history: [past] } },
      { at: now + 20_000, value: { snapshots: [snapshot, pending, scratched], history: [past] } },
    ],
    odds: [{ at: now, value: quotes("Starter 1 1", now) }, { at: now + 20_000, value: quotes("Replacement", now + 20_000) }],
    finalOpeningFeed: {
      ...source, eventId: snapshot.eventId, finalAt: now + 300_000, availableAt: now + 301_000,
      teams: [{ id: home.id, jumperId: replacement.id, starters: home.starters.map(player => player.id) }, source.teams[1]],
      actions: [{ ...source.actions[0]!, jumpBallWonPersonId: 16 }, ...source.actions.slice(1)],
    },
  });
  assert.deepEqual(result.requests.map(request => request.at), [now, now + 20_000]);
  assert.equal(result.maxCredits, 6);
  assert.deepEqual(result.results.map(({ result }) => result.status),
    ["ready", "ready", "waiting_for_starters", "ready", "ready", "started"]);
  const fresh = result.results[3]!.result;
  assert.ok(fresh.status === "ready");
  assert.equal(fresh.groups.flatMap(group => group.rows)[0]?.playerId, replacement.id);
  assert.equal(result.final?.firstFieldGoal.method, "3");
  assert.equal(result.final?.teams[0].jumperId, replacement.id);
});

test("validation separates tip and team calibration from matched whole-field closing log loss", () => {
  const past = captureOpeningGame(source)!;
  const final = { ...past, eventId: snapshot.eventId, finalAt: now + 360_000, availableAt: now + 361_000 };
  const game = { ...snapshot, bookRules: [{ book: "book", market: "player_first_basket" as const, rule: "points" as const, voidRule, exhaustiveStarterField: true }] };
  const full = [...game.home.starters, ...game.away.starters].map(player => ({ name: player.name, price: 800 }));
  const closingField = (outcomes: typeof full) => ({ at: now, odds: oddsData([{ key: "book", markets: [{ key: "player_first_basket", last_update: updated, outcomes }] }]) });
  const closed = backtestNbaFirstBasket({ history: [past], cases: [{ snapshot: game, final, closing: closingField(full) }] });
  assert.equal(closed.stage1.tip.games, 1);
  assert.equal(closed.stage1.firstPoints.games, 1);
  assert.equal(closed.stage1.firstFieldGoal.games, 1);
  assert.equal(closed.stage2.gamesWithClosingFields, 1);
  assert.ok(Math.abs(closed.stage2.comparisons[0]!.closingNoVigLogLoss! - Math.log(10)) < 1e-12);
  const partial = backtestNbaFirstBasket({ history: [past], cases: [{ snapshot: game, final, closing: closingField(full.slice(1)) }] });
  assert.equal(partial.stage1.tip.games, 1);
  assert.deepEqual(partial.stage2.comparisons, []);
});

test("one-minute app polling stays within 45 credits in a stable 45-minute window", async () => {
  const startsAt = snapshot.startsAt;
  const openAt = startsAt - 45 * 60_000;
  const game = { ...snapshot, confirmedAt: openAt, availableAt: openAt };
  const past = captureOpeningGame({ ...source, finalAt: openAt - 500_000, availableAt: openAt - 490_000 })!;
  const report = await replayFirstBasket({
    matchup: { eventId: snapshot.eventId, homeTeamId: "1", awayTeamId: "2" },
    polls: Array.from({ length: 47 }, (_, i) => openAt + (i - 1) * 60_000),
    captures: [{ at: openAt, value: { snapshots: [game], history: [past] } }],
    odds: [],
  });
  assert.equal(report.requests.length, 15);
  assert.equal(report.maxCredits, 45);
  assert.equal(report.requests.at(-1)?.at, startsAt - 3 * 60_000);
});

test("a high-confidence edge remains Lean before calibration and closing validation", () => {
  const past = captureOpeningGame(source)!;
  const games = Array.from({ length: 10 }, (_, i) => ({ ...past, eventId: `history-${i}` }));
  const quotes = firstBasketQuotes(snapshot, oddsData([book]), now);
  const first = { ...quotes[0]!, price: 100_000 };
  const result = priceFirstBasket(snapshot, games, [first], now);
  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  const row = result.groups.flatMap(group => group.rows)[0];
  assert.equal(row?.confidence, "High");
  assert.equal(row?.grade, "Lean");
});

test("collector records raw quotes and actual quota across restarts and only enables fast refresh with reserve", async () => {
  const root = await mkdtemp(join(tmpdir(), "first-basket-archive-"));
  try {
    let wall = now;
    const game = { ...snapshot, startsAt: now + 12 * MINUTE };
    const capture = { snapshots: [game], history: [] };
    let remaining = 200;
    const prices = { ...oddsData([book]), commence_time: new Date(game.startsAt).toISOString() };
    const poll = () => collectFirstBasket(root, capture, {
      now: () => wall, fastReserve: 100,
      requestOdds: async () => new Response(JSON.stringify(prices), { headers: {
        "x-requests-last": "3", "x-requests-remaining": String(remaining -= 3),
      } }),
    });
    assert.equal((await poll()).requests, 1);
    wall += MINUTE;
    assert.equal((await poll()).requests, 0);
    wall += MINUTE; // ten minutes left, using the shared recorded quota
    assert.equal((await poll()).requests, 1);
    const day = slateDate(game.startsAt);
    const archived = await readFirstBasketArchiveDay(root, day);
    const quota = archived.flatMap(item => item.kind === "odds" ? [item] : []).sort((a, b) => b.at - a.at)[0];
    assert.equal(quota?.response?.bookmakers?.[0]?.markets?.length, 3);
    assert.equal(archiveOddsPlan(game, wall, quota, 100)?.ttlMs, MINUTE);
    assert.equal(archiveOddsPlan(game, wall, quota)?.ttlMs, 3 * MINUTE);
    assert.equal(archiveOddsPlan(game, wall, { ...quota!, remaining: 101 }, 100)?.ttlMs, 3 * MINUTE);
    assert.equal(archiveOddsPlan(game, wall, { ...quota!, at: wall - 6 * MINUTE }, 100)?.ttlMs, 3 * MINUTE);
    assert.equal(archived.filter(record => record.kind === "lineup").length, 1);
    const week = await firstBasketWeek(root, day);
    assert.equal(week.nights.length, 7);
    assert.equal(week.nightsWithQuota, 1);
    assert.equal(week.reportedCredits, 6);
    assert.equal(week.nights[0]?.reportedCredits, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("builds a closing comparison only when pre-tip odds match the latest confirmed five", () => {
  const past = captureOpeningGame(source)!;
  const final = { ...past, eventId: snapshot.eventId, finalAt: now + 360_000, availableAt: now + 361_000 };
  const lineup = { kind: "lineup" as const, snapshot, at: now - 1000 };
  const quote = { kind: "odds" as const, at: now, eventId: snapshot.eventId, key: archiveOddsPlan(snapshot, now, undefined)!.key,
    status: 200, credits: 3, remaining: 100, response: oddsData([book]) };
  const afterTip = { ...quote, at: snapshot.startsAt };
  assert.equal(archivedFirstBasketCases([lineup, quote, afterTip], [final])[0]?.closing?.at, now);
  assert.equal(archivedFirstBasketCases([lineup, afterTip], [final])[0]?.closing, undefined);
  const scratch = { ...lineup, at: now + 1, snapshot: { ...snapshot, availableAt: now + 1, confirmedAt: null } };
  assert.deepEqual(archivedFirstBasketCases([lineup, quote, scratch], [final]), []);
});

test("walk-forward usage tuning keeps the final time block out of selection", () => {
  const past = captureOpeningGame(source)!;
  const cases = Array.from({ length: 3 }, (_, i) => {
    const startsAt = now + (i + 1) * 86_400_000;
    const eventId = `tune-${i}`;
    return {
      snapshot: { ...snapshot, eventId, startsAt, confirmedAt: startsAt - 2 * MINUTE, availableAt: startsAt - MINUTE },
      final: { ...past, eventId, finalAt: startsAt + 120 * MINUTE, availableAt: startsAt + 121 * MINUTE },
    };
  });
  const result = tuneFirstBasketUsage({ history: [past], cases, strengths: [5, 35] });
  assert.ok(result.selectedStrength != null && result.holdout);
  assert.equal(result.holdout.selected.games, 1);
  assert.deepEqual(result.development.map(row => row.folds.map(fold => fold.games)), [[1, 1], [1, 1]]);
  assert.deepEqual(tuneFirstBasketUsage({ history: [past], cases: cases.slice(0, 1) }).holdout, null);
});
