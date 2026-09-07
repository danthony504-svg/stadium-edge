import { homeLiveGames } from "./homeLiveGames";
import type { EspnGame } from "./api";

const live = (overrides: Partial<EspnGame> = {}): EspnGame => ({
  id: "401999999",
  sport: "ncaaf",
  name: "Louisville Cardinals at Ole Miss Rebels",
  shortName: "LOU @ MISS",
  status: "In Progress",
  startsAt: "2026-09-06T20:00:00.000Z",
  awayTeam: "Louisville Cardinals",
  homeTeam: "Ole Miss Rebels",
  awayScore: 38,
  homeScore: 38,
  period: 4,
  clock: "0:50",
  periodLabel: "0:50 - 4th",
  state: "in",
  ...overrides,
});

test("Live Now uses current NCAAF provider rows and preserves provider scoreboard fields", () => {
  const providerRow = live();
  const result = homeLiveGames({ gen: 7, league: "ncaaf", rows: [providerRow] }, "ncaaf", 7);

  expect(result).toEqual([providerRow]);
  expect(result[0]).toMatchObject({
    id: providerRow.id,
    awayScore: 38,
    homeScore: 38,
    period: 4,
    clock: "0:50",
    periodLabel: "0:50 - 4th",
  });
});

test("a final provider row cannot continue to render as LIVE", () => {
  const finalRow = live({ state: "post", status: "Final" });

  expect(homeLiveGames({ gen: 7, league: "ncaaf", rows: [finalRow] }, "ncaaf", 7)).toEqual([]);
});

test("a stale or other-sport payload cannot override the selected sport's live state", () => {
  const cachedNcaafRow = live();

  expect(homeLiveGames({ gen: 6, league: "ncaaf", rows: [cachedNcaafRow] }, "ncaaf", 7)).toEqual([]);
  expect(homeLiveGames({ gen: 7, league: "ncaaf", rows: [cachedNcaafRow] }, "nfl", 7)).toEqual([]);
});
