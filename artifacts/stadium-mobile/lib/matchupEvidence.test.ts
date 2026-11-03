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

test("logged opportunity fills gaps across sports without inventing usage or ambiguous attempts", () => {
 for (const [sport, market, stat, field, label] of [
  ["nba", "player_points", "PTS", "fieldGoalsAttempted", "Field-goal attempts"],
  ["nfl", "player_rush_yds", "rushingYards", "rushingAttempts", "Carries"],
  ["ncaaf", "player_reception_yds", "receivingYards", "receivingTargets", "Targets"],
  ["mlb", "batter_hits", "H", "plateAppearances", "Plate appearances"],
  ["nhl", "player_shots_on_goal", "S", "shotsOnGoal", "Shots on goal"],
  ["soccer", "player_shots", "SH", "minutesPlayed", "Minutes played"],
 ]) {
  const h=history(sport,stat);
  h.recent=h.recent.map(g=>({...g,stats:{[stat]:"8",[field]:"8"}}));
  const e=explainMatchup({...base,sport,market,history:h});
  assert.ok(e.opportunity.some(t=>t.includes(`${label}: 8.0/game (based on 5 games`)),sport);
  assert.ok(!e.missing.some(t=>t.startsWith("Logged opportunity sample unavailable")),sport);
 }
 const h=history("nfl","rushingYards");
 h.recent=h.recent.map(g=>({...g,stats:{rushingYards:"12",ATT:"20"}}));
 assert.equal(explainMatchup({...base,sport:"nfl",market:"player_rush_yds",history:h}).opportunity.length,0);
});
test("conflicting aliases and short opportunity samples remain unavailable; missing is not zero",()=>{
 const h=history();
 h.recent=h.recent.map(g=>({...g,stats:{PTS:"12",FGA:"5",fieldGoalsAttempted:"9"}}));
 assert.equal(explainMatchup({...base,history:h}).opportunity.length,0);
 h.recent=h.recent.slice(0,2).map(g=>({...g,stats:{PTS:"12",FGA:"0"}}));
 assert.equal(explainMatchup({...base,history:h}).opportunity.length,0);
});

test("positional opponent observations require exact defending team, verified position, stat and pregame cutoff",()=>{
 const pack={source:"ESPN completed boxes",receivedAt:"2026-10-28T10:00Z",rows:[{position:"C",market:"player_points",per36:24,games:4,appearances:6,minutes:180,firstGame:"2026-10-20T00:00Z",lastGame:"2026-10-26T00:00Z"}]};
 const opts={...base,position:"C",opponentDefense:{...def,positionAllowances:pack}};
 assert.ok(explainMatchup(opts).observations.some(t=>t.includes("opposing C players produced 24.0")));
 for(const patch of [{position:null},{position:"F/C"},{market:"player_assists"},{opponentId:"wrong"},{startsAt:"2026-10-25T00:00Z"}])assert.ok(!explainMatchup({...opts,...patch}).observations.some(t=>t.includes("opposing C players")));
});

test("opponent threshold evidence counts games, never players, and requires matching sport/team",()=>{
 const games=[1,2,3].map(i=>({eventId:String(i),date:`2026-10-0${i}`,values:i===1?[5,6]:[1,2]}));
 const defense={...def,positionAllowances:{source:"verified boxes",receivedAt:"2026-10-04",rows:[],thresholds:[{position:"G",market:"player_threes",games}]}};
 const opts={...base,market:"player_threes",line:4.5,position:"PG",opponentDefense:defense};
 const evidence=explainMatchup(opts);
 assert.ok(evidence.observations.some(s=>s.includes("guard to exceed 4.5")&&s.includes("1/3 completed games")));
 for(const d of [{...defense,sport:"wnba"},{...defense,teamId:"wrong"}])assert.ok(!explainMatchup({...opts,opponentDefense:d}).observations.some(s=>s.includes("guard to exceed")));
});
test('shooting evidence uses only athlete-bound pregame history',()=>{
 const h=history();h.recent=h.recent.map(g=>({...g,stats:{...g.stats,FG:'4-10'}}));
 assert.ok(explainMatchup({...base,history:h}).observations.some(s=>s.includes('20/50 (40.0%); 30 misses')));
 assert.ok(!explainMatchup({...base,history:{...h,athleteId:'wrong'}}).observations.some(s=>s.startsWith('Shooting')));
 const future={...h,recent:h.recent.map(g=>({...g,date:'2027-01-01T12:00Z'}))};
 assert.ok(!explainMatchup({...base,history:future}).observations.some(s=>s.startsWith('Shooting')));
});
