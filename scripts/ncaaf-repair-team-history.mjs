/** Targeted research history repair. No automatic model/gate changes. */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeHistory } from "./ncaaf-capture-history.mjs";
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
const iso = (v) => typeof v === "string" && Number.isFinite(Date.parse(v));
export function scheduleCompletedEvents(raw, teamId, season, receivedAt) {
  const p = JSON.parse(raw);
  if (
    p.team?.id !== teamId ||
    !Number.isSafeInteger(season) ||
    season < 2021 ||
    !Array.isArray(p.events) ||
    !iso(receivedAt)
  )
    throw Error("repair_schedule_identity");
  const ids = new Set();
  for (const e of p.events) {
    if (
      e.season?.year !== season ||
      !/^\d+$/.test(e.id) ||
      !Array.isArray(e.competitions) ||
      e.competitions.length !== 1
    )
      continue;
    const c = e.competitions[0],
      s = c.status ?? e.status;
    if (!c.competitors?.some((x) => x.team?.id === teamId))
      throw Error("repair_schedule_team_mismatch");
    if (
      s?.type?.completed === true &&
      s.type.state === "post" &&
      iso(c.date) &&
      Date.parse(c.date) < Date.parse(receivedAt)
    )
      ids.add(e.id);
  }
  return [...ids];
}
export function summaryHistory(
  raw,
  eventId,
  season,
  requestStartedAt,
  receivedAt,
) {
  const p = JSON.parse(raw),
    h = p.header;
  if (
    h?.id !== eventId ||
    h.season?.year !== season ||
    h.league?.slug !== "college-football" ||
    !Array.isArray(h.competitions) ||
    h.competitions.length !== 1
  )
    throw Error("repair_summary_identity");
  // Summary linescores are ordered arrays, not explicit numbered scoreboard rows.
  // Preserve this distinction for independent provenance review.
  const header = structuredClone(h),
    c = header.competitions[0];
  if (!Array.isArray(c.competitors) || c.competitors.length !== 2)
    throw Error("repair_summary_sides");
  for (const side of c.competitors) {
    if (!Array.isArray(side.linescores) || side.linescores.length < 4)
      throw Error("repair_summary_periods_missing");
    side.linescores = side.linescores.map((x, i) => {
      const value =
        typeof x.value === "number"
          ? x.value
          : typeof x.displayValue === "string" && /^\d+$/.test(x.displayValue)
            ? Number(x.displayValue)
            : NaN;
      if (
        !Number.isSafeInteger(value) ||
        value < 0 ||
        (x.period != null && x.period !== i + 1)
      )
        throw Error("repair_summary_invalid_period");
      return { value, period: i + 1 };
    });
  }
  if (c.competitors[0].linescores.length !== c.competitors[1].linescores.length)
    throw Error("repair_summary_period_length");
  c.status = { ...c.status, period: c.competitors[0].linescores.length };
  const normalized = normalizeHistory(
    JSON.stringify({ events: [header] }),
    season,
    requestStartedAt,
    receivedAt,
  );
  return {
    ...normalized,
    rawResponse: raw,
    sha256: sha(raw),
    source: "espn_college_football_summary",
    games: normalized.games.map((g) => ({
      ...g,
      source: "espn_college_football_summary",
      sourceSha256: sha(raw),
      periodEvidence: "ordered_summary_linescores",
      periodOrderingIndependentlyVerified: false,
    })),
  };
}
export function mergeGames(existing, added) {
  const map = new Map();
  const identity = (g) =>
    JSON.stringify([
      g.season,
      g.eventId,
      g.homeId,
      g.awayId,
      Date.parse(g.kickoff),
      g.homePoints,
      g.awayPoints,
      g.overtime,
      g.regulationHomePoints,
      g.regulationAwayPoints,
    ]);
  for (const g of [...existing, ...added]) {
    const key = `${g.season}:${g.eventId}`,
      prior = map.get(key);
    if (prior && identity(prior) !== identity(g))
      throw Error("repair_conflicting_result");
    if (!prior || Date.parse(g.observedAt) < Date.parse(prior.observedAt))
      map.set(key, g);
  }
  return [...map.values()];
}
async function receipt(url) {
  const requestStartedAt = new Date().toISOString(),
    r = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
  if (!r.ok) throw Error("repair_provider_http_failure");
  const rawResponse = await r.text(),
    receivedAt = new Date().toISOString();
  if (Buffer.byteLength(rawResponse) > 8_000_000)
    throw Error("repair_response_too_large");
  return {
    requestStartedAt,
    receivedAt,
    rawResponse,
    sha256: sha(rawResponse),
  };
}
async function main() {
  if (!process.argv.includes("--execute")) {
    console.log(
      JSON.stringify({
        planOnly: true,
        maximumTeamSchedules: 128,
        maximumGameSummaries: 500,
        paidOddsRequests: 0,
        automaticUnlock: false,
      }),
    );
    return;
  }
  if (!process.env.DATABASE_URL) throw Error("repair_database_missing");
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
    if (
      (await db.query("SELECT current_database() AS name")).rows[0].name !==
      "stadium_edge_production"
    )
      throw Error("repair_unexpected_database");
    if (
      !(
        await db.query(
          "SELECT pg_try_advisory_lock(64233,20261027) AS acquired",
        )
      ).rows[0].acquired
    )
      throw Error("repair_already_running");
    const live = (
      await db.query(
        "SELECT value FROM public.app_kv WHERE key LIKE 'research:ncaaf:live-inputs:%' ORDER BY key DESC LIMIT 1",
      )
    ).rows[0]?.value;
    const seasonArg = process.argv.indexOf("--season");
    const season =
      seasonArg < 0
        ? new Date().getUTCFullYear()
        : Number(process.argv[seasonArg + 1]);
    if (
      !Number.isSafeInteger(season) ||
      season < 2021 ||
      season > new Date().getUTCFullYear()
    )
      throw Error("repair_invalid_season");
    const base = (
      await db.query(
        "SELECT key,value FROM public.app_kv WHERE key LIKE $1 ORDER BY key DESC LIMIT 1",
        [`research:ncaaf:history-summary:${season}:%`],
      )
    ).rows[0];
    if (
      !live ||
      !base ||
      !Array.isArray(live.matched) ||
      !Array.isArray(base.value.games)
    )
      throw Error("repair_archives_missing");
    const teams = [
      ...new Set(
        live.matched.flatMap((g) =>
          g.target.season === season ? [g.target.homeId, g.target.awayId] : [],
        ),
      ),
    ].sort();
    if (
      !teams.length ||
      teams.length > 128 ||
      teams.some((id) => !/^\d+$/.test(id))
    )
      throw Error("repair_team_budget");
    const slotArg = process.argv.indexOf("--capture-slot"),
      slot = slotArg < 0 ? null : process.argv[slotArg + 1];
    if (
      slot !== null &&
      (!/^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$/.test(slot) ||
        !Number.isFinite(Date.parse(slot)) ||
        Date.parse(slot) > Date.now())
    )
      throw Error("repair_invalid_capture_slot");
    const day = slot ?? new Date().toISOString().slice(0, 10),
      ids = new Set(),
      sourceKeys = [],
      failures = [];
    const get = async (key, url, normalize) => {
      const old = (
        await db.query("SELECT value FROM public.app_kv WHERE key=$1", [key])
      ).rows[0]?.value;
      if (old) {
        if (sha(old.rawResponse) !== old.sha256)
          throw Error("repair_hash_mismatch");
        return normalize(old);
      }
      const capture = await receipt(url),
        value = normalize(capture);
      await db.query(
        "INSERT INTO public.app_kv(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING",
        [
          key,
          JSON.stringify({
            ...value,
            researchOnly: true,
            automaticUnlock: false,
          }),
        ],
      );
      return value;
    };
    for (const id of teams) {
      const key = `research:ncaaf:team-schedule:${season}:${id}:${day}`;
      const row = await get(
        key,
        `https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams/${id}/schedule?season=${season}`,
        (c) => ({
          ...c,
          eventIds: scheduleCompletedEvents(
            c.rawResponse,
            id,
            season,
            c.receivedAt,
          ),
        }),
      );
      row.eventIds.forEach((id) => ids.add(id));
      sourceKeys.push(key);
    }
    const known = new Set(base.value.games.map((g) => g.eventId)),
      missing = [...ids].filter((id) => !known.has(id));
    if (missing.length > 500) throw Error("repair_event_budget");
    console.log(
      JSON.stringify({
        teams: teams.length,
        completedScheduleEvents: ids.size,
        missingSummaries: missing.length,
      }),
    );
    let games = base.value.games,
      processed = 0;
    for (const id of missing) {
      const key = `research:ncaaf:game-summary:${season}:${id}:${day}`;
      try {
        const row = await get(
          key,
          `https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=${id}`,
          (c) =>
            summaryHistory(
              c.rawResponse,
              id,
              season,
              c.requestStartedAt,
              c.receivedAt,
            ),
        );
        games = mergeGames(games, row.games);
        sourceKeys.push(key);
        if (!row.games.length)
          failures.push({ eventId: id, reason: "not_usable_completed_result" });
      } catch (error) {
        if (error?.message === "repair_conflicting_result") throw error;
        failures.push({
          eventId: id,
          reason: "summary_unavailable_or_invalid",
        });
      }
      if (++processed % 10 === 0)
        console.log(
          JSON.stringify({
            processedSummaries: processed,
            totalSummaries: missing.length,
          }),
        );
    }
    const matched = live.matched.filter((g) => g.target.season === season),
      sample = (id) =>
        games.filter(
          (g) => g.season === season && (g.homeId === id || g.awayId === id),
        ).length;
    const coverage = matched.filter(
      (g) => sample(g.target.homeId) >= 3 && sample(g.target.awayId) >= 3,
    ).length;
    const summary = {
      version: 1,
      researchOnly: true,
      games,
      sourceKeys,
      baseSummaryKey: base.key,
      failures,
      coverage: "matched_teams_only_unverified",
      rulesetCompatibilityVerified: false,
      historicalAvailabilityVerified: false,
      automaticUnlock: false,
    };
    const key = `research:ncaaf:history-summary:${season}:${new Date().toISOString()}`;
    await db.query(
      "INSERT INTO public.app_kv(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING",
      [key, JSON.stringify(summary)],
    );
    console.log(
      JSON.stringify({
        saved: true,
        key,
        uniqueGames: games.length,
        overtimeGames: games.filter((g) => g.overtime).length,
        matchedEventsWithTeamSamples: coverage,
        matchedEvents: matched.length,
        summaryFailures: failures.length,
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
      "History repair stopped; cached source responses retained. No unlock performed.",
    );
    process.exitCode = 1;
  });
