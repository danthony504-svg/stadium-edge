import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const propsSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../src/routes/props.ts"),
  "utf8",
);

function blockAfter(label: string): string {
  const idx = propsSrc.indexOf(label);
  assert.ok(idx >= 0, `missing ${label}`);
  const slice = propsSrc.slice(idx, idx + 2500);
  const end = slice.indexOf("};");
  assert.ok(end > 0, `unclosed ${label}`);
  return slice.slice(0, end);
}

test("props route main catalog covers every prop league + combo/stat diversity", () => {
  const block = blockAfter("export const MARKETS_BY_SPORT");
  for (const sport of ["mlb", "nba", "ncaab", "ncaaf", "nfl", "nhl", "soccer", "wnba"]) {
    assert.ok(block.includes(`${sport}:`), `MARKETS_BY_SPORT missing ${sport}`);
  }
  // Screenshot market family: Hits+Runs+RBIs
  assert.ok(block.includes("batter_hits_runs_rbis"));
  assert.ok(block.includes("batter_home_runs"));
  assert.ok(block.includes("pitcher_strikeouts"));
  assert.ok(block.includes("player_rush_yds"));
  assert.ok(block.includes("player_pass_yds"));
  assert.ok(block.includes("player_anytime_td"));
  assert.ok(block.includes("player_points"));
  assert.ok(block.includes("player_goal_scorer_anytime"));
});

test("props route also fetches alternate ladders and quarter/half markets", () => {
  const alt = blockAfter("export const ALT_MARKETS_BY_SPORT");
  const qh = blockAfter("export const QH_MARKETS_BY_SPORT");
  assert.ok(alt.includes("mlb:"));
  assert.ok(alt.includes("nfl:"));
  assert.ok(alt.includes("nba:"));
  assert.ok(alt.includes("_alternate"));
  assert.ok(qh.includes("nfl:"));
  assert.ok(qh.includes("nba:"));
  assert.ok(qh.includes("_q1") || qh.includes("_h1"));
});

test("handler fans out base + QH + alt Odds fetches (all prop types)", () => {
  assert.ok(propsSrc.includes("QH_MARKETS_BY_SPORT[sport]"));
  assert.ok(propsSrc.includes("ALT_MARKETS_BY_SPORT[sport]"));
  assert.ok(propsSrc.includes("ALT_MARKETS_EXTENDED_BY_SPORT[sport]"));
  assert.ok(propsSrc.includes("altExtendedData"));
  assert.ok(propsSrc.includes("Promise.all"));
});

test("NCAAF extended alt batch is separate from verified yard alts", () => {
  const alt = blockAfter("export const ALT_MARKETS_BY_SPORT");
  const ext = blockAfter("export const ALT_MARKETS_EXTENDED_BY_SPORT");
  assert.ok(alt.includes("ncaaf:"));
  assert.ok(alt.includes("player_pass_yds_alternate"));
  assert.ok(ext.includes("ncaaf:"));
  assert.ok(ext.includes("player_pass_tds_alternate"));
  assert.ok(ext.includes("player_receptions_alternate"));
});
