import test from "node:test";
import assert from "node:assert/strict";
import {
  usageCapturePlan,
  usageWaitingForVerifiedAvailabilityReport,
  validateUsageSummary,
} from "./ncaaf-capture-usage.mjs";
const target = {
  eventId: "999",
  season: 2026,
  homeId: "1",
  awayId: "2",
  kickoff: "2026-10-24T16:00:00Z",
};
const game = (id, day, homeId = "1") => ({
  eventId: String(id),
  season: 2026,
  homeId,
  awayId: "2",
  kickoff: `2026-10-${String(day).padStart(2, "0")}T16:00:00Z`,
  completedAt: `2026-10-${String(day).padStart(2, "0")}T20:00:00Z`,
  observedAt: "2026-10-23T00:00:00Z",
  homePoints: 14,
  awayPoints: 7,
});
test("only missing newest three distinct completed games per team are captured", () => {
  const games = [
    game(1, 1),
    game(2, 2),
    game(3, 3),
    game(4, 4),
    game(4, 4),
    { ...game(999, 5) },
    game(5, 25),
    { ...game(6, 6), observedAt: "2026-10-25T00:00:00Z" },
  ];
  const p = usageCapturePlan(
    games,
    [target],
    new Set(["3"]),
    "2026-10-24T04:00:00Z",
  );
  assert.deepEqual(
    p.jobs.map((g) => g.eventId),
    ["4", "2"],
  );
  assert.equal(p.paidOddsRequests, 0);
  assert.equal(
    usageCapturePlan(
      games,
      [target],
      new Set(["2", "3", "4"]),
      "2026-10-24T04:00:00Z",
    ).jobs.length,
    0,
  );
});
test("requests are bounded across many targets and the target cap cannot be expanded", () => {
  const targets = Array.from({ length: 40 }, (_, i) => ({
    ...target,
    eventId: String(1000 + i),
    homeId: String(100 + i),
    awayId: String(200 + i),
  }));
  const games = targets.flatMap((t, i) =>
    Array.from({ length: 3 }, (_, j) => ({
      ...game(i * 3 + j + 1, j + 1),
      homeId: t.homeId,
      awayId: t.awayId,
    })),
  );
  const p = usageCapturePlan(games, targets, new Set(), "2026-10-24T04:00:00Z");
  assert.equal(p.jobs.length, 64);
  assert.equal(p.missingGames, 120);
  assert.equal(p.deferred, 56);
  assert.throws(() =>
    usageCapturePlan(
      games,
      Array(129).fill(target),
      new Set(),
      "2026-10-24T04:00:00Z",
    ),
  );
});
function capture() {
  const expected = game(123, 1),
    competitors = ["1", "2"].map((id, i) => ({
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
          date: expected.kickoff,
          status: { type: { completed: true, state: "post" } },
          competitors,
        },
      ],
    },
    boxscore: {
      players: ["1", "2"].map((id) => ({
        team: { id },
        statistics: [
          { name: "passing", athletes: [{ athlete: { id: "10" } }] },
        ],
      })),
    },
  });
  return {
    expected,
    capture: {
      rawResponse,
      requestStartedAt: "2026-10-24T03:00:00Z",
      receivedAt: "2026-10-24T03:00:01Z",
    },
  };
}
test("original final-game identity, score and both player-boxscore sides must agree", () => {
  const f = capture();
  assert.equal(validateUsageSummary(f.capture, f.expected).games.length, 1);
  assert.throws(() =>
    validateUsageSummary(f.capture, { ...f.expected, homePoints: 99 }),
  );
  const p = JSON.parse(f.capture.rawResponse);
  p.boxscore.players.pop();
  assert.throws(() =>
    validateUsageSummary(
      { ...f.capture, rawResponse: JSON.stringify(p) },
      f.expected,
    ),
  );
});
test("empty verified bindings wait cleanly without inventing usage jobs", () => {
  const waiting = usageWaitingForVerifiedAvailabilityReport(
    "2026-10-26T17:00:00Z",
  );
  assert.equal(waiting.state, "waiting_for_verified_availability_bindings");
  assert.equal(waiting.matchedTargets, 0);
  assert.equal(waiting.requests, 0);
  assert.equal(waiting.releaseEligible, false);
  assert.equal(waiting.automaticUnlock, false);
  assert.equal(waiting.reason, "no_verified_conference_event_bindings");
  assert.equal(
    usageCapturePlan([], [], new Set(), "2026-10-26T17:00:00Z").jobs.length,
    0,
  );
});
