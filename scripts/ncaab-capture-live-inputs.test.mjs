import test from "node:test";
import assert from "node:assert/strict";
import {
  espnBoardDay,
  matchEspnEvent,
  pairNcaabMarkets,
  upcomingNcaabOdds,
} from "./ncaab-capture-live-inputs.mjs";

test("upcoming NCAAB odds keep exact sport key and future kickoffs", () => {
  const observedAt = "2026-10-26T17:00:00Z";
  const raw = JSON.stringify([
    {
      id: "odds1",
      sport_key: "basketball_ncaab",
      home_team: "Duke Blue Devils",
      away_team: "Kansas Jayhawks",
      commence_time: "2026-11-02T00:00:00Z",
      bookmakers: [],
    },
    {
      id: "odds2",
      sport_key: "basketball_ncaab",
      home_team: "Past Home",
      away_team: "Past Away",
      commence_time: "2026-10-20T00:00:00Z",
      bookmakers: [],
    },
  ]);
  const upcoming = upcomingNcaabOdds(raw, observedAt);
  assert.equal(upcoming.length, 1);
  assert.equal(upcoming[0].id, "odds1");
  assert.equal(espnBoardDay("2026-11-02T00:00:00Z"), "2026-11-01");
});

test("pairNcaabMarkets preserves sourceUpdatedAt and rejects stale quotes", () => {
  const observedAt = "2026-10-26T17:00:00Z";
  const { quotes, excluded } = pairNcaabMarkets(
    {
      bookmakers: [
        {
          key: "draftkings",
          last_update: "2026-10-26T16:55:00Z",
          markets: [
            {
              key: "h2h",
              last_update: "2026-10-26T16:55:00Z",
              outcomes: [
                { name: "Duke", price: -140 },
                { name: "Kansas", price: 120 },
              ],
            },
            {
              key: "spreads",
              last_update: "2026-10-26T15:00:00Z",
              outcomes: [{ name: "Duke", price: -110, point: -3.5 }],
            },
          ],
        },
      ],
    },
    observedAt,
  );
  assert.equal(quotes.length, 2);
  assert.ok(quotes.every((q) => q.sourceUpdatedAt));
  assert.ok(excluded.includes("stale_or_future_quote"));
});

test("matchEspnEvent requires unique home/away/kickoff identity", () => {
  const kickoff = "2026-11-02T00:00:00Z";
  const board = JSON.stringify({
    events: [
      {
        id: "401",
        season: { year: 2027 },
        competitions: [
          {
            date: kickoff,
            competitors: [
              {
                homeAway: "home",
                team: {
                  id: "150",
                  displayName: "Duke Blue Devils",
                  shortDisplayName: "Duke",
                  location: "Duke",
                  name: "Blue Devils",
                },
              },
              {
                homeAway: "away",
                team: {
                  id: "2305",
                  displayName: "Kansas Jayhawks",
                  shortDisplayName: "Kansas",
                  location: "Kansas",
                  name: "Jayhawks",
                },
              },
            ],
          },
        ],
      },
    ],
  });
  const hit = matchEspnEvent(board, {
    home_team: "Duke Blue Devils",
    away_team: "Kansas Jayhawks",
    commence_time: kickoff,
  });
  assert.equal(hit?.eventId, "401");
  assert.equal(hit?.homeId, "150");
  assert.equal(
    matchEspnEvent(board, {
      home_team: "Duke Blue Devils",
      away_team: "Kansas Jayhawks",
      commence_time: "2026-11-03T00:00:00Z",
    }),
    null,
  );
});
