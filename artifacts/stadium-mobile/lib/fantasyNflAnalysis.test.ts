import {
  fantasyPointsFromRecordedNflGame,
  historicalFantasyAnalysis,
} from "./fantasyNflAnalysis";

const game = {
  eventId: "1",
  date: "2025-09-01",
  opponent: "Opponent",
  isHome: true,
  categories: {
    passing: { YDS: "250", TD: "2", INT: "1" },
    rushing: { YDS: "30", TD: "0" },
    receiving: { REC: "4", YDS: "40", TD: "0" },
  },
};

describe("recorded NFL fantasy analysis", () => {
  it("scores category-preserving ESPN stats with the selected format", () => {
    expect(fantasyPointsFromRecordedNflGame(game, "ppr")).toBe(27);
    expect(fantasyPointsFromRecordedNflGame(game, "standard")).toBe(23);
  });

  it("does not turn missing game categories into a made-up analysis", () => {
    expect(historicalFantasyAnalysis([{ ...game, categories: {} }], "ppr")).toEqual({
      recentAverage: null, floor: null, ceiling: null, games: 0,
    });
  });
});
