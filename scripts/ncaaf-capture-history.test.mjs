import test from "node:test";
import assert from "node:assert/strict";
import {
  historyDates,
  normalizeHistory,
  mergeHistory,
} from "./ncaaf-capture-history.mjs";
const now = "2026-10-23T14:00:00Z";
function payload(ot = false) {
  return {
    events: [
      {
        id: "99",
        season: { year: 2026 },
        competitions: [
          {
            date: "2026-09-05T18:00:00Z",
            status: {
              period: ot ? 5 : 4,
              type: { state: "post", completed: true },
            },
            competitors: [
              {
                homeAway: "home",
                team: { id: "1" },
                score: ot ? "28" : "21",
                linescores: [7, 7, 7, 0, ...(ot ? [7] : [])].map(
                  (value, i) => ({ value, period: i + 1 }),
                ),
              },
              {
                homeAway: "away",
                team: { id: "2" },
                score: ot ? "24" : "14",
                linescores: [7, 7, 0, ot ? 7 : 0, ...(ot ? [3] : [])].map(
                  (value, i) => ({ value, period: i + 1 }),
                ),
              },
            ],
          },
        ],
      },
    ],
  };
}
const archive = (p) => normalizeHistory(JSON.stringify(p), 2026, now, now);
test("known final scores and regulation quarters preserve honest completion/availability bounds", () => {
  for (const ot of [false, true]) {
    const a = archive(payload(ot)),
      g = a.games[0];
    assert.equal(g.overtime, ot);
    assert.equal(g.completedAt, now);
    assert.equal(g.actualCompletedAt, null);
    assert.equal(g.observedAt, now);
    assert.equal(g.completionTimeKind, "observed_complete_upper_bound");
    assert.equal(a.historicalAvailabilityVerified, false);
    assert.equal(g.rulesetCompatibilityVerified, false);
  }
});
test("live games, absent period data, inconsistent scores and non-tied OT regulation are excluded", () => {
  for (const mutate of [
    (p) => (p.events[0].competitions[0].status.type.completed = false),
    (p) => (p.events[0].competitions[0].competitors[0].linescores = []),
    (p) => (p.events[0].competitions[0].competitors[0].score = "99"),
    (p) =>
      (p.events[0].competitions[0].competitors[0].linescores[0].period = 2),
  ]) {
    const p = payload();
    mutate(p);
    assert.equal(archive(p).games.length, 0);
  }
  const p = payload(true);
  p.events[0].competitions[0].competitors[0].linescores[0].value = 8;
  p.events[0].competitions[0].competitors[0].score = "29";
  assert.equal(archive(p).games.length, 0);
});
test("same result deduplicates using earliest genuine observation, conflicting results reject", () => {
  const a = archive(payload()),
    b = normalizeHistory(
      JSON.stringify(payload()),
      2026,
      now,
      "2026-10-23T14:01:00Z",
    );
  assert.equal(mergeHistory([b, a]).games.length, 1);
  assert.equal(mergeHistory([b, a]).games[0].observedAt, now);
  const p = payload();
  p.events[0].competitions[0].competitors[0].score = "28";
  p.events[0].competitions[0].competitors[0].linescores[3].value = 7;
  assert.throws(() => mergeHistory([a, archive(p)]), /conflicting/);
});
test("hash tampering and invalid receipt times reject", () => {
  const a = archive(payload());
  a.rawResponse = "{}";
  assert.throws(() => mergeHistory([a]), /hash/);
  assert.throws(
    () => normalizeHistory("{}", 2026, now, "2026-10-22T14:00:00Z"),
    /receipt/,
  );
});
test("bounded season plan never requests future dates or exceeds the season budget", () => {
  const dates = historyDates(2026, now);
  assert.equal(dates.length, 84);
  assert.equal(dates[0], "2026-08-01");
  assert.equal(dates.at(-1), "2026-10-23");
  assert.equal(historyDates(2025, now).length, 153);
  assert.throws(() => historyDates(2027, now));
});
