import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { buildLiveArchive } from "../../../scripts/ncaaf-capture-live-inputs.mjs";
import { forecastInputFromArchive } from "../src/lib/ncaafLiveInputAdapter.js";
import { prepareForwardForecast } from "../src/lib/ncaafForecastJournal.js";
const now = "2026-10-23T12:00:00Z",
  kickoff = "2026-10-24T18:00:00Z";
function fixture() {
  const raw = JSON.stringify({ injuries: [] }),
    injury = {
      key: "research:ncaaf:injuries:2026-10-23T12:00",
      observedAt: now,
      sha256: createHash("sha256").update(raw).digest("hex"),
      rawResponse: raw,
      absentTeamStatus: "unknown" as const,
    };
  const capture = (p: unknown) => ({
    rawResponse: JSON.stringify(p),
    requestStartedAt: now,
    receivedAt: now,
  });
  const archive = buildLiveArchive(
    capture([
      {
        id: "provider1",
        sport_key: "americanfootball_ncaaf",
        home_team: "Home Eagles",
        away_team: "Away Owls",
        commence_time: kickoff,
        bookmakers: [
          {
            key: "fixture",
            last_update: now,
            markets: [
              {
                key: "spreads",
                outcomes: [
                  { name: "Home Eagles", point: -3.5, price: -110 },
                  { name: "Away Owls", point: 3.5, price: -110 },
                ],
              },
            ],
          },
        ],
      },
    ]),
    [
      capture({
        events: [
          {
            id: "999",
            season: { year: 2026 },
            competitions: [
              {
                date: kickoff,
                status: { type: { state: "pre" } },
                competitors: [
                  {
                    homeAway: "home",
                    team: { id: "1", displayName: "Home Eagles" },
                  },
                  {
                    homeAway: "away",
                    team: { id: "2", displayName: "Away Owls" },
                  },
                ],
              },
            ],
          },
        ],
      }),
    ],
  );
  const games = Array.from({ length: 36 }, (_, i) => ({
    season: 2026,
    eventId: String(i + 10),
    homeId: i < 3 ? "1" : i < 6 ? "2" : String(100 + i),
    awayId: String(200 + i),
    kickoff: "2026-09-01T12:00:00Z",
    completedAt: "2026-09-01T16:00:00Z",
    observedAt: "2026-09-01T17:00:00Z",
    source: "fixture",
    ruleset: "fixture",
    homePoints: i < 6 ? 28 : 31,
    awayPoints: i < 6 ? 21 : 28,
    overtime: i >= 6,
    regulationHomePoints: i < 6 ? 28 : 21,
    regulationAwayPoints: 21,
  }));
  return { archive, injury, games };
}
test("captured raw quote and exact ESPN identity bind through to the 10k forward recorder", () => {
  const { archive, injury, games } = fixture();
  const input = forecastInputFromArchive(
      archive,
      "999",
      games,
      injury,
      "fixture",
      now,
    ),
    record = prepareForwardForecast(input, now);
  assert.equal(record.markets.length, 1);
  assert.equal(record.markets[0].line, -3.5);
  assert.equal(record.markets[0].firstPrice, -110);
  assert.equal(record.simulations, 10000);
  assert.equal(record.validationReady, false);
  assert.equal(record.absentTeamStatus, "unknown");
  assert.ok("liveSourceEvidence" in record.input);
});
test("modified normalized line, price, provider ID or raw bytes cannot inherit authentic source evidence", () => {
  for (const mutate of [
    (a: any) => (a.matched[0].quotes[0].line = -2.5),
    (a: any) => (a.matched[0].quotes[0].firstPrice = 120),
    (a: any) => (a.matched[0].providerEventId = "another"),
    (a: any) => (a.odds.rawResponse = "[]"),
    (a: any) => (a.matched[0].target.homeId = "3"),
  ]) {
    const { archive, injury, games } = fixture();
    mutate(archive);
    assert.throws(() =>
      forecastInputFromArchive(archive, "999", games, injury, "fixture", now),
    );
  }
});
test("future receipts, started targets, stale quotes and missing evidence cannot produce forecasts", () => {
  const { archive, injury, games } = fixture();
  assert.throws(() =>
    forecastInputFromArchive(
      archive,
      "999",
      games,
      injury,
      "fixture",
      "2026-10-23T11:59:59Z",
    ),
  );
  assert.throws(() =>
    forecastInputFromArchive(archive, "999", games, injury, "fixture", kickoff),
  );
  assert.throws(() =>
    forecastInputFromArchive(
      archive,
      "999",
      games,
      injury,
      "fixture",
      "2026-10-23T12:16:00Z",
    ),
  );
  const thin = forecastInputFromArchive(
    archive,
    "999",
    [],
    injury,
    "fixture",
    now,
  );
  assert.throws(() => prepareForwardForecast(thin, now));
});
