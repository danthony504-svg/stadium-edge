/** Forward-observed historical results. Never backdates data availability. */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const digest = (raw) => createHash("sha256").update(raw).digest("hex");
const stamp = (v) => typeof v === "string" && Number.isFinite(Date.parse(v));
const score = (v) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0
    ? v
    : typeof v === "string" &&
        /^\d+$/.test(v) &&
        Number.isSafeInteger(Number(v))
      ? Number(v)
      : null;
export function historyDates(season, now) {
  if (
    !Number.isSafeInteger(season) ||
    season < 2021 ||
    season > new Date(now).getUTCFullYear() ||
    !Number.isFinite(Date.parse(now))
  )
    throw Error("history_invalid_season");
  const dates = [],
    day = new Date(`${season}-08-01T00:00:00Z`),
    end = Math.min(
      Date.parse(now),
      Date.parse(`${season + 1}-01-01T00:00:00Z`) - 1,
    );
  while (day.getTime() <= end) {
    dates.push(day.toISOString().slice(0, 10));
    day.setUTCDate(day.getUTCDate() + 1);
  }
  if (dates.length > 153) throw Error("history_budget_exceeded");
  return dates;
}
export function normalizeHistory(raw, season, requestStartedAt, receivedAt) {
  if (
    !stamp(requestStartedAt) ||
    !stamp(receivedAt) ||
    Date.parse(receivedAt) < Date.parse(requestStartedAt)
  )
    throw Error("history_invalid_receipt");
  const payload = JSON.parse(raw);
  if (!Array.isArray(payload.events)) throw Error("history_invalid_payload");
  const games = [],
    excluded = [],
    seen = new Set(),
    sha256 = digest(raw);
  for (const e of payload.events) {
    const competitions = e.competitions;
    if (
      !/^\d+$/.test(e.id) ||
      e.season?.year !== season ||
      !Array.isArray(competitions) ||
      competitions.length !== 1
    ) {
      excluded.push("event_identity");
      continue;
    }
    const c = competitions[0],
      status = c.status ?? e.status;
    if (status?.type?.completed !== true || status.type.state !== "post") {
      excluded.push("not_completed");
      continue;
    }
    if (!stamp(c.date) || Date.parse(c.date) >= Date.parse(receivedAt)) {
      excluded.push("invalid_kickoff");
      continue;
    }
    const home = c.competitors?.filter((s) => s.homeAway === "home") ?? [],
      away = c.competitors?.filter((s) => s.homeAway === "away") ?? [];
    if (
      home.length !== 1 ||
      away.length !== 1 ||
      !/^\d+$/.test(home[0].team?.id) ||
      !/^\d+$/.test(away[0].team?.id) ||
      home[0].team.id === away[0].team.id
    ) {
      excluded.push("team_identity");
      continue;
    }
    const h = home[0],
      a = away[0],
      hp = score(h.score),
      ap = score(a.score);
    const quarters = (s) => {
      if (!Array.isArray(s.linescores) || s.linescores.length < 4) return null;
      const values = s.linescores.map((x, i) =>
        x.period === i + 1 ? score(x.value) : null,
      );
      return values.some((x) => x === null) ? null : values;
    };
    const hl = quarters(h),
      al = quarters(a);
    if (
      hp === null ||
      ap === null ||
      hp === ap ||
      !hl ||
      !al ||
      hl.length !== al.length ||
      status.period !== hl.length ||
      hl.reduce((s, v) => s + v, 0) !== hp ||
      al.reduce((s, v) => s + v, 0) !== ap
    ) {
      excluded.push("incomplete_or_conflicting_period_scores");
      continue;
    }
    const rh = hl.slice(0, 4).reduce((s, v) => s + v, 0),
      ra = al.slice(0, 4).reduce((s, v) => s + v, 0),
      ot = hl.length > 4;
    if (ot && rh !== ra) {
      excluded.push("invalid_regulation_tie");
      continue;
    }
    if (seen.has(e.id)) throw Error("history_duplicate_event");
    seen.add(e.id);
    games.push({
      eventId: e.id,
      season,
      kickoff: c.date,
      homeId: h.team.id,
      awayId: a.team.id,
      homePoints: hp,
      awayPoints: ap,
      overtime: ot,
      regulationHomePoints: rh,
      regulationAwayPoints: ra,
      observedAt: receivedAt,
      // This is a proven completion upper bound, NOT the actual final whistle time.
      completedAt: receivedAt,
      completionTimeKind: "observed_complete_upper_bound",
      actualCompletedAt: null,
      source: "espn_college_football_scoreboard",
      sourceSha256: sha256,
      ruleset: `ncaa-football-season-${season}-unverified`,
      rulesetCompatibilityVerified: false,
    });
  }
  return {
    version: 1,
    researchOnly: true,
    season,
    requestStartedAt,
    receivedAt,
    sha256,
    rawResponse: raw,
    games,
    excluded,
    coverage: "reported_events_only_unverified",
    historicalAvailabilityVerified: false,
    automaticUnlock: false,
  };
}
export function mergeHistory(archives) {
  const byId = new Map();
  for (const archive of archives) {
    if (digest(archive.rawResponse) !== archive.sha256)
      throw Error("history_hash_mismatch");
    const verified = normalizeHistory(
      archive.rawResponse,
      archive.season,
      archive.requestStartedAt,
      archive.receivedAt,
    );
    for (const g of verified.games) {
      const key = `${g.season}:${g.eventId}`,
        old = byId.get(key);
      const identity = (x) =>
        JSON.stringify([
          x.season,
          x.eventId,
          x.homeId,
          x.awayId,
          Date.parse(x.kickoff),
          x.homePoints,
          x.awayPoints,
          x.overtime,
          x.regulationHomePoints,
          x.regulationAwayPoints,
        ]);
      if (old && identity(old) !== identity(g))
        throw Error("history_conflicting_results");
      if (!old || Date.parse(g.observedAt) < Date.parse(old.observedAt))
        byId.set(key, g);
    }
  }
  return {
    version: 1,
    researchOnly: true,
    games: [...byId.values()].sort(
      (a, b) =>
        Date.parse(a.kickoff) - Date.parse(b.kickoff) ||
        a.eventId.localeCompare(b.eventId),
    ),
    automaticUnlock: false,
    historicalAvailabilityVerified: false,
    coverage: "reported_events_only_unverified",
    completionTimeKind: "observed_complete_upper_bound",
    rulesetCompatibilityVerified: false,
  };
}
async function main() {
  const now = new Date().toISOString(),
    arg = process.argv.indexOf("--season"),
    season =
      arg < 0 ? new Date(now).getUTCFullYear() : Number(process.argv[arg + 1]);
  const dates = historyDates(season, now);
  console.log(
    JSON.stringify({
      planOnly: !process.argv.includes("--execute"),
      season,
      maximumRequests: dates.length,
      paidOddsRequests: 0,
      automaticUnlock: false,
    }),
  );
  if (!process.argv.includes("--execute")) return;
  if (!process.env.DATABASE_URL) throw Error("history_database_missing");
  const requireDb = createRequire(
    resolve(
      process.env.NCAAF_REPO_ROOT ?? "/opt/render/project/src",
      "lib/db/package.json",
    ),
  );
  const { Client } = requireDb("pg"),
    db = new Client({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 10000,
      query_timeout: 15000,
    });
  await db.connect();
  try {
    const check = await db.query("SELECT current_database() AS name");
    if (check.rows[0].name !== "stadium_edge_production")
      throw Error("history_unexpected_database");
    if (
      !(
        await db.query(
          "SELECT pg_try_advisory_lock(64233,20261026) AS acquired",
        )
      ).rows[0].acquired
    )
      throw Error("history_collector_running");
    const archives = [];
    let requests = 0;
    for (const day of dates) {
      const key = `research:ncaaf:history-day:${season}:${day}:captured:${now.slice(0, 10)}`;
      const prior = await db.query(
        "SELECT value FROM public.app_kv WHERE key=$1",
        [key],
      );
      if (prior.rowCount) {
        archives.push(prior.rows[0].value);
        continue;
      }
      const requestStartedAt = new Date().toISOString();
      const response = await fetch(
        `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${day.replaceAll("-", "")}&groups=80&limit=100`,
        { signal: AbortSignal.timeout(15000), redirect: "error" },
      );
      requests++;
      if (!response.ok) throw Error("history_provider_http_failure");
      const raw = await response.text(),
        receivedAt = new Date().toISOString();
      if (Buffer.byteLength(raw) > 5_000_000)
        throw Error("history_response_too_large");
      const archive = normalizeHistory(
        raw,
        season,
        requestStartedAt,
        receivedAt,
      );
      await db.query(
        "INSERT INTO public.app_kv(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING",
        [key, JSON.stringify(archive)],
      );
      archives.push(archive);
      if (requests % 10 === 0)
        console.log(
          JSON.stringify({
            capturedDays: archives.length,
            totalDays: dates.length,
          }),
        );
    }
    const summary = mergeHistory(archives),
      key = `research:ncaaf:history-summary:${season}:${new Date().toISOString().slice(0, 16)}`;
    await db.query(
      "INSERT INTO public.app_kv(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING",
      [key, JSON.stringify(summary)],
    );
    console.log(
      JSON.stringify({
        saved: true,
        key,
        requests,
        uniqueGames: summary.games.length,
        overtimeGames: summary.games.filter((g) => g.overtime).length,
        completionTimeKind: summary.completionTimeKind,
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
      "History capture stopped; saved days are retained. No availability backfill or unlock performed.",
    );
    process.exitCode = 1;
  });
