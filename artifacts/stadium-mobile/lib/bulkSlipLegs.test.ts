import { addMissingSlipLegs } from "./bulkSlipLegs";

type TestLeg = { id: string; game: string; market: string; pick: string; odds: number; metadata?: string };
const pick = (n: number): Omit<TestLeg, "id"> => ({
  game: `Game ${n}`, market: "Moneyline", pick: `Team ${n}`, odds: -110 - n, metadata: `pick-${n}`,
});
const store = (leg: Omit<TestLeg, "id">): TestLeg => ({
  ...leg, id: `${leg.game}|${leg.market}|${leg.pick}`.toLowerCase(),
});

describe("bulk Coach slip insertion", () => {
  it("adds all five displayed picks and preserves their metadata", () => {
    const result = addMissingSlipLegs([], [1, 2, 3, 4, 5].map(pick), 15, store);
    expect(result).toMatchObject({ sourceCount: 5, existingCount: 0, addedCount: 5 });
    expect(result.legs).toHaveLength(5);
    expect(result.legs[4]).toMatchObject({ odds: -115, metadata: "pick-5" });
  });

  it("adds only displayed legs missing from the slip", () => {
    const result = addMissingSlipLegs([store(pick(1)), store(pick(3))], [1, 2, 3, 4, 5].map(pick), 15, store);
    expect(result).toMatchObject({ existingCount: 2, addedCount: 3 });
    expect(result.legs).toHaveLength(5);
  });

  it("works from a displayed committed ticket regardless of scan status", () => {
    const committedDisplayed = [1, 2, 3, 4, 5].map(pick);
    expect(addMissingSlipLegs([], committedDisplayed, 15, store).addedCount).toBe(5);
  });

  it("is idempotent when the same bulk action is pressed twice", () => {
    const displayed = [1, 2, 3, 4, 5].map(pick);
    const first = addMissingSlipLegs([], displayed, 15, store);
    const second = addMissingSlipLegs(first.legs, displayed, 15, store);
    expect(second).toMatchObject({ existingCount: 5, addedCount: 0 });
    expect(second.legs).toHaveLength(5);
  });
});
