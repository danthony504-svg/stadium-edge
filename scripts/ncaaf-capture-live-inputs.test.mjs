import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  espnBoardDay,
  upcomingOdds,
  pairMarkets,
  buildLiveArchive,
} from "./ncaaf-capture-live-inputs.mjs";
const observedAt = "2026-10-23T12:00:00Z",
  kickoff = "2026-10-24T18:00:00Z";
function fixture() {
  const game = {
    id: "odds-1",
    sport_key: "americanfootball_ncaaf",
    home_team: "Example State Eagles",
    away_team: "Example Tech Owls",
    commence_time: kickoff,
    bookmakers: [
      {
        key: "fixture",
        last_update: observedAt,
        markets: [
          {
            key: "h2h",
            outcomes: [
              { name: "Example State Eagles", price: -150 },
              { name: "Example Tech Owls", price: 130 },
            ],
          },
          {
            key: "spreads",
            outcomes: [
              { name: "Example State Eagles", price: -105, point: -3.5 },
              { name: "Example Tech Owls", price: -115, point: 3.5 },
            ],
          },
          {
            key: "totals",
            outcomes: [
              { name: "Over", price: -110, point: 52.5 },
              { name: "Under", price: -110, point: 52.5 },
            ],
          },
        ],
      },
    ],
  };
  const event = {
    id: "999",
    season: { year: 2026 },
    competitions: [
      {
        date: kickoff,
        status: { type: { state: "pre" } },
        competitors: [
          {
            homeAway: "home",
            team: { id: "1", displayName: "Example State Eagles" },
          },
          {
            homeAway: "away",
            team: { id: "2", displayName: "Example Tech Owls" },
          },
        ],
      },
    ],
  };
  const capture = (raw) => ({
    requestStartedAt: observedAt,
    receivedAt: observedAt,
    rawResponse: JSON.stringify(raw),
  });
  return { game, event, capture };
}
test("exact two-sided provider lines/prices survive; raw evidence hashes are preserved", () => {
  const { game, event, capture } = fixture();
  const odds = capture([game]),
    board = capture({ events: [event] });
  const r = buildLiveArchive(odds, [board]);
  assert.equal(r.matched.length, 1);
  assert.equal(r.matched[0].target.eventId, "999");
  assert.deepEqual(
    r.matched[0].quotes.map((q) => [
      q.market,
      q.line,
      q.firstPrice,
      q.secondPrice,
    ]),
    [
      ["ml", null, -150, 130],
      ["spread", -3.5, -105, -115],
      ["total", 52.5, -110, -110],
    ],
  );
  assert.equal(
    r.odds.sha256,
    createHash("sha256").update(odds.rawResponse).digest("hex"),
  );
  assert.equal(r.validationReady, false);
  assert.equal(r.automaticUnlock, false);
});
test("different kickoff seconds, abbreviations, reversed teams and multiple IDs never fuzzy-match", () => {
  for (const mutate of [
    (e) => (e.competitions[0].date = "2026-10-24T18:00:01Z"),
    (e) =>
      (e.competitions[0].competitors[0].team.displayName = "Example St Eagles"),
    (e) =>
      e.competitions[0].competitors
        .reverse()
        .forEach((c, i) => (c.homeAway = i ? "away" : "home")),
  ]) {
    const { game, event, capture } = fixture();
    mutate(event);
    const r = buildLiveArchive(capture([game]), [capture({ events: [event] })]);
    assert.equal(r.matched.length, 0);
  }
  const { game, event, capture } = fixture();
  assert.equal(
    buildLiveArchive(capture([game]), [
      capture({ events: [event, { ...event, id: "998" }] }),
    ]).excluded[0].reason,
    "ambiguous_identity",
  );
});
test("one-sided, mismatched spreads/totals, invalid prices and stale markets cannot become quotes", () => {
  for (const mutate of [
    (g) => (g.bookmakers[0].markets[1].outcomes[1].point = 4),
    (g) => g.bookmakers[0].markets[1].outcomes.pop(),
    (g) => (g.bookmakers[0].markets[1].outcomes[0].price = 0),
  ]) {
    const { game } = fixture();
    mutate(game);
    assert.equal(
      pairMarkets(game, observedAt).quotes.some((q) => q.market === "spread"),
      false,
    );
  }
  const { game } = fixture();
  game.bookmakers[0].last_update = "2026-10-23T11:00:00Z";
  assert.equal(pairMarkets(game, observedAt).quotes.length, 0);
});
test("period markets are ignored and duplicated bookmaker markets reject", () => {
  const { game } = fixture();
  game.bookmakers[0].markets.push({
    ...game.bookmakers[0].markets[0],
    key: "h2h_q1",
  });
  assert.equal(pairMarkets(game, observedAt).quotes.length, 3);
  game.bookmakers[0].markets.push(game.bookmakers[0].markets[0]);
  assert.throws(() => pairMarkets(game, observedAt), /ambiguous/);
});
test("postgame, past events, wrong sports and invalid receipt times fail closed", () => {
  const { game, event, capture } = fixture();
  event.competitions[0].status.type.state = "post";
  assert.equal(
    buildLiveArchive(capture([game]), [capture({ events: [event] })]).matched
      .length,
    0,
  );
  assert.equal(
    upcomingOdds(JSON.stringify([game]), "2026-10-25T12:00:00Z").length,
    0,
  );
  assert.throws(() =>
    upcomingOdds(
      JSON.stringify([{ ...game, sport_key: "americanfootball_nfl" }]),
      observedAt,
    ),
  );
  assert.throws(
    () =>
      buildLiveArchive(
        { ...capture([game]), receivedAt: "2026-10-22T12:00:00Z" },
        [],
      ),
    /receipt/,
  );
});
test("default CLI is plan-only without database or provider credentials", () => {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  delete env.ODDS_API_KEY;
  const r = JSON.parse(
    execFileSync(process.execPath, ["scripts/ncaaf-capture-live-inputs.mjs"], {
      env,
      encoding: "utf8",
    }),
  );
  assert.equal(r.planOnly, true);
  assert.equal(r.maximumOddsRequests, 1);
  assert.equal(r.automaticUnlock, false);
});

test("ESPN board days use Eastern midnight across daylight-saving changes", () => {
  assert.equal(espnBoardDay("2026-10-24T00:30:00Z"), "2026-10-23");
  assert.equal(espnBoardDay("2026-12-05T00:30:00Z"), "2026-12-04");
  assert.equal(espnBoardDay("2026-10-24T18:00:00Z"), "2026-10-24");
  assert.throws(() => espnBoardDay("invalid"));
});
test("repeated board evidence preserves earliest receipt but conflicting identities reject", () => {
  const { game, event, capture } = fixture(),
    first = capture({ events: [event] }),
    later = { ...first, receivedAt: "2026-10-23T12:01:00Z" };
  const r = buildLiveArchive(capture([game]), [later, first]);
  assert.equal(r.matched.length, 1);
  assert.equal(r.matched[0].target.scoreboardObservedAt, first.receivedAt);
  const changed = structuredClone(event);
  changed.competitions[0].competitors[0].team.id = "900";
  assert.throws(
    () =>
      buildLiveArchive(capture([game]), [
        first,
        capture({ events: [changed] }),
      ]),
    /conflicting/,
  );
});
