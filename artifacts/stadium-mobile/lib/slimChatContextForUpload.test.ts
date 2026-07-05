import { test } from "node:test";
import assert from "node:assert/strict";
import { slimChatContextForUpload, ultraSlimChatContextForUpload, microSlimChatContextForUpload, compactSlimChatContextForUpload, largeCompactSlimChatContextForUpload, type SlimChatContextInput } from "./slimChatContext.ts";

function heavyContext(): SlimChatContextInput {
  const game = "Away Team @ Home Team";
  return {
    selectedSports: ["mlb", "nba"],
    currentSlip: [],
    realGames: [{ sport: "mlb", game, status: "pre", startsAt: "2026-07-04T23:00:00Z", venue: "Stadium" }],
    realOdds: [
      {
        sport: "mlb",
        game,
        market: "Moneyline",
        pick: "Away ML",
        odds: 150,
        noVigFair: 0.42,
        edge: 3.1,
        bookSpread: 12,
      },
    ],
    realProps: [
      {
        sport: "mlb",
        game,
        startsAt: "2026-07-04T23:00:00Z",
        player: "Player One",
        market: "batter_hits",
        line: 1.5,
        over: -110,
        under: -110,
        alt: false,
        ev: 4.2,
        evSide: "Over",
        fairProb: 0.55,
        edge: 2.1,
        simHitPct: 58,
        selectionScore: 7.2,
      },
      {
        sport: "mlb",
        game,
        startsAt: "2026-07-04T23:00:00Z",
        player: "Player Two",
        market: "batter_hits",
        line: 2.5,
        over: 180,
        under: -220,
        alt: true,
      },
    ],
    matchupHistory: {
      [game]: {
        home: { wins: 10, losses: 5 },
        away: { wins: 8, losses: 7 },
        homePace: 102,
        awayPace: 98,
        homeVenueForm: { wins: 5, losses: 2 },
        awayVenueForm: { wins: 4, losses: 3 },
        homeStreak: "W3",
        awayStreak: "L1",
        homeSeason: { wins: 40, losses: 30 },
        awaySeason: { wins: 38, losses: 32 },
        homeRest: 1,
        awayRest: 2,
        h2h: [{ winner: "home" }],
        lastMeeting: { date: "2026-06-01", score: "5-3" },
        mlLean: { side: "Home Team", edge: 2.1, reasons: ["pace"] },
      },
    },
    playerHistory: {
      "Player One#1": {
        player: "Player One",
        recent: [1, 2, 3, 4, 5, 6, 7],
        vsOpponent: [1, 2, 3],
      },
    },
    mlbPlatoon: { "Player One#1": { platoon: "L" } },
    mlbGameEnv: { [game]: { venue: "Stadium", park: { hrFactor: 1.1 } } },
    matchupInjuries: {
      [game]: {
        home: { out: [{ name: "Star", status: "Out", impact: "high" }], edge: "away" },
        away: { out: [], edge: "away" },
      },
    },
  };
}

test("slimChatContextForUpload drops heavy upload-only fields", () => {
  const slim = slimChatContextForUpload(heavyContext());
  assert.deepEqual(slim.realGames, []);
  assert.equal(slim.realProps.length, 2);
  assert.equal(slim.realProps[0].player, "Player One");
  assert.equal(slim.realProps[1].alt, true);
  assert.equal("ev" in slim.realProps[0], false);
  assert.equal("noVigFair" in slim.realOdds[0], false);
  assert.equal(slim.mlbPlatoon, undefined);
  assert.equal(slim.mlbGameEnv, undefined);
  assert.equal(slim.matchupInjuries, undefined);
  assert.equal(slim.matchupHistory?.["Away Team @ Home Team"]?.mlLean?.side, "Home Team");
  assert.equal(slim.matchupHistory?.["Away Team @ Home Team"]?.home, null);
});

test("slimChatContextForUpload shrinks serialized upload size", () => {
  const before = JSON.stringify(heavyContext()).length;
  const after = JSON.stringify(slimChatContextForUpload(heavyContext())).length;
  assert.ok(after < before * 0.7, `expected meaningful shrink: ${after} vs ${before}`);
});

test("ultraSlimChatContextForUpload caps pools for emergency retry", () => {
  const base = heavyContext();
  const manyProps = Array.from({ length: 80 }, (_, i) => ({
    sport: "mlb",
    game: "Away Team @ Home Team",
    startsAt: "2026-07-04T23:00:00Z",
    player: `Player ${i}`,
    market: "batter_hits",
    line: 1.5,
    over: -110,
    under: -110,
    alt: false,
  }));
  const manyOdds = Array.from({ length: 60 }, (_, i) => ({
    sport: "mlb",
    game: "Away Team @ Home Team",
    market: "Moneyline",
    pick: `Pick ${i}`,
    odds: 150 + i,
  }));
  const heavy = { ...base, realProps: manyProps, realOdds: manyOdds };
  const slim = slimChatContextForUpload(heavy);
  const ultra = ultraSlimChatContextForUpload(heavy);
  assert.ok(ultra.realProps.length <= 36);
  assert.ok(ultra.realOdds.length <= 24);
  assert.equal(ultra.playerHistory, undefined);
  assert.ok(JSON.stringify(ultra).length < JSON.stringify(slim).length);
});

test("microSlimChatContextForUpload caps further for 3-leg cellular uploads", () => {
  const base = heavyContext();
  const manyProps = Array.from({ length: 80 }, (_, i) => ({
    sport: "mlb",
    game: "Away Team @ Home Team",
    startsAt: "2026-07-04T23:00:00Z",
    player: `Player ${i}`,
    market: "batter_hits",
    line: 1.5,
    over: -110,
    under: -110,
    alt: false,
  }));
  const heavy = { ...base, realProps: manyProps };
  const micro = microSlimChatContextForUpload(heavy);
  assert.ok(micro.realProps.length <= 20);
  assert.ok(micro.realOdds.length <= 16);
  assert.equal(micro.matchupHistory, undefined);
  assert.ok(JSON.stringify(micro).length < JSON.stringify(ultraSlimChatContextForUpload(heavy)).length);
});

test("compactSlimChatContextForUpload caps 4-8 leg cellular uploads", () => {
  const heavy: SlimChatContextInput = {
    selectedSports: ["mlb", "wnba", "nba", "nhl"],
    currentSlip: [],
    realGames: Array(20).fill({ sport: "mlb", game: "A @ B", status: "pre" }),
    realOdds: Array(80).fill({ sport: "mlb", game: "A @ B", market: "h2h", pick: "A", odds: -110, startsAt: new Date().toISOString() }),
    realProps: Array(100).fill({
      sport: "mlb",
      game: "A @ B",
      startsAt: new Date().toISOString(),
      player: "P",
      market: "batter_hits",
      line: 0.5,
      over: -120,
      under: 100,
      alt: false,
    }),
    matchupHistory: { "A @ B": { home: null, away: null, homePace: 100, awayPace: 100, homeVenueForm: null, awayVenueForm: null, homeStreak: null, awayStreak: null, homeSeason: null, awaySeason: null, homeRest: null, awayRest: null, h2h: null, lastMeeting: null, mlLean: { side: "A", edge: 2, reasons: ["x"] } } },
  };
  const compact = compactSlimChatContextForUpload(heavy);
  assert.ok(compact.realOdds.length <= 32);
  assert.ok(compact.realProps.length <= 56);
  assert.equal(compact.matchupHistory, undefined);
  assert.equal(compact.realGames.length, 0);
});

test("largeCompactSlimChatContextForUpload caps 9-15 leg cellular uploads", () => {
  const heavy: SlimChatContextInput = {
    selectedSports: ["mlb", "wnba", "nba", "nhl", "soccer", "ufc"],
    currentSlip: [],
    realGames: Array(20).fill({ sport: "mlb", game: "A @ B", status: "pre" }),
    realOdds: Array(100).fill({ sport: "mlb", game: "A @ B", market: "h2h", pick: "A", odds: -110, startsAt: new Date().toISOString() }),
    realProps: Array(120).fill({
      sport: "mlb",
      game: "A @ B",
      startsAt: new Date().toISOString(),
      player: "P",
      market: "batter_hits",
      line: 0.5,
      over: -120,
      under: 100,
      alt: false,
    }),
  };
  const large = largeCompactSlimChatContextForUpload(heavy);
  assert.ok(large.realOdds.length <= 48);
  assert.ok(large.realProps.length <= 80);
  assert.ok((large.selectedSports?.length ?? 0) <= 6);
  assert.equal(large.matchupHistory, undefined);
});
