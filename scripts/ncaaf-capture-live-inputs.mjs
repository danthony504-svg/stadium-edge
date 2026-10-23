/** Research-only current odds + exact ESPN event identity capture. No Coach path. */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const SPORT = "americanfootball_ncaaf";
const hash = (raw) => createHash("sha256").update(raw).digest("hex");
const instant = (value) => Date.parse(value);
const name = (value) =>
  typeof value === "string"
    ? value.toLowerCase().replace(/[^a-z0-9]/g, "")
    : "";
const validPrice = (value) => Number.isFinite(value) && Math.abs(value) >= 100;
const validTime = (value) =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

export function espnBoardDay(kickoff) {
  if (!validTime(kickoff)) throw Error("live_invalid_kickoff");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(kickoff));
  const part = (key) => parts.find((p) => p.type === key).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function upcomingOdds(raw, observedAt) {
  const games = JSON.parse(raw),
    ids = new Set();
  if (!Array.isArray(games) || !validTime(observedAt))
    throw Error("live_invalid_odds");
  for (const g of games) {
    if (
      g.sport_key !== SPORT ||
      typeof g.id !== "string" ||
      !g.id ||
      ids.has(g.id) ||
      !name(g.home_team) ||
      !name(g.away_team) ||
      name(g.home_team) === name(g.away_team) ||
      !validTime(g.commence_time) ||
      !Array.isArray(g.bookmakers)
    )
      throw Error("live_invalid_event");
    ids.add(g.id);
  }
  const now = Date.parse(observedAt);
  return games.filter(
    (g) =>
      Date.parse(g.commence_time) > now &&
      Date.parse(g.commence_time) <= now + 7 * 86400000,
  );
}

export function pairMarkets(game, observedAt) {
  const quotes = [],
    excluded = [];
  const seen = new Set();
  for (const book of game.bookmakers) {
    if (
      typeof book.key !== "string" ||
      !book.key ||
      !Array.isArray(book.markets)
    ) {
      excluded.push("invalid_book");
      continue;
    }
    for (const market of book.markets) {
      if (!["h2h", "spreads", "totals"].includes(market.key)) continue;
      const identity = `${book.key}:${market.key}`;
      if (seen.has(identity)) throw Error("live_ambiguous_book_market");
      seen.add(identity);
      const sourceUpdatedAt = market.last_update ?? book.last_update;
      if (
        !validTime(sourceUpdatedAt) ||
        Date.parse(sourceUpdatedAt) > Date.parse(observedAt) ||
        Date.parse(observedAt) - Date.parse(sourceUpdatedAt) > 15 * 60000
      ) {
        excluded.push("stale_or_untimed_quote");
        continue;
      }
      const rows = market.outcomes;
      if (
        !Array.isArray(rows) ||
        rows.length !== 2 ||
        !rows.every((r) => validPrice(r.price))
      ) {
        excluded.push("not_two_sided");
        continue;
      }
      const firstName = market.key === "totals" ? "Over" : game.home_team;
      const secondName = market.key === "totals" ? "Under" : game.away_team;
      const first = rows.filter((r) => r.name === firstName),
        second = rows.filter((r) => r.name === secondName);
      if (first.length !== 1 || second.length !== 1) {
        excluded.push("outcome_identity");
        continue;
      }
      const a = first[0],
        b = second[0];
      if (
        (market.key === "spreads" &&
          (!Number.isFinite(a.point) ||
            !Number.isFinite(b.point) ||
            a.point !== -b.point)) ||
        (market.key === "totals" &&
          (!Number.isFinite(a.point) || a.point < 0 || a.point !== b.point))
      ) {
        excluded.push("unpaired_lines");
        continue;
      }
      quotes.push({
        bookmaker: book.key,
        market:
          market.key === "h2h"
            ? "ml"
            : market.key === "spreads"
              ? "spread"
              : "total",
        line: market.key === "h2h" ? null : a.point,
        firstPrice: a.price,
        secondPrice: b.price,
        observedAt,
        sourceUpdatedAt,
        settlement: "full_game_including_overtime",
        providerEventId: game.id,
        providerMarket: market.key,
        firstOutcome: a,
        secondOutcome: b,
      });
    }
  }
  return { quotes, excluded };
}

export function buildLiveArchive(oddsCapture, scoreboardCaptures) {
  if (
    !validTime(oddsCapture.requestStartedAt) ||
    !validTime(oddsCapture.receivedAt) ||
    Date.parse(oddsCapture.receivedAt) <
      Date.parse(oddsCapture.requestStartedAt)
  )
    throw Error("live_invalid_receipt");
  const games = upcomingOdds(oddsCapture.rawResponse, oddsCapture.receivedAt);
  const index = new Map(),
    matched = [],
    excluded = [];
  for (const capture of scoreboardCaptures) {
    if (
      !validTime(capture.receivedAt) ||
      !validTime(capture.requestStartedAt) ||
      Date.parse(capture.receivedAt) < Date.parse(capture.requestStartedAt)
    )
      throw Error("live_invalid_receipt");
    const payload = JSON.parse(capture.rawResponse);
    if (!Array.isArray(payload.events)) throw Error("live_invalid_scoreboard");
    for (const event of payload.events)
      for (const c of event.competitions ?? []) {
        const h = c.competitors?.filter((s) => s.homeAway === "home") ?? [];
        const a = c.competitors?.filter((s) => s.homeAway === "away") ?? [];
        const kickoff = c.date;
        if (
          h.length !== 1 ||
          a.length !== 1 ||
          !validTime(kickoff) ||
          !/^\d+$/.test(event.id) ||
          !/^\d+$/.test(h[0].team?.id) ||
          !/^\d+$/.test(a[0].team?.id) ||
          h[0].team.id === a[0].team.id ||
          !name(h[0].team.displayName) ||
          !name(a[0].team.displayName) ||
          !Number.isSafeInteger(event.season?.year)
        )
          continue;
        const key = JSON.stringify([
          name(h[0].team.displayName),
          name(a[0].team.displayName),
          instant(kickoff),
        ]);
        const entry = {
          eventId: event.id,
          season: event.season.year,
          homeId: h[0].team.id,
          awayId: a[0].team.id,
          kickoff,
          status: c.status?.type?.state ?? event.status?.type?.state,
          scoreboardObservedAt: capture.receivedAt,
          scoreboardSha256: hash(capture.rawResponse),
        };
        const hits = index.get(key) ?? new Map();
        const old = hits.get(event.id);
        const identity = (value) =>
          JSON.stringify([
            value.eventId,
            value.season,
            value.homeId,
            value.awayId,
            Date.parse(value.kickoff),
            value.status,
          ]);
        if (old && identity(old) !== identity(entry))
          throw Error("live_conflicting_event_evidence");
        if (
          !old ||
          Date.parse(entry.scoreboardObservedAt) <
            Date.parse(old.scoreboardObservedAt)
        )
          hits.set(event.id, entry);
        index.set(key, hits);
      }
  }
  for (const game of games) {
    const key = JSON.stringify([
      name(game.home_team),
      name(game.away_team),
      instant(game.commence_time),
    ]);
    const hits = [...(index.get(key)?.values() ?? [])];
    if (hits.length !== 1) {
      excluded.push({
        providerEventId: game.id,
        reason: hits.length ? "ambiguous_identity" : "no_exact_identity",
      });
      continue;
    }
    const target = hits[0];
    // A scoreboard obtained after tipoff cannot certify a pregame target.
    if (
      target.status !== "pre" ||
      Date.parse(target.scoreboardObservedAt) >= Date.parse(target.kickoff)
    ) {
      excluded.push({
        providerEventId: game.id,
        reason: "not_confirmed_pregame",
      });
      continue;
    }
    const paired = pairMarkets(game, oddsCapture.receivedAt);
    if (!paired.quotes.length) {
      excluded.push({
        providerEventId: game.id,
        reason: "no_valid_two_sided_quotes",
        details: paired.excluded,
      });
      continue;
    }
    matched.push({
      target,
      providerEventId: game.id,
      providerKickoff: game.commence_time,
      quotes: paired.quotes.map((q) => ({
        ...q,
        season: target.season,
        eventId: target.eventId,
      })),
      quoteExclusions: paired.excluded,
    });
  }
  return {
    version: 1,
    researchOnly: true,
    source: "odds_api_and_espn",
    automaticUnlock: false,
    validationReady: false,
    odds: { ...oddsCapture, sha256: hash(oddsCapture.rawResponse) },
    scoreboards: scoreboardCaptures.map((c) => ({
      ...c,
      sha256: hash(c.rawResponse),
    })),
    matched,
    excluded,
    limitations: [
      "exact_normalized_names_only_no_fuzzy_aliases",
      "history_and_ruleset_inputs_not_supplied",
      "not_a_forecast_or_release_certificate",
    ],
  };
}

async function receipt(url) {
  const requestStartedAt = new Date().toISOString();
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    redirect: "error",
  });
  if (!response.ok) throw Error("live_provider_http_failure");
  const rawResponse = await response.text(),
    receivedAt = new Date().toISOString();
  if (Buffer.byteLength(rawResponse) > 5_000_000)
    throw Error("live_response_too_large");
  return { requestStartedAt, receivedAt, rawResponse };
}
async function main() {
  if (!process.argv.includes("--execute")) {
    console.log(
      JSON.stringify({
        planOnly: true,
        maximumOddsRequests: 1,
        maximumScoreboardRequests: 8,
        markets: ["h2h", "spreads", "totals"],
        automaticUnlock: false,
      }),
    );
    return;
  }
  if (!process.env.DATABASE_URL || !process.env.ODDS_API_KEY)
    throw Error("live_missing_environment");
  const requireDb = createRequire(
    resolve(
      process.env.NCAAF_REPO_ROOT ?? "/opt/render/project/src",
      "lib/db/package.json",
    ),
  );
  const { Client } = requireDb("pg");
  const db = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10000,
    query_timeout: 15000,
  });
  await db.connect();
  try {
    const check = await db.query("SELECT current_database() AS name");
    if (check.rows[0].name !== "stadium_edge_production")
      throw Error("live_unexpected_database");
    const lock = await db.query(
      "SELECT pg_try_advisory_lock(64233,20261025) AS acquired",
    );
    if (!lock.rows[0].acquired) throw Error("live_collector_running");
    const key = `research:ncaaf:live-inputs:${new Date().toISOString().slice(0, 16)}`;
    if (
      (await db.query("SELECT key FROM public.app_kv WHERE key=$1", [key]))
        .rowCount
    ) {
      console.log("Already captured this minute; no provider request made.");
      return;
    }
    const url = new URL(
      "https://api.the-odds-api.com/v4/sports/americanfootball_ncaaf/odds",
    );
    url.search = new URLSearchParams({
      apiKey: process.env.ODDS_API_KEY,
      regions: "us",
      markets: "h2h,spreads,totals",
      oddsFormat: "american",
    });
    const odds = await receipt(url);
    const days = [
      ...new Set(
        upcomingOdds(odds.rawResponse, odds.receivedAt).map((g) =>
          espnBoardDay(g.commence_time),
        ),
      ),
    ].sort();
    if (days.length > 8) throw Error("live_request_budget_exceeded");
    const scoreboards = [];
    for (const day of days)
      scoreboards.push(
        await receipt(
          `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${day.replaceAll("-", "")}&groups=80&limit=1000`,
        ),
      );
    const archive = buildLiveArchive(odds, scoreboards);
    await db.query(
      "INSERT INTO public.app_kv(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING",
      [key, JSON.stringify(archive)],
    );
    console.log(
      JSON.stringify({
        saved: true,
        matchedEvents: archive.matched.length,
        quotePairs: archive.matched.reduce((n, g) => n + g.quotes.length, 0),
        excludedEvents: archive.excluded.length,
        automaticUnlock: false,
      }),
    );
  } finally {
    await db.end();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch(() => {
    console.error(
      "Live input capture failed; no forecast or unlock performed.",
    );
    process.exitCode = 1;
  });
