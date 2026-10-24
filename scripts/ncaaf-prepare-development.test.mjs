import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  authenticateDevelopmentExample,
  prepareDevelopmentDataset,
} from "./ncaaf-prepare-development.mjs";
import { outcomeFromSettlement } from "./ncaaf-context-dataset.mjs";
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
const hash = (x) =>
  createHash("sha256")
    .update(JSON.stringify(sort(x)))
    .digest("hex");
function fixture() {
  const now = "2026-10-24T22:00:00Z",
    t = {
      season: 2026,
      eventId: "999",
      homeId: "1",
      awayId: "2",
      kickoff: "2026-10-24T16:00:00Z",
      neutralSite: false,
    };
  const inputKey = "research:ncaaf:context-input:v2:2026:999";
  const history = {
    key: "research:ncaaf:history-summary:2026:fixture",
    value: {
      games: [
        {
          eventId: "10",
          season: 2026,
          completedAt: "2026-10-01T20:00:00Z",
          observedAt: "2026-10-02T00:00:00Z",
        },
      ],
    },
  };
  const shares = {
    available: 0.6,
    out: 0.2,
    unknown: 0.2,
    probable: 0,
    questionable: 0,
    doubtful: 0,
    game_time_decision: 0,
  };
  const family = { coverage: "observed_participation", games: 3, shares };
  const input = {
    target: t,
    featureVersion: "ncaaf-participation-availability-v2",
    datasetRole: "development_only",
    capturedAt: "2026-10-24T03:00:00Z",
    recordedAt: "2026-10-24T03:00:01Z",
    sides: ["1", "2"].map((teamId) => ({
      teamId,
      features: {
        passingAttempts: family,
        carries: family,
        receptions: family,
      },
    })),
    historySourceEvidence: {
      key: history.key,
      sha256: hash(history.value),
      priorEventIds: ["10"],
    },
  };
  const rawResponse = JSON.stringify({
    header: {
      id: "999",
      season: { year: 2026 },
      league: { slug: "college-football" },
      competitions: [
        {
          date: t.kickoff,
          status: { type: { completed: true, state: "post" } },
          competitors: [
            {
              homeAway: "home",
              team: { id: "1" },
              score: "28",
              linescores: [
                { displayValue: "7" },
                { displayValue: "7" },
                { displayValue: "7" },
                { displayValue: "7" },
              ],
            },
            {
              homeAway: "away",
              team: { id: "2" },
              score: "21",
              linescores: [
                { displayValue: "7" },
                { displayValue: "7" },
                { displayValue: "7" },
                { displayValue: "0" },
              ],
            },
          ],
        },
      ],
    },
  });
  const source = {
    rawResponse,
    sha256: createHash("sha256").update(rawResponse).digest("hex"),
    requestStartedAt: "2026-10-24T21:00:00Z",
    receivedAt: "2026-10-24T21:00:01Z",
  };
  const settlement = {
    key: "research:ncaaf:settlement:fixture:2026:999",
    value: {
      source,
      outcome: {
        eventId: "999",
        season: 2026,
        homeId: "1",
        awayId: "2",
        homePoints: 28,
        awayPoints: 21,
      },
    },
  };
  const label = {
    ...outcomeFromSettlement(input, settlement.value, now),
    inputKey,
    inputSha256: hash(input),
    settlementKey: settlement.key,
    observedAt: now,
  };
  return { inputKey, input, label, settlement, history, now };
}
test("only exact frozen input, final and past history form a development example", () => {
  const f = fixture(),
    x = authenticateDevelopmentExample(
      f.inputKey,
      f.input,
      f.label,
      f.settlement,
      f.history,
      f.now,
    );
  assert.equal(x.featureComplete, true);
  assert.equal(x.datasetRole, "development_only");
  assert.ok(!JSON.stringify(x).includes("rawResponse"));
  for (const change of [
    (f) => {
      f.input.sides[0].features.passingAttempts.shares.out = 0.9;
    },
    (f) => {
      f.label.inputSha256 = "bad";
    },
    (f) => {
      f.settlement.value.source.sha256 = "bad";
    },
    (f) => {
      f.history.value.games[0].observedAt = "2026-10-25T00:00:00Z";
    },
  ]) {
    const g = fixture();
    change(g);
    assert.throws(() =>
      authenticateDevelopmentExample(
        g.inputKey,
        g.input,
        g.label,
        g.settlement,
        g.history,
        g.now,
      ),
    );
  }
});
test("unknown features stay unknown and uncompleted inputs never create training examples", async () => {
  const f = fixture();
  f.input.sides[0].features.carries = {
    coverage: "unknown",
    games: 1,
    shares: null,
  };
  f.label.inputSha256 = hash(f.input);
  const example = authenticateDevelopmentExample(
    f.inputKey,
    f.input,
    f.label,
    f.settlement,
    f.history,
    f.now,
  );
  assert.equal(example.featureComplete, false);
  assert.ok(example.missing.includes("1:carries:usage_unknown"));
  const writes = [];
  const db = {
    query: async (sql, p = []) => {
      if (sql.includes("current_database"))
        return { rows: [{ name: "stadium_edge_production" }] };
      if (sql.includes("clock_timestamp() AS now"))
        return { rows: [{ now: f.now }] };
      if (sql.startsWith("SELECT i.key"))
        return { rows: [{ key: f.inputKey, value: f.input, label: null }] };
      if (sql.startsWith("INSERT")) {
        writes.push(p);
        return { rows: [] };
      }
      throw Error("unexpected source read before final");
    },
  };
  const r = await prepareDevelopmentDataset(db);
  assert.equal(r.authenticatedDevelopmentGames, 0);
  assert.equal(r.pendingFinals, 1);
  assert.equal(r.releaseEligible, false);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], "research:ncaaf:development-dataset:latest");
});
test("label-only CLI plans no provider calls and performs no capture", () => {
  const result = JSON.parse(
    execFileSync(
      process.execPath,
      ["scripts/ncaaf-context-dataset.mjs", "--labels-only"],
      { cwd: new URL("../", import.meta.url), encoding: "utf8" },
    ),
  );
  assert.equal(result.mode, "labels_only");
  assert.equal(result.providerRequests, 0);
  assert.equal(result.planOnly, true);
});
