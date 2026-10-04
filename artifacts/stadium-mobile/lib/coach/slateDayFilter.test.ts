/**
 * Regression: parsed slate-day intent must restrict candidate games BEFORE
 * player-prop and game-line pools are built — and must stay closed through
 * recovery / top-up / final staging.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  filterOddsForSlateDay,
  filterOddsGamesForSlateDay,
  filterPicksForSlateDay,
  localDayDiff,
  slateDayFromThread,
  startsTodayUpcoming,
  startsTomorrowUpcoming,
  wantsTonightSlate,
  wantsTomorrowSlate,
} from "../slate.ts";
import { parseCoachAskMarketConstraint } from "../coachAskMarketFilter.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function isoHoursFromNow(h: number): string {
  return new Date(Date.now() + h * 3600_000).toISOString();
}

function isoLocalDay(dayOffset: number, hour = 20): string {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);
  // If "today" hour already passed, push a bit later so it stays upcoming.
  if (dayOffset === 0 && d.getTime() <= Date.now()) {
    d.setTime(Date.now() + 90 * 60_000);
  }
  return d.toISOString();
}

function boardFixture() {
  const today = isoLocalDay(0, 21);
  const tomorrow = isoLocalDay(1, 19);
  const dayAfter = isoLocalDay(2, 19);
  return {
    today,
    tomorrow,
    dayAfter,
    oddsGames: [
      { id: "t", sport: "nhl", commenceTime: today, label: "today" },
      { id: "m", sport: "nhl", commenceTime: tomorrow, label: "tomorrow" },
      { id: "a", sport: "nfl", commenceTime: dayAfter, label: "dayAfter" },
    ],
    espnGames: [
      { id: "t", sport: "nhl", startsAt: today, label: "today" },
      { id: "m", sport: "nhl", startsAt: tomorrow, label: "tomorrow" },
      { id: "a", sport: "nfl", startsAt: dayAfter, label: "dayAfter" },
    ],
    propPool: [
      { game: "A @ B", player: "P1", startsAt: today, marketLabel: "Anytime TD" },
      { game: "C @ D", player: "P2", startsAt: tomorrow, marketLabel: "Anytime TD" },
      { game: "E @ F", player: "P3", startsAt: dayAfter, marketLabel: "Rush Yds" },
    ],
    liveOdds: [
      { sport: "nhl", game: "A @ B", market: "Moneyline", pick: "A", odds: -110, startsAt: today },
      { sport: "nhl", game: "C @ D", market: "Moneyline", pick: "C", odds: -110, startsAt: tomorrow },
      { sport: "nfl", game: "E @ F", market: "Spread", pick: "E +3.5", odds: -110, startsAt: dayAfter },
    ],
    picks: [
      { game: "A @ B", market: "Anytime TD", pick: "P1", startsAt: today, isProp: true },
      { game: "C @ D", market: "Alt Spread", pick: "C +1.5", startsAt: tomorrow, isProp: false },
      { game: "E @ F", market: "Q1 Spread", pick: "E -2.5", startsAt: dayAfter, isProp: false },
    ],
  };
}

/** Mirrors loadScanInputs: bettable → slateDay → filter games/props/odds. */
function applyLoadScanSlateFilter<T extends { commenceTime?: string; startsAt?: string | null }>(
  ask: string,
  prior: string[],
  board: {
    oddsGames: Array<T & { commenceTime: string }>;
    espnGames: Array<T & { startsAt: string }>;
    propPool: Array<T & { startsAt?: string | null }>;
    liveOdds: Array<T & { startsAt?: string | null }>;
  },
) {
  const slateDay = slateDayFromThread(ask, prior);
  return {
    slateDay,
    oddsGames: filterOddsGamesForSlateDay(board.oddsGames, slateDay),
    espnGames: filterOddsForSlateDay(board.espnGames, slateDay),
    propPool: filterOddsForSlateDay(board.propPool, slateDay),
    liveOdds: filterOddsForSlateDay(board.liveOdds, slateDay),
  };
}

test("1) 7 leg for today → only still-upcoming games on the local calendar day", () => {
  const ask = "7 leg for today";
  assert.equal(slateDayFromThread(ask, []), "tonight");
  assert.equal(wantsTonightSlate(ask), true);

  const board = boardFixture();
  const filtered = applyLoadScanSlateFilter(ask, [], board);
  assert.equal(filtered.slateDay, "tonight");
  assert.equal(filtered.oddsGames.length, 1);
  assert.ok(startsTodayUpcoming(filtered.oddsGames[0]!.commenceTime));
  assert.equal(filtered.espnGames.length, 1);
  assert.equal(filtered.propPool.length, 1);
  assert.equal(filtered.liveOdds.length, 1);
  assert.equal(localDayDiff(filtered.propPool[0]!.startsAt!), 0);

  const finalPicks = filterPicksForSlateDay(board.picks, filtered.slateDay);
  assert.equal(finalPicks.length, 1);
  assert.ok(startsTodayUpcoming(finalPicks[0]!.startsAt));
});

test("2) 7 leg tonight → same today/tonight slate (no new evening cutoff)", () => {
  const ask = "7 leg tonight";
  assert.equal(slateDayFromThread(ask, []), "tonight");
  assert.equal(wantsTonightSlate(ask), true);

  const board = boardFixture();
  const filtered = applyLoadScanSlateFilter(ask, [], board);
  assert.equal(filtered.slateDay, "tonight");
  assert.equal(filtered.oddsGames.length, 1);
  assert.ok(startsTodayUpcoming(filtered.oddsGames[0]!.commenceTime));
  // Same helper as "today" — startsTodayUpcoming, not an invented evening window.
  assert.equal(
    filterOddsGamesForSlateDay(board.oddsGames, "tonight").length,
    board.oddsGames.filter((g) => startsTodayUpcoming(g.commenceTime)).length,
  );
});

test("3) 7 leg tomorrow → only games on the next local calendar day", () => {
  const ask = "7 leg tomorrow";
  assert.equal(slateDayFromThread(ask, []), "tomorrow");
  assert.equal(wantsTomorrowSlate(ask), true);

  const board = boardFixture();
  const filtered = applyLoadScanSlateFilter(ask, [], board);
  assert.equal(filtered.slateDay, "tomorrow");
  assert.equal(filtered.oddsGames.length, 1);
  assert.ok(startsTomorrowUpcoming(filtered.oddsGames[0]!.commenceTime));
  assert.equal(filtered.espnGames.length, 1);
  assert.equal(filtered.propPool.length, 1);
  assert.equal(filtered.liveOdds.length, 1);
  assert.equal(localDayDiff(filtered.propPool[0]!.startsAt!), 1);

  const finalPicks = filterPicksForSlateDay(board.picks, filtered.slateDay);
  assert.equal(finalPicks.length, 1);
  assert.ok(startsTomorrowUpcoming(finalPicks[0]!.startsAt));
});

test("4) 7 leg with no date → retain existing 48h default (slateDay null)", () => {
  const ask = "7 leg";
  assert.equal(slateDayFromThread(ask, []), null);

  const board = boardFixture();
  const filtered = applyLoadScanSlateFilter(ask, [], board);
  assert.equal(filtered.slateDay, null);
  // No slate-day restriction — full board passed through (48h already applied upstream).
  assert.equal(filtered.oddsGames.length, board.oddsGames.length);
  assert.equal(filtered.espnGames.length, board.espnGames.length);
  assert.equal(filtered.propPool.length, board.propPool.length);
  assert.equal(filtered.liveOdds.length, board.liveOdds.length);
  assert.deepEqual(
    filterPicksForSlateDay(board.picks, null),
    board.picks,
  );
});

test("5) today request after a previous tomorrow request → today wins", () => {
  assert.equal(
    slateDayFromThread("7 leg for today", ["7 leg tomorrow"]),
    "tonight",
  );
  const board = boardFixture();
  const filtered = applyLoadScanSlateFilter("7 leg for today", ["7 leg tomorrow"], board);
  assert.equal(filtered.oddsGames.length, 1);
  assert.ok(startsTodayUpcoming(filtered.oddsGames[0]!.commenceTime));
});

test("5b) sport-scoped ask after tonight does NOT inherit tonight (48h NFL)", () => {
  // Phone: prior "tonight" staged college; "7 leg NFL" inherited tonight and
  // emptied Sunday-evening NFL while Monday games were outside "today".
  assert.equal(slateDayFromThread("7 leg NFL", ["7 leg tonight"]), null);
  assert.equal(slateDayFromThread("7 leg nfl", ["5 leg for today"]), null);
  assert.equal(slateDayFromThread("10 leg nba", ["parlay for tonight"]), null);
  // Explicit date on this turn still wins.
  assert.equal(slateDayFromThread("7 leg NFL tonight", ["7 leg tomorrow"]), "tonight");
  // Bare refinement without a sport still inherits tonight.
  assert.equal(slateDayFromThread("5 leg", ["7 leg tonight"]), "tonight");
  assert.equal(slateDayFromThread("5 leg parlay", ["for tonight"]), "tonight");

  const board = boardFixture();
  // boardFixture NFL game is day-after — must survive "7 leg NFL" after tonight.
  const filtered = applyLoadScanSlateFilter("7 leg NFL", ["7 leg tonight"], board);
  assert.equal(filtered.slateDay, null);
  assert.ok(
    filtered.oddsGames.some((g) => (g as { sport?: string }).sport === "nfl"),
    "NFL day-after game must remain on the 48h board",
  );
});

test("6) tomorrow request after a previous today request → tomorrow wins", () => {
  assert.equal(
    slateDayFromThread("7 leg tomorrow", ["7 leg for today"]),
    "tomorrow",
  );
  const board = boardFixture();
  const filtered = applyLoadScanSlateFilter("7 leg tomorrow", ["7 leg for today"], board);
  assert.equal(filtered.oddsGames.length, 1);
  assert.ok(startsTomorrowUpcoming(filtered.oddsGames[0]!.commenceTime));
});

test("7) recovery / top-up cannot introduce an out-of-day candidate", () => {
  const board = boardFixture();
  const { slateDay, propPool, oddsGames } = applyLoadScanSlateFilter(
    "7 leg for today",
    [],
    board,
  );
  assert.equal(slateDay, "tonight");

  // Recovery pulls from the already day-filtered prop pool (same as buildParlay).
  const recoveryCandidates = [
    ...propPool,
    // Hostile: an out-of-day row that somehow reappears during recovery.
    {
      game: "X @ Y",
      player: "Leak",
      startsAt: board.tomorrow,
      marketLabel: "Anytime TD",
    },
  ];
  const recoveryClosed = filterOddsForSlateDay(recoveryCandidates, slateDay);
  assert.equal(recoveryClosed.length, 1);
  assert.ok(startsTodayUpcoming(recoveryClosed[0]!.startsAt));

  // Final staging belt — same filterPicksForSlateDay used after recovery/top-up.
  const stagedWithLeak = [
    ...filterPicksForSlateDay(
      board.picks.map((p) => ({ ...p })),
      slateDay,
    ),
    {
      game: "Leak @ Game",
      market: "Alt Spread",
      pick: "Leak +3.5",
      startsAt: board.tomorrow,
      isProp: false,
    },
  ];
  const finalBelt = filterPicksForSlateDay(stagedWithLeak, slateDay);
  assert.equal(finalBelt.length, 1);
  assert.ok(startsTodayUpcoming(finalBelt[0]!.startsAt));

  // Game-line discovery is also day-scoped via filtered oddsGames.
  assert.ok(oddsGames.every((g) => startsTodayUpcoming(g.commenceTime)));
});

test("8) explicit market lock retains date restriction (5 touchdowns today)", () => {
  const ask = "5 touchdowns today";
  assert.equal(slateDayFromThread(ask, []), "tonight");
  const market = parseCoachAskMarketConstraint(ask, []);
  assert.equal(market.propsOnly, true);
  assert.ok(market.allowedMarketKeys != null);
  assert.ok(market.allowedMarketKeys!.includes("player_anytime_td"));

  const board = boardFixture();
  const filtered = applyLoadScanSlateFilter(ask, [], board);
  assert.equal(filtered.slateDay, "tonight");
  // Market lock + date: only today's TD-eligible prop rows remain on the board.
  assert.equal(filtered.propPool.length, 1);
  assert.equal(filtered.propPool[0]!.marketLabel, "Anytime TD");
  assert.ok(startsTodayUpcoming(filtered.propPool[0]!.startsAt));
  // Tomorrow TD row must not survive even though the market matches.
  assert.equal(
    filtered.propPool.filter((p) => p.startsAt === board.tomorrow).length,
    0,
  );
});

test("buildCoachParlay wires slate-day filter before props + game lines", () => {
  const src = readFileSync(join(root, "lib/coach/buildParlay.ts"), "utf8");
  assert.match(src, /slateDayFromThread\(askText/);
  assert.match(src, /filterOddsGamesForSlateDay\(oddsGames,\s*slateDay\)/);
  assert.match(src, /filterOddsForSlateDay\(espnGames,\s*slateDay\)/);
  assert.match(src, /fetchFullBoardPropPool\(oddsGames,\s*espnGames/);
  // Prop pool + live odds also day-scoped; final belt after recovery/staging.
  assert.match(src, /propPool = filterOddsForSlateDay\(propPool,\s*slateDay\)/);
  assert.match(src, /filterOddsForSlateDay\(liveFeed\.odds/);
  assert.match(src, /filterPicksForSlateDay\(picks,\s*inputs\.slateDay\)/);
  // priorUserTexts must reach loadScanInputs for thread date precedence.
  assert.match(src, /priorUserTexts/);
});

test("filterOddsGamesForSlateDay is a thin commenceTime adapter (same rules)", () => {
  const today = isoHoursFromNow(3);
  const tomorrow = isoLocalDay(1, 18);
  // Force today kickoff to local day 0 when isoHoursFromNow crosses midnight.
  const todayLocal = startsTodayUpcoming(today) ? today : isoLocalDay(0, 22);
  const games = [
    { commenceTime: todayLocal },
    { commenceTime: tomorrow },
  ];
  assert.equal(filterOddsGamesForSlateDay(games, null).length, 2);
  assert.equal(filterOddsGamesForSlateDay(games, "tonight").length, 1);
  assert.equal(filterOddsGamesForSlateDay(games, "tomorrow").length, 1);
});
