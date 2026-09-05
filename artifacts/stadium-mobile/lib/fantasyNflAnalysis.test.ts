import {
  fantasyPointsFromRecordedNflGame,
  historicalFantasyAnalysis,
} from "./fantasyNflAnalysis";

const game = {
  eventId: "1",
  date: "2025-09-01",
  opponent: "Opponent",
  isHome: true,
  stats: {
    passingYards: "250", passingTouchdowns: "2", interceptions: "1",
    rushingYards: "30", rushingTouchdowns: "0",
    receptions: "4", receivingYards: "40", receivingTouchdowns: "0",
    rushingAttempts: "6", receivingTargets: "5",
  },
};

describe("recorded NFL fantasy analysis", () => {
  it("scores category-preserving ESPN stats with the selected format", () => {
    expect(fantasyPointsFromRecordedNflGame(game, "ppr")).toBe(27);
    expect(fantasyPointsFromRecordedNflGame(game, "standard")).toBe(23);
  });

  it("does not turn missing game categories into a made-up analysis", () => {
    expect(historicalFantasyAnalysis([{ ...game, stats: {} }], "ppr")).toMatchObject({
      recentAverage: null, floor: null, ceiling: null, games: 0,
    });
  });

  it("keeps usage trends auditable from canonical ESPN stats", () => {
    expect(historicalFantasyAnalysis([game], "ppr")).toMatchObject({
      targetsPerGame: 5, carriesPerGame: 6, touchesPerGame: 10,
      sourceInputs: { provider: "ESPN athlete gamelog", eventIds: ["1"], scoringFormat: "ppr" },
    });
  });
});
