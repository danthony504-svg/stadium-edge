/** Bind a captured quote to original provider rows before journaling. Research only. */
import { createHash } from "node:crypto";
import type { ForecastInput } from "./ncaafForecastJournal.js";
import type { TimedGame, ReplayQuote } from "./ncaafFullGameBacktest.js";
type Capture = { rawResponse: string; sha256: string; receivedAt: string };
type Target = ForecastInput["target"] & {
  scoreboardSha256: string;
  scoreboardObservedAt: string;
  status: string;
};
type Quote = ReplayQuote & {
  providerEventId: string;
  providerMarket: string;
  sourceUpdatedAt: string;
  firstOutcome: unknown;
  secondOutcome: unknown;
};
export type LiveInputArchive = {
  version: 1;
  researchOnly: true;
  odds: Capture;
  scoreboards: Capture[];
  matched: { target: Target; providerEventId: string; quotes: Quote[] }[];
};
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const normalized = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
function capture(c: Capture, now: number) {
  if (
    !c ||
    typeof c.rawResponse !== "string" ||
    digest(c.rawResponse) !== c.sha256 ||
    !Number.isFinite(Date.parse(c.receivedAt)) ||
    Date.parse(c.receivedAt) > now
  )
    throw Error("journal_invalid_live_archive");
  return JSON.parse(c.rawResponse);
}
export function forecastInputFromArchive(
  archive: LiveInputArchive,
  eventId: string,
  games: TimedGame[],
  injuryEvidence: ForecastInput["injuryEvidence"],
  ruleset: string,
  now: string,
): ForecastInput {
  const clock = Date.parse(now);
  if (
    !Number.isFinite(clock) ||
    archive?.version !== 1 ||
    archive.researchOnly !== true ||
    !ruleset?.trim() ||
    !Array.isArray(archive.matched)
  )
    throw Error("journal_invalid_live_archive");
  const odds = capture(archive.odds, clock);
  if (!Array.isArray(odds)) throw Error("journal_invalid_live_archive");
  const matches = archive.matched.filter((g) => g.target.eventId === eventId);
  if (matches.length !== 1) throw Error("journal_live_event_not_unique");
  const selected = matches[0]!,
    t = selected.target;
  if (
    t.status !== "pre" ||
    !Number.isFinite(Date.parse(t.kickoff)) ||
    Date.parse(t.kickoff) <= clock ||
    !Array.isArray(selected.quotes) ||
    !selected.quotes.length ||
    !Array.isArray(archive.scoreboards)
  )
    throw Error("journal_live_event_not_pregame");
  const events = odds.filter((g) => g.id === selected.providerEventId);
  if (events.length !== 1) throw Error("journal_live_provider_event_mismatch");
  const event = events[0];
  if (
    event.sport_key !== "americanfootball_ncaaf" ||
    Date.parse(event.commence_time) !== Date.parse(t.kickoff)
  )
    throw Error("journal_live_provider_event_mismatch");
  const boards = archive.scoreboards.filter(
    (c) =>
      c.sha256 === t.scoreboardSha256 &&
      c.receivedAt === t.scoreboardObservedAt,
  );
  if (boards.length !== 1) throw Error("journal_live_scoreboard_mismatch");
  const board = capture(boards[0]!, clock);
  const identities = (board.events ?? [])
    .filter((e: any) => e.id === eventId && e.season?.year === t.season)
    .flatMap((e: any) => e.competitions ?? [])
    .filter((c: any) => {
      const sides = c.competitors ?? [],
        h = sides.filter((s: any) => s.homeAway === "home"),
        a = sides.filter((s: any) => s.homeAway === "away");
      return (
        h.length === 1 &&
        a.length === 1 &&
        h[0].team?.id === t.homeId &&
        a[0].team?.id === t.awayId &&
        normalized(h[0].team.displayName) === normalized(event.home_team) &&
        normalized(a[0].team.displayName) === normalized(event.away_team) &&
        Date.parse(c.date) === Date.parse(t.kickoff) &&
        (c.status?.type?.state ??
          board.events.find((e: any) => e.id === eventId)?.status?.type
            ?.state) === "pre"
      );
    });
  if (identities.length !== 1) throw Error("journal_live_scoreboard_mismatch");
  const quotes: ReplayQuote[] = selected.quotes.map((q) => {
    const books = (event.bookmakers ?? []).filter(
      (b: any) => b.key === q.bookmaker,
    );
    const marketName =
      q.market === "ml"
        ? "h2h"
        : q.market === "spread"
          ? "spreads"
          : q.market === "total"
            ? "totals"
            : null;
    if (
      !marketName ||
      q.providerMarket !== marketName ||
      q.providerEventId !== event.id ||
      books.length !== 1 ||
      q.observedAt !== archive.odds.receivedAt ||
      q.eventId !== t.eventId ||
      q.season !== t.season
    )
      throw Error("journal_live_quote_mismatch");
    const book = books[0],
      markets = (book.markets ?? []).filter((m: any) => m.key === marketName);
    if (markets.length !== 1) throw Error("journal_live_quote_mismatch");
    const m = markets[0],
      rows = m.outcomes ?? [],
      firstName = q.market === "total" ? "Over" : event.home_team,
      secondName = q.market === "total" ? "Under" : event.away_team;
    const a = rows.filter((r: any) => r.name === firstName),
      b = rows.filter((r: any) => r.name === secondName),
      stamp = m.last_update ?? book.last_update;
    if (
      rows.length !== 2 ||
      a.length !== 1 ||
      b.length !== 1 ||
      a[0].price !== q.firstPrice ||
      b[0].price !== q.secondPrice ||
      q.sourceUpdatedAt !== stamp ||
      !Number.isFinite(Date.parse(stamp)) ||
      Date.parse(stamp) > Date.parse(archive.odds.receivedAt) ||
      clock - Date.parse(stamp) > 15 * 60000 ||
      (q.market === "ml" ? q.line !== null : a[0].point !== q.line) ||
      (q.market === "spread" && a[0].point !== -b[0].point) ||
      (q.market === "total" && a[0].point !== b[0].point)
    )
      throw Error("journal_live_quote_mismatch");
    return {
      season: q.season,
      eventId: q.eventId,
      bookmaker: q.bookmaker,
      market: q.market,
      line: q.line,
      firstPrice: q.firstPrice,
      secondPrice: q.secondPrice,
      observedAt: q.observedAt,
      settlement: q.settlement,
    };
  });
  const input: ForecastInput = {
    version: 1,
    target: {
      season: t.season,
      eventId: t.eventId,
      homeId: t.homeId,
      awayId: t.awayId,
      kickoff: t.kickoff,
      ruleset,
    },
    games,
    quotes,
    injuryEvidence,
  };
  // Retain original bytes in the persisted input hash for later independent review.
  return Object.assign(input, { liveSourceEvidence: archive });
}
