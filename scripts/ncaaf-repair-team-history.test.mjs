import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  scheduleCompletedEvents,
  summaryHistory,
  mergeGames,
} from "./ncaaf-repair-team-history.mjs";
const now = "2026-10-23T14:00:00Z";
function summary(ot = false) {
  return {
    header: {
      id: "99",
      league: { slug: "college-football" },
      season: { year: 2026 },
      competitions: [
        {
          date: "2026-09-05T18:00:00Z",
          status: { type: { state: "post", completed: true } },
          competitors: [
            {
              homeAway: "home",
              team: { id: "1" },
              score: ot ? "28" : "21",
              linescores: [7, 7, 7, 0, ...(ot ? [7] : [])].map((v) => ({
                displayValue: String(v),
              })),
            },
            {
              homeAway: "away",
              team: { id: "2" },
              score: ot ? "24" : "14",
              linescores: [7, 7, 0, ot ? 7 : 0, ...(ot ? [3] : [])].map(
                (v) => ({ displayValue: String(v) }),
              ),
            },
          ],
        },
      ],
    },
  };
}
const normalized = (p) =>
  summaryHistory(JSON.stringify(p), "99", 2026, now, now);
test("detailed summary yields consistent regulation/OT outcomes and original-byte provenance", () => {
  for (const ot of [false, true]) {
    const p = summary(ot),
      r = normalized(p);
    assert.equal(r.games.length, 1);
    assert.equal(r.games[0].overtime, ot);
    assert.equal(
      r.games[0].sourceSha256,
      createHash("sha256").update(JSON.stringify(p)).digest("hex"),
    );
    assert.equal(r.games[0].periodOrderingIndependentlyVerified, false);
    assert.equal(r.games[0].actualCompletedAt, null);
    assert.equal(r.games[0].observedAt, now);
    assert.equal(r.automaticUnlock, false);
  }
});
test("wrong event/team/season/sport and absent or conflicting periods cannot become history", () => {
  for (const mutate of [
    (p) => (p.header.id = "98"),
    (p) => (p.header.season.year = 2025),
    (p) => (p.header.league.slug = "nfl"),
    (p) => (p.header.competitions[0].competitors[0].linescores = []),
    (p) =>
      (p.header.competitions[0].competitors[0].linescores[0].displayValue =
        "--"),
  ]) {
    const p = summary();
    mutate(p);
    assert.throws(() => normalized(p));
  }
  const p = summary();
  p.header.competitions[0].competitors[0].score = "99";
  assert.equal(normalized(p).games.length, 0);
});
test("schedule selection requires exact team, season, completed state and a past kickoff", () => {
  const p = {
    team: { id: "1" },
    season: { year: 2026 },
    events: [
      {
        id: "99",
        season: { year: 2026 },
        competitions: summary().header.competitions,
      },
    ],
  };
  assert.deepEqual(scheduleCompletedEvents(JSON.stringify(p), "1", 2026, now), [
    "99",
  ]);
  assert.throws(() =>
    scheduleCompletedEvents(JSON.stringify(p), "2", 2026, now),
  );
  p.events[0].competitions[0].status.type.completed = false;
  assert.deepEqual(
    scheduleCompletedEvents(JSON.stringify(p), "1", 2026, now),
    [],
  );
});
test("duplicate games cannot pad history; changed results reject instead of overwriting", () => {
  const a = normalized(summary()).games[0],
    b = { ...a, observedAt: "2026-10-23T14:01:00Z" };
  assert.equal(mergeGames([b], [a]).length, 1);
  assert.equal(mergeGames([b], [a])[0].observedAt, now);
  assert.throws(
    () => mergeGames([a], [{ ...a, homePoints: 28 }]),
    /conflicting/,
  );
});
test("default CLI is plan-only with no required credentials", () => {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  const r = JSON.parse(
    execFileSync(process.execPath, ["scripts/ncaaf-repair-team-history.mjs"], {
      env,
      encoding: "utf8",
    }),
  );
  assert.equal(r.planOnly, true);
  assert.equal(r.paidOddsRequests, 0);
  assert.equal(r.automaticUnlock, false);
});
test("combined runner defaults to a plan without provider/database calls", () => {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  delete env.ODDS_API_KEY;
  const r = JSON.parse(
    execFileSync("bash", ["scripts/ncaaf-run-coverage-repair.sh"], {
      env,
      encoding: "utf8",
    }),
  );
  assert.equal(r.planOnly, true);
  assert.equal(r.maximumPaidOddsRequests, 1);
  assert.equal(r.automaticUnlock, false);
});

test("historical event identities survive a provider current-season container label", () => {
  const p = {
    team: { id: "1" },
    season: { year: 2026 },
    events: [
      {
        id: "99",
        season: { year: 2025 },
        competitions: summary().header.competitions,
      },
    ],
  };
  assert.deepEqual(scheduleCompletedEvents(JSON.stringify(p), "1", 2025, now), [
    "99",
  ]);
  assert.deepEqual(
    scheduleCompletedEvents(JSON.stringify(p), "1", 2026, now),
    [],
  );
  p.events[0].season.year = 2024;
  assert.deepEqual(
    scheduleCompletedEvents(JSON.stringify(p), "1", 2025, now),
    [],
  );
  delete p.events[0].season;
  assert.deepEqual(
    scheduleCompletedEvents(JSON.stringify(p), "1", 2025, now),
    [],
  );
});
