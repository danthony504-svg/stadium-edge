import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  filterPicksByAskMarketConstraint,
  filterPropPoolByAskMarkets,
  parseCoachAskMarketConstraint,
  propMarketKeyAllowed,
} from "./coachAskMarketFilter.ts";
import {
  EXPLICIT_MARKET_LOCK_RULES,
  askHasExplicitMarketLock,
  canonicalExplicitMarketKey,
  matchExplicitMarketLocks,
} from "./explicitMarketLock.ts";
import {
  propsOnlyLegClearsOdds,
  PROPS_ONLY_RECOVERY_ODDS_SLACK,
  gradeFootballPropFromHistory,
} from "./coachFootballPropsOnlyGrade.ts";
import { stageFootballPropsOnlyLegs } from "./coachFootballPropsOnly.ts";
import type { ParsedPick } from "../components/PickCard.tsx";
import type { BoardScoredLeg } from "./ticketStaging.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every supported explicit family → canonical provider key(s). */
const FAMILY_CASES: Array<{
  ask: string;
  id: string;
  keys: string[];
  reject?: string[];
}> = [
  // NBA / WNBA
  { ask: "5 leg NBA blocks", id: "nba_blocks", keys: ["player_blocks"], reject: ["player_steals", "player_points"] },
  { ask: "6 leg WNBA blocks props", id: "nba_blocks", keys: ["player_blocks"] },
  { ask: "5 leg threes", id: "nba_threes", keys: ["player_threes"], reject: ["player_points"] },
  { ask: "4 leg 3s tonight", id: "nba_threes", keys: ["player_threes"] },
  { ask: "5 leg 3pm props", id: "nba_threes", keys: ["player_threes"] },
  { ask: "6 leg assists", id: "nba_assists", keys: ["player_assists"], reject: ["player_rebounds"] },
  { ask: "5 leg rebounds", id: "nba_rebounds", keys: ["player_rebounds"], reject: ["player_assists"] },
  { ask: "5 leg steals", id: "nba_steals", keys: ["player_steals"], reject: ["batter_stolen_bases"] },
  { ask: "5 leg NBA points props", id: "nba_points", keys: ["player_points"] },
  { ask: "4 leg turnovers", id: "nba_turnovers", keys: ["player_turnovers"] },
  { ask: "5 leg PRA", id: "nba_pra", keys: ["player_points_rebounds_assists"] },
  { ask: "5 leg pts+reb", id: "nba_pts_reb", keys: ["player_points_rebounds"] },
  // MLB
  { ask: "3 leg home run", id: "mlb_home_runs", keys: ["batter_home_runs"], reject: ["pitcher_strikeouts", "batter_hits"] },
  { ask: "6 leg hr", id: "mlb_home_runs", keys: ["batter_home_runs"] },
  { ask: "5 leg homers", id: "mlb_home_runs", keys: ["batter_home_runs"] },
  { ask: "5 leg strikeouts", id: "mlb_strikeouts", keys: ["pitcher_strikeouts"], reject: ["pitcher_outs"] },
  { ask: "5 leg Ks", id: "mlb_strikeouts", keys: ["pitcher_strikeouts"], reject: ["pitcher_outs"] },
  { ask: "5 leg hits props", id: "mlb_hits", keys: ["batter_hits"], reject: ["batter_home_runs"] },
  { ask: "4 leg total bases", id: "mlb_total_bases", keys: ["batter_total_bases"] },
  { ask: "5 leg RBI", id: "mlb_rbis", keys: ["batter_rbis"] },
  { ask: "5 leg RBIs", id: "mlb_rbis", keys: ["batter_rbis"] },
  { ask: "5 leg stolen bases", id: "mlb_stolen_bases", keys: ["batter_stolen_bases"], reject: ["player_steals"] },
  { ask: "5 leg SB props", id: "mlb_stolen_bases", keys: ["batter_stolen_bases"], reject: ["player_steals"] },
  { ask: "5 leg hits + runs + rbis", id: "mlb_hits_runs_rbis", keys: ["batter_hits_runs_rbis"] },
  // NHL
  { ask: "5 leg NHL goals", id: "nhl_soccer_goals", keys: ["player_goals"] },
  { ask: "5 leg assists props", id: "nba_assists", keys: ["player_assists"] },
  { ask: "5 leg NHL points props", id: "nba_points", keys: ["player_points"] },
  { ask: "5 leg SOG", id: "nhl_shots_on_goal", keys: ["player_shots_on_goal"], reject: ["player_shots"] },
  { ask: "5 leg shots on goal", id: "nhl_shots_on_goal", keys: ["player_shots_on_goal"] },
  // Soccer
  { ask: "5 leg SOT", id: "soccer_shots_on_target", keys: ["player_shots_on_target"], reject: ["player_shots"] },
  { ask: "5 leg shots on target", id: "soccer_shots_on_target", keys: ["player_shots_on_target"] },
  { ask: "5 leg shots props", id: "soccer_shots", keys: ["player_shots"], reject: ["player_shots_on_target"] },
  { ask: "5 leg anytime goal", id: "soccer_nhl_goal_scorer", keys: ["player_goal_scorer_anytime"] },
  // NFL / NCAAF
  { ask: "5 leg touchdown", id: "fb_touchdowns", keys: ["player_anytime_td", "player_first_td", "player_rush_tds", "player_reception_tds", "player_pass_tds"] },
  { ask: "5 leg td", id: "fb_touchdowns", keys: ["player_anytime_td"] },
  { ask: "4 leg first touchdown", id: "fb_first_td", keys: ["player_first_td"] },
  { ask: "5 leg rushing yards", id: "fb_rush_yds", keys: ["player_rush_yds"], reject: ["player_rush_attempts", "player_reception_yds"] },
  { ask: "5 leg passing yards", id: "fb_pass_yds", keys: ["player_pass_yds"] },
  { ask: "5 leg receiving yards", id: "fb_rec_yds", keys: ["player_reception_yds"] },
  { ask: "5 leg receptions", id: "fb_receptions", keys: ["player_receptions"] },
  { ask: "5 leg sacks", id: "fb_sacks", keys: ["player_sacks"] },
  { ask: "5 leg completions", id: "fb_completions", keys: ["player_pass_completions"] },
  { ask: "4 leg field goals", id: "fb_field_goals", keys: ["player_field_goals"] },
];

test("explicit lock: every supported family + alias maps to canonical provider keys", () => {
  for (const c of FAMILY_CASES) {
    const m = matchExplicitMarketLocks(c.ask);
    assert.ok(m, `expected lock for: ${c.ask}`);
    assert.ok(m!.ids.includes(c.id), `${c.ask} → ids ${m!.ids.join(",")} missing ${c.id}`);
    for (const k of c.keys) {
      assert.ok(
        m!.allowedMarketKeys.includes(k),
        `${c.ask} missing key ${k} (got ${m!.allowedMarketKeys.join(",")})`,
      );
    }
    const parsed = parseCoachAskMarketConstraint(c.ask);
    assert.equal(parsed.propsOnly, true, c.ask);
    assert.ok(parsed.allowedMarketKeys?.length, c.ask);
    for (const k of c.keys) {
      assert.ok(parsed.allowedMarketKeys!.includes(k), `parse missing ${k} for ${c.ask}`);
    }
    for (const bad of c.reject ?? []) {
      assert.equal(
        parsed.allowedMarketKeys!.includes(bad),
        false,
        `${c.ask} must not include ${bad}`,
      );
      assert.equal(propMarketKeyAllowed(bad, parsed.allowedMarketKeys), false, c.ask);
    }
  }
});

test("alias precedence: SB before steals, SOT before shots", () => {
  const sb = matchExplicitMarketLocks("5 leg SB props");
  assert.deepEqual(sb?.allowedMarketKeys, ["batter_stolen_bases"]);
  assert.equal(sb?.ids.includes("nba_steals"), false);

  const stealBase = matchExplicitMarketLocks("steal a base tonight");
  assert.deepEqual(stealBase?.allowedMarketKeys, ["batter_stolen_bases"]);

  const steals = matchExplicitMarketLocks("5 leg steals");
  assert.deepEqual(steals?.allowedMarketKeys, ["player_steals"]);

  const sot = matchExplicitMarketLocks("5 leg SOT");
  assert.deepEqual(sot?.allowedMarketKeys, ["player_shots_on_target"]);
  assert.equal(sot?.ids.includes("soccer_shots"), false);

  const shots = matchExplicitMarketLocks("5 leg shots");
  assert.deepEqual(shots?.allowedMarketKeys, ["player_shots"]);

  // Span blanking: "shots on target" does not also lock bare shots.
  const phrase = matchExplicitMarketLocks("shots on target parlay");
  assert.deepEqual(phrase?.allowedMarketKeys, ["player_shots_on_target"]);
});

test("strikeouts / Ks never lock pitcher_outs", () => {
  for (const ask of ["5 leg strikeouts", "5 leg Ks", "pitcher strikeouts props"]) {
    const c = parseCoachAskMarketConstraint(ask);
    assert.deepEqual(c.allowedMarketKeys, ["pitcher_strikeouts"]);
    assert.equal(propMarketKeyAllowed("pitcher_outs", c.allowedMarketKeys), false);
    assert.equal(propMarketKeyAllowed("pitcher_outs_alternate", c.allowedMarketKeys), false);
  }
});

test("same-stat alternate recovery stays inside locked family", () => {
  const hr = parseCoachAskMarketConstraint("3 leg home run");
  const pool = [
    { marketKey: "batter_home_runs", player: "Judge" },
    { marketKey: "batter_home_runs_alternate", player: "Ohtani" },
    { marketKey: "batter_hits", player: "Soto" },
    { marketKey: "pitcher_strikeouts", player: "Cole" },
  ];
  const filtered = filterPropPoolByAskMarkets(pool, hr.allowedMarketKeys);
  assert.deepEqual(
    filtered.map((r) => r.marketKey).sort(),
    ["batter_home_runs", "batter_home_runs_alternate"],
  );

  const threes = parseCoachAskMarketConstraint("5 leg threes");
  assert.ok(propMarketKeyAllowed("player_threes_alternate", threes.allowedMarketKeys));
  assert.equal(propMarketKeyAllowed("player_points_alternate", threes.allowedMarketKeys), false);

  const rush = parseCoachAskMarketConstraint("5 leg rushing yards");
  assert.ok(propMarketKeyAllowed("player_rush_yds_alternate", rush.allowedMarketKeys));
  assert.equal(propMarketKeyAllowed("player_pass_yds_alternate", rush.allowedMarketKeys), false);
  assert.equal(propMarketKeyAllowed("player_receptions", rush.allowedMarketKeys), false);
});

test("blocks / steals: no cross-fill into other NBA stats", () => {
  // props.ts ALT_MARKETS: NBA alts are points/rebounds/assists/threes only —
  // blocks/steals alts are never posted, so recovery cannot invent them.
  const blocks = parseCoachAskMarketConstraint("5 leg blocks");
  assert.deepEqual(blocks.allowedMarketKeys, ["player_blocks"]);
  assert.equal(propMarketKeyAllowed("player_steals", blocks.allowedMarketKeys), false);
  assert.equal(propMarketKeyAllowed("player_points", blocks.allowedMarketKeys), false);
  assert.equal(propMarketKeyAllowed("player_threes", blocks.allowedMarketKeys), false);
});

test("insufficient qualifying lines: filter keeps short ticket, never cross-fills", () => {
  const c = parseCoachAskMarketConstraint("7 leg blocks");
  const picks = [
    {
      isProp: true,
      market: "BLOCKS",
      propMarketKey: "player_blocks",
      pick: "A Over 1.5",
    },
    {
      isProp: true,
      market: "BLOCKS",
      propMarketKey: "player_blocks",
      pick: "B Over 0.5",
    },
    {
      isProp: true,
      market: "STEALS",
      propMarketKey: "player_steals",
      pick: "C Over 1.5",
    },
    {
      isProp: true,
      market: "POINTS",
      propMarketKey: "player_points",
      pick: "D Over 24.5",
    },
    { isProp: false, market: "SPREAD", pick: "Lakers -3.5" },
  ];
  const out = filterPicksByAskMarketConstraint(picks, c);
  assert.equal(out.length, 2);
  assert.ok(out.every((p) => propMarketKeyAllowed(p.propMarketKey, c.allowedMarketKeys)));
  // Honest shortfall — fewer than asked 7, no steals/points fill.
  assert.ok(out.length < 7);
});

test("mixed / general asks stay unlocked (variety path)", () => {
  for (const ask of [
    "5 leg NFL parlay",
    "9 leg tonight mixed sports",
    "8 leg multi-sport tonight",
    "10 leg with player props",
    "5 leg for tomorrow",
    "8 legs tonight",
    "12 leg tonight",
  ]) {
    assert.equal(askHasExplicitMarketLock(ask), false, ask);
    const c = parseCoachAskMarketConstraint(ask);
    assert.equal(c.allowedMarketKeys, null, ask);
    assert.equal(c.propsOnly, false, ask);
  }
  // Props-only without a named market stays unlocked allowlist.
  const propsOnly = parseCoachAskMarketConstraint("9 leg nfl props");
  assert.equal(propsOnly.propsOnly, true);
  assert.equal(propsOnly.allowedMarketKeys, null);
});

test("multi-market ask unions named families", () => {
  const m = matchExplicitMarketLocks("mixed parlay of hits and hr");
  assert.ok(m);
  assert.ok(m!.allowedMarketKeys.includes("batter_hits"));
  assert.ok(m!.allowedMarketKeys.includes("batter_home_runs"));
});

test("recovery odds slack stages near-miss same-stat TD without unlocking markets", () => {
  const td = {
    game: "A @ B",
    market: "Anytime TD",
    propMarketKey: "player_anytime_td",
    pick: "Star Anytime TD",
    odds: -130,
    isProp: true,
    player: "Star",
    propLine: 0.5,
    propSide: "Over",
    sport: "nfl",
    athleteId: "star-1",
  } as ParsedPick;
  const hist = {
    recent: Array.from({ length: 8 }, (_, g) => ({
      stats: {
        rushingTouchdowns: "0",
        receivingTouchdowns: g % 2 === 0 ? "1" : "0",
        passingTouchdowns: "0",
      },
    })),
  };
  const hit = gradeFootballPropFromHistory(td, hist).hitProbability;
  assert.equal(propsOnlyLegClearsOdds(td, hit), false);
  assert.equal(propsOnlyLegClearsOdds(td, hit, PROPS_ONLY_RECOVERY_ODDS_SLACK), true);

  const constraint = parseCoachAskMarketConstraint("5 leg touchdown");
  const scored: BoardScoredLeg[] = [
    {
      pick: { ...td, propsOnlyTicket: true },
      simHit: hit,
      evPct: -5,
      rankScore: 5,
    } as BoardScoredLeg,
  ];
  const staged = stageFootballPropsOnlyLegs(scored, 5, PROPS_ONLY_RECOVERY_ODDS_SLACK);
  assert.equal(staged.length, 1);
  const kept = filterPicksByAskMarketConstraint(staged, constraint);
  assert.equal(kept.length, 1);
  assert.ok(propMarketKeyAllowed(kept[0]!.propMarketKey, constraint.allowedMarketKeys));
});

test("locked TD recovery must reject yards / receptions / sacks cross-fill", () => {
  const c = parseCoachAskMarketConstraint("7 leg touchdown");
  const pool = [
    { marketKey: "player_anytime_td" },
    { marketKey: "player_rush_tds_alternate" },
    { marketKey: "player_rush_yds" },
    { marketKey: "player_receptions" },
    { marketKey: "player_sacks" },
    { marketKey: "player_pass_yds_alternate" },
  ];
  const recovery = filterPropPoolByAskMarkets(pool, c.allowedMarketKeys);
  assert.deepEqual(
    recovery.map((r) => r.marketKey).sort(),
    ["player_anytime_td", "player_rush_tds_alternate"],
  );
});

test("buildParlay recovery preserves allowedMarketKeys when locked (no null)", () => {
  const src = readFileSync(join(root, "lib/coach/buildParlay.ts"), "utf8");
  // Locked path must keep marketConstraint — never wipe allowlist on recovery.
  assert.match(src, /isMarketLocked/);
  assert.match(src, /filterPropPoolByAskMarkets\(/);
  assert.match(src, /No other markets were substituted/);
  assert.match(src, /same-stat/);
  assert.match(src, /recoveryFill:\s*true/);
  assert.match(src, /recovered\.picks/);
  assert.match(src, /softPreferred\.picks/);
  // Recovery / soft-retry paths must keep marketConstraint (never wipe lock).
  assert.ok(
    (src.match(/filterPicksByAskMarketConstraint\([\s\S]*?marketConstraint/g) ?? [])
      .length >= 4,
  );
  assert.doesNotMatch(src, /allowedMarketKeys:\s*null/);
});

test("chat + mobile share identical EXPLICIT_MARKET_LOCK_RULES source", () => {
  const mobile = readFileSync(join(root, "lib/explicitMarketLock.ts"), "utf8");
  const api = readFileSync(
    join(root, "../api-server/src/lib/explicitMarketLock.ts"),
    "utf8",
  );
  assert.equal(mobile, api);

  const chat = readFileSync(
    join(root, "../api-server/src/routes/chat.ts"),
    "utf8",
  );
  assert.match(chat, /EXPLICIT_MARKET_LOCK_RULES/);
  assert.match(chat, /from ["'].*explicitMarketLock/);
});

test("canonicalExplicitMarketKey strips alts/periods like allowlist", () => {
  assert.equal(canonicalExplicitMarketKey("player_threes_alternate"), "player_threes");
  assert.equal(canonicalExplicitMarketKey("batter_runs_scored"), "batter_runs");
  assert.equal(canonicalExplicitMarketKey("player_1st_td"), "player_first_td");
  assert.equal(canonicalExplicitMarketKey("player_pass_yds_h1"), "player_pass_yds");
});

test("EXPLICIT_MARKET_LOCK_RULES only uses real provider keys (no inventions)", () => {
  const propsSrc = readFileSync(
    join(root, "../api-server/src/routes/props.ts"),
    "utf8",
  );
  const catalogKeys = new Set<string>();
  for (const m of propsSrc.matchAll(/"(player_[a-z0-9_]+|batter_[a-z0-9_]+|pitcher_[a-z0-9_]+)"/g)) {
    catalogKeys.add(m[1]!);
  }
  for (const rule of EXPLICIT_MARKET_LOCK_RULES) {
    for (const mk of rule.markets) {
      const raw = mk === "player_first_td" ? "player_1st_td" : mk;
      const ok =
        catalogKeys.has(mk) ||
        catalogKeys.has(raw) ||
        catalogKeys.has(`${mk}_alternate`) ||
        (mk === "batter_runs" && catalogKeys.has("batter_runs_scored"));
      assert.ok(ok, `invented / unknown provider key: ${mk} (rule ${rule.id})`);
    }
  }
});
