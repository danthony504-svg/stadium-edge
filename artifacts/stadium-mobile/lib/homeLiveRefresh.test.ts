import { HOME_LIVE_REFETCH_MS, shouldRefreshHomeScoreboard } from "./homeLiveRefresh";

test("Home polls the active scoreboard every 15 seconds", () => {
  expect(HOME_LIVE_REFETCH_MS).toBe(15_000);
});

test("Home immediately refreshes the scoreboard when the native app resumes", () => {
  expect(shouldRefreshHomeScoreboard("active")).toBe(true);
  expect(shouldRefreshHomeScoreboard("background")).toBe(false);
  expect(shouldRefreshHomeScoreboard("inactive")).toBe(false);
});
