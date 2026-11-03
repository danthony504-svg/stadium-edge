/** Research-only NCAAB odds + ESPN event identity. Does not enable Coach. */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ODDS_SPORT = "basketball_ncaab";
const ESPN_SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard";
const hash = (raw) => createHash("sha256").update(raw).digest("hex");
const validTime = (value) =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
const norm = (value) =>
  typeof value === "string"
    ? value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
    : "";

export function espnBoardDay(kickoff) {
  if (!validTime(kickoff)) throw Error("ncaab_live_invalid_kickoff");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(kickoff));
  const part = (key) => parts.find((p) => p.type === key).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function upcomingNcaabOdds(raw, observedAt) {
  const games = JSON.parse(raw);
  if (!Array.isArray(games) || !validTime(observedAt))
    throw Error("ncaab_live_invalid_odds");
  const ids = new Set();
  for (const g of games) {
    if (
      g.sport_key !== ODDS_SPORT ||
      typeof g.id !== "string" ||
      !g.id ||
      ids.has(g.id) ||
      !norm(g.home_team) ||
      !norm(g.away_team) ||
      norm(g.home_team) === norm(g.away_team) ||
      !validTime(g.commence_time) ||
      !Array.isArray(g.bookmakers)
    )
      throw Error("ncaab_live_invalid_event");
    ids.add(g.id);
  }
  const now = Date.parse(observedAt);
  return games.filter(
    (g) =>
      Date.parse(g.commence_time) > now &&
      Date.parse(g.commence_time) <= now + 14 * 86400000,
  );
}

export function pairNcaabMarkets(game, observedAt) {
  const quotes = [];
  const excluded = [];
  const seen = new Set();
  for (const book of game.bookmakers ?? []) {
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
      if (seen.has(identity)) throw Error("ncaab_live_ambiguous_book_market");
      seen.add(identity);
      const sourceUpdatedAt = market.last_update ?? book.last_update;
      if (
        !validTime(sourceUpdatedAt) ||
        Date.parse(sourceUpdatedAt) > Date.parse(observedAt) ||
        Date.parse(observedAt) - Date.parse(sourceUpdatedAt) > 15 * 60000
      ) {
        excluded.push("stale_or_future_quote");
        continue;
      }
      const outcomes = Array.isArray(market.outcomes) ? market.outcomes : [];
      for (const o of outcomes) {
        if (!Number.isFinite(o?.price) || Math.abs(o.price) < 100) {
          excluded.push("invalid_price");
          continue;
        }
        quotes.push({
          book: book.key,
          market: market.key,
          name: o.name ?? null,
          price: o.price,
          point: o.point ?? null,
          sourceUpdatedAt,
        });
      }
    }
  }
  return { quotes, excluded };
}

/** Odds round hours often disagree with ESPN TBD `:59` placeholders by ≤1m–few m. */
const KICKOFF_BIND_TOLERANCE_MS = 15 * 60_000;

export function matchEspnEvent(scoreboardRaw, game) {
  const board = JSON.parse(scoreboardRaw);
  const events = Array.isArray(board.events) ? board.events : [];
  const home = norm(game.home_team);
  const away = norm(game.away_team);
  const kickoff = Date.parse(game.commence_time);
  if (!Number.isFinite(kickoff)) return null;
  const exact = [];
  const near = [];
  for (const event of events) {
    for (const competition of event.competitions ?? []) {
      const comps = competition.competitors ?? [];
      if (comps.length !== 2) continue;
      const sides = Object.fromEntries(
        comps.map((c) => [c.homeAway, c.team]),
      );
      if (!sides.home?.id || !sides.away?.id) continue;
      const aliases = (team) =>
        [team.displayName, team.shortDisplayName, team.location, team.name]
          .map(norm)
          .filter(Boolean);
      const homeOk = aliases(sides.home).includes(home);
      const awayOk = aliases(sides.away).includes(away);
      if (!homeOk || !awayOk) continue;
      const espnKickoff = Date.parse(competition.date ?? event.date ?? "");
      if (!Number.isFinite(espnKickoff)) continue;
      const hit = {
        eventId: String(event.id),
        season: event.season?.year ?? null,
        kickoff: competition.date ?? event.date,
        homeId: String(sides.home.id),
        awayId: String(sides.away.id),
        homeName: sides.home.displayName ?? null,
        awayName: sides.away.displayName ?? null,
      };
      if (espnKickoff === kickoff) exact.push(hit);
      else if (Math.abs(espnKickoff - kickoff) <= KICKOFF_BIND_TOLERANCE_MS)
        near.push(hit);
    }
  }
  // Prefer exact kickoff identity; only then a unique near match (ESPN TBD skew).
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  if (near.length === 1) return near[0];
  return null;
}

async function main() {
  if (!process.argv.includes("--execute")) {
    console.log(
      JSON.stringify({
        planOnly: true,
        sport: "ncaab",
        oddsSport: ODDS_SPORT,
        paidOddsRequests: 1,
        releaseEligible: false,
        automaticUnlock: false,
      }),
    );
    return;
  }
  if (!process.env.DATABASE_URL) throw Error("ncaab_live_database_missing");
  if (!process.env.ODDS_API_KEY?.trim())
    throw Error("ncaab_live_odds_credentials_missing");
  const arg = process.argv.indexOf("--capture-slot");
  const slot =
    arg < 0
      ? new Date().toISOString().slice(0, 13) + ":00:00Z"
      : process.argv[arg + 1];
  if (!Number.isFinite(Date.parse(slot))) throw Error("ncaab_live_slot_invalid");

  const { Client } = createRequire(
    resolve(
      process.env.NCAAB_REPO_ROOT ??
        process.env.NCAAF_REPO_ROOT ??
        "/opt/render/project/src",
      "lib/db/package.json",
    ),
  )("pg");
  const db = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10000,
    query_timeout: 20000,
  });
  await db.connect();
  try {
    if (
      (await db.query("SELECT current_database() AS name")).rows[0].name !==
      "stadium_edge_production"
    )
      throw Error("ncaab_live_unexpected_database");
    if (
      !(await db.query("SELECT pg_try_advisory_lock(64234,20261027) AS ok"))
        .rows[0].ok
    )
      throw Error("ncaab_live_overlap");

    const requestStartedAt = new Date().toISOString();
    const oddsUrl = `https://api.the-odds-api.com/v4/sports/${ODDS_SPORT}/odds/?apiKey=${encodeURIComponent(process.env.ODDS_API_KEY)}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`;
    const oddsRes = await fetch(oddsUrl, {
      signal: AbortSignal.timeout(20000),
      redirect: "error",
    });
    if (!oddsRes.ok) throw Error(`ncaab_live_odds_http_${oddsRes.status}`);
    const oddsRaw = await oddsRes.text();
    const receivedAt = new Date().toISOString();
    if (Buffer.byteLength(oddsRaw) > 8_000_000)
      throw Error("ncaab_live_odds_too_large");
    const upcoming = upcomingNcaabOdds(oddsRaw, receivedAt).slice(0, 64);
    const days = [
      ...new Set(upcoming.map((g) => espnBoardDay(g.commence_time))),
    ].slice(0, 8);
    const scoreboards = [];
    for (const day of days) {
      const started = new Date().toISOString();
      const boardRes = await fetch(`${ESPN_SCOREBOARD}?dates=${day.replace(/-/g, "")}`, {
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      });
      if (!boardRes.ok) continue;
      const rawResponse = await boardRes.text();
      const boardReceived = new Date().toISOString();
      scoreboards.push({
        day,
        requestStartedAt: started,
        receivedAt: boardReceived,
        sha256: hash(rawResponse),
        rawResponse,
      });
    }

    const matched = [];
    const unmatched = [];
    for (const game of upcoming) {
      const { quotes, excluded } = pairNcaabMarkets(game, receivedAt);
      let target = null;
      for (const board of scoreboards) {
        const hit = matchEspnEvent(board.rawResponse, game);
        if (!hit) continue;
        target = {
          ...hit,
          oddsEventId: game.id,
          scoreboardSha256: board.sha256,
          scoreboardObservedAt: board.receivedAt,
          datasetRole: "unassigned_pending_protocol",
        };
        break;
      }
      if (!target) {
        unmatched.push({
          oddsEventId: game.id,
          reason: "missing_or_ambiguous_espn_event",
        });
        continue;
      }
      matched.push({
        target,
        quotes,
        excludedQuoteReasons: excluded,
        homeTeam: game.home_team,
        awayTeam: game.away_team,
        commenceTime: game.commence_time,
      });
    }

    const archive = {
      version: 1,
      sport: "ncaab",
      researchOnly: true,
      slot,
      odds: {
        sportKey: ODDS_SPORT,
        requestStartedAt,
        receivedAt,
        sha256: hash(oddsRaw),
        rawEncoding: "utf8",
        // Store hash authority; raw body kept only when under 1.5MB.
        rawResponse: Buffer.byteLength(oddsRaw) <= 1_500_000 ? oddsRaw : null,
        rawOmitted: Buffer.byteLength(oddsRaw) > 1_500_000,
      },
      scoreboards: scoreboards.map((s) => ({
        day: s.day,
        requestStartedAt: s.requestStartedAt,
        receivedAt: s.receivedAt,
        sha256: s.sha256,
        rawResponse: s.rawResponse,
      })),
      matched,
      unmatched,
      releaseEligible: false,
      automaticUnlock: false,
      observedAt: receivedAt,
    };
    const key = `research:ncaab:live-inputs:${receivedAt}`;
    await db.query(
      "INSERT INTO public.app_kv(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO NOTHING",
      [key, JSON.stringify(archive)],
    );
    console.log(
      JSON.stringify({
        state: "processed",
        sport: "ncaab",
        key,
        matched: matched.length,
        unmatched: unmatched.length,
        releaseEligible: false,
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
  main().catch((err) => {
    console.error(
      err instanceof Error ? err.message : "ncaab_live_capture_failed",
    );
    process.exitCode = 1;
  });
