import assert from "node:assert/strict";
import test from "node:test";
import { backtestEventSim } from "../src/lib/sportSim/eventSimBacktest.ts";
import { playEvent, prepareEvent, rng, type EventSnapshot } from "../src/lib/sportSim/eventKernels.ts";
import { researchLine, simulateEventResearch, summarizeEventResearch } from "../src/lib/sportSim/eventSimResearch.ts";

type Rules = Pick<EventSnapshot, "sport" | "rules">;
const rosters = {
  nfl: ["qb", "wr", "wr", "te", "rb", "k", "defense"],
  mlb: [...Array<string>(9).fill("batter"), "starter", "reliever", "closer"],
  nhl: ["goalie", "skater", "skater", "skater", "power_play", "power_play"],
  soccer: [...Array<string>(9).fill("outfield"), "sub", "sub"],
  tennis: ["server"],
};
const rules = [
  { sport: "nfl", rules: { passRate: .56, completion: .63, yardsPerCatch: 11, runYards: 4.1, sackRate: .06, giveawayRate: .018, kickAccuracy: .87, windMph: 8, wet: false } },
  { sport: "mlb", rules: { outcomes: [.225, .081, .01, .158, .047, .006, .03, .443], pitchLimit: 94, parkFactor: 1, windOutMph: 4, automaticRunner: true } },
  { sport: "nhl", rules: { shotsPer60: [31, 29], xgPerShot: .09, powerPlayXg: .13, goalieSave: [.905, .910], goalieShots: [600, 550], tourSave: .905, playoffs: false } },
  { sport: "soccer", rules: { xg: [1.6, 1.15], shots: [13, 11], redRate: .06, knockout: false, lowScoreAdjustment: .07 } },
  { sport: "tennis", rules: { surface: "hard", bestOf: 3, decidingTiebreak: 10, serve: [.65, .62], serveSample: [500, 460], tourServe: .63, ace: [.07, .06], doubleFault: [.034, .048], retirement: [.02, .01] } },
] satisfies Rules[];

function fixture(sport: EventSnapshot["sport"]): EventSnapshot {
  const context = rules.find(r => r.sport === sport)!;
  const roster = (id: string) => ({
    id, restDays: 2, travelKm: 200,
    players: rosters[sport].map((role, i) => ({
      id: `${id}-${i}`, name: `Player ${i}`, role, share: .15,
      hand: i % 2 ? "R" as const : "L" as const,
    })),
  });
  return {
    ...context,
    eventId: sport, availableAt: 200, startsAt: 300, lineupSource: "fixture",
    lineupAvailableAt: 190, resourceVersion: "fixture", uncertainty: .08,
    home: roster("home"), away: roster("away"),
  } as EventSnapshot;
}

for (const sport of ["nfl", "mlb", "nhl", "soccer", "tennis"] as const) {
  test(`${sport} reconciles player totals and period scores in every draw`, () => {
    const t = performance.now();
    let audited = 0, sawExtra = false, sawRetirement = false;
    const outcomes = simulateEventResearch(fixture(sport), 381, frame => {
      audited++;
      const key = sport === "nfl" ? "points" : sport === "mlb" ? "runs" : sport === "tennis" ? "games" : "goals";
      for (const [side, team] of frame.teams.entries()) {
        const overPeriods = frame.periods.reduce((sum, p) => sum + (side === 0 ? p.home : p.away), 0);
        assert.equal(overPeriods, team.score);
        assert.equal(team.totals[key] ?? 0, team.score);
        for (const [stat, total] of Object.entries(team.totals)) {
          const sum = team.players.reduce((n, p) => n + (p.stats[stat as keyof typeof p.stats] ?? 0), 0);
          assert.equal(total, sum);
        }
        if (sport === "nfl") assert.equal(team.totals.passYards ?? 0, team.totals.recYards ?? 0);
        if (sport === "mlb") assert.equal(team.totals.pitcherK ?? 0, frame.teams[1 - side]!.totals.strikeouts ?? 0);
      }
      if (sport === "mlb" && frame.periods.length > 9 || sport === "nhl" && frame.tiebreak === "shootout") sawExtra = true;
      if (frame.retired != null) sawRetirement = true;
    });
    console.log(`${sport} audited 10,000 draws in ${Math.round(performance.now() - t)}ms`);
    assert.equal(audited, 10_000);
    if (sport === "mlb" || sport === "nhl") assert.ok(sawExtra);
    if (sport === "tennis") assert.ok(sawRetirement);
    const q = { id: "home", kind: "spread", teamSide: "home", line: 0 } as const;
    const summary = summarizeEventResearch(outcomes, [q], false);
    assert.deepEqual(summary.eventSimulation.lines.home, researchLine(outcomes, q));
    assert.equal(summary.eventSimulation.representative.percentile, 50);
    assert.equal(summary.eventSimulation.marginHistogram.reduce((sum, bin) => sum + bin.count, 0),
      outcomes.retired.reduce((sum, retired) => sum + 1 - retired, 0));
    const half = researchLine(outcomes, { ...q, line: .5 })!;
    assert.equal(half.push, 0);
    if (sport === "soccer") assert.ok(summary.tieProbability > 0 && summary.tieProbability < .65);
  });
}

test("uses published replacements and rejects post-start data", () => {
  const snapshot = fixture("nfl");
  const available = snapshot.home.players[1]!;
  available.available = false;
  available.replacementId = snapshot.home.players[2]!.id;
  const setup = prepareEvent(snapshot);
  const frame = playEvent(snapshot, setup, [1, 1], rng(10));
  assert.ok(!frame.teams[0].players.some(player => player.id === available.id));
  assert.throws(() => prepareEvent({ ...snapshot, lineupAvailableAt: 301 }), /snapshot/);
});

test("backtest uses soccer regulation settlement and compares the same posted line to closing", () => {
  const snapshot = fixture("soccer");
  const row = {
    snapshot, final: { kind: "regulation", home: 2, away: 1, winner: "home", availableAt: 400 },
    open: { spread: -.5, availableAt: 190 },
    close: { fairHomeWin: .49, fairCoverAtOpen: .48, spread: -.75, availableAt: 270 },
  } as const;
  const [report] = backtestEventSim([row]);
  assert.equal(report?.win.paired, 1);
  assert.equal(report?.cover.paired, 1);
  assert.equal(report?.draw.settled, 1);
  assert.throws(() => backtestEventSim([{ ...row, final: { ...row.final, kind: "full_game" } }]), /invalid/i);
  assert.throws(() => backtestEventSim([{ ...row, close: { ...row.close, availableAt: 310 } }]), /invalid/i);
});

test("a trusted event snapshot reuses the exact 10,000 draws across the posted lines", async () => {
  const { eventSimReview } = await import("../src/lib/sportSim/eventSimReview.ts");
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const data = await mkdtemp(join(tmpdir(), "stadium-event-review-"));
  const path = join(data, "events.json");
  const previous = process.env.SPORT_EVENT_REVIEW_SNAPSHOTS;
  try {
    await writeFile(path, JSON.stringify([fixture("tennis")]));
    process.env.SPORT_EVENT_REVIEW_SNAPSHOTS = path;
    const event = { sport: "tennis", eventId: "tennis", homeId: "home", awayId: "away", retainOutcomes: true };
    const q = { id: "total", kind: "total", totalSide: "over", line: 21 } as const;
    const first = await eventSimReview({ ...event, queries: [q] });
    const second = await eventSimReview({ ...event, queries: [{ ...q, line: 21.5 }] });
    assert.equal(first?.eventDrawCacheHit, false);
    assert.equal(second?.eventDrawCacheHit, true);
    assert.deepEqual(first?.outcomes, second?.outcomes);
    assert.equal(second?.eventSimulation.lines.total?.push, 0);
    assert.equal(await eventSimReview({ ...event, awayId: "unrelated", queries: [] }), null);
  } finally {
    if (previous == null) delete process.env.SPORT_EVENT_REVIEW_SNAPSHOTS;
    else process.env.SPORT_EVENT_REVIEW_SNAPSHOTS = previous;
    await rm(data, { recursive: true, force: true });
  }
});
