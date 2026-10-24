import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { canonicalEvidenceJson } from "../src/lib/ncaafOvertimeTransfer.js";
import {
  prepareForwardForecast,
  type ForecastInput,
} from "../src/lib/ncaafForecastJournal.js";
import {
  buildNcaafResearchPreview,
  renderNcaafResearchPreview,
} from "../src/lib/ncaafResearchPreview.js";
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const digest = (v: unknown) => hash(JSON.stringify(v));
const stamp = "2026-10-23T12:00:00Z",
  kickoff = "2026-10-24T18:00:00Z",
  finalAt = "2026-10-24T23:00:00Z";
function fixture() {
  const rawResponse = JSON.stringify({
    events: [
      {
        id: "999",
        season: { year: 2026 },
        competitions: [
          {
            date: kickoff,
            competitors: [
              {
                homeAway: "home",
                team: { id: "1", displayName: "Home <script>bad()</script>" },
              },
              { homeAway: "away", team: { id: "2", displayName: "Away" } },
            ],
          },
        ],
      },
    ],
  });
  const live = { scoreboards: [{ rawResponse, sha256: hash(rawResponse) }] };
  const injury = JSON.stringify({ injuries: [] });
  const input: ForecastInput & {
    liveSourceEvidence: { key: string; sha256: string };
  } = {
    version: 1,
    target: {
      season: 2026,
      eventId: "999",
      homeId: "1",
      awayId: "2",
      kickoff,
      ruleset: "fixture",
    },
    games: Array.from({ length: 36 }, (_, i) => ({
      season: 2026,
      eventId: String(i + 10),
      homeId: i < 3 ? "1" : i < 6 ? "2" : String(100 + i),
      awayId: String(200 + i),
      kickoff: "2026-09-01T12:00:00Z",
      completedAt: "2026-09-01T16:00:00Z",
      observedAt: "2026-09-01T17:00:00Z",
      source: "fixture",
      ruleset: "fixture",
      homePoints: i < 6 ? 28 : 31,
      awayPoints: i < 6 ? 21 : 28,
      overtime: i >= 6,
      regulationHomePoints: i < 6 ? 28 : 21,
      regulationAwayPoints: 21,
    })),
    quotes: [
      {
        season: 2026,
        eventId: "999",
        bookmaker: "fixture",
        market: "spread",
        line: -3,
        firstPrice: -110,
        secondPrice: -110,
        observedAt: stamp,
        settlement: "full_game_including_overtime",
      },
    ],
    injuryEvidence: {
      key: "research:ncaaf:injuries:fixture",
      observedAt: stamp,
      sha256: hash(injury),
      rawResponse: injury,
      absentTeamStatus: "unknown",
    },
    liveSourceEvidence: {
      key: "research:ncaaf:live-inputs:fixture",
      sha256: digest(live),
    },
  };
  const record = {
    ...prepareForwardForecast(input, stamp),
    inputHashFormat: "canonical-json-sha256-v1",
    inputSha256: hash(canonicalEvidenceJson(input)),
    recordedAt: stamp,
  };
  const key = `research:ncaaf:forecast:${record.modelVersion}:2026:999`;
  return {
    row: { key, value: record, settlement: undefined as any },
    sources: new Map([[input.liveSourceEvidence.key, live]]),
  };
}
function settled(
  f: ReturnType<typeof fixture>,
  homePoints = 24,
  awayPoints = 21,
) {
  const rawResponse = JSON.stringify({
    header: {
      id: "999",
      season: { year: 2026 },
      competitions: [
        {
          date: kickoff,
          status: { type: { completed: true } },
          competitors: [
            { team: { id: "1" }, homeAway: "home", score: String(homePoints) },
            { team: { id: "2" }, homeAway: "away", score: String(awayPoints) },
          ],
        },
      ],
    },
  });
  f.row.settlement = {
    forecastKey: f.row.key,
    forecastSha256: digest(f.row.value),
    source: { rawResponse, sha256: hash(rawResponse), receivedAt: finalAt },
    outcome: {
      season: 2026,
      eventId: "999",
      homeId: "1",
      awayId: "2",
      kickoff,
      completedAt: finalAt,
      observedAt: finalAt,
      source: "fixture",
      ruleset: "fixture",
      homePoints,
      awayPoints,
      overtime: false,
      regulationHomePoints: homePoints,
      regulationAwayPoints: awayPoints,
    },
  };
  return f;
}
test("sanitized preview preserves exact saved probabilities and never mutates or releases forecasts", () => {
  const f = fixture(),
    before = JSON.stringify(f.row);
  const p = buildNcaafResearchPreview([f.row], f.sources, stamp);
  assert.equal(p.distinctGames, 1);
  assert.equal(p.games[0].status, "pregame");
  assert.equal(
    p.games[0].markets[0].conditionalWinProbability,
    f.row.value.markets[0].conditionalWinProbability,
  );
  assert.equal(p.games[0].markets[0].firstPrice, -110);
  assert.equal(p.games[0].home, "Home <script>bad()</script>");
  assert.equal(p.coachEnabled, false);
  assert.equal(p.validationReady, false);
  assert.equal(JSON.stringify(f.row), before);
  for (const forbidden of [
    "rawResponse",
    "injuryEvidence",
    "liveSourceEvidence",
    "gamesSource",
    "overtimeSupport",
  ])
    assert.ok(!JSON.stringify(p).includes(forbidden));
  const html = renderNcaafResearchPreview(p);
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("Download report"));
  assert.ok(html.includes("Subscriber NCAAF Coach remains locked"));
});
test("invalid hashes, late records and altered quote bindings are withheld", () => {
  for (const mutate of [
    (r: any) => {
      r.input.games[0].homePoints++;
    },
    (r: any) => {
      r.recordedAt = kickoff;
    },
    (r: any) => {
      r.markets[0].firstPrice = -120;
    },
    (r: any) => {
      r.markets[0].conditionalWinProbability = 1.2;
    },
    (r: any) => {
      r.markets[0].pushProbability = 0.9;
    },
  ]) {
    const f = fixture();
    mutate(f.row.value);
    const p = buildNcaafResearchPreview([f.row], f.sources, finalAt);
    assert.equal(p.games.length, 0);
    assert.equal(p.withheld, 1);
  }
});
test("exact final push is separate; no unverified win/loss is invented", () => {
  const f = settled(fixture());
  const p = buildNcaafResearchPreview([f.row], f.sources, finalAt);
  assert.equal(p.settledGames, 1);
  assert.equal(p.games[0].markets[0].result, "push");
  for (const alter of [
    (s: any) => {
      s.forecastSha256 = "bad";
    },
    (s: any) => {
      s.source.sha256 = "bad";
    },
    (s: any) => {
      s.outcome.homeId = "3";
    },
    (s: any) => {
      s.outcome.homePoints = 50;
    },
  ]) {
    const g = settled(fixture());
    alter(g.row.settlement);
    const q = buildNcaafResearchPreview([g.row], g.sources, finalAt);
    assert.equal(q.settledGames, 0);
    assert.equal(q.games[0].status, "awaiting_verified_final");
    assert.equal(q.games[0].markets[0].result, "pending");
    assert.equal(q.unverifiedOutcomes, 1);
  }
});
test("multiple model records count as one distinct game and missing names use explicit IDs", () => {
  const f = fixture(),
    p = buildNcaafResearchPreview([f.row, f.row], new Map(), stamp);
  assert.equal(p.distinctGames, 1);
  assert.equal(p.games[0].home, "ESPN team 1");
  assert.equal(
    buildNcaafResearchPreview([], new Map(), stamp).distinctGames,
    0,
  );
});

test("database JSONB key reordering preserves canonical forecasts and explicitly omits unverifiable legacy records", () => {
  const f = fixture();
  const reorder = (v: any): any =>
    Array.isArray(v)
      ? v.map(reorder)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .reverse()
              .map((k) => [k, reorder(v[k])]),
          )
        : v;
  const row = reorder(f.row);
  assert.equal(
    buildNcaafResearchPreview([row], f.sources, stamp).distinctGames,
    1,
  );
  delete row.value.inputHashFormat;
  const p = buildNcaafResearchPreview([row], f.sources, stamp);
  assert.equal(p.distinctGames, 0);
  assert.equal(p.unsupportedLegacyRecords, 1);
  assert.ok(renderNcaafResearchPreview(p).includes("legacy forecasts omitted"));
});
