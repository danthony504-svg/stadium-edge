/**
 * Authenticate NCAAB development examples from live-input archives + ESPN finals.
 * Never fits a model, never invents injuries/usage, never enables Coach.
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ncaabSummaryFinal } from "./ncaab-bind-final-summary.mjs";

const FEATURE_VERSION = "ncaab-odds-score-features-v1";
const BOOK_PRIORITY = [
  "fanduel",
  "draftkings",
  "betmgm",
  "betrivers",
  "caesars",
  "williamhill_us",
  "fanatics",
];

const sort = (x) =>
  Array.isArray(x)
    ? x.map(sort)
    : x && typeof x === "object"
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, sort(x[k])]),
        )
      : x;
export const canonical = (x) => JSON.stringify(sort(x));
export const hash = (x) =>
  createHash("sha256").update(canonical(x)).digest("hex");

function americanImplied(price) {
  if (!Number.isFinite(price) || Math.abs(price) < 100)
    throw Error("ncaab_dev_invalid_price");
  return price < 0 ? -price / (-price + 100) : 100 / (price + 100);
}

export function normalizeTeamName(name) {
  return String(name ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Exact full-name opposing rows only — no mascot/substring matching. */
export function pairOpposingQuotes(rows, homeName, awayName) {
  const homeNorm = normalizeTeamName(homeName);
  const awayNorm = normalizeTeamName(awayName);
  if (!homeNorm || !awayNorm || homeNorm === awayNorm) return null;
  const homes = (rows ?? []).filter(
    (r) => normalizeTeamName(String(r.name ?? "")) === homeNorm,
  );
  const aways = (rows ?? []).filter(
    (r) => normalizeTeamName(String(r.name ?? "")) === awayNorm,
  );
  if (homes.length !== 1 || aways.length !== 1 || homes[0] === aways[0])
    return null;
  return { home: homes[0], away: aways[0] };
}

export function selectPrimaryQuotes(quotes, homeName, awayName) {
  const byBookMarket = new Map();
  for (const q of quotes ?? []) {
    if (!q?.book || !["h2h", "spreads", "totals"].includes(q.market)) continue;
    if (!Number.isFinite(q.price) || Math.abs(q.price) < 100) continue;
    const key = `${q.book}:${q.market}`;
    const list = byBookMarket.get(key) ?? [];
    list.push(q);
    byBookMarket.set(key, list);
  }
  const books = [
    ...new Set([...byBookMarket.keys()].map((k) => k.split(":")[0])),
  ].sort((a, b) => {
    const ia = BOOK_PRIORITY.indexOf(a);
    const ib = BOOK_PRIORITY.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  const pick = (market) => {
    for (const book of books) {
      const rows = byBookMarket.get(`${book}:${market}`) ?? [];
      if (market === "totals") {
        const overs = rows.filter((r) =>
          /^over$/i.test(String(r.name ?? "").trim()),
        );
        const unders = rows.filter((r) =>
          /^under$/i.test(String(r.name ?? "").trim()),
        );
        if (
          overs.length === 1 &&
          unders.length === 1 &&
          Number.isFinite(overs[0].point) &&
          overs[0].point === unders[0].point
        )
          return {
            bookmaker: book,
            market: "total",
            line: overs[0].point,
            firstPrice: overs[0].price,
            secondPrice: unders[0].price,
            observedAt: overs[0].sourceUpdatedAt,
          };
        continue;
      }
      const paired = pairOpposingQuotes(rows, homeName, awayName);
      if (!paired) continue;
      if (market === "spreads") {
        if (
          !Number.isFinite(paired.home.point) ||
          !Number.isFinite(paired.away.point) ||
          Math.abs(paired.home.point + paired.away.point) > 1e-9
        )
          continue;
        return {
          bookmaker: book,
          market: "spread",
          line: paired.home.point,
          firstPrice: paired.home.price,
          secondPrice: paired.away.price,
          observedAt: paired.home.sourceUpdatedAt,
        };
      }
      return {
        bookmaker: book,
        market: "ml",
        line: null,
        firstPrice: paired.home.price,
        secondPrice: paired.away.price,
        observedAt: paired.home.sourceUpdatedAt,
      };
    }
    return null;
  };
  return { ml: pick("h2h"), spread: pick("spreads"), total: pick("totals") };
}

export function buildOddsFeatures(primary, venue) {
  const missing = [];
  if (!primary.ml) missing.push("ml_pair_missing");
  if (!primary.spread) missing.push("spread_pair_missing");
  if (!primary.total) missing.push("total_pair_missing");
  const neutralSite =
    typeof venue?.neutralSite === "boolean" ? venue.neutralSite : null;
  if (missing.length) return { missing, features: null, neutralSite };
  const L = primary.spread.line;
  const T = primary.total.line;
  const homeBaseline = (T - L) / 2;
  const awayBaseline = (T + L) / 2;
  const homeMl = americanImplied(primary.ml.firstPrice);
  const awayMl = americanImplied(primary.ml.secondPrice);
  return {
    missing: [],
    features: {
      home: {
        baseline: homeBaseline,
        values: [
          1,
          L,
          T,
          homeMl,
          awayMl,
          primary.spread.firstPrice,
          primary.spread.secondPrice,
        ],
        historyGameIds: [],
      },
      away: {
        baseline: awayBaseline,
        values: [
          1,
          -L,
          T,
          awayMl,
          homeMl,
          primary.spread.secondPrice,
          primary.spread.firstPrice,
        ],
        historyGameIds: [],
      },
      // Preserve explicit venue evidence; never invent false when unknown.
      neutralSite,
    },
  };
}

export function buildContextInput({
  matched,
  liveArchiveKey,
  liveArchive,
  capturedAt,
}) {
  const t = matched.target;
  if (
    !t ||
    !/^\d+$/.test(t.eventId) ||
    !Number.isSafeInteger(t.season) ||
    !Number.isFinite(Date.parse(t.kickoff)) ||
    Date.parse(capturedAt) >= Date.parse(t.kickoff)
  )
    throw Error("ncaab_dev_invalid_target_or_late_capture");
  const primary = selectPrimaryQuotes(
    matched.quotes,
    matched.homeTeam,
    matched.awayTeam,
  );
  const venueEvidence =
    typeof matched.target?.neutralSite === "boolean"
      ? { neutralSite: matched.target.neutralSite }
      : typeof matched.neutralSite === "boolean"
        ? { neutralSite: matched.neutralSite }
        : { neutralSite: null };
  const { missing, features } = buildOddsFeatures(primary, venueEvidence);
  const input = {
    version: 1,
    sport: "ncaab",
    featureVersion: FEATURE_VERSION,
    datasetRole: "development_only",
    researchOnly: true,
    releaseEligible: false,
    coachEnabled: false,
    target: {
      eventId: String(t.eventId),
      season: t.season,
      homeId: String(t.homeId),
      awayId: String(t.awayId),
      kickoff: t.kickoff,
      ruleset: "full_game_including_overtime",
      homeName: matched.homeTeam,
      awayName: matched.awayTeam,
      oddsEventId: t.oddsEventId ?? null,
      // Explicit venue only — null means unknown, never coerced to false.
      neutralSite: venueEvidence.neutralSite,
    },
    capturedAt,
    liveArchiveKey,
    liveArchiveSha256: liveArchive.odds?.sha256 ?? hash(liveArchive),
    quotes: matched.quotes,
    primaryQuotes: primary,
    features,
    missing,
    featureComplete: missing.length === 0,
  };
  return input;
}

export function authenticateDevelopmentExample(
  inputKey,
  input,
  label,
  finalArchive,
  labelKey = `research:ncaab:context-outcome:v1:${input?.target?.season}:${input?.target?.eventId}`,
) {
  const t = input?.target;
  if (
    !/^research:ncaab:context-input:v1:\d{4}:\d+$/.test(inputKey) ||
    input?.datasetRole !== "development_only" ||
    input.featureVersion !== FEATURE_VERSION ||
    !t ||
    inputKey !== `research:ncaab:context-input:v1:${t.season}:${t.eventId}` ||
    label?.inputKey !== inputKey ||
    label.inputSha256 !== hash(input) ||
    label.datasetRole !== "development_only" ||
    !/^research:ncaab:context-outcome:v1:\d{4}:\d+$/.test(labelKey) ||
    labelKey !== `research:ncaab:context-outcome:v1:${t.season}:${t.eventId}`
  )
    throw Error("ncaab_dev_input_or_label_mismatch");
  const game = finalArchive?.games?.[0];
  if (
    !game ||
    game.eventId !== t.eventId ||
    game.season !== t.season ||
    game.homeId !== t.homeId ||
    game.awayId !== t.awayId ||
    Date.parse(game.kickoff) !== Date.parse(t.kickoff) ||
    canonical(label.outcome) !==
      canonical({
        homePoints: game.homePoints,
        awayPoints: game.awayPoints,
        regulationHomePoints: game.regulationHomePoints,
        regulationAwayPoints: game.regulationAwayPoints,
        overtime: game.overtime,
      }) ||
    label.sourceSha256 !== finalArchive.sha256
  )
    throw Error("ncaab_dev_final_mismatch");
  // Hash the stored label object only — never inject key into the digest.
  return {
    season: t.season,
    eventId: t.eventId,
    inputKey,
    inputSha256: label.inputSha256,
    labelKey,
    labelSha256: hash(label),
    featureComplete: input.featureComplete === true,
    kickoff: t.kickoff,
  };
}

async function fetchFinal(eventId, season) {
  const requestStartedAt = new Date().toISOString();
  const response = await fetch(
    `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event=${eventId}`,
    { signal: AbortSignal.timeout(15000), redirect: "error" },
  );
  if (!response.ok) return null;
  const rawResponse = await response.text();
  const receivedAt = new Date().toISOString();
  if (Buffer.byteLength(rawResponse) > 8_000_000) return null;
  try {
    return ncaabSummaryFinal(
      rawResponse,
      eventId,
      season,
      requestStartedAt,
      receivedAt,
    );
  } catch {
    return null;
  }
}

async function main() {
  if (!process.argv.includes("--execute")) {
    console.log(
      JSON.stringify({
        planOnly: true,
        sport: "ncaab",
        featureVersion: FEATURE_VERSION,
        releaseEligible: false,
        automaticUnlock: false,
        inventsInjuriesOrUsage: false,
      }),
    );
    return;
  }
  if (!process.env.DATABASE_URL) throw Error("ncaab_dev_database_missing");
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
    query_timeout: 30000,
  });
  await db.connect();
  try {
    if (
      (await db.query("SELECT current_database() AS name")).rows[0].name !==
      "stadium_edge_production"
    )
      throw Error("ncaab_dev_unexpected_database");
    const now = new Date(
      (await db.query("SELECT clock_timestamp() AS now")).rows[0].now,
    ).toISOString();
    // Oldest-first scan so first-write-wins stores the earliest complete capture.
    const archives = (
      await db.query(
        "SELECT key,value FROM public.app_kv WHERE key LIKE 'research:ncaab:live-inputs:%' ORDER BY key ASC LIMIT 64",
      )
    ).rows;

    // Permanently separate holdout forecasts from development examples.
    const holdoutIds = new Set(
      (
        await db.query(
          "SELECT (value->'target'->>'season')||':'||(value->'target'->>'eventId') AS id FROM public.app_kv WHERE key LIKE 'research:ncaab:forecast:%' AND value->>'datasetRole'='independent_holdout'",
        )
      ).rows.map((r) => r.id),
    );

    const earliestComplete = new Map();
    for (const archive of archives) {
      for (const matched of archive.value?.matched ?? []) {
        const t = matched.target;
        if (!t?.eventId || !Number.isSafeInteger(t.season)) continue;
        const id = `${t.season}:${t.eventId}`;
        if (holdoutIds.has(id) || earliestComplete.has(id)) continue;
        if (
          !Number.isFinite(Date.parse(t.kickoff)) ||
          Date.parse(t.kickoff) > Date.parse(now) - 4 * 3600000
        )
          continue;
        const capturedAt =
          archive.value.odds?.receivedAt ?? archive.value.observedAt;
        if (
          !Number.isFinite(Date.parse(capturedAt)) ||
          Date.parse(capturedAt) >= Date.parse(t.kickoff)
        )
          continue;
        let input;
        try {
          input = buildContextInput({
            matched,
            liveArchiveKey: archive.key,
            liveArchive: archive.value,
            capturedAt,
          });
        } catch {
          continue;
        }
        // Never burn the immutable input key with incomplete odds.
        if (!input.featureComplete) continue;
        earliestComplete.set(id, {
          matched,
          archive,
          capturedAt,
          input,
        });
        if (earliestComplete.size >= 1024) break;
      }
      if (earliestComplete.size >= 1024) break;
    }

    const examples = [];
    for (const { input, matched, archive } of earliestComplete.values()) {
      const t = matched.target;
      const inputKey = `research:ncaab:context-input:v1:${t.season}:${t.eventId}`;
      await db.query(
        "INSERT INTO public.app_kv(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO NOTHING",
        [inputKey, JSON.stringify(input)],
      );
      const storedInput = (
        await db.query("SELECT value FROM public.app_kv WHERE key=$1", [
          inputKey,
        ])
      ).rows[0]?.value;
      if (!storedInput) continue;

      const finalArchive = await fetchFinal(String(t.eventId), t.season);
      if (!finalArchive) continue;
      const game = finalArchive.games[0];
      const finalKey = `research:ncaab:settlement-final:${t.season}:${t.eventId}`;
      await db.query(
        "INSERT INTO public.app_kv(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO NOTHING",
        [finalKey, JSON.stringify(finalArchive)],
      );
      const label = {
        version: 1,
        sport: "ncaab",
        datasetRole: "development_only",
        researchOnly: true,
        releaseEligible: false,
        inputKey,
        inputSha256: hash(storedInput),
        settlementFinalKey: finalKey,
        sourceSha256: finalArchive.sha256,
        sourceReceivedAt: finalArchive.receivedAt,
        observedAt: now,
        outcome: {
          homePoints: game.homePoints,
          awayPoints: game.awayPoints,
          regulationHomePoints: game.regulationHomePoints,
          regulationAwayPoints: game.regulationAwayPoints,
          overtime: game.overtime,
        },
      };
      const labelKey = `research:ncaab:context-outcome:v1:${t.season}:${t.eventId}`;
      await db.query(
        "INSERT INTO public.app_kv(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO NOTHING",
        [labelKey, JSON.stringify(label)],
      );
      const storedLabel = (
        await db.query("SELECT value FROM public.app_kv WHERE key=$1", [
          labelKey,
        ])
      ).rows[0]?.value;
      if (!storedLabel) continue;
      try {
        examples.push(
          authenticateDevelopmentExample(
            inputKey,
            storedInput,
            storedLabel,
            finalArchive,
            labelKey,
          ),
        );
      } catch {
        continue;
      }
      if (examples.length >= 1024) break;
    }

    const manifest = {
      version: 1,
      sport: "ncaab",
      datasetRole: "development_only",
      featureVersion: FEATURE_VERSION,
      researchOnly: true,
      releaseEligible: false,
      coachEnabled: false,
      holdoutEligible: false,
      preparedAt: now,
      examples: examples.sort((a, b) =>
        `${a.season}:${a.eventId}`.localeCompare(`${b.season}:${b.eventId}`),
      ),
    };
    const manifestSha256 = hash(manifest);
    const manifestKey = `research:ncaab:development-manifest:${manifestSha256}`;
    await db.query(
      "INSERT INTO public.app_kv(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO NOTHING",
      [manifestKey, JSON.stringify(manifest)],
    );
    const status = {
      version: 1,
      sport: "ncaab",
      state: "prepared",
      manifestSha256,
      manifestKey,
      preparedAt: now,
      authenticatedDevelopmentGames: examples.length,
      featureCompleteGames: examples.filter((x) => x.featureComplete).length,
      researchOnly: true,
      releaseEligible: false,
      coachEnabled: false,
      holdoutEligible: false,
      modelFit: "handled_by_versioned_adjusted_model_stage",
    };
    await db.query(
      "INSERT INTO public.app_kv(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()",
      ["research:ncaab:development-dataset:latest", JSON.stringify(status)],
    );
    console.log(
      JSON.stringify({
        state: "processed",
        sport: "ncaab",
        manifestSha256,
        authenticatedDevelopmentGames: examples.length,
        featureCompleteGames: status.featureCompleteGames,
        releaseEligible: false,
        coachEnabled: false,
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
    console.error(err instanceof Error ? err.message : "ncaab_dev_failed");
    process.exitCode = 1;
  });
