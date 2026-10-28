/** Bounded, forward-only official conference evidence. Never changes a forecast or release gate. */
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const CONFERENCES = ["B10", "B12", "ACC", "SEC"];
const ENDPOINT = "https://app.hdintelligence.com/api/";
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
const norm = (s) =>
  typeof s === "string" ? s.toLowerCase().replace(/[^a-z0-9]/g, "") : "";
const zones = {
  CT: "America/Chicago",
  ET: "America/New_York",
  MT: "America/Denver",
  PT: "America/Los_Angeles",
};
export function availabilityStatus(s) {
  const statuses = new Map([
    ["Available", "available"],
    ["Probable", "probable"],
    ["Questionable", "questionable"],
    ["Doubtful", "doubtful"],
    ["Out", "out"],
    ["Game Time Decision", "game_time_decision"],
  ]);
  return statuses.get(s) ?? "unknown";
}

function localStamp(ms, zone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (k) => parts.find((p) => p.type === k).value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
}
export function publicationTime(r) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(r.publishDate ?? "") ||
    !/^(?:[0-9]|[01][0-9]|2[0-3]):[0-5]\d:[0-5]\d$/.test(r.postedTime ?? "") ||
    !zones[r.conferenceTimeZone]
  )
    throw Error("conference_invalid_publication");
  const stamp = r.publishDate + "T" + r.postedTime.padStart(8, "0"),
    base = Date.parse(stamp + "Z");
  if (!Number.isFinite(base)) throw Error("conference_invalid_publication");
  let utc = base;
  for (let i = 0; i < 3; i++)
    utc +=
      base - Date.parse(localStamp(utc, zones[r.conferenceTimeZone]) + "Z");
  if (
    !Number.isFinite(utc) ||
    localStamp(utc, zones[r.conferenceTimeZone]) !== stamp
  )
    throw Error("conference_invalid_publication");
  return new Date(utc).toISOString();
}
export function decodeCapture(c) {
  const raw = gunzipSync(Buffer.from(c.rawResponseGzipBase64, "base64"), {
    maxOutputLength: 16000000,
  });
  if (sha(raw) !== c.sha256) throw Error("conference_capture_hash");
  return JSON.parse(raw.toString("utf8"));
}
export function buildConferenceArchive(conference, published, history) {
  if (!CONFERENCES.includes(conference)) throw Error("conference_not_allowed");
  for (const c of [published, history]) {
    if (
      !Number.isFinite(Date.parse(c.requestStartedAt)) ||
      !Number.isFinite(Date.parse(c.receivedAt)) ||
      Date.parse(c.requestStartedAt) > Date.parse(c.receivedAt) ||
      Buffer.byteLength(c.rawResponse) > 16000000
    )
      throw Error("conference_invalid_receipt");
  }
  const p = JSON.parse(published.rawResponse),
    a = JSON.parse(history.rawResponse);
  if (
    !p ||
    Array.isArray(p) ||
    typeof p !== "object" ||
    !Array.isArray(a?.data) ||
    a.data.length > 50000
  )
    throw Error("conference_invalid_payload");
  const entries = Object.entries(p);
  if (entries.length > 128)
    throw Error("conference_invalid_reports");
  const observedAt = new Date(
    Math.max(Date.parse(published.receivedAt), Date.parse(history.receivedAt)),
  ).toISOString();
  const teams = new Set();
  let statusRows = 0;
  let deferredFutureReports = 0;
  const reports = entries.flatMap(([reportId, r]) => {
    if (
      !/^\d+$/.test(reportId) ||
      !Array.isArray(r.games) ||
      r.games.length !== 2
    )
      throw Error("conference_invalid_report");
    const publishedAt = publicationTime(r);
    if (Date.parse(publishedAt) > Date.parse(published.receivedAt)) {
      deferredFutureReports++;
      return [];
    }
    const sides = r.games.map((g) => {
      if (!norm(g.teamName) || !Array.isArray(g.rows) || g.rows.length > 250)
        throw Error("conference_invalid_team");
      teams.add(g.teamName);
      statusRows += g.rows.length;
      const aliases = [
        ...new Set([g.teamName, g.teamDisplayName].map(norm).filter(Boolean)),
      ];
      return {
        name: g.teamName,
        aliases,
        rows: g.rows.map((x) => {
          if (
            typeof x.name !== "string" ||
            !x.name.trim() ||
            typeof x.status !== "string"
          )
            throw Error("conference_invalid_status");
          return {
            name: x.name,
            status: availabilityStatus(x.status),
            sourceStatus: x.status,
          };
        }),
      };
    });
    if (sides[0].aliases.some((n) => sides[1].aliases.includes(n)))
      throw Error("conference_ambiguous_sides");
    // Archive dates are source event-day labels, not source publication times.
    const daySets = sides.map(
      (side, i) =>
        new Set(
          a.data
            .filter((row) => {
              const team = [row.Team, row.TeamDisplay].map(norm),
                opponent = [row.Opponent, row.OpponentDisplay].map((x) =>
                  norm(
                    typeof x === "string"
                      ? x.replace(/^(at|vs\.?)\s+/i, "")
                      : x,
                  ),
                );
              return (
                side.aliases.some((n) => team.includes(n)) &&
                sides[1 - i].aliases.some((n) => opponent.includes(n))
              );
            })
            .map((row) => Date.parse(row.Week))
            .filter((ms) => Number.isFinite(ms) && ms % 86400000 === 0)
            .map((ms) => new Date(ms).toISOString().slice(0, 10))
            .filter(
              (day) =>
                day >= r.publishDate &&
                Date.parse(day + "T00:00:00Z") -
                  Date.parse(r.publishDate + "T00:00:00Z") <=
                  7 * 86400000,
            ),
        ),
    );
    const days = [...daySets[0]].filter((day) => daySets[1].has(day));
    return [{
      reportId,
      publishedAt,
      reportType: r.ReportType,
      sides,
      eventDay: days.length === 1 ? days[0] : null,
      eventDayVerified: days.length === 1,
    }];
  });
  const compress = (c, route) => ({
    endpoint: ENDPOINT + route,
    requestStartedAt: c.requestStartedAt,
    receivedAt: c.receivedAt,
    sha256: sha(c.rawResponse),
    rawEncoding: "gzip-base64",
    rawResponseGzipBase64: gzipSync(c.rawResponse).toString("base64"),
  });
  return {
    version: 2,
    researchOnly: true,
    conference,
    observedAt,
    reportCount: reports.length,
    deferredFutureReports,
    teamCount: teams.size,
    statusRows,
    reports,
    published: compress(published, "get-publish-public"),
    history: compress(history, "get-archive-public"),
    absentTeamStatus: "unknown",
    historicalAvailabilityVerified: false,
    releaseEligible: false,
    automaticUnlock: false,
  };
}
/**
 * Empty or failed conference captures must stay retryable inside the same slot.
 * Captures with deferred future reports also retry after backoff; new source
 * archives/bindings are appended, never rewritten. Never invents report dates.
 */
export function shouldRetryConferenceCapture(
  attempt,
  nowMs,
  minAgeMs = 30 * 60000,
  staleRunningMs = 15 * 60000,
) {
  if (!attempt || typeof attempt !== "object") return true;
  const started = Date.parse(attempt.startedAt ?? "");
  // A killed collector can leave state=running forever; reclaim after staleRunningMs.
  if (attempt.state === "running") {
    if (!Number.isFinite(started) || !Number.isFinite(nowMs) || nowMs < started)
      return false;
    return nowMs - started >= staleRunningMs;
  }
  const finished = Date.parse(attempt.finishedAt ?? attempt.startedAt ?? "");
  if (!Number.isFinite(finished) || !Number.isFinite(nowMs) || nowMs < finished)
    return false;
  if (nowMs - finished < minAgeMs) return false;
  if (attempt.state === "failed") return true;
  if (attempt.state === "processed" && ((attempt.verifiedEvents ?? 0) === 0 || (attempt.deferredFutureReports ?? 0) > 0))
    return true;
  return false;
}

export function bindConferenceReports(archive, live, now) {
  const clock = Date.parse(now);
  if (
    !Number.isFinite(clock) ||
    archive.researchOnly !== true ||
    Date.parse(archive.observedAt) > clock ||
    clock - Date.parse(archive.observedAt) > 6 * 3600000
  )
    throw Error("conference_stale_or_future_capture");
  // Rebuild normalized evidence from authenticated raw bytes; metadata alone is not authority.
  const rebuilt = buildConferenceArchive(
    archive.conference,
    {
      ...archive.published,
      rawResponse: JSON.stringify(decodeCapture(archive.published)),
    },
    {
      ...archive.history,
      rawResponse: JSON.stringify(decodeCapture(archive.history)),
    },
  );
  if (rebuilt.observedAt !== archive.observedAt)
    throw Error("conference_receipt_mismatch");
  if (
    !live?.researchOnly ||
    !Array.isArray(live.scoreboards) ||
    !Array.isArray(live.matched)
  )
    throw Error("conference_invalid_live_archive");
  const events = [];
  for (const c of live.scoreboards) {
    if (
      sha(c.rawResponse) !== c.sha256 ||
      Date.parse(c.receivedAt) > clock ||
      !Number.isFinite(Date.parse(c.receivedAt))
    )
      throw Error("conference_invalid_scoreboard");
    for (const event of JSON.parse(c.rawResponse).events ?? [])
      for (const game of event.competitions ?? []) {
        if (
          event.season?.year !== 2026 ||
          !Array.isArray(game.competitors) ||
          game.competitors.length !== 2
        )
          continue;
        const sides = game.competitors.map((x) => ({
          id: x.team?.id,
          homeAway: x.homeAway,
          aliases: [
            x.team?.displayName,
            x.team?.shortDisplayName,
            x.team?.location,
            x.team?.name,
          ]
            .map(norm)
            .filter(Boolean),
        }));
        const matches = live.matched.filter(
          (m) =>
            m.target?.eventId === event.id &&
            Date.parse(m.target.kickoff) === Date.parse(game.date) &&
            m.target.scoreboardSha256 === c.sha256 &&
            m.target.scoreboardObservedAt === c.receivedAt,
        );
        if (
          matches.length !== 1 ||
          Date.parse(game.date) <= clock ||
          (game.status?.type?.state ?? event.status?.type?.state) !== "pre"
        )
          continue;
        const t = matches[0].target;
        if (
          !sides.some((s) => s.homeAway === "home" && s.id === t.homeId) ||
          !sides.some((s) => s.homeAway === "away" && s.id === t.awayId)
        )
          continue;
        events.push({
          eventId: event.id,
          kickoff: t.kickoff,
          season: 2026,
          homeId: t.homeId,
          awayId: t.awayId,
          day: localStamp(Date.parse(t.kickoff), "America/New_York").slice(
            0,
            10,
          ),
          sides,
          scoreboardSha256: c.sha256,
          neutralSite:
            typeof game.neutralSite === "boolean" ? game.neutralSite : null,
        });
      }
  }
  return rebuilt.reports.map((r) => {
    const candidates = r.eventDayVerified
      ? events.filter(
          (e) =>
            e.day === r.eventDay &&
            r.sides.every(
              (s) =>
                e.sides.filter((x) =>
                  s.aliases.some((n) => x.aliases.includes(n)),
                ).length === 1,
            ),
        )
      : [];
    // Duplicate source events, repeated aliases or absent dates must not produce a binding.
    const unique =
      candidates.length === 1 &&
      r.sides.every(
        (s, i) =>
          !r.sides[1 - i].aliases.some((n) =>
            candidates[0].sides.some(
              (x) =>
                s.aliases.some((a) => x.aliases.includes(a)) &&
                x.aliases.includes(n),
            ),
          ),
      );
    return {
      reportId: r.reportId,
      eventBindingVerified: unique,
      target: unique ? candidates[0] : null,
      reason: unique
        ? null
        : r.eventDayVerified
          ? "missing_or_ambiguous_event"
          : "missing_or_ambiguous_source_day",
      publishedAt: r.publishedAt,
      observedAt: archive.observedAt,
      sourceHashes: {
        published: archive.published.sha256,
        history: archive.history.sha256,
      },
      sides: r.sides,
      researchOnly: true,
      releaseEligible: false,
    };
  });
}
/** Persist only an allowlisted code and phase: never provider bodies, athlete rows or arbitrary errors. */
export function conferenceFailureDiagnostic(error, phase) {
  const codes = new Set(['conference_invalid_publication','conference_invalid_payload','conference_invalid_reports','conference_invalid_report','conference_invalid_team','conference_invalid_status','conference_ambiguous_sides','conference_invalid_receipt','conference_capture_hash','conference_receipt_mismatch','conference_invalid_live_archive','conference_invalid_scoreboard','conference_stale_or_future_capture','conference_provider_http','conference_response_too_large']);
  return {failurePhase: ['published_receipt','history_receipt','archive_validation','archive_save','event_binding','binding_save'].includes(phase) ? phase : 'unknown', failureCode: codes.has(error?.message) ? error.message : error?.name === 'TimeoutError' ? 'conference_provider_timeout' : error instanceof SyntaxError ? 'conference_invalid_json' : 'conference_internal_failure'};
}
async function receipt(route, conference) {
  const requestStartedAt = new Date().toISOString();
  const response = await fetch(ENDPOINT + route, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sport: "Football",
      conference,
      organization: conference,
    }),
    redirect: "error",
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) throw Error("conference_provider_http");
  let length = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > 16000000) throw Error("conference_response_too_large");
    chunks.push(chunk);
  }
  return {
    rawResponse: Buffer.concat(chunks).toString("utf8"),
    requestStartedAt,
    receivedAt: new Date().toISOString(),
  };
}
async function main() {
  if (!process.argv.includes("--execute")) {
    console.log(
      JSON.stringify({
        planOnly: true,
        conferences: CONFERENCES,
        maximumPublicRequests: 8,
        paidOddsRequests: 0,
        automaticUnlock: false,
      }),
    );
    return;
  }
  const arg = process.argv.indexOf("--capture-slot"),
    slot =
      arg < 0 ? new Date().toISOString().slice(0, 13) : process.argv[arg + 1];
  if (
    !slot ||
    !Number.isFinite(Date.parse(slot.length === 13 ? slot + ":00:00Z" : slot))
  )
    throw Error("conference_invalid_slot");
  if (!process.env.DATABASE_URL) throw Error("conference_database_missing");
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
  try {
    if (
      (await db.query("SELECT current_database() AS name")).rows[0].name !==
      "stadium_edge_production"
    )
      throw Error("conference_unexpected_database");
    if (
      !(await db.query("SELECT pg_try_advisory_lock(64233,20261031) AS ok"))
        .rows[0].ok
    )
      throw Error("conference_capture_overlap");
    let captureFailed = false;
    for (const conference of CONFERENCES) {
      const phase = process.argv.includes("--development-catchup")
        ? ":development-catchup"
        : process.argv.includes("--slot-free-refresh")
          ? ":slot-free-refresh"
          : "";
      const attemptKey = `research:ncaaf:conference-capture-slot:${conference}:${slot}${phase}`;
      const priorAttempt = (
        await db.query("SELECT value FROM public.app_kv WHERE key=$1", [
          attemptKey,
        ])
      ).rows[0]?.value;
      const nowMs = Date.now();
      if (priorAttempt && !shouldRetryConferenceCapture(priorAttempt, nowMs))
        continue;
      const running = {
        state: "running",
        startedAt: new Date().toISOString(),
        releaseEligible: false,
        retryOf:
          priorAttempt?.state === "processed" || priorAttempt?.state === "failed"
            ? priorAttempt.state
            : null,
      };
      if (priorAttempt) {
        await db.query(
          "UPDATE public.app_kv SET value=$2::jsonb,updated_at=now() WHERE key=$1",
          [attemptKey, JSON.stringify(running)],
        );
      } else {
        const claimed = await db.query(
          "INSERT INTO public.app_kv(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO NOTHING RETURNING key",
          [attemptKey, JSON.stringify(running)],
        );
        if (!claimed.rowCount) continue;
      }
      let failurePhase = "published_receipt";
      try {
        const published = await receipt("get-publish-public", conference);
        failurePhase = "history_receipt";
        const history = await receipt("get-archive-public", conference);
        failurePhase = "archive_validation";
        const archive = buildConferenceArchive(conference, published, history);
        failurePhase = "archive_save";
        const key = `research:ncaaf:conference-availability-v2:${conference}:${archive.observedAt}`;
        await db.query(
          "INSERT INTO public.app_kv(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO NOTHING",
          [key, JSON.stringify(archive)],
        );
        const live = (
          await db.query(
            "SELECT key,value FROM public.app_kv WHERE key LIKE 'research:ncaaf:live-inputs:%' ORDER BY key DESC LIMIT 1",
          )
        ).rows[0];
        const now = new Date(
          (await db.query("SELECT clock_timestamp() AS now")).rows[0].now,
        ).toISOString();
        failurePhase = "event_binding";
        const bindings = live
          ? bindConferenceReports(archive, live.value, now)
          : [];
        failurePhase = "binding_save";
        const bindingKey = `research:ncaaf:conference-bindings:${conference}:${archive.observedAt}`;
        const result = {
          researchOnly: true,
          archiveKey: key,
          liveKey: live?.key ?? null,
          observedAt: archive.observedAt,
          bindings,
          verifiedEvents: bindings.filter((x) => x.eventBindingVerified).length,
          releaseEligible: false,
        };
        await db.query(
          "INSERT INTO public.app_kv(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO NOTHING",
          [bindingKey, JSON.stringify(result)],
        );
        await db.query(
          "UPDATE public.app_kv SET value=$2::jsonb,updated_at=now() WHERE key=$1",
          [
            attemptKey,
            JSON.stringify({
              state: "processed",
              archiveKey: key,
              bindingKey,
              reportCount: archive.reportCount,
              deferredFutureReports: archive.deferredFutureReports,
              waitingReason: archive.reportCount === 0 ? (archive.deferredFutureReports > 0 ? "conference_reports_not_yet_published" : "conference_no_published_reports") : null,
              teamCount: archive.teamCount,
              verifiedEvents: result.verifiedEvents,
              finishedAt: now,
              releaseEligible: false,
            }),
          ],
        );
        console.log(
          JSON.stringify({
            conference,
            state: "processed",
            reports: archive.reportCount,
            teams: archive.teamCount,
            verifiedEvents: result.verifiedEvents,
            automaticUnlock: false,
          }),
        );
      } catch (error) {
        captureFailed = true;
        const diagnostic = conferenceFailureDiagnostic(error, failurePhase);
        await db.query(
          "UPDATE public.app_kv SET value=$2::jsonb,updated_at=now() WHERE key=$1",
          [
            attemptKey,
            JSON.stringify({
              state: "failed",
              reason: "conference_capture_or_binding_failed",
              ...diagnostic,
              finishedAt: new Date().toISOString(),
              releaseEligible: false,
            }),
          ],
        );
        console.log(
          JSON.stringify({
            conference,
            state: "failed",
            automaticUnlock: false,
          }),
        );
      }
    }
    if (captureFailed) process.exitCode = 1;
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
      "Conference research collector failed; no forecast or release changed.",
    );
    process.exitCode = 1;
  });
