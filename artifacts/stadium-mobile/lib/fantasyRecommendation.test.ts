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

const strongPlayerA = { games: 10, recentAverage: 24, floor: 16, ceiling: 32, targetsPerGame: 2, carriesPerGame: 4, touchesPerGame: 6 } as never;
const weakerPlayerB = { games: 10, recentAverage: 14, floor: 8, ceiling: 21, targetsPerGame: 2, carriesPerGame: 4, touchesPerGame: 6 } as never;
const injuredPlayerB = { ...weakerPlayerB } as never;
const limitedHistoryPlayer = { games: 0, recentAverage: null, floor: null, ceiling: null } as never;
const pprSensitiveReceiver = { games: 10, recentAverage: 19, floor: 10, ceiling: 27, targetsPerGame: 9, carriesPerGame: 0, touchesPerGame: 7 } as never;

test("strong production, floor, ceiling, and usage produce supported evidence", () => {
  const strong = fantasyRecommendation(strongPlayerA);
  const weak = fantasyRecommendation(weakerPlayerB);
  expect(strong.score).toBeGreaterThan(weak.score!);
  expect(strong.reason).toContain("recorded L10 production");
});

test("injury designation downgrades an otherwise identical recommendation", () => {
  expect(fantasyRecommendation(injuredPlayerB, "Questionable").score).toBeLessThan(fantasyRecommendation(injuredPlayerB, "Active").score!);
});

test("scoring-format-specific received analyses can change the preferred player", () => {
  const standardRunner = { ...strongPlayerA, recentAverage: 18, targetsPerGame: 1 } as never;
  expect(fantasyRecommendation(pprSensitiveReceiver).score).toBeGreaterThan(fantasyRecommendation(standardRunner).score!);
});

test("limited history stays explicitly limited and contains no unsupported weekly data", () => {
  const result = fantasyRecommendation(limitedHistoryPlayer);
  expect(result).toEqual(expect.objectContaining({ score: null, confidence: "Limited recent data" }));
  expect(JSON.stringify(result)).not.toMatch(/opponent|projection|matchup/i);
});
