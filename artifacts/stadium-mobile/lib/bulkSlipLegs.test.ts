import { addMissingSlipLegs } from "./bulkSlipLegs";

type TestLeg = { id: string; game: string; market: string; pick: string; odds: number; metadata?: string };
const pick = (n: number): Omit<TestLeg, "id"> => ({
  game: `Game ${n}`, market: "Moneyline", pick: `Team ${n}`, odds: -110 - n, metadata: `pick-${n}`,
});
const store = (leg: Omit<TestLeg, "id">): TestLeg => ({
  ...leg, id: `${leg.game}|${leg.market}|${leg.pick}`.toLowerCase(),
});

describe("bulk Coach slip insertion", () => {
  it("adds all four displayed picks and preserves their metadata", () => {
    const result = addMissingSlipLegs([], [1, 2, 3, 4].map(pick), 15, store);
    expect(result).toMatchObject({ sourceCount: 4, existingCount: 0, addedCount: 4 });
    expect(result.legs).toHaveLength(4);
    expect(result.legs[3]).toMatchObject({ odds: -114, metadata: "pick-4" });
  });

  it("preserves a two-leg slip while adding four new displayed legs", () => {
    const result = addMissingSlipLegs([store(pick(5)), store(pick(6))], [1, 2, 3, 4].map(pick), 15, store);
    expect(result).toMatchObject({ existingCount: 0, addedCount: 4 });
    expect(result.legs).toHaveLength(6);
  });

  it("works from a displayed committed ticket regardless of scan status", () => {
    const committedDisplayed = [1, 2, 3, 4, 5].map(pick);
    expect(addMissingSlipLegs([], committedDisplayed, 15, store).addedCount).toBe(5);
  });

  it("is idempotent when the same bulk action is pressed twice", () => {
    const displayed = [1, 2, 3, 4].map(pick);
    const first = addMissingSlipLegs([], displayed, 15, store);
    const second = addMissingSlipLegs(first.legs, displayed, 15, store);
    expect(second).toMatchObject({ existingCount: 4, addedCount: 0 });
    expect(second.legs).toHaveLength(4);
  });
});
