import { canAnalyzeTrade } from "../app/fantasy-trade";

test("trade analysis stays disabled until both sides have a player", () => {
  expect(canAnalyzeTrade(1, 0)).toBe(false);
  expect(canAnalyzeTrade(0, 1)).toBe(false);
  expect(canAnalyzeTrade(1, 1)).toBe(true);
  expect(canAnalyzeTrade(2, 2)).toBe(true);
});
