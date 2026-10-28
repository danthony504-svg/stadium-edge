import test from "node:test";
import assert from "node:assert/strict";
import { explainMatchup, marketDefenseContext } from "./matchupEvidence.ts";
import type { PropSimPlayerHistoryPayload, TeamDefense } from "./api.ts";
const def: TeamDefense = {
  sport: "nba",
  teamId: "A",
  teamName: "Opponent",
  avgPointsAgainst: 115,
  avgPointsFor: 110,
  pointDifferential: -5,
  defensive: {},
  offensive: {},
};
const base = {
  sport: "nba",
  athleteId: "1",
  market: "player_points",
  line: 10,
  side: "Over" as const,
  startsAt: "2026-10-28T23:00Z",
  nowMs: Date.parse("2026-10-28T12:00Z"),
  isHome: true,
  opponentName: "Opponent",
  opponentId: "A",
  opponentDefense: def,
  simProbability: 0.999,
  simSample: 5,
};
function history(sport = "nba", stat = "PTS"): PropSimPlayerHistoryPayload {
  return {
    sport,
    athleteId: "1",
    labels: [stat, "MIN"],
    recent: [1, 2, 3, 4, 5].map((n) => ({
      date: `2026-10-${20 + n}T12:00Z`,
      opponentId: "A",
      isHome: true,
      stats: { [stat]: "12", MIN: "28:30" },
    })),
  };
}
test("exact market, venue, opponent and minutes evidence has samples and dates, not causal claims", () => {
  const e = explainMatchup({ ...base, history: history() });
  assert.ok(e.observations.some((x) => x.includes("12.0 average; 5/5")));
  assert.ok(e.observations.some((x) => x.includes("Home average")));
  assert.ok(e.observations.some((x) => x.includes("Against this opponent")));
  assert.ok(e.observations.some((x) => x.includes("28.5 minutes/game")));
  assert.ok(e.cautions.some((x) => x.includes("Extreme model estimate")));
  assert.match(e.source, /2026-10-21–2026-10-25/);
});
test("foreign athlete, sport, invalid cutoff and missing market stats never produce player history", () => {
  for (const patch of [
    { history: { ...history(), athleteId: "wrong" } },
    { history: history("nfl") },
    { startsAt: "bad", history: history() },
    { market: "unknown", history: history() },
  ]) {
    const e = explainMatchup({ ...base, ...patch });
    assert.ok(!e.observations.some((x) => x.includes("Exact-market history")));
    assert.ok(e.missing.some((x) => x.includes("athlete-bound history")));
  }
});
test("future, undated and duplicate games cannot inflate sample; pushes are not hits", () => {
  const h = history();
  h.recent = [
    h.recent[0]!,
    h.recent[0]!,
    { ...h.recent[1]!, date: "2026-10-29T12:00Z" },
    { ...h.recent[2]!, date: null },
  ];
  const e = explainMatchup({ ...base, history: h, line: 12 });
  assert.ok(e.observations.some((x) => x.includes("0/1 hit")));
  assert.ok(e.missing.some((x) => x.includes("fewer than 3")));
});
test("all supported sports use exact stat families, never generic points as a prop explanation", () => {
  for (const [sport, market, stat] of [
    ["nba", "player_rebounds", "REB"],
    ["wnba", "player_assists", "AST"],
    ["ncaab", "player_blocks", "BLK"],
    ["nfl", "player_rush_yds", "rushingYards"],
    ["ncaaf", "player_pass_yds", "passingYards"],
    ["mlb", "batter_hits", "H"],
    ["nhl", "player_shots_on_goal", "S"],
    ["soccer", "player_shots", "SH"],
  ]) {
    const e = explainMatchup({
      ...base,
      sport,
      market,
      history: history(sport, stat),
      opponentDefense: { ...def, sport },
    });
    assert.ok(
      e.observations.some((x) => x.includes("Exact-market history")),
      sport,
    );
    assert.ok(
      e.missing.some((x) => x.includes("Market-specific opponent allowance")),
      sport,
    );
    assert.ok(!e.observations.some((x) => x.includes("115.0 PPG")), sport);
  }
  for (const sport of ["tennis", "ufc"])
    assert.ok(
      explainMatchup({ ...base, sport, history: null }).missing.some((x) =>
        x.includes("history for this exact market unavailable"),
      ),
    );
});
test("passing yards are not evidence for receptions, sacks, touchdowns or mixed yardage", () => {
  const d = {
    ...def,
    sport: "nfl",
    passDefense: {
      passingYardsAllowedPerGame: 200,
      yardsPerPassAllowed: 7,
      sampleSize: 5,
    },
  };
  for (const m of [
    "player_receptions",
    "player_sacks",
    "player_anytime_td",
    "player_pass_rush_yds",
  ])
    assert.equal(marketDefenseContext("nfl", m, "Opp", d), null);
  assert.match(
    marketDefenseContext("nfl", "player_reception_yds", "Opp", d)!,
    /Broader passing context/,
  );
  assert.equal(marketDefenseContext("nba", "player_points", "Opp", d), null);
});
test("counter evidence flags averages opposed to selected side without changing estimate", () => {
  const e = explainMatchup({ ...base, side: "Under", history: history() });
  assert.ok(e.cautions.some((x) => x.includes("disagree")));
  assert.equal(base.simProbability, 0.999);
});

test("wrong-opponent defensive rates are never presented as matchup evidence", () => {
  const e = explainMatchup({
    ...base,
    opponentDefense: { ...def, teamId: "WRONG" },
  });
  assert.ok(!e.observations.some((x) => x.includes("115.0 PPG")));
  assert.ok(
    e.missing.some((x) => x.includes("Market-specific opponent allowance")),
  );
});
