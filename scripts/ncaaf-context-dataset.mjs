/** Prospective development features only; no injury coefficients or forecast rewrites. */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { summaryHistory } from "./ncaaf-repair-team-history.mjs";
import { bindConferenceReports } from "./ncaaf-conference-availability.mjs";
const sha = (s) => createHash("sha256").update(s).digest("hex");
const canonical = (x) => JSON.stringify(sortKeys(x));
function sortKeys(x) {
  return Array.isArray(x)
    ? x.map(sortKeys)
    : x && typeof x === "object"
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, sortKeys(x[k])]),
        )
      : x;
}
const norm = (s) =>
  typeof s === "string" ? s.toLowerCase().replace(/[^a-z0-9]/g, "") : "";
const metrics = {
  passingAttempts: {
    group: "passing",
    key: "completions/passingAttempts",
    part: 1,
  },
  carries: { group: "rushing", key: "rushingAttempts" },
  receptions: { group: "receiving", key: "receptions" },
};
function count(v, part) {
  if (typeof v !== "string") return null;
  const s = part == null ? v : v.split("/")[part];
  return typeof s === "string" &&
    /^\d+$/.test(s) &&
    Number.isSafeInteger(Number(s))
    ? Number(s)
    : null;
}
export function usageFromSummary(capture, target, cutoff) {
  const clock = Date.parse(cutoff);
  if (
    !Number.isFinite(clock) ||
    sha(capture.rawResponse) !== capture.sha256 ||
    !Number.isFinite(Date.parse(capture.receivedAt)) ||
    Date.parse(capture.receivedAt) > clock ||
    Date.parse(capture.receivedAt) >= Date.parse(target.kickoff)
  )
    throw Error("context_invalid_usage_capture");
  const raw = JSON.parse(capture.rawResponse),
    eventId = raw.header?.id;
  if (eventId === target.eventId) throw Error("context_target_leakage");
  const checked = summaryHistory(
    capture.rawResponse,
    eventId,
    target.season,
    capture.requestStartedAt,
    capture.receivedAt,
  );
  if (
    checked.games.length !== 1 ||
    Date.parse(checked.games[0].kickoff) >= clock
  )
    throw Error("context_incomplete_prior_game");
  const game = checked.games[0],
    teams = [];
  for (const team of raw.boxscore?.players ?? []) {
    const teamId = team.team?.id;
    if (![game.homeId, game.awayId].includes(teamId))
      throw Error("context_usage_team_identity");
    const groups = team.statistics ?? [],
      usage = {};
    for (const [metric, spec] of Object.entries(metrics)) {
      const found = groups.filter((g) => g.name === spec.group);
      if (found.length !== 1) {
        usage[metric] = null;
        continue;
      }
      const group = found[0],
        index = (group.keys ?? []).indexOf(spec.key);
      if (
        index < 0 ||
        !Array.isArray(group.athletes) ||
        !Array.isArray(group.totals)
      ) {
        usage[metric] = null;
        continue;
      }
      const total = count(group.totals[index], spec.part),
        players = [],
        seen = new Set();
      let sum = 0,
        unattributed = 0,
        valid = total !== null;
      for (const row of group.athletes) {
        const a = row.athlete,
          n = count(row.stats?.[index], spec.part);
        if (
          a &&
          norm(a.displayName) === "team" &&
          /^-\d+$/.test(a.id ?? "") &&
          n !== null
        ) {
          sum += n;
          unattributed += n;
          continue;
        }
        if (
          !a ||
          !/^\d+$/.test(a.id ?? "") ||
          !norm(a.displayName) ||
          n === null ||
          seen.has(a.id)
        ) {
          valid = false;
          break;
        }
        seen.add(a.id);
        sum += n;
        players.push({
          athleteId: a.id,
          name: a.displayName,
          jersey: /^\d+$/.test(String(a.jersey ?? ""))
            ? String(a.jersey)
            : null,
          count: n,
        });
      }
      usage[metric] =
        valid && sum === total ? { total, players, unattributed } : null;
    }
    if (teams.some((t) => t.teamId === teamId))
      throw Error("context_duplicate_usage_team");
    teams.push({ teamId, usage });
  }
  return {
    eventId: game.eventId,
    kickoff: game.kickoff,
    receivedAt: capture.receivedAt,
    sha256: capture.sha256,
    teams,
  };
}
export function contextFeatures(binding, usage, cutoff = binding.observedAt) {
  if (
    binding.eventBindingVerified !== true ||
    binding.sides?.length !== 2 ||
    !binding.target
  )
    throw Error("context_unverified_binding");
  const clock = Date.parse(cutoff);
  if (
    !Number.isFinite(clock) ||
    !Number.isFinite(Date.parse(binding.observedAt)) ||
    Date.parse(binding.observedAt) > clock ||
    clock >= Date.parse(binding.target.kickoff) ||
    usage.some(
      (g) =>
        g.eventId === binding.target.eventId ||
        !Number.isFinite(Date.parse(g.kickoff)) ||
        !Number.isFinite(Date.parse(g.receivedAt)) ||
        Date.parse(g.kickoff) >= clock ||
        Date.parse(g.receivedAt) > clock,
    )
  )
    throw Error("context_usage_cutoff");
  if (new Set(usage.map((g) => g.eventId)).size !== usage.length)
    throw Error("context_duplicate_usage_game");
  const target = binding.target,
    ids = [target.homeId, target.awayId];
  const sides = binding.sides.map((side) => {
    const matches = target.sides.filter((s) =>
      side.aliases.some((a) => s.aliases.includes(a)),
    );
    if (matches.length !== 1 || !ids.includes(matches[0].id))
      throw Error("context_ambiguous_team");
    const teamId = matches[0].id;
    const recent = usage
      .filter((g) => g.teams.some((t) => t.teamId === teamId))
      .sort((a, b) => Date.parse(b.kickoff) - Date.parse(a.kickoff))
      .slice(0, 5);
    const features = {};
    for (const metric of Object.keys(metrics)) {
      const relevant = recent.map((g) => ({
        game: g,
        metric: g.teams.find((t) => t.teamId === teamId).usage[metric],
      }));
      const complete =
        relevant.length >= 3 && relevant.every((r) => r.metric !== null);
      if (!complete) {
        features[metric] = {
          coverage: "unknown",
          games: recent.length,
          shares: null,
        };
        continue;
      }
      let total = 0,
        unattributed = 0;
      const players = new Map();
      for (const { metric: m } of relevant) {
        total += m.total;
        unattributed += m.unattributed ?? 0;
        for (const p of m.players) {
          const k = p.athleteId;
          let x = players.get(k);
          if (!x) {
            x = { ...p, count: 0, identities: new Set() };
            players.set(k, x);
          }
          x.count += p.count;
          if (p.jersey !== null)
            x.identities.add(norm(p.name) + ":" + p.jersey);
        }
      }
      const statuses = {
        available: 0,
        probable: 0,
        questionable: 0,
        doubtful: 0,
        out: 0,
        game_time_decision: 0,
        unknown: unattributed,
      };
      let identified = 0;
      const owners = new Map();
      for (const p of players.values())
        for (const identity of p.identities) {
          if (!owners.has(identity)) owners.set(identity, new Set());
          owners.get(identity).add(p.athleteId);
        }
      for (const p of players.values()) {
        const matches = side.rows.filter((r) => {
          const m = /^([A-Za-z]+) #(\d+) (.+)$/.exec(r.name);
          return (
            m &&
            p.identities.has(norm(m[3]) + ":" + m[2]) &&
            owners.get(norm(m[3]) + ":" + m[2])?.size === 1
          );
        });
        const status =
          matches.length === 1 && Object.hasOwn(statuses, matches[0].status)
            ? matches[0].status
            : "unknown";
        if (matches.length === 1) identified++;
        statuses[status] += p.count;
      }
      features[metric] = {
        coverage: total > 0 ? "observed_participation" : "unknown",
        games: recent.length,
        total,
        identifiedAthletes: identified,
        observedAthletes: players.size,
        unattributedCount: unattributed,
        shares:
          total > 0
            ? Object.fromEntries(
                Object.entries(statuses).map(([k, v]) => [k, v / total]),
              )
            : null,
      };
    }
    return {
      teamId,
      features,
      usageSources: recent.map((g) => ({
        eventId: g.eventId,
        sha256: g.sha256,
        receivedAt: g.receivedAt,
      })),
    };
  });
  if (new Set(sides.map((s) => s.teamId)).size !== 2)
    throw Error("context_duplicate_team");
  return {
    version: 1,
    featureVersion: "ncaaf-participation-availability-v2",
    datasetRole: "development_only",
    researchOnly: true,
    target: {
      season: target.season,
      eventId: target.eventId,
      homeId: target.homeId,
      awayId: target.awayId,
      kickoff: target.kickoff,
      neutralSite:
        typeof target.neutralSite === "boolean" ? target.neutralSite : null,
      venueSourceSha256: target.scoreboardSha256 ?? null,
    },
    availabilityObservedAt: binding.observedAt,
    availabilityPublishedAt: binding.publishedAt,
    sides,
    limitations: [
      "participation_is_not_snap_count_or_targets",
      "no_inferred_starter_or_player_impact",
      "unmatched_and_exempt_remain_unknown",
      "no_automatic_model_fit_or_release",
    ],
    productionReady: false,
    releaseEligible: false,
  };
}
export function outcomeFromSettlement(context, settlement, now) {
  const t = context.target,
    source = settlement?.source;
  if (
    context.datasetRole !== "development_only" ||
    !source ||
    !Number.isFinite(Date.parse(now)) ||
    !Number.isFinite(Date.parse(context.recordedAt)) ||
    !Number.isFinite(Date.parse(context.capturedAt)) ||
    Date.parse(context.capturedAt) > Date.parse(context.recordedAt) ||
    Date.parse(context.recordedAt) >= Date.parse(t.kickoff) ||
    !Number.isFinite(Date.parse(source.receivedAt)) ||
    Date.parse(source.receivedAt) < Date.parse(t.kickoff) ||
    Date.parse(source.receivedAt) > Date.parse(now) ||
    sha(source.rawResponse) !== source.sha256
  )
    throw Error("context_invalid_final_evidence");
  const normalized = summaryHistory(
    source.rawResponse,
    t.eventId,
    t.season,
    source.requestStartedAt,
    source.receivedAt,
  );
  const o = normalized.games[0],
    saved = settlement.outcome;
  if (
    normalized.games.length !== 1 ||
    o.homeId !== t.homeId ||
    o.awayId !== t.awayId ||
    Date.parse(o.kickoff) !== Date.parse(t.kickoff) ||
    !saved ||
    ["eventId", "season", "homeId", "awayId", "homePoints", "awayPoints"].some(
      (k) => saved[k] !== o[k],
    )
  )
    throw Error("context_final_identity_mismatch");
  return {
    datasetRole: "development_only",
    researchOnly: true,
    outcome: o,
    sourceSha256: source.sha256,
    sourceReceivedAt: source.receivedAt,
    releaseEligible: false,
  };
}
export function selectUsageArchives(summaries, target, cutoff) {
  if (!Number.isFinite(Date.parse(cutoff)))
    throw Error("context_invalid_cutoff");
  const chosen = new Map();
  for (const id of [target.homeId, target.awayId]) {
    const candidates = summaries
      .filter(
        (r) =>
          Array.isArray(r.games) &&
          r.games.length === 1 &&
          r.games[0].season === target.season &&
          r.games[0].eventId !== target.eventId &&
          [r.games[0].homeId, r.games[0].awayId].includes(id) &&
          Date.parse(r.received_at) <= Date.parse(cutoff) &&
          Date.parse(r.games[0].kickoff) < Date.parse(cutoff),
      )
      .sort(
        (x, y) =>
          Date.parse(y.games[0].kickoff) - Date.parse(x.games[0].kickoff) ||
          Date.parse(x.received_at) - Date.parse(y.received_at) ||
          (x.key < y.key ? -1 : x.key > y.key ? 1 : 0),
      );
    const ids = new Set();
    for (const r of candidates) {
      if (ids.has(r.games[0].eventId)) continue;
      ids.add(r.games[0].eventId);
      const old = chosen.get(r.games[0].eventId);
      if (!old || Date.parse(r.received_at) < Date.parse(old.received_at))
        chosen.set(r.games[0].eventId, r);
      if (ids.size === 5) break;
    }
  }

  return [...chosen.values()];
}
async function main() {
  const labelsOnly = process.argv.includes("--labels-only");
  if (!process.argv.includes("--execute")) {
    console.log(
      JSON.stringify({
        planOnly: true,
        mode: labelsOnly ? "labels_only" : "assembly_and_labels",
        providerRequests: 0,
        maximumTargets: 128,
        maximumUsageArchivesPerTarget: 10,
        role: "development_only",
        automaticUnlock: false,
      }),
    );
    return;
  }
  if (!process.env.DATABASE_URL) throw Error("context_database_missing");
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
      throw Error("context_unexpected_database");
    if (
      !(await db.query("SELECT pg_try_advisory_lock(64233,20261101) AS ok"))
        .rows[0].ok
    )
      throw Error("context_overlap");
    const archiveRows = labelsOnly
      ? []
      : (
          await db.query(
            "SELECT DISTINCT ON (value->>'conference') key,value FROM public.app_kv WHERE key LIKE 'research:ncaaf:conference-availability-v2:%' ORDER BY value->>'conference',key DESC",
          )
        ).rows;
    const live = labelsOnly
      ? null
      : (
          await db.query(
            "SELECT key,value FROM public.app_kv WHERE key LIKE 'research:ncaaf:live-inputs:%' ORDER BY key DESC LIMIT 1",
          )
        ).rows[0];
    const summaries = labelsOnly
      ? []
      : (
          await db.query(
            "SELECT key,value->'games' AS games,value->>'receivedAt' AS received_at FROM public.app_kv WHERE key LIKE 'research:ncaaf:game-summary:2026:%'",
          )
        ).rows;
    const blockers = {};
    const fail = (error) => {
      const m = error instanceof Error ? error.message : "";
      const reason = /^(context|conference|repair|history)_[a-z_]+$/.test(m)
        ? m
        : "dataset_input_or_storage_failed";
      blockers[reason] = (blockers[reason] ?? 0) + 1;
    };
    let recorded = 0,
      existing = 0,
      withheld = 0;
    const seen = new Set();
    for (const a of archiveRows) {
      const now = new Date(
        (await db.query("SELECT clock_timestamp() AS now")).rows[0].now,
      ).toISOString();
      let bindings;
      try {
        bindings = bindConferenceReports(a.value, live?.value, now);
      } catch (error) {
        fail(error);
        withheld++;
        continue;
      }
      for (const b of bindings.filter((x) => x.eventBindingVerified)) {
        if (seen.has(b.target.eventId)) continue;
        seen.add(b.target.eventId);
        if (seen.size > 128) throw Error("context_target_budget");
        const key = `research:ncaaf:context-input:v2:2026:${b.target.eventId}`;
        if (
          (await db.query("SELECT key FROM public.app_kv WHERE key=$1", [key]))
            .rowCount
        ) {
          existing++;
          continue;
        }
        try {
          const chosen = selectUsageArchives(summaries, b.target, now);
          const usage = [];
          for (const r of chosen) {
            const capture = (
              await db.query("SELECT value FROM public.app_kv WHERE key=$1", [
                r.key,
              ])
            ).rows[0].value;
            const parsed = usageFromSummary(capture, b.target, now);
            if (
              parsed.eventId !== r.games[0].eventId ||
              Date.parse(parsed.kickoff) !== Date.parse(r.games[0].kickoff)
            )
              throw Error("context_usage_metadata_mismatch");
            parsed.archiveKey = r.key;
            usage.push(parsed);
          }
          const record = contextFeatures(b, usage, now);
          const candidate = (
            await db.query("SELECT value FROM public.app_kv WHERE key=$1", [
              "research:ncaaf:context-model:first:v1",
            ])
          ).rows[0]?.value;
          if (
            candidate?.state === "frozen_research_candidate" &&
            /^[a-f0-9]{64}$/.test(candidate.modelSha256) &&
            Number.isFinite(Date.parse(candidate.registeredAt)) &&
            Date.parse(candidate.registeredAt) <= Date.parse(now)
          ) {
            record.datasetRole = "holdout_context";
            record.holdoutModelSha256 = candidate.modelSha256;
            record.holdoutProtocolSha256 = candidate.protocolSha256;
          }
          const history = (
            await db.query(
              "SELECT key,value FROM public.app_kv WHERE key LIKE 'research:ncaaf:history-summary:2026:%' ORDER BY key DESC LIMIT 1",
            )
          ).rows[0];
          if (!history || !Array.isArray(history.value.games))
            throw Error("context_history_missing");
          const priorIds = history.value.games
            .filter(
              (g) =>
                g.season === b.target.season &&
                g.eventId !== b.target.eventId &&
                Number.isFinite(Date.parse(g.observedAt)) &&
                Date.parse(g.observedAt) <= Date.parse(now) &&
                Number.isFinite(Date.parse(g.completedAt)) &&
                Date.parse(g.completedAt) < Date.parse(now),
            )
            .map((g) => g.eventId);

          Object.assign(record, {
            capturedAt: now,
            historySourceEvidence: {
              key: history.key,
              sha256: sha(canonical(history.value)),
              priorEventIds: [...new Set(priorIds)],
            },
            availabilityArchiveKey: a.key,
            availabilitySourceHashes: b.sourceHashes,
            liveArchiveKey: live.key,
            usageArchiveKeys: usage.map((g) => g.archiveKey),
          });
          const saved = await db.query(
            "INSERT INTO public.app_kv(key,value) SELECT $1,$2::jsonb || jsonb_build_object('recordedAt',clock_timestamp()) WHERE clock_timestamp() < $3::timestamptz ON CONFLICT(key) DO NOTHING RETURNING key",
            [key, JSON.stringify(record), b.target.kickoff],
          );
          if (saved.rowCount) recorded++;
          else withheld++;
        } catch (error) {
          fail(error);
          withheld++;
        }
      }
    }
    // Labels may arrive later; they never overwrite the frozen pregame input.
    const priorStatus = (
      await db.query("SELECT value FROM public.app_kv WHERE key=$1", [
        labelsOnly
          ? "research:ncaaf:context-labels:latest"
          : "research:ncaaf:context-dataset:latest",
      ])
    ).rows[0]?.value;
    let labelCursor =
      typeof priorStatus?.labelCursor === "string"
        ? priorStatus.labelCursor
        : "";
    const pendingQuery =
      "SELECT i.key,i.value FROM public.app_kv i LEFT JOIN public.app_kv o ON o.key=replace(i.key,'context-input:','context-outcome:') WHERE (i.key LIKE 'research:ncaaf:context-input:v1:2026:%' OR i.key LIKE 'research:ncaaf:context-input:v2:2026:%') AND i.value->>'datasetRole'='development_only' AND o.key IS NULL AND i.key > $1 ORDER BY i.key LIMIT 128";
    let inputs = (await db.query(pendingQuery, [labelCursor])).rows;
    if (!inputs.length && labelCursor)
      inputs = (await db.query(pendingQuery, [""])).rows;
    let outcomesRecorded = 0,
      outcomesPresent = 0,
      pendingOutcomes = 0;
    for (const input of inputs) {
      labelCursor = input.key;
      const labelKey = input.key.replace("context-input:", "context-outcome:");
      if (
        (
          await db.query("SELECT key FROM public.app_kv WHERE key=$1", [
            labelKey,
          ])
        ).rowCount
      ) {
        outcomesPresent++;
        continue;
      }
      const t = input.value.target;
      const settled = (
        await db.query(
          "SELECT key,value FROM public.app_kv WHERE key LIKE 'research:ncaaf:settlement:%' AND value->'outcome'->>'eventId'=$1 AND value->'outcome'->>'season'=$2 ORDER BY key LIMIT 1",
          [t.eventId, String(t.season)],
        )
      ).rows[0];
      if (!settled) {
        pendingOutcomes++;
        continue;
      }
      try {
        const now = new Date(
          (await db.query("SELECT clock_timestamp() AS now")).rows[0].now,
        ).toISOString();
        const label = outcomeFromSettlement(input.value, settled.value, now);
        Object.assign(label, {
          inputKey: input.key,
          inputSha256: sha(canonical(input.value)),
          settlementKey: settled.key,
          observedAt: now,
        });
        const inserted = await db.query(
          "INSERT INTO public.app_kv(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO NOTHING RETURNING key",
          [labelKey, JSON.stringify(label)],
        );
        if (inserted.rowCount) outcomesRecorded++;
        else outcomesPresent++;
      } catch (error) {
        fail(error);
        pendingOutcomes++;
      }
    }
    const uniqueDevelopmentEvents = Number(
      (
        await db.query(
          "SELECT count(DISTINCT value->'target'->>'eventId') AS events FROM public.app_kv WHERE (key LIKE 'research:ncaaf:context-input:v1:2026:%' OR key LIKE 'research:ncaaf:context-input:v2:2026:%') AND value->>'datasetRole'='development_only'",
        )
      ).rows[0].events,
    );
    const result = {
      researchOnly: true,
      state: "processed",
      mode: labelsOnly ? "labels_only" : "assembly_and_labels",
      inputsRecorded: recorded,
      featureVersion: "ncaaf-participation-availability-v2",
      uniqueDevelopmentEvents,
      blockers,
      outcomesRecorded,
      labelCursor,
      outcomesAlreadyPresent: outcomesPresent,
      pendingOutcomes,
      inputsAlreadyPresent: existing,
      withheld,
      providerRequests: 0,
      modelFit: "not_run_pending_completed_development_records",
      holdoutEligible: false,
      releaseEligible: false,
      finishedAt: new Date().toISOString(),
    };
    await db.query(
      "INSERT INTO public.app_kv(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()",
      [
        labelsOnly
          ? "research:ncaaf:context-labels:latest"
          : "research:ncaaf:context-dataset:latest",
        JSON.stringify(result),
      ],
    );
    console.log(JSON.stringify(result));
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
      "NCAAF context assembly failed; forecasts and release unchanged.",
    );
    process.exitCode = 1;
  });
