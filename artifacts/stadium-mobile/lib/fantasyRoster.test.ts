import {
  DEFAULT_FANTASY_ROSTER_ID,
  FANTASY_ROSTER_SLOTS,
  createDefaultFantasyRosters,
  defaultFantasyRoster,
  positionEligibleForSlot,
} from "./fantasyRoster";

describe("fantasy roster persistence shape", () => {
  it("starts with one versioned default roster for future league support", () => {
    const data = createDefaultFantasyRosters();

    expect(data.version).toBe(1);
    expect(data.defaultRosterId).toBe(DEFAULT_FANTASY_ROSTER_ID);
    expect(defaultFantasyRoster(data)).toMatchObject({
      id: DEFAULT_FANTASY_ROSTER_ID,
      sport: "nfl",
      players: [],
    });
  });

  it("supports every supported roster slot", () => {
    expect(FANTASY_ROSTER_SLOTS).toEqual([
      "QB", "RB", "WR", "TE", "FLEX", "K", "DEF", "Bench", "IR",
    ]);
  });

  it("enforces known position and FLEX eligibility while allowing bench and IR", () => {
    expect(positionEligibleForSlot("RB", "RB")).toBe(true);
    expect(positionEligibleForSlot("RB", "FLEX")).toBe(true);
    expect(positionEligibleForSlot("QB", "FLEX")).toBe(false);
    expect(positionEligibleForSlot("WR", "TE")).toBe(false);
    expect(positionEligibleForSlot("QB", "Bench")).toBe(true);
    expect(positionEligibleForSlot("QB", "IR")).toBe(true);
  });
});
