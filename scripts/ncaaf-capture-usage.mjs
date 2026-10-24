/** Bounded prior-game boxscore capture for authenticated prospective development. */
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { summaryHistory } from "./ncaaf-repair-team-history.mjs";
import { bindConferenceReports } from "./ncaaf-conference-availability.mjs";
export function usageCapturePlan(games, targets, existingIds, cutoff) {
  const now = Date.parse(cutoff);
  if (!Number.isFinite(now) || targets.length > 128)
    throw Error("usage_invalid_plan");
  const byId = new Map();
  for (const t of [...targets].sort(
    (a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff),
  )) {
    if (
      t.season !== 2026 ||
      !/^\d+$/.test(t.eventId) ||
      Date.parse(t.kickoff) <= now
    )
      continue;
    for (const id of [t.homeId, t.awayId]) {
      const prior = games
        .filter(
          (g) =>
            g.season === t.season &&
            /^\d+$/.test(g.eventId) &&
            g.eventId !== t.eventId &&
            [g.homeId, g.awayId].includes(id) &&
            Number.isFinite(Date.parse(g.kickoff)) &&
            Number.isFinite(Date.parse(g.observedAt)) &&
            Number.isFinite(Date.parse(g.completedAt)) &&
            Date.parse(g.observedAt) <= now &&
            Date.parse(g.completedAt) < now &&
            Date.parse(g.kickoff) < now,
        )
        .sort(
          (a, b) =>
            Date.parse(b.kickoff) - Date.parse(a.kickoff) ||
            a.eventId.localeCompare(b.eventId),
        );
      const seen = new Set();
      for (const g of prior) {
        if (seen.has(g.eventId)) continue;
        seen.add(g.eventId);
        if (!existingIds.has(g.eventId) && !byId.has(g.eventId))
          byId.set(g.eventId, g);
        if (seen.size === 3) break;
      }
    }
  }
  return {
    jobs: [...byId.values()].slice(0, 64),
    missingGames: byId.size,
    deferred: Math.max(0, byId.size - 64),
    maximumRequests: 64,
    paidOddsRequests: 0,
  };
}
export function validateUsageSummary(capture, expected) {
  const a = summaryHistory(
      capture.rawResponse,
      expected.eventId,
      expected.season,
      capture.requestStartedAt,
      capture.receivedAt,
    ),
    g = a.games[0];
  if (
    a.games.length !== 1 ||
    ["eventId", "season", "homeId", "awayId", "homePoints", "awayPoints"].some(
      (k) => g[k] !== expected[k],
    ) ||
    Date.parse(g.kickoff) !== Date.parse(expected.kickoff)
  )
    throw Error("usage_prior_result_mismatch");
  const teams = JSON.parse(capture.rawResponse).boxscore?.players;
  if (
    !Array.isArray(teams) ||
    teams.length !== 2 ||
    new Set(teams.map((t) => t.team?.id)).size !== 2 ||
    !teams.every(
      (t) =>
        [g.homeId, g.awayId].includes(t.team?.id) &&
        Array.isArray(t.statistics) &&
        t.statistics.some(
          (s) =>
            Array.isArray(s.athletes) &&
            s.athletes.length > 0 &&
            ["passing", "rushing", "receiving"].includes(s.name),
        ),
    )
  )
    throw Error("usage_players_missing");
  return a;
}
async function main() {
  if (!process.argv.includes("--execute")) {
    console.log(
      JSON.stringify({
        planOnly: true,
        maximumRequests: 64,
        concurrency: 2,
        timeoutMs: 10000,
        paidOddsRequests: 0,
        automaticUnlock: false,
      }),
    );
    return;
  }
  if (!process.env.DATABASE_URL) throw Error("usage_database_missing");
  const arg = process.argv.indexOf("--capture-slot"),
    slot =
      arg < 0
        ? new Date().toISOString().slice(0, 13) + ":00:00Z"
        : process.argv[arg + 1];
  if (!Number.isFinite(Date.parse(slot))) throw Error("usage_slot_invalid");
  const { Client } = createRequire(
    resolve(
      process.env.NCAAF_REPO_ROOT ?? "/opt/render/project/src",
      "lib/db/package.json",
    ),
  )("pg");
  const db = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10000,
    query_timeout: 15000,
  });
  await db.connect();
  let chain = Promise.resolve();
  const query = (sql, params) => {
    const next = chain.then(() => db.query(sql, params));
    chain = next.catch(() => {});
    return next;
  };
  try {
    if (
      (await query("SELECT current_database() AS name")).rows[0].name !==
      "stadium_edge_production"
    )
      throw Error("usage_unexpected_database");
    if (
      !(await query("SELECT pg_try_advisory_lock(64233,20261102) AS ok"))
        .rows[0].ok
    )
      throw Error("usage_overlap");
    const now = new Date(
      (await query("SELECT clock_timestamp() AS now")).rows[0].now,
    ).toISOString();
    const live = (
      await query(
        "SELECT value FROM public.app_kv WHERE key LIKE 'research:ncaaf:live-inputs:%' ORDER BY key DESC LIMIT 1",
      )
    ).rows[0]?.value;
    const archives = (
      await query(
        "SELECT DISTINCT ON (value->>'conference') value FROM public.app_kv WHERE key LIKE 'research:ncaaf:conference-availability-v2:%' ORDER BY value->>'conference',key DESC",
      )
    ).rows;
    const targets = new Map();
    for (const a of archives) {
      try {
        for (const b of bindConferenceReports(a.value, live, now))
          if (b.eventBindingVerified) targets.set(b.target.eventId, b.target);
      } catch {}
    }
    const history = (
      await query(
        "SELECT value FROM public.app_kv WHERE key LIKE 'research:ncaaf:history-summary:2026:%' ORDER BY key DESC LIMIT 1",
      )
    ).rows[0]?.value;
    if (!Array.isArray(history?.games)) throw Error("usage_history_missing");
    const existing = (
      await query(
        "SELECT value->'games'->0->>'eventId' AS event_id FROM public.app_kv WHERE key LIKE 'research:ncaaf:game-summary:2026:%'",
      )
    ).rows;
    const plan = usageCapturePlan(
      history.games,
      [...targets.values()],
      new Set(existing.map((r) => r.event_id)),
      now,
    );
    let index = 0,
      saved = 0,
      failed = 0,
      skipped = 0;
    const used = Number(
      (
        await query(
          "SELECT count(*) AS attempts FROM public.app_kv WHERE key LIKE $1",
          [`research:ncaaf:usage-attempt:${slot}:%`],
        )
      ).rows[0].attempts,
    );
    let remaining = Math.max(0, 64 - used);
    const jobs = [];
    for (const g of plan.jobs) {
      if (!remaining) break;
      const attemptKey = `research:ncaaf:usage-attempt:${slot}:${g.eventId}`;
      const claim = await query(
        "INSERT INTO public.app_kv(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO NOTHING RETURNING key",
        [
          attemptKey,
          JSON.stringify({
            state: "running",
            startedAt: new Date().toISOString(),
            releaseEligible: false,
          }),
        ],
      );
      if (claim.rowCount) {
        jobs.push({ g, attemptKey });
        remaining--;
      } else skipped++;
    }
    const requests = jobs.length;
    async function work() {
      while (index < jobs.length) {
        const { g, attemptKey } = jobs[index++];
        try {
          const requestStartedAt = new Date().toISOString(),
            response = await fetch(
              `https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=${g.eventId}`,
              { redirect: "error", signal: AbortSignal.timeout(10000) },
            );
          if (!response.ok) throw Error("usage_provider_http");
          let size = 0;
          const chunks = [];
          for await (const c of response.body) {
            size += c.length;
            if (size > 8000000) throw Error("usage_response_too_large");
            chunks.push(c);
          }
          const capture = {
              requestStartedAt,
              receivedAt: new Date().toISOString(),
              rawResponse: Buffer.concat(chunks).toString("utf8"),
            },
            archive = validateUsageSummary(capture, g);
          const key = `research:ncaaf:game-summary:2026:${g.eventId}:usage:${capture.receivedAt}`;
          await query(
            "INSERT INTO public.app_kv(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO NOTHING",
            [key, JSON.stringify(archive)],
          );
          saved++;
          await query(
            "UPDATE public.app_kv SET value=$2::jsonb,updated_at=now() WHERE key=$1",
            [
              attemptKey,
              JSON.stringify({
                state: "processed",
                archiveKey: key,
                receivedAt: capture.receivedAt,
                releaseEligible: false,
              }),
            ],
          );
        } catch {
          failed++;
          await query(
            "UPDATE public.app_kv SET value=$2::jsonb,updated_at=now() WHERE key=$1",
            [
              attemptKey,
              JSON.stringify({
                state: "failed",
                reason: "usage_capture_or_identity_failed",
                releaseEligible: false,
              }),
            ],
          );
        }
      }
    }
    await Promise.all([work(), work()]);
    const result = {
      state: "processed",
      requests,
      saved,
      failed,
      skipped,
      deferred: Math.max(0, plan.missingGames - requests - skipped),
      matchedTargets: targets.size,
      maximumRequests: 64,
      paidOddsRequests: 0,
      releaseEligible: false,
      finishedAt: new Date().toISOString(),
    };
    await query(
      "INSERT INTO public.app_kv(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()",
      ["research:ncaaf:usage-capture:latest", JSON.stringify(result)],
    );
    console.log(JSON.stringify(result));
    if (failed) process.exitCode = 1;
  } finally {
    await chain;
    await db.end();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch(() => {
    console.error(
      "Usage evidence capture failed; no forecast or release changed.",
    );
    process.exitCode = 1;
  });
