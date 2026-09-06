import { fantasyRecommendation, selectFantasyStarter } from "./fantasyRecommendation";
import type { FantasyRosterPlayer } from "./fantasyRoster";

test("uses recorded production and injury status without treating missing data as zero", () => {
  expect(fantasyRecommendation(undefined).confidence).toBe("Limited recent data");
  const healthy = fantasyRecommendation({ games: 10, recentAverage: 20, floor: 10, ceiling: 30, targetsPerGame: 5, carriesPerGame: 0, touchesPerGame: 5 } as never);
  const injured = fantasyRecommendation({ games: 10, recentAverage: 20, floor: 10, ceiling: 30, targetsPerGame: 5, carriesPerGame: 0, touchesPerGame: 5 } as never, "Questionable");
  expect(healthy.score).toBeGreaterThan(injured.score!);
});

test("selects supported highest-production eligible FLEX player only", () => {
  const player = (athleteId: string, position: string): FantasyRosterPlayer => ({ athleteId, name: athleteId, position, team: "NFL", rosterSlot: "Bench", dateAdded: 1 });
  const players = [player("qb", "QB"), player("rb", "RB"), player("wr", "WR")];
  const analysis = Object.fromEntries(players.map((p, index) => [p.athleteId, { games: 10, recentAverage: 10 + index * 5, floor: 5, ceiling: 20, targetsPerGame: index, carriesPerGame: 0, touchesPerGame: index }])) as never;
  const result = selectFantasyStarter(players, "FLEX", analysis, {});
  expect(result.winner?.player.athleteId).toBe("wr");
  expect(result.alternative?.player.athleteId).toBe("rb");
});
