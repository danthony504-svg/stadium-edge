import { test } from "node:test";
import assert from "node:assert/strict";
import { mentionsPropIntent, wantsPropsOnly, effectiveBuildLegCount, explicitSingleGameIntent, tonightExhaustedNote, wantsTonightSlate, threadWantsTonightSlate, filterTonightSlatePicks, localDayDiff, wantsTomorrowSlate, threadWantsTomorrowSlate, slateDayFromThread, slateOddsLabel, filterTomorrowSlatePicks, filterPicksForSlateDay, wantsMlbPitcherSlateAsk, wantsPropPickRecommendation, wantsSoccerScorerGoalkeeperPicks, isPregameBettableForSport, filterBettableOddsGames, filterBettablePicks, preferBettableQualifiedPicks } from "./slate.ts";

// A GENERIC parlay ask carries no prop words, so the today-only salvage and the
// reach-count backfill are both allowed to fill from real GAME-LEVEL mains.
test("generic parlay asks => false (game-main fill allowed)", () => {
  assert.equal(mentionsPropIntent("Build me a 7 leg soccer parlay for today"), false);
  assert.equal(mentionsPropIntent("6-leg parlay for tonight"), false);
  assert.equal(mentionsPropIntent("give me a safe 3 leg ticket"), false);
  assert.equal(mentionsPropIntent(""), false);
  assert.equal(mentionsPropIntent(null), false);
});

// Explicit prop / prop-market asks => true, so neither fill silently turns a
// props ticket into game moneylines.
test("explicit prop intent => true", () => {
  assert.equal(mentionsPropIntent("player props only"), true);
  assert.equal(mentionsPropIntent("give me some prop bets"), true);
  assert.equal(mentionsPropIntent("6 home run hitters today"), true);
  assert.equal(mentionsPropIntent("strikeout parlay"), true);
  assert.equal(mentionsPropIntent("anytime TD parlay"), true);
  assert.equal(mentionsPropIntent("3 shots on target legs"), true);
});

// Points-as-prop phrasing (a number/leg/over-under near "points") => true.
test("points-as-prop phrasing => true", () => {
  assert.equal(mentionsPropIntent("over 25.5 points parlay"), true);
  assert.equal(mentionsPropIntent("3 legs of player points"), true);
});

test("wantsPropsOnly: explicit-only phrasing, not mixed with-props phrasing", () => {
  assert.equal(wantsPropsOnly("Build me a 15 leg with player props"), false);
  assert.equal(wantsPropsOnly("player props only parlay"), true);
  assert.equal(wantsPropsOnly("6 leg strikeout parlay"), true);
  assert.equal(wantsPropsOnly("Build me a 7 leg soccer parlay for today"), false);
  assert.equal(wantsPropsOnly("6-leg parlay for tonight"), false);
});

test("effectiveBuildLegCount defaults bare parlay asks onto the compact path", () => {
  assert.equal(effectiveBuildLegCount("Build me a player props only parlay"), 6);
  assert.equal(effectiveBuildLegCount("build me a parlay"), 8);
  assert.equal(effectiveBuildLegCount("Build me a 9-leg parlay"), 9);
  assert.equal(effectiveBuildLegCount("what do you think of the Lakers?"), 0);
});

test("explicitSingleGameIntent: generic tonight parlay is NOT single-game", () => {
  assert.equal(explicitSingleGameIntent("Build me a 15-leg longshot parlay for tonight"), false);
  assert.equal(explicitSingleGameIntent("6-leg parlay for tonight"), false);
  assert.equal(explicitSingleGameIntent("same game parlay for Yankees @ Red Sox"), true);
  assert.equal(explicitSingleGameIntent("build a 6 leg for Yankees vs Red Sox"), true);
});

test("tonightExhaustedNote: blocks silent tomorrow padding when tonight slate is gone", () => {
  assert.match(
    tonightExhaustedNote({
      tonightRequested: true,
      todayOnlyApplied: false,
      surviving: 0,
      requestedLegs: 15,
    }),
    /tomorrow/i,
  );
  assert.equal(
    tonightExhaustedNote({
      tonightRequested: true,
      todayOnlyApplied: true,
      surviving: 0,
      requestedLegs: 15,
    }),
    "",
  );
});

test("wantsTonightSlate: bare N-leg parlay uses 48h window (not tonight-only)", () => {
  assert.equal(wantsTonightSlate("Build me a 5-leg parlay"), false);
  assert.equal(wantsTonightSlate("Build me the best parlay"), false);
  assert.equal(wantsTonightSlate("Build me a 5-leg parlay for tomorrow"), false);
  assert.equal(wantsTonightSlate("Build me a 5-leg parlay for tonight"), true);
  assert.equal(wantsTonightSlate("Build me a parlay tonight"), true);
});

test("wantsMlbPitcherSlateAsk detects pitcher/bullpen slate targeting", () => {
  assert.equal(
    wantsMlbPitcherSlateAsk("target all the worst pitchers, worst bullpen for today's slate"),
    true,
  );
  assert.equal(wantsMlbPitcherSlateAsk("Build me a 6-leg parlay"), false);
});

test("isPregameBettableForSport: coach uses 48h for all sports including soccer", () => {
  const inSixDays = new Date(Date.now() + 6 * 24 * 3600_000);
  assert.equal(isPregameBettableForSport(inSixDays.toISOString(), "soccer"), false);
  assert.equal(isPregameBettableForSport(inSixDays.toISOString(), "mlb"), false);
  const in36h = new Date(Date.now() + 36 * 3600_000);
  assert.equal(isPregameBettableForSport(in36h.toISOString(), "soccer"), true);
});

test("wantsSoccerScorerGoalkeeperPicks: ranked scorer vs keeper matchup ask", () => {
  const q =
    "Show me the best scorers facing the worst goalkeepers today. Include goals, shots on target, xG, keeper save %, goals allowed, clean sheet rate, confidence, and edge.";
  assert.equal(wantsSoccerScorerGoalkeeperPicks(q), true);
  assert.equal(wantsPropPickRecommendation(q), true);
  assert.equal(mentionsPropIntent(q), true);
});

test("wantsPropPickRecommendation: superlative prop asks without parlay phrasing", () => {
  assert.equal(
    wantsPropPickRecommendation("Give me the best HR for Dodgers and Padres tonight"),
    true,
  );
  assert.equal(wantsPropPickRecommendation("top strikeout plays today"), true);
  assert.equal(wantsPropPickRecommendation("best hr picks for tomorrow"), true);
  assert.equal(wantsPropPickRecommendation("Build me a 6-leg parlay for tonight"), false);
  assert.equal(wantsPropPickRecommendation("what is a home run prop?"), false);
  assert.equal(
    wantsPropPickRecommendation("willy adames or heliot ramos to hit a HR?"),
    false,
  );
});

test("slateDayFromThread: tomorrow beats tonight default", () => {
  assert.equal(slateDayFromThread("Build me a 8 leg for tomorrow", []), "tomorrow");
  assert.equal(slateDayFromThread("Build me the best parlay", []), null);
  assert.equal(slateOddsLabel("tomorrow"), "tomorrow's");
});

test("World Cup parlay for today's matches uses tonight slate", () => {
  const ask = "Build me a 2 leg World Cup parlay for today's matches";
  assert.equal(slateDayFromThread(ask, []), "tonight");
  assert.ok(wantsTonightSlate(ask));
});

test("filterTomorrowSlatePicks keeps only tomorrow kickoffs", () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(17, 35, 0, 0);
  const today = new Date();
  today.setHours(23, 0, 0, 0);
  const kept = filterPicksForSlateDay(
    [{ startsAt: tomorrow.toISOString() }, { startsAt: today.toISOString() }],
    "tomorrow",
  );
  assert.equal(kept.length, 1);
  assert.equal(localDayDiff(kept[0]!.startsAt!), 1);
});

test("threadWantsTonightSlate: inherits tonight from prior user turn", () => {
  assert.equal(
    threadWantsTonightSlate("make it safer", ["Build me a 6-leg parlay for tonight"]),
    true,
  );
  assert.equal(
    threadWantsTonightSlate("add one more leg", ["Build me a parlay for tomorrow"]),
    false,
  );
});

test("filterTonightSlatePicks drops tomorrow kickoffs", () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(17, 35, 0, 0);
  const kept = filterTonightSlatePicks([
    { startsAt: tomorrow.toISOString() },
    { startsAt: null },
  ]);
  assert.equal(kept.length, 0);
  assert.equal(localDayDiff(tomorrow.toISOString()), 1);
});

test("filterBettableOddsGames drops games outside the 48h coach window", () => {
  const soon = new Date(Date.now() + 6 * 3600_000).toISOString();
  const september = new Date(Date.now() + 54 * 24 * 3600_000).toISOString();
  const kept = filterBettableOddsGames([
    { sport: "ncaaf", commenceTime: soon },
    { sport: "ncaaf", commenceTime: september },
  ]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0]?.commenceTime, soon);
});

test("preferBettableQualifiedPicks drops far-future legs with known kickoff", () => {
  const soon = new Date(Date.now() + 6 * 3600_000).toISOString();
  const inNineDays = new Date(Date.now() + 9 * 24 * 3600_000).toISOString();
  const kept = preferBettableQualifiedPicks([
    { sport: "soccer", startsAt: soon },
    { sport: "soccer", startsAt: inNineDays },
  ]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0]?.startsAt, soon);
});

test("preferBettableQualifiedPicks returns empty when every leg is outside 48h", () => {
  const inNineDays = new Date(Date.now() + 9 * 24 * 3600_000).toISOString();
  const kept = preferBettableQualifiedPicks([
    { sport: "soccer", startsAt: inNineDays },
    { sport: "mlb", startsAt: inNineDays },
  ]);
  assert.equal(kept.length, 0);
});

test("filterBettablePicks drops far-future legs from a mixed ticket", () => {
  const soon = new Date(Date.now() + 6 * 3600_000).toISOString();
  const september = new Date(Date.now() + 54 * 24 * 3600_000).toISOString();
  const kept = filterBettablePicks([
    { sport: "wnba", startsAt: soon },
    { sport: "ncaaf", startsAt: september },
  ]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0]?.sport, "wnba");
});
