import { rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { archiveLineupKey, MINUTE, offsetDay, readFirstBasketArchiveDay, slateDate, type FirstBasketArchiveRecord } from "./nbaFirstBasketArchive.js";

import { firstBasketQuotes } from "./nbaFirstBasketOdds.js";

type Odds = Extract<FirstBasketArchiveRecord, { kind: "odds" }>;
type Lineup = Extract<FirstBasketArchiveRecord, { kind: "lineup" }>;

export function auditFirstBasketSlate(records: readonly FirstBasketArchiveRecord[], expected: readonly string[], limits: {
  creditsPerGame: number; reserve: number;
}) {
  const games = [...new Set(expected)].map(eventId => {
    const calls = records.filter((row): row is Odds => row.kind === "odds" && row.eventId === eventId);
    const lineups = records.filter((row): row is Lineup => row.kind === "lineup" && row.snapshot.eventId === eventId &&
      row.at >= row.snapshot.availableAt && row.at < row.snapshot.startsAt)
      .sort((a, b) => a.snapshot.availableAt - b.snapshot.availableAt);
    const confirmed = lineups.at(-1)?.snapshot;
    const quotes = calls.filter(call => call.response?.id && call.status === 200 &&
      (!confirmed || call.at < confirmed.startsAt));
    const recorded = confirmed?.confirmedAt != null && quotes.some(call =>
      call.at >= (lineups.at(-1)?.at ?? Infinity) && confirmed.startsAt - call.at <= 5 * MINUTE &&
      call.key === archiveLineupKey(confirmed, call.at) && firstBasketQuotes(confirmed, call.response!, call.at).length > 0);
    const changedStarters = [];
    let previousFive: string | null = null;
    let cleared = false;
    let lastRevision: string | null = null;
    for (const [index, lineup] of lineups.entries()) {
      const snapshot = lineup.snapshot;
      if (snapshot.confirmedAt == null) {
        if (previousFive != null) cleared = true;
        continue;
      }
      const five = [snapshot.home, snapshot.away].map(team => team.starters.map(player => player.id).sort().join(",")).join(":");
      const key = archiveLineupKey(snapshot, lineup.at);
      if (previousFive != null && (five !== previousFive || cleared) && key !== lastRevision) {
        const until = lineups.slice(index + 1).find(row => archiveLineupKey(row.snapshot, row.at) !== key)?.at ?? snapshot.startsAt;
        const repriced = quotes.some(call => call.key === key && call.at >= lineup.at && call.at <= until &&
          firstBasketQuotes(snapshot, call.response!, call.at).length > 0);
        changedStarters.push({ confirmedAt: snapshot.confirmedAt, pendingRevisionRecorded: cleared, repriced });
      }
      previousFive = five;
      cleared = false;
      lastRevision = key;
    }
    const unknownCreditCalls = calls.filter(call => call.credits == null).length;
    const credits = calls.reduce((sum, call) => sum + (call.credits ?? 0), 0);
    return {
      eventId, recorded, credits, unknownCreditCalls, pendingScratch: cleared, changedStarters,
      withinBudget: !unknownCreditCalls && credits <= limits.creditsPerGame,
      aboveReserve: calls.length > 0 && calls.every(call => call.remaining != null && call.remaining >= limits.reserve),
    };
  });
  const expectedIds = new Set(expected);
  const unmatchedOddsEventIds = [...new Set(records.flatMap(row =>
    row.kind === "odds" && !expectedIds.has(row.eventId) ? [row.eventId] : []))];
  return {
    expectedGames: games.length, unmatchedOddsEventIds,
    missingNight: games.length > 0 && games.every(game => !game.recorded),
    missingEventIds: games.filter(game => !game.recorded).map(game => game.eventId),
    games,
    passed: !unmatchedOddsEventIds.length && games.every(game => game.recorded && game.withinBudget && game.aboveReserve &&
      !game.pendingScratch && game.changedStarters.every(scratch => scratch.repriced)),
  };
}

type ScheduleResponse = { events?: { id?: string; date?: string; status?: { type?: { name?: string } } }[] };
export async function expectedFirstBasketGames(day: string) {
  const dates = [day, offsetDay(day, 1)];
  const rows = await Promise.all(dates.map(async value => {
    const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${value.replaceAll("-", "")}`,
      { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error("First Basket schedule unavailable");
    const json = await response.json() as ScheduleResponse;
    if (!Array.isArray(json.events)) throw new Error("Invalid First Basket schedule");
    return json.events;
  }));
  return [...new Set(rows.flat().flatMap(event => {
    const startsAt = Date.parse(event.date ?? "");
    return !event.id || !Number.isFinite(startsAt) || slateDate(startsAt) !== day ||
      ["STATUS_POSTPONED", "STATUS_CANCELED"].includes(event.status?.type?.name ?? "") ? [] : [event.id];
  }))];
}

export async function stagingFirstBasketWeek(root: string, day: string, limits: { creditsPerGame: number; reserve: number },
  schedule = expectedFirstBasketGames) {
  const nights = await Promise.all(Array.from({ length: 7 }, (_, i) => offsetDay(day, i - 6)).map(async date => {
    const [records, expected] = await Promise.all([readFirstBasketArchiveDay(root, date), schedule(date)]);
    return { date, ...auditFirstBasketSlate(records, expected, limits) };
  }));
  return { nights, go: nights.some(night => night.expectedGames > 0) && nights.every(night => night.passed) };
}

export async function refreshStagingFirstBasketCapture(destination: string, url: string, token: string) {
  if (new URL(url).protocol !== "https:") throw new Error("The First Basket lineup source requires HTTPS");
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("First Basket lineup capture fetch failed");
  const input = await response.text();
  if (Buffer.byteLength(input) > 20_000_000) throw new Error("First Basket lineup capture exceeds size limit");
  const parsed = JSON.parse(input);
  if (!Array.isArray(parsed?.snapshots) || !Array.isArray(parsed.history)) throw new Error("Invalid First Basket lineup capture");
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, input, { flag: "wx", mode: 0o600 });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}
