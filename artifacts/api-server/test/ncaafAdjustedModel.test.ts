import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  ADJUSTED_MODEL_VERSION,
  ADJUSTED_FEATURE_NAMES,
  MIN_ADJUSTED_DEVELOPMENT_GAMES,
  adjustedHash,
  fitAdjustedModel,
  predictAdjustedMeans,
  contextScoreFeatures,
  validateAdjustedModel,
  type AdjustedTrainingGame,
  type ContextFeatures,
} from "../src/lib/ncaafAdjustedModel.js";
import { freezeModelProtocol } from "../src/lib/ncaafModelProtocol.js";
import {
  prepareForwardForecast,
  scoreRecordedForecast,
} from "../src/lib/ncaafForecastJournal.js";
import {
  persistAdjustedForecast,
  fitAndFreezeContextModel,
  recordAdjustedContextForecasts,
} from "../src/lib/ncaafAdjustedModelStore.js";
import { buildNcaafResearchPreview } from "../src/lib/ncaafResearchPreview.js";
const frozenAt = "2026-10-24T00:00:00Z",
  forecastAt = "2026-10-25T10:01:00Z",
  kickoff = "2026-10-25T18:00:00Z";
function support() {
  return {
    sourceKey: "research:ncaaf:history-summary:2025:fixture",
    sourceSha256: "a".repeat(64),
    games: Array.from({ length: 30 }, (_, i) => ({
      eventId: String(5000 + i),
      season: 2025,
      homeId: "5",
      awayId: "6",
      kickoff: "2025-09-01T12:00:00Z",
      completedAt: "2025-09-01T16:00:00Z",
      observedAt: "2026-09-01T00:00:00Z",
      source: "SYNTHETIC_LOGIC_TEST_ONLY",
      ruleset: "ncaa-football-season-2025-unverified",
      homePoints: 28,
      awayPoints: 21,
      overtime: true,
      regulationHomePoints: 21,
      regulationAwayPoints: 21,
    })),
  };
}
function training() {
  return Array.from({ length: MIN_ADJUSTED_DEVELOPMENT_GAMES + 9 }, (_, i) => {
    const side = (home: boolean) => {
      const values = ADJUSTED_FEATURE_NAMES.map(() => 0);
      values[0] = 1;
      values[1] = ((i % 7) - 3) * (home ? 2 : -2);
      values[2] = home ? 0.5 : -0.5;
      values[6] = (i % 4) / 5;
      values[8] = ((i + 1) % 4) / 10;
      return { baseline: home ? 28 : 24, values };
    };
    const home = side(true),
      away = side(false);
    return {
      id: `2026:${1000 + i}`,
      inputSha256: "b".repeat(64),
      labelSha256: "c".repeat(64),
      observedAt: "2026-10-23T23:00:00Z",
      features: {
        home,
        away,
        neutralSite: false,
        historyGameIds: ["2026:10", "2026:11"],
      },
      regulationHome: Math.round(
        home.baseline +
          home.values[1] +
          5 * home.values[2] -
          8 * home.values[6] -
          3 * home.values[8],
      ),
      regulationAway: Math.round(
        away.baseline +
          away.values[1] +
          5 * away.values[2] -
          8 * away.values[6] -
          3 * away.values[8],
      ),
    };
  }) as AdjustedTrainingGame[];
}
const meta = () => ({
  now: frozenAt,
  implementationCommit: "d".repeat(40),
  implementationSha256: "e".repeat(64),
  manifestSha256: "f".repeat(64),
  overtimeSupport: support(),
});
function candidate() {
  const f = fitAdjustedModel(training(), meta());
  assert.equal(f.state, "fitted_research_candidate");
  return { model: f.model!, modelSha256: f.modelSha256! };
}
function history() {
  return {
    games: Array.from({ length: 6 }, (_, i) => ({
      eventId: String(10 + i),
      season: 2026,
      homeId: i < 3 ? "1" : "2",
      awayId: String(100 + i),
      kickoff: `2026-09-${String(i + 1).padStart(2, "0")}T12:00:00Z`,
      completedAt: `2026-09-${String(i + 1).padStart(2, "0")}T16:00:00Z`,
      observedAt: "2026-10-01T00:00:00Z",
      source: "SYNTHETIC_LOGIC_TEST_ONLY",
      ruleset: "ncaa-football-season-2026-unverified",
      homePoints: i < 3 ? 28 : 24,
      awayPoints: 21,
      overtime: false,
      regulationHomePoints: i < 3 ? 28 : 24,
      regulationAwayPoints: 21,
    })),
  };
}
function context(h = history()): ContextFeatures {
  const shares = {
    available: 1,
    probable: 0,
    questionable: 0,
    doubtful: 0,
    out: 0,
    game_time_decision: 0,
    unknown: 0,
  };
  return {
    featureVersion: "ncaaf-participation-availability-v2",
    datasetRole: "holdout_context",
    target: {
      eventId: "999",
      season: 2026,
      homeId: "1",
      awayId: "2",
      kickoff,
      neutralSite: false,
    },
    capturedAt: "2026-10-25T10:00:00Z",
    recordedAt: "2026-10-25T10:00:01Z",
    availabilityObservedAt: "2026-10-25T09:00:00Z",
    historySourceEvidence: {
      sha256: adjustedHash(h),
      priorEventIds: h.games.map((g) => g.eventId),
    },
    sides: ["1", "2"].map((teamId) => ({
      teamId,
      features: Object.fromEntries(
        ["passingAttempts", "carries", "receptions"].map((f) => [
          f,
          {
            coverage: "observed_participation",
            games: 3,
            shares: {
              ...shares,
              ...(f === "passingAttempts"
                ? { available: 0.5, out: 0.3, unknown: 0.2 }
                : {}),
            },
          },
        ]),
      ),
    })),
  };
}
function forecast() {
  const c = candidate(),
    h = history(),
    ctx = context(h),
    p = freezeModelProtocol(
      {
        version: 1,
        modelSha256: c.modelSha256,
        frozenAt,
        trainingGameIds: c.model.excludedGameIds,
        featureVersion: ctx.featureVersion,
        implementationCommit: c.model.implementationCommit,
        simulations: 10000,
        markets: ["ml", "spread", "total"],
        settlement: "full_game_including_overtime",
        minimumIndependentGames: 500,
        minimumSeasons: 2,
      },
      frozenAt,
    );
  Object.assign(ctx, {
    holdoutModelSha256: c.modelSha256,
    holdoutProtocolSha256: p.protocolSha256,
  });
  const raw = JSON.stringify({ injuries: [] });
  const input = {
    version: 1 as const,
    target: { ...ctx.target, ruleset: "ncaa-football-season-2026-unverified" },
    games: h.games,
    quotes: [
      {
        season: 2026,
        eventId: "999",
        bookmaker: "SYNTHETIC_BOOK",
        market: "spread" as const,
        line: -3,
        firstPrice: -110,
        secondPrice: -110,
        observedAt: forecastAt,
        settlement: "full_game_including_overtime" as const,
      },
    ],
    injuryEvidence: {
      key: "research:ncaaf:injuries:fixture",
      observedAt: forecastAt,
      rawResponse: raw,
      sha256: createHash("sha256").update(raw).digest("hex"),
      absentTeamStatus: "unknown" as const,
    },
    overtimeSupport: c.model.overtimeSupport,
    adjustedEvidence: {
      ...c,
      protocol: p.protocol,
      protocolSha256: p.protocolSha256,
      protocolRecordedAt: p.recordedAt,
      context: ctx,
      historyArchive: h,
    },
  };
  return prepareForwardForecast(input, forecastAt);
}
test("fitted score adjustments are deterministic, content-addressed and remain unvalidated", () => {
  const a = candidate(),
    b = fitAdjustedModel([...training()].reverse(), meta());
  assert.equal(a.modelSha256, b.modelSha256);
  assert.equal(a.model.productionReady, false);
  assert.equal(a.model.validationReady, false);
  assert.ok(a.model.coefficients[6] < 0);
  assert.ok(a.model.excludedGameIds.includes("2025:5000"));
  const features = training()[0].features;
  const before = predictAdjustedMeans(a.model, a.modelSha256, features);
  const after = structuredClone(features);
  after.home.values[6] = 0.6;
  assert.ok(
    predictAdjustedMeans(a.model, a.modelSha256, after).home < before.home,
  );
  const mutated = structuredClone(a.model);
  mutated.coefficients[0]++;
  assert.throws(() => validateAdjustedModel(mutated, a.modelSha256));
});
test("insufficient development data, unidentifiable signals, unknown families and unsupported inputs withhold", () => {
  assert.equal(
    fitAdjustedModel(training().slice(0, 16), meta()).state,
    "waiting_for_more_development_games",
  );
  const noSignals = training();
  for (const g of noSignals) {
    g.features.home.values[6] = 0;
    g.features.away.values[6] = 0;
  }
  assert.equal(
    fitAdjustedModel(noSignals, meta()).state,
    "waiting_for_signal_variation",
  );
  const a = candidate(),
    feature = structuredClone(training()[0].features);
  feature.home.values[8] = 1;
  assert.throws(() => predictAdjustedMeans(a.model, a.modelSha256, feature));
  const c = context();
  c.sides[0].features.carries.shares = null;
  assert.throws(() => contextScoreFeatures(c, history()));
  const targetLeak = history();
  targetLeak.games[0].eventId = "999";
  const ctx = context(targetLeak);
  assert.throws(() => contextScoreFeatures(ctx, targetLeak));
  const neutral = training()[0].features;
  neutral.neutralSite = true;
  assert.throws(() => predictAdjustedMeans(a.model, a.modelSha256, neutral));
});
test("new journal freezes genuine pregame predictions separately and scores exact pushes without rerunning", () => {
  const r = forecast(),
    before = JSON.stringify(r);
  assert.ok(r.modelVersion.startsWith(ADJUSTED_MODEL_VERSION + ":"));
  assert.equal(r.datasetRole, "independent_holdout");
  assert.equal(r.simulations, 10000);
  assert.equal(r.validationReady, false);
  assert.deepEqual(r, prepareForwardForecast(r.input, forecastAt));
  const outcome = {
    ...history().games[0],
    eventId: "999",
    homeId: "1",
    awayId: "2",
    kickoff,
    completedAt: "2026-10-25T22:00:00Z",
    observedAt: "2026-10-25T22:01:00Z",
    homePoints: 24,
    awayPoints: 21,
    regulationHomePoints: 24,
    regulationAwayPoints: 21,
  };
  const scored = scoreRecordedForecast(
    { ...r, recordedAt: "2026-10-25T10:01:01Z" },
    outcome,
  );
  assert.equal(scored[0].result, "push");
  assert.equal(scored[0].modelBrier, null);
  assert.equal(scored[0].marketBrier, null);
  const changedLine = structuredClone(r);
  changedLine.markets[0].line = -2.5;
  assert.throws(
    () =>
      scoreRecordedForecast(
        { ...changedLine, recordedAt: "2026-10-25T10:01:01Z" },
        outcome,
      ),
    /quote_binding_changed/,
  );

  assert.equal(JSON.stringify(r), before);
  const row = {
    key: `research:ncaaf:forecast:${r.modelVersion}:2026:999`,
    value: { ...r, recordedAt: "2026-10-25T10:01:01Z" },
  };
  const preview = buildNcaafResearchPreview(
    [row],
    new Map(),
    forecastAt.replace("10:01:", "10:02:"),
  );
  assert.equal(preview.distinctGames, 1);
  assert.equal(preview.games[0].adjustedResearchModel, true);
  assert.equal(preview.coachEnabled, false);
  const bad = structuredClone(r.input);
  bad.adjustedEvidence.context.datasetRole = "development_only";
  assert.throws(() => prepareForwardForecast(bad, forecastAt));
  const badTime = structuredClone(r.input);
  badTime.adjustedEvidence.context.capturedAt = "invalid";
  assert.throws(() => prepareForwardForecast(badTime, forecastAt));
  const changed = structuredClone(r.input);
  changed.adjustedEvidence.model.coefficients[0]++;
  assert.throws(() => prepareForwardForecast(changed, forecastAt));
});
test("journal writes are immutable and the database clock prevents kickoff-crossing inserts", async () => {
  const r = forecast(),
    store = new Map<string, any>();
  let now = "2026-10-25T10:01:01Z";
  const db = {
    query: async (sql: string, p: unknown[] = []) => {
      if (sql.startsWith("INSERT")) {
        const key = String(p[0]);
        if (store.has(key) || Date.parse(now) >= Date.parse(String(p[2])))
          return { rows: [], rowCount: 0 };
        store.set(key, { ...JSON.parse(String(p[1])), recordedAt: now });
        return { rows: [{ key }], rowCount: 1 };
      }
      if (sql.startsWith("SELECT value"))
        return {
          rows: store.has(String(p[0]))
            ? [{ value: store.get(String(p[0])) }]
            : [],
        };
      throw Error("unexpected query");
    },
  };
  assert.equal(await persistAdjustedForecast(db, r), "recorded");
  const old = JSON.stringify([...store]);
  assert.equal(await persistAdjustedForecast(db, r), "existing");
  assert.equal(JSON.stringify([...store]), old);
  store.clear();
  now = kickoff;
  await assert.rejects(() => persistAdjustedForecast(db, r), /kickoff_crossed/);
});
test("production jobs wait for authentic development evidence and a frozen candidate without creating predictions", async () => {
  const writes: string[] = [];
  const db = {
    query: async (sql: string, p: unknown[] = []) => {
      if (sql.includes("current_database"))
        return { rows: [{ name: "stadium_edge_production" }] };
      if (sql.includes("pg_try_advisory_lock"))
        return { rows: [{ acquired: true }] };
      if (sql.includes("pg_advisory_unlock")) return { rows: [] };
      if (sql.includes("clock_timestamp() AS now"))
        return { rows: [{ now: frozenAt }] };
      if (sql.startsWith("SELECT key,value")) return { rows: [] };
      if (sql.startsWith("INSERT")) {
        writes.push(String(p[0]));
        return { rows: [] };
      }
      throw Error("unexpected model/source read before eligible data");
    },
  };
  assert.equal(
    (await fitAndFreezeContextModel(db, "/unused")).state,
    "waiting_for_verified_development_finals",
  );
  assert.equal(
    (await recordAdjustedContextForecasts(db, "/unused")).state,
    "waiting_for_frozen_model",
  );
  assert.deepEqual(writes, [
    "research:ncaaf:adjusted-model:latest",
    "research:ncaaf:adjusted-journal:latest",
  ]);
});

test("learned availability adjustments reach the actual 10000-draw market distribution", () => {
  const first = forecast(),
    lower = structuredClone(first.input),
    higher = structuredClone(first.input);
  Object.assign(
    lower.adjustedEvidence.context.sides[0].features.passingAttempts.shares!,
    { available: 0.7, out: 0.1, unknown: 0.2 },
  );
  Object.assign(
    higher.adjustedEvidence.context.sides[0].features.passingAttempts.shares!,
    { available: 0.2, out: 0.6, unknown: 0.2 },
  );
  const a = prepareForwardForecast(lower, forecastAt),
    b = prepareForwardForecast(higher, forecastAt);
  assert.equal(a.simulations, 10000);
  assert.equal(b.simulations, 10000);
  assert.ok(a.homeMean > b.homeMean);
  assert.ok(
    a.markets[0].conditionalWinProbability! >
      b.markets[0].conditionalWinProbability! + 0.02,
  );
  assert.equal(a.productionReady, false);
  assert.equal(b.validationReady, false);
});

test("a frozen first candidate is preserved without refitting on newly available data", async () => {
  const c = candidate(),
    sealed = freezeModelProtocol(
      {
        version: 1,
        modelSha256: c.modelSha256,
        frozenAt,
        trainingGameIds: c.model.excludedGameIds,
        featureVersion: "ncaaf-participation-availability-v2",
        implementationCommit: c.model.implementationCommit,
        simulations: 10000,
        markets: ["ml", "spread", "total"],
        settlement: "full_game_including_overtime",
        minimumIndependentGames: 500,
        minimumSeasons: 2,
      },
      frozenAt,
    );
  const pointer = {
    state: "frozen_research_candidate",
    modelKey: `research:ncaaf:context-model:artifact:${c.modelSha256}`,
    modelSha256: c.modelSha256,
    protocol: sealed.protocol,
    protocolSha256: sealed.protocolSha256,
    protocolRecordedAt: sealed.recordedAt,
    registeredAt: "2026-10-24T00:00:00.001Z",
  };
  const before = JSON.stringify(c.model),
    writes: string[] = [];
  const db = {
    query: async (sql: string, p: unknown[] = []) => {
      if (sql.includes("current_database"))
        return { rows: [{ name: "stadium_edge_production" }] };
      if (sql.includes("pg_try_advisory_lock"))
        return { rows: [{ acquired: true }] };
      if (sql.includes("pg_advisory_unlock")) return { rows: [] };
      if (sql.includes("clock_timestamp() AS now"))
        return { rows: [{ now: forecastAt }] };
      if (sql.startsWith("SELECT key,value")) {
        const key = String(p[0]);
        if (key === "research:ncaaf:context-model:first:v1")
          return { rows: [{ key, value: pointer }] };
        if (key === pointer.modelKey)
          return { rows: [{ key, value: c.model }] };
        throw Error("must not read new training outcomes after freeze");
      }
      if (sql.startsWith("INSERT")) {
        writes.push(String(p[0]));
        return { rows: [] };
      }
      throw Error("unexpected frozen model operation");
    },
  };
  const result = await fitAndFreezeContextModel(db, "/unused");
  assert.equal(result.state, "frozen_candidate_preserved");
  assert.equal(JSON.stringify(c.model), before);
  assert.deepEqual(writes, ["research:ncaaf:adjusted-model:latest"]);
});
