import { buildRealOdds } from "./api";

const sports = ["nfl", "ncaaf", "mlb", "nba", "wnba", "nhl", "soccer"];

describe("Coach provider event identity", () => {
  test.each(sports)("preserves %s canonical odds event ID into every Coach candidate", (sport) => {
    const rows = buildRealOdds({
      id: `${sport}-event-123`,
      sport,
      awayTeam: "Away Team",
      homeTeam: "Home Team",
      commenceTime: "2026-09-08T20:00:00.000Z",
      markets: [{
        key: "h2h",
        outcomes: [{ name: "Away Team", price: 120 }],
      }],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.providerEventId).toBe(`${sport}-event-123`);
  });
});
