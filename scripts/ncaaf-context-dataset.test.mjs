import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  usageFromSummary,
  contextFeatures,
  outcomeFromSettlement,
  selectUsageArchives,
} from "./ncaaf-context-dataset.mjs";
const target = {
  eventId: "999",
  season: 2026,
  homeId: "1",
  awayId: "2",
  kickoff: "2026-10-24T16:00:00Z",
};
const binding = {
  eventBindingVerified: true,
  target: {
    ...target,
    sides: [
      { id: "1", aliases: ["home"] },
      { id: "2", aliases: ["away"] },
    ],
  },
  observedAt: "2026-10-24T03:00:00Z",
  publishedAt: "2026-10-24T00:00:00Z",
  sides: [
    {
      aliases: ["home"],
      rows: [
        { name: "QB #10 Home Player", status: "out" },
        { name: "QB #11 Exempt Player", status: "unknown" },
      ],
    },
    {
      aliases: ["away"],
      rows: [{ name: "QB #10 Away Player", status: "available" }],
    },
  ],
};
function usage() {
  return Array.from({ length: 3 }, (_, i) => ({
    eventId: String(i + 1),
    kickoff: `2026-10-${String(i + 1).padStart(2, "0")}T16:00:00Z`,
    receivedAt: "2026-10-23T00:00:00Z",
    sha256: "a".repeat(64),
    teams: [
      {
        teamId: "1",
        usage: {
          passingAttempts: {
            total: 10,
            players: [
              { athleteId: "11", name: "Home Player", jersey: "10", count: 6 },
              {
                athleteId: "12",
                name: "Exempt Player",
                jersey: "11",
                count: 4,
              },
            ],
          },
          carries: null,
          receptions: null,
        },
      },
      {
        teamId: "2",
        usage: {
          passingAttempts: {
            total: 10,
            players: [
              { athleteId: "21", name: "Away Player", jersey: "10", count: 10 },
            ],
          },
          carries: null,
          receptions: null,
        },
      },
    ],
  }));
}
test("participation shares preserve known out, explicit available and unknown without guessed impacts", () => {
  const f = contextFeatures(binding, usage()),
    h = f.sides[0].features.passingAttempts,
    a = f.sides[1].features.passingAttempts;
  assert.equal(h.shares.out, 0.6);
  assert.equal(h.shares.unknown, 0.4);
  assert.equal(a.shares.available, 1);
  assert.equal(f.sides[0].features.carries.shares, null);
  assert.equal(f.datasetRole, "development_only");
  assert.equal(f.releaseEligible, false);
  assert.equal(f.predictedHomeScore, undefined);
});
test("thin or incomplete participation stays unknown; duplicate games and unverified bindings reject", () => {
  assert.equal(
    contextFeatures(binding, usage().slice(0, 2)).sides[0].features
      .passingAttempts.shares,
    null,
  );
  const u = usage();
  u[0].teams[0].usage.passingAttempts = null;
  assert.equal(
    contextFeatures(binding, u).sides[0].features.passingAttempts.shares,
    null,
  );
  assert.throws(() => contextFeatures(binding, [...usage(), usage()[0]]));
  assert.throws(() =>
    contextFeatures({ ...binding, eventBindingVerified: false }, usage()),
  );
});
test("ambiguous athlete identity cannot inherit a named availability status", () => {
  const u = usage();
  for (const g of u)
    g.teams[0].usage.passingAttempts.players[1] = {
      athleteId: "22",
      name: "Home Player",
      jersey: "10",
      count: 4,
    };
  const x = contextFeatures(binding, u).sides[0].features.passingAttempts;
  assert.equal(x.shares.out, 0);
  assert.equal(x.shares.unknown, 1);
});
function capture() {
  const competitors = ["1", "2"].map((id, i) => ({
    homeAway: i ? "away" : "home",
    team: { id },
    score: i ? "7" : "14",
    linescores: [
      { value: i ? 0 : 7 },
      { value: 7 },
      { value: 0 },
      { value: 0 },
    ],
  }));
  const rawResponse = JSON.stringify({
    header: {
      id: "123",
      season: { year: 2026 },
      league: { slug: "college-football" },
      competitions: [
        {
          date: "2026-10-01T16:00:00Z",
          status: { type: { completed: true, state: "post" } },
          competitors,
        },
      ],
    },
    boxscore: {
      players: [
        {
          team: { id: "1" },
          statistics: [
            {
              name: "passing",
              keys: ["completions/passingAttempts"],
              totals: ["6/10"],
              athletes: [
                {
                  athlete: {
                    id: "11",
                    displayName: "Home Player",
                    jersey: "10",
                  },
                  stats: ["6/10"],
                },
              ],
            },
          ],
        },
      ],
    },
  });
  return {
    rawResponse,
    sha256: createHash("sha256").update(rawResponse).digest("hex"),
    requestStartedAt: "2026-10-23T00:00:00Z",
    receivedAt: "2026-10-23T00:01:00Z",
  };
}
test("raw complete prior-game boxscores bind real attempts and source identities", () => {
  const c = capture(),
    u = usageFromSummary(c, target, "2026-10-24T03:00:00Z");
  assert.equal(u.teams[0].usage.passingAttempts.total, 10);
  assert.equal(u.teams[0].usage.carries, null);
  const p = JSON.parse(c.rawResponse);
  p.boxscore.players[0].statistics[0].totals = ["6/11"];
  const rawResponse = JSON.stringify(p);
  const bad = {
    ...c,
    rawResponse,
    sha256: createHash("sha256").update(rawResponse).digest("hex"),
  };
  assert.equal(
    usageFromSummary(bad, target, "2026-10-24T03:00:00Z").teams[0].usage
      .passingAttempts,
    null,
  );
});
test("future receipts, raw tampering and target-result leakage reject", () => {
  const c = capture();
  assert.throws(() =>
    usageFromSummary(
      { ...c, receivedAt: "2026-10-25T00:00:00Z" },
      target,
      "2026-10-24T03:00:00Z",
    ),
  );
  assert.throws(() =>
    usageFromSummary(
      { ...c, sha256: "0".repeat(64) },
      target,
      "2026-10-24T03:00:00Z",
    ),
  );
  assert.throws(() =>
    usageFromSummary(c, { ...target, eventId: "123" }, "2026-10-24T03:00:00Z"),
  );
});

test("outcome labels authenticate the final source and cannot relabel postgame inputs", () => {
  const input = {
    ...contextFeatures(binding, usage()),
    capturedAt: "2026-10-24T03:00:00Z",
    recordedAt: "2026-10-24T03:00:01Z",
  };
  const p = JSON.parse(capture().rawResponse);
  p.header.id = "999";
  p.header.competitions[0].date = target.kickoff;
  const rawResponse = JSON.stringify(p),
    source = {
      rawResponse,
      sha256: createHash("sha256").update(rawResponse).digest("hex"),
      requestStartedAt: "2026-10-24T21:00:00Z",
      receivedAt: "2026-10-24T21:00:01Z",
    };
  const settled = {
    source,
    outcome: {
      eventId: "999",
      season: 2026,
      homeId: "1",
      awayId: "2",
      homePoints: 14,
      awayPoints: 7,
    },
  };
  const label = outcomeFromSettlement(input, settled, "2026-10-24T22:00:00Z");
  assert.equal(label.outcome.homePoints, 14);
  assert.equal(label.datasetRole, "development_only");
  assert.equal(label.releaseEligible, false);
  assert.throws(() =>
    outcomeFromSettlement(
      input,
      { ...settled, outcome: { ...settled.outcome, homePoints: 99 } },
      "2026-10-24T22:00:00Z",
    ),
  );
  assert.throws(() =>
    outcomeFromSettlement(
      { ...input, recordedAt: "2026-10-24T17:00:00Z" },
      settled,
      "2026-10-24T22:00:00Z",
    ),
  );
});

test("feature construction rejects future participation and target-game leakage", () => {
  const future = usage();
  future[0].receivedAt = "2026-10-24T04:00:00Z";
  assert.throws(() => contextFeatures(binding, future));
  const targetLeak = usage();
  targetLeak[0].eventId = target.eventId;
  assert.throws(() => contextFeatures(binding, targetLeak));
});

test("usage selection always chooses earliest receipt despite unordered corrected archives", () => {
  const game = {
    eventId: "123",
    season: 2026,
    homeId: "1",
    awayId: "2",
    kickoff: "2026-10-01T16:00:00Z",
  };
  const later = {
    key: "later",
    games: [game],
    received_at: "2026-10-23T02:00:00Z",
  };
  const earlier = {
    key: "earlier",
    games: [game],
    received_at: "2026-10-23T01:00:00Z",
  };
  for (const rows of [
    [later, earlier],
    [earlier, later],
  ]) {
    const selected = selectUsageArchives(rows, target, "2026-10-24T03:00:00Z");
    assert.equal(selected.length, 1);
    assert.equal(selected[0].key, "earlier");
  }
  const future = {
    ...earlier,
    key: "future",
    received_at: "2026-10-25T01:00:00Z",
  };
  assert.equal(
    selectUsageArchives([future], target, "2026-10-24T03:00:00Z").length,
    0,
  );
});

test("anonymous Team rows and missing jerseys retain authentic counts as unknown attribution", () => {
  const c = capture(),
    p = JSON.parse(c.rawResponse),
    g = p.boxscore.players[0].statistics[0];
  g.totals = ["6/12"];
  g.athletes.push({
    athlete: { id: "-100", displayName: " Team" },
    stats: ["0/2"],
  });
  const rawResponse = JSON.stringify(p),
    a = {
      ...c,
      rawResponse,
      sha256: createHash("sha256").update(rawResponse).digest("hex"),
    };
  const u = usageFromSummary(a, target, "2026-10-24T03:00:00Z").teams[0].usage
    .passingAttempts;
  assert.equal(u.total, 12);
  assert.equal(u.unattributed, 2);
  assert.equal(u.players.length, 1);
  const rows = usage();
  for (const r of rows) {
    r.teams[0].usage.passingAttempts.total = 12;
    r.teams[0].usage.passingAttempts.unattributed = 2;
  }
  const f = contextFeatures(binding, rows).sides[0].features.passingAttempts;
  assert.equal(f.shares.out, 0.5);
  assert.equal(f.shares.unknown, 0.5);
  const missing = capture(),
    m = JSON.parse(missing.rawResponse);
  delete m.boxscore.players[0].statistics[0].athletes[0].athlete.jersey;
  const bytes = JSON.stringify(m),
    result = usageFromSummary(
      {
        ...missing,
        rawResponse: bytes,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
      target,
      "2026-10-24T03:00:00Z",
    );
  assert.equal(result.teams[0].usage.passingAttempts.players[0].jersey, null);
});
