import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalPropMarketKey,
  filterPicksByAskMarketConstraint,
  filterPropPoolByAskMarkets,
  parseCoachAskMarketConstraint,
  propMarketKeyAllowed,
} from "./coachAskMarketFilter.ts";
import { askAllowsNcaafPlayerProps, askRequiresFootballPropMix } from "./boardScanPropDelivery.ts";

test("phone ask: rushing and passing yards → props-only rush+pass yds", () => {
  const c = parseCoachAskMarketConstraint("10 lag rushing and passing yards");
  assert.equal(c.propsOnly, true);
  assert.deepEqual(c.allowedMarketKeys?.slice().sort(), [
    "player_pass_yds",
    "player_rush_yds",
  ]);
});

test("phone ask: NFL rushing and receiving yards only → props-only rush+rec yds", () => {
  const c = parseCoachAskMarketConstraint(
    "5 leg NFL rushing and receiving yards only",
  );
  assert.equal(c.propsOnly, true);
  assert.deepEqual(c.allowedMarketKeys?.slice().sort(), [
    "player_reception_yds",
    "player_rush_yds",
  ]);
});

test("canonicalPropMarketKey keeps alt/period yards inside the allowlist", () => {
  assert.equal(canonicalPropMarketKey("player_rush_yds_alternate"), "player_rush_yds");
  assert.equal(canonicalPropMarketKey("player_pass_yds_h1"), "player_pass_yds");
  assert.ok(propMarketKeyAllowed("player_rush_yds_alternate", ["player_rush_yds"]));
  assert.equal(propMarketKeyAllowed("player_rush_attempts", ["player_rush_yds"]), false);
  assert.equal(propMarketKeyAllowed("player_pass_interceptions", ["player_pass_yds"]), false);
  assert.equal(propMarketKeyAllowed("player_receptions", ["player_reception_yds"]), false);
});

test("filterPropPoolByAskMarkets drops attempts/receptions/INTs when yards asked", () => {
  const allowed = parseCoachAskMarketConstraint(
    "10 lag rushing and passing yards",
  ).allowedMarketKeys;
  const pool = [
    { marketKey: "player_rush_yds", player: "Barkley" },
    { marketKey: "player_rush_yds_alternate", player: "Henry" },
    { marketKey: "player_rush_attempts", player: "Lamar" },
    { marketKey: "player_pass_yds", player: "Allen" },
    { marketKey: "player_pass_interceptions", player: "Mahomes" },
    { marketKey: "player_receptions", player: "Waller" },
  ];
  const out = filterPropPoolByAskMarkets(pool, allowed);
  assert.deepEqual(
    out.map((r) => r.marketKey).sort(),
    ["player_pass_yds", "player_rush_yds", "player_rush_yds_alternate"],
  );
});

test("filterPicksByAskMarketConstraint blocks totals and non-yards props (screenshot leak)", () => {
  const c = parseCoachAskMarketConstraint("10 lag rushing and passing yards");
  const picks = [
    { isProp: false, market: "F5 TOTAL", pick: "Under 5.5" },
    { isProp: false, market: "TOTAL", pick: "Over 8.5" },
    {
      isProp: true,
      market: "RUSH ATTEMPTS",
      propMarketKey: "player_rush_attempts",
      pick: "Lamar Under 6.5",
    },
    {
      isProp: true,
      market: "RECEPTIONS",
      propMarketKey: "player_receptions",
      pick: "Waller Over 1.5",
    },
    {
      isProp: true,
      market: "PASS INTS",
      propMarketKey: "player_pass_interceptions",
      pick: "Mahomes Over 0.5",
    },
    {
      isProp: true,
      market: "RUSH YDS",
      propMarketKey: "player_rush_yds",
      pick: "Barkley Over 75.5",
    },
    {
      isProp: true,
      market: "PASS YDS",
      propMarketKey: "player_pass_yds_alternate",
      pick: "Allen Over 249.5",
    },
  ];
  const out = filterPicksByAskMarketConstraint(picks, c);
  assert.equal(out.length, 2);
  assert.ok(out.every((p) => p.isProp));
  assert.ok(
    out.every((p) =>
      /rush_yds|pass_yds/.test(canonicalPropMarketKey(p.propMarketKey)),
    ),
  );
});

test("generic parlay ask has no market constraint", () => {
  const c = parseCoachAskMarketConstraint("5 leg NFL parlay");
  assert.equal(c.propsOnly, false);
  assert.equal(c.gameLinesOnly, false);
  assert.equal(c.maxGames, null);
  assert.equal(c.allowedMarketKeys, null);
});

test("generic asks stay market-unlocked (mix path) — examples from lock-in", () => {
  for (const ask of [
    "5 leg",
    "7 leg parlay",
    "10 leg Saints",
    "give me a parlay",
    "8 leg NFL",
  ]) {
    const c = parseCoachAskMarketConstraint(ask);
    assert.equal(c.propsOnly, false, ask);
    assert.equal(c.gameLinesOnly, false, ask);
    assert.equal(c.allowedMarketKeys, null, ask);
  }
});

test("explicit locks stay locked — props / TD / sport-only soccer", () => {
  const props = parseCoachAskMarketConstraint("5 player props");
  assert.equal(props.propsOnly, true);
  assert.equal(props.gameLinesOnly, false);

  const td = parseCoachAskMarketConstraint("5 touchdowns");
  assert.equal(td.propsOnly, true);
  assert.ok(td.allowedMarketKeys?.some((k) => /td/i.test(k)));

  const soccer = parseCoachAskMarketConstraint("4 soccer");
  assert.equal(soccer.propsOnly, false, "sport lock must not force propsOnly");
  assert.equal(soccer.gameLinesOnly, false, "sport lock must keep broad market mix");
  assert.equal(soccer.allowedMarketKeys, null);
});

test("screenshot ask: nfl rushing receiving and passing props → props-only skill families", () => {
  const c = parseCoachAskMarketConstraint(
    "9 leg nfl rushing receiving and passing props",
  );
  assert.equal(c.propsOnly, true);
  assert.deepEqual(c.allowedMarketKeys?.slice().sort(), [
    "player_pass_attempts",
    "player_pass_completions",
    "player_pass_interceptions",
    "player_pass_tds",
    "player_pass_yds",
    "player_reception_tds",
    "player_reception_yds",
    "player_receptions",
    "player_rush_attempts",
    "player_rush_tds",
    "player_rush_yds",
  ]);
});

test("skill props ask drops spreads/totals from ticket (screenshot lead-spread leak)", () => {
  const c = parseCoachAskMarketConstraint(
    "9 leg nfl rushing receiving and passing props",
  );
  const picks = [
    {
      isProp: false,
      market: "SPREAD",
      pick: "Falcons +6",
    },
    {
      isProp: false,
      market: "TOTAL",
      pick: "Over 47.5",
    },
    {
      isProp: true,
      market: "PASS TDS",
      propMarketKey: "player_pass_tds",
      pick: "Aaron Rodgers Under 1.5 Pass TDs",
    },
    {
      isProp: true,
      market: "PASS INTS",
      propMarketKey: "player_pass_interceptions",
      pick: "Patrick Mahomes Over 0.5 Pass INTs",
    },
    {
      isProp: true,
      market: "RUSH ATTEMPTS",
      propMarketKey: "player_rush_attempts",
      pick: "Lamar Jackson Under 6.5 Rush Attempts",
    },
    {
      isProp: true,
      market: "RECEPTIONS",
      propMarketKey: "player_receptions",
      pick: "Cade Otton Over 3.5 Receptions",
    },
    {
      isProp: true,
      market: "ANYTIME TD",
      propMarketKey: "player_anytime_td",
      pick: "Someone Anytime TD",
    },
  ];
  const out = filterPicksByAskMarketConstraint(picks, c);
  assert.equal(out.length, 4);
  assert.ok(out.every((p) => p.isProp));
  assert.ok(!out.some((p) => /spread|total/i.test(String(p.market))));
  assert.ok(!out.some((p) => p.propMarketKey === "player_anytime_td"));
});

test("rushing props alone allowlists rush family only", () => {
  const c = parseCoachAskMarketConstraint("6 leg NFL rushing props");
  assert.equal(c.propsOnly, true);
  assert.deepEqual(c.allowedMarketKeys?.slice().sort(), [
    "player_rush_attempts",
    "player_rush_tds",
    "player_rush_yds",
  ]);
});

test("props without skill words does not constrain markets", () => {
  const c = parseCoachAskMarketConstraint("9 leg nfl props");
  // Still props-only (no ML/spread/total fill) — just no market-key allowlist.
  assert.equal(c.propsOnly, true);
  assert.equal(c.allowedMarketKeys, null);
});

test("N leg NFL player props / just player props → propsOnly (no game-line fill)", () => {
  for (const ask of [
    "10 leg NFL player props",
    "10-leg nfl player props",
    "6 leg player props",
    "player props only",
    "just player props",
    "10 leg props",
    // Phone: "9 lag NFL player prop" skipped propsOnly → spreads/totals.
    "9 lag NFL player prop",
    "9 lag nfl player props",
    // Phone: asked for player props + teams → still propsOnly (no game-line fill).
    "player props for bears and broncos",
    "player prop bears broncos",
    // Phone: "5 leg soccer" staged 1 Asian spread — must be propsOnly.
    "5 leg soccer",
    "6 leg nba",
  ]) {
    const c = parseCoachAskMarketConstraint(ask);
    assert.equal(c.propsOnly, true, ask);
    assert.equal(c.gameLinesOnly, false, ask);
    assert.equal(c.allowedMarketKeys, null, ask);
  }
  // Mixed "with player props" stays on the board-scan mix path.
  const mixed = parseCoachAskMarketConstraint("10 leg with player props");
  assert.equal(mixed.propsOnly, false);
  // Phone: "9 leg tonight mixed sports" must not be propsOnly (was 4 HR / 1 game).
  assert.equal(
    parseCoachAskMarketConstraint("9 leg tonight mixed sports").propsOnly,
    false,
  );
  assert.equal(
    parseCoachAskMarketConstraint("8 leg multi-sport tonight").propsOnly,
    false,
  );
  // Bare number + slate day is mix (not props-only).
  assert.equal(parseCoachAskMarketConstraint("5 leg for tomorrow").propsOnly, false);
  assert.equal(parseCoachAskMarketConstraint("8 legs tonight").propsOnly, false);
  // Explicit no-props stays game-lines-only.
  const none = parseCoachAskMarketConstraint("10 leg nfl with no player props");
  assert.equal(none.propsOnly, false);
  assert.equal(none.gameLinesOnly, true);
});

test("rushing yards and passing TDs locks both named families (not pass yards)", () => {
  const c = parseCoachAskMarketConstraint("rushing yards and passing TDs");
  assert.equal(c.propsOnly, true);
  const keys = c.allowedMarketKeys?.slice().sort() ?? [];
  assert.ok(keys.includes("player_rush_yds"));
  assert.ok(keys.includes("player_anytime_td"));
  assert.ok(keys.includes("player_pass_tds"));
  assert.equal(keys.includes("player_pass_yds"), false);
});

test("passing and receiving yards allowlists both pass and reception yards", () => {
  const c = parseCoachAskMarketConstraint("passing and receiving yards");
  assert.equal(c.propsOnly, true);
  assert.deepEqual(c.allowedMarketKeys?.slice().sort(), [
    "player_pass_yds",
    "player_reception_yds",
  ]);
});

test("rushing, passing, and receiving yards allowlists all three", () => {
  const c = parseCoachAskMarketConstraint("rushing, passing, and receiving yards");
  assert.equal(c.propsOnly, true);
  assert.deepEqual(c.allowedMarketKeys?.slice().sort(), [
    "player_pass_yds",
    "player_reception_yds",
    "player_rush_yds",
  ]);
});

test("screenshot ask: 3 leg home run → props-only HR markets", () => {
  const c = parseCoachAskMarketConstraint("3 leg home run");
  assert.equal(c.propsOnly, true);
  assert.deepEqual(c.allowedMarketKeys, ["batter_home_runs"]);
});

test("home run ask drops spreads and strikeouts (screenshot leak)", () => {
  const c = parseCoachAskMarketConstraint("3 leg home run");
  const picks = [
    {
      isProp: false,
      market: "ALT SPREAD",
      pick: "Jays +1.5",
    },
    {
      isProp: true,
      market: "STRIKEOUTS",
      propMarketKey: "pitcher_strikeouts",
      pick: "Kade Anderson Under 5.5 Strikeouts",
    },
    {
      isProp: true,
      market: "HOME RUNS",
      propMarketKey: "batter_home_runs",
      pick: "Vladimir Guerrero Jr. Over 0.5 Home Runs",
    },
    {
      isProp: true,
      market: "HOME RUNS",
      propMarketKey: "batter_home_runs_alternate",
      pick: "Shohei Ohtani Over 0.5 Home Runs",
    },
    {
      isProp: true,
      market: "HITS",
      propMarketKey: "batter_hits",
      pick: "Someone Over 1.5 Hits",
    },
  ];
  const out = filterPicksByAskMarketConstraint(picks, c);
  assert.equal(out.length, 2);
  assert.ok(out.every((p) => p.isProp));
  assert.ok(
    out.every((p) =>
      canonicalPropMarketKey(p.propMarketKey) === "batter_home_runs",
    ),
  );
});

test("hr / homer shorthand also locks home-run props", () => {
  assert.equal(parseCoachAskMarketConstraint("6 leg hr").propsOnly, true);
  assert.deepEqual(parseCoachAskMarketConstraint("6 leg hr").allowedMarketKeys, [
    "batter_home_runs",
  ]);
  assert.equal(parseCoachAskMarketConstraint("4 leg homers tonight").propsOnly, true);
});

test("no player props / game lines only → gameLinesOnly", () => {
  const a = parseCoachAskMarketConstraint("10 leg nfl with no player props");
  assert.equal(a.gameLinesOnly, true);
  assert.equal(a.propsOnly, false);
  const b = parseCoachAskMarketConstraint("8 leg without props");
  assert.equal(b.gameLinesOnly, true);
  const c = parseCoachAskMarketConstraint("game lines only 6 leg");
  assert.equal(c.gameLinesOnly, true);
  const stacked = parseCoachAskMarketConstraint(
    "10 leg with no player props only from 2 games",
  );
  assert.equal(stacked.gameLinesOnly, true);
  assert.equal(stacked.maxGames, 2);
  // Genuine props-only asks are not gameLinesOnly.
  assert.equal(parseCoachAskMarketConstraint("player props only parlay").gameLinesOnly, false);
  assert.equal(parseCoachAskMarketConstraint("6 leg player props only").gameLinesOnly, false);
});

test("only from 2 games raises maxGames", () => {
  const c = parseCoachAskMarketConstraint("10 leg but only from 2 games");
  assert.equal(c.maxGames, 2);
  assert.equal(parseCoachAskMarketConstraint("6 leg from 3 games").maxGames, 3);
});

test("filterPicksByAskMarketConstraint drops props when gameLinesOnly", () => {
  const picks = [
    { isProp: false, market: "Total", pick: "Over 42.5" },
    { isProp: true, market: "player_rush_yds", pick: "Over 65.5", propMarketKey: "player_rush_yds" },
  ];
  const out = filterPicksByAskMarketConstraint(picks, {
    propsOnly: false,
    gameLinesOnly: true,
    excludeTotals: false,
    maxGames: null,
    allowedMarketKeys: null,
  });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.isProp, false);
});

test("Bet365 no over/under NHL → gameLinesOnly + excludeTotals", () => {
  const c = parseCoachAskMarketConstraint(
    "Bet 365 doesn't have over or under for NHL so give me 4 different ones.",
  );
  assert.equal(c.gameLinesOnly, true);
  assert.equal(c.excludeTotals, true);
  assert.equal(c.propsOnly, false);
  const picks = [
    { isProp: false, market: "Moneyline", pick: "Penguins" },
    { isProp: false, market: "Puck Line", pick: "Oilers -1.5" },
    { isProp: false, market: "Total", pick: "Over 6.5" },
    { isProp: true, market: "Points", pick: "Under 0.5" },
  ];
  const out = filterPicksByAskMarketConstraint(picks, c);
  assert.equal(out.length, 2);
  assert.ok(out.every((p) => !p.isProp && !/total/i.test(p.market)));
});

test("5 leg NHL team props → game lines (not player Under 0.5 stack)", () => {
  const c = parseCoachAskMarketConstraint("5 leg NHL team props");
  assert.equal(c.propsOnly, false, "team props must not be propsOnly");
  assert.equal(c.gameLinesOnly, true);
  assert.equal(c.excludeTotals, false, "team totals stay available");
  const out = filterPicksByAskMarketConstraint(
    [
      { isProp: true, market: "Points", pick: "Zach Werenski Under 0.5" },
      { isProp: false, market: "Moneyline", pick: "Blue Jackets" },
      { isProp: false, market: "Total", pick: "Under 6.5" },
      { isProp: false, market: "Puck Line", pick: "Sabres +1.5" },
    ],
    c,
  );
  assert.equal(out.length, 3);
  assert.ok(out.every((p) => !p.isProp));
  // Explicit player props still win.
  assert.equal(
    parseCoachAskMarketConstraint("5 leg NHL player props").propsOnly,
    true,
  );
});

test("bare college / NCAAF / Collage → gameLinesOnly team markets (no player props)", () => {
  // Phone: college books mostly lack player props — bare collage/college stays
  // on FG + period + team totals. Explicit player props / yards still opt in.
  for (const ask of [
    "8 leg college",
    "8 leg Collage",
    "8 leg college football",
    "10-leg NCAAF",
    "6 leg cfb",
    "8 leg collage football",
  ]) {
    const c = parseCoachAskMarketConstraint(ask);
    assert.equal(c.propsOnly, false, `${ask}: not propsOnly`);
    assert.equal(c.gameLinesOnly, true, `${ask}: team markets / gameLinesOnly`);
    assert.equal(askAllowsNcaafPlayerProps(ask), false, `${ask}: no player props`);
    assert.equal(askRequiresFootballPropMix(ask), false, `${ask}: not prop mix`);
  }
  // Explicit CFB player props still props-only.
  const propsAsk = parseCoachAskMarketConstraint("8 leg college football player props");
  assert.equal(propsAsk.propsOnly, true);
  assert.equal(propsAsk.gameLinesOnly, false);
  assert.equal(askAllowsNcaafPlayerProps("8 leg college football player props"), true);
  // Explicit team props stay on team markets (no yards).
  const teamAsk = parseCoachAskMarketConstraint("7 leg college team props");
  assert.equal(teamAsk.gameLinesOnly, true);
  assert.equal(askAllowsNcaafPlayerProps("7 leg college team props"), false);
  // Mixed soccer + college must not kill soccer props via gameLinesOnly,
  // and must still strip CFB player props unless the ask named them.
  const mixed = parseCoachAskMarketConstraint("8 leg soccer and college");
  assert.equal(mixed.gameLinesOnly, false, "mixed board stays off gameLinesOnly");
  assert.equal(askAllowsNcaafPlayerProps("8 leg soccer and college"), false);
});

test("RC3: explicit market locks beat college gameLinesOnly default (all 30 families)", () => {
  // Every EXPLICIT_MARKET_LOCK_RULES label on an ncaaf ask must keep its lock —
  // college automatic game-lines default must not silently discard named intent.
  const RC3_ASKS: Array<{ ask: string; key: string }> = [
    { ask: "5 leg ncaaf pitcher strikeouts", key: "pitcher_strikeouts" },
    { ask: "5 leg ncaaf hits+runs+RBIs", key: "batter_hits_runs_rbis" },
    { ask: "5 leg ncaaf stolen bases", key: "batter_stolen_bases" },
    { ask: "5 leg ncaaf total bases", key: "batter_total_bases" },
    { ask: "5 leg ncaaf RBIs", key: "batter_rbis" },
    { ask: "5 leg ncaaf hits", key: "batter_hits" },
    { ask: "5 leg ncaaf runs", key: "batter_runs" },
    { ask: "5 leg ncaaf passing attempts", key: "player_pass_attempts" },
    { ask: "5 leg ncaaf rushing attempts", key: "player_rush_attempts" },
    { ask: "5 leg ncaaf longest completion", key: "player_pass_longest_completion" },
    { ask: "5 leg ncaaf longest rush", key: "player_rush_longest" },
    { ask: "5 leg ncaaf completions", key: "player_pass_completions" },
    { ask: "5 leg ncaaf pass interceptions", key: "player_pass_interceptions" },
    { ask: "5 leg ncaaf goal scorer", key: "player_goal_scorer_anytime" },
    { ask: "5 leg ncaaf shots on target", key: "player_shots_on_target" },
    { ask: "5 leg ncaaf shots on goal", key: "player_shots_on_goal" },
    { ask: "5 leg ncaaf shots", key: "player_shots" },
    { ask: "5 leg ncaaf goals", key: "player_goals" },
    { ask: "5 leg ncaaf pts+reb+ast", key: "player_points_rebounds_assists" },
    { ask: "5 leg ncaaf pts+reb", key: "player_points_rebounds" },
    { ask: "5 leg ncaaf pts+ast", key: "player_points_assists" },
    { ask: "5 leg ncaaf reb+ast", key: "player_rebounds_assists" },
    { ask: "5 leg ncaaf blocks+steals", key: "player_blocks_steals" },
    { ask: "5 leg ncaaf rebounds", key: "player_rebounds" },
    { ask: "5 leg ncaaf assists", key: "player_assists" },
    { ask: "5 leg ncaaf threes", key: "player_threes" },
    { ask: "5 leg ncaaf blocks", key: "player_blocks" },
    { ask: "5 leg ncaaf steals", key: "player_steals" },
    { ask: "5 leg ncaaf turnovers", key: "player_turnovers" },
    { ask: "5 leg ncaaf points", key: "player_points" },
  ];
  assert.equal(RC3_ASKS.length, 30, "must cover all 30 RC3 cases");

  for (const { ask, key } of RC3_ASKS) {
    const c = parseCoachAskMarketConstraint(ask);
    assert.equal(c.propsOnly, true, `${ask}: propsOnly`);
    assert.equal(c.gameLinesOnly, false, `${ask}: not gameLinesOnly`);
    assert.ok(c.allowedMarketKeys?.includes(key), `${ask}: missing ${key} got ${c.allowedMarketKeys}`);
    assert.equal(askAllowsNcaafPlayerProps(ask), true, `${ask}: allows NCAAF props opt-in`);
  }

  // Equivalent wording / college tokens still lock (not just "ncaaf").
  for (const ask of [
    "5 leg college completions",
    "5 leg cfb rushing attempts",
    "5 leg NCAAF longest rush",
    "6 leg college football pass interceptions",
    "8 leg collage completions",
  ]) {
    const c = parseCoachAskMarketConstraint(ask);
    assert.equal(c.propsOnly, true, ask);
    assert.equal(c.gameLinesOnly, false, ask);
    assert.ok(c.allowedMarketKeys && c.allowedMarketKeys.length > 0, ask);
  }

  // Already-working skill families stay locked.
  for (const ask of [
    "5 leg ncaaf passing yards",
    "5 leg ncaaf touchdowns",
    "5 leg ncaaf sacks",
    "5 leg ncaaf receptions",
  ]) {
    const c = parseCoachAskMarketConstraint(ask);
    assert.equal(c.propsOnly, true, ask);
    assert.equal(c.gameLinesOnly, false, ask);
    assert.ok(c.allowedMarketKeys?.length, ask);
  }

  // Bare college unchanged — still automatic team markets.
  const bare = parseCoachAskMarketConstraint("8 leg college");
  assert.equal(bare.gameLinesOnly, true);
  assert.equal(bare.propsOnly, false);
  assert.equal(bare.allowedMarketKeys, null);
});

test("thread prior props-only inherits onto refinement ask", () => {
  const c = parseCoachAskMarketConstraint("make it 5 for tomorrow", [
    "7 leg NFL player props",
  ]);
  assert.equal(c.propsOnly, true);
});
