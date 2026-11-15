import assert from "node:assert/strict";
import test from "node:test";
import { pickOpeningCoachGames, runCoachOpeningPass } from "./coachOpeningPass.ts";
import type { OddsGame, EspnGame } from "./api.ts";

test("opening slate is capped, upcoming, and uniquely matched on league, teams and time", () => {
  const now = Date.parse("2026-11-15T15:30:00Z");
  const odds: OddsGame[] = Array.from({length: 9}, (_, i) => ({
    id: "book-" + i, sport: "nba", homeTeam: "Home " + i, awayTeam: "Away " + i,
    commenceTime: new Date(now + (i-1) * 3600_000).toISOString(), markets: [],
  }));
  const games: EspnGame[] = odds.map((g, i) => ({
    ...g, id: "provider-" + i, startsAt: g.commenceTime, name: "", shortName: "", status: "scheduled",
  }));
  games.push({ ...games[2]!, id: "ambiguous" });
  games[3] = { ...games[3]!, awayTeam: "Wrong opponent" };
  assert.deepEqual(pickOpeningCoachGames(odds.reverse(), games, now).oddsGames.map(g=>g.id),
    ["book-4","book-5","book-6","book-7","book-8"]);
});

test("a crowded kickoff does not crowd a later league out of the opening slate", () => {
  const now = Date.parse("2026-11-15T15:30:00Z");
  const odds: OddsGame[] = Array.from({ length: 7 }, (_, i) => ({
    id: String(i), sport: i < 6 ? "nfl" : "nba", homeTeam: "Home " + i, awayTeam: "Away " + i,
    commenceTime: new Date(now + (i + 1) * 3600_000).toISOString(), markets: [],
  }));
  const games: EspnGame[] = odds.map(g => ({
    ...g, startsAt: g.commenceTime, name: "", shortName: "", status: "scheduled",
  }));
  assert.deepEqual(pickOpeningCoachGames(odds, games, now).oddsGames.map(g => g.id),
    ["0", "6", "1", "2", "3"]);
});

test("a complete opening ticket wins; a shortfall or timed out probe falls back", async () => {
  const parent = new AbortController();
  const accept = (picks: number[]) => picks.length === 2 ? picks : null;
  const options = { signal: parent.signal, remainingMs: 45_000, accept };
  assert.deepEqual(await runCoachOpeningPass({...options, work: async () => [1, 2]}), [1, 2]);
  assert.equal(await runCoachOpeningPass({...options, work: async () => [1]}), null);
  let owned: AbortSignal | undefined;
  assert.equal(await runCoachOpeningPass({...options, openingBudgetMs: 10, work: signal => {
    owned = signal;
    return new Promise<number[]>(() => {});
  }}), null);
  assert.equal(owned?.aborted, true);
  assert.equal(parent.signal.aborted, false);
  assert.equal(await runCoachOpeningPass({...options, remainingMs: 30_000, work: async () => assert.fail("fallback time must be reserved")}), null);
});

test("stop cancels an active opening pass rather than letting the full board start", async () => {
  const parent = new AbortController();
  const pending = runCoachOpeningPass({
    signal: parent.signal, remainingMs: 45_000,
    work: async () => { parent.abort(); return [1, 2]; },
    accept: picks => picks,
  });
  await assert.rejects(pending, { name: "AbortError" });
});
