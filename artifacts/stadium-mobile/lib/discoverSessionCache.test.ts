jest.mock("expo-updates", () => ({ __esModule: true, isEnabled: false }));

import AsyncStorage from "@react-native-async-storage/async-storage";
import { cachedLiveGames, rememberLiveGames } from "./discoverSessionCache";
import type { EspnGame } from "./api";

const game: EspnGame = {
  id: "401856661",
  sport: "ncaaf",
  name: "Louisville Cardinals at Ole Miss Rebels",
  shortName: "LOU VS MISS",
  status: "In Progress",
  startsAt: "2026-09-06T23:30:00.000Z",
  state: "in",
};

test("a no-live provider result removes a persisted NCAAF live snapshot", async () => {
  rememberLiveGames("ncaaf", [game]);
  expect(cachedLiveGames("ncaaf")).toEqual([{ ...game, sport: "ncaaf" }]);

  rememberLiveGames("ncaaf", []);
  await Promise.resolve();

  expect(cachedLiveGames("ncaaf")).toEqual([]);
  expect(AsyncStorage.setItem).toHaveBeenLastCalledWith(
    "discover-cache:v5:live:ncaaf",
    expect.stringContaining('"data":[]'),
  );
});
