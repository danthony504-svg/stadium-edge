/**
 * Phone: UFC ML detail opened as TEAM PICK with empty team-history copy.
 * Fighters must use fight-analysis, not ESPN team-search.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  fightAnalysisHasStats,
  fightPickSide,
  isCombatFightSport,
  parseFightGameSides,
} from "./fightPickSheet.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("isCombatFightSport: ufc/mma only", () => {
  assert.equal(isCombatFightSport("ufc"), true);
  assert.equal(isCombatFightSport("mma"), true);
  assert.equal(isCombatFightSport("UFC"), true);
  assert.equal(isCombatFightSport("nfl"), false);
  assert.equal(isCombatFightSport("ncaaf"), false);
  assert.equal(isCombatFightSport("tennis"), false);
});

test("parseFightGameSides from odds Away @ Home", () => {
  assert.deepEqual(parseFightGameSides("Anthony Romero @ Marcus McGhee"), {
    away: "Anthony Romero",
    home: "Marcus McGhee",
  });
  assert.deepEqual(parseFightGameSides("Wang Cong @ Natalia Silva"), {
    away: "Wang Cong",
    home: "Natalia Silva",
  });
  assert.equal(parseFightGameSides("Broken"), null);
});

test("fightPickSide matches Coach team param to away/home", () => {
  assert.equal(
    fightPickSide({
      team: "Anthony Romero",
      away: "Anthony Romero",
      home: "Marcus McGhee",
    }),
    "away",
  );
  assert.equal(
    fightPickSide({
      team: "Wang Cong",
      away: "Wang Cong",
      home: "Natalia Silva",
    }),
    "away",
  );
  assert.equal(
    fightPickSide({
      team: "Romero",
      away: "Anthony Romero",
      home: "Marcus McGhee",
    }),
    "away",
  );
  assert.equal(
    fightPickSide({
      team: "Marcus McGhee",
      away: "Anthony Romero",
      home: "Marcus McGhee",
    }),
    "home",
  );
});

test("fightAnalysisHasStats gates REAL STATS vs empty copy", () => {
  assert.equal(fightAnalysisHasStats(null), false);
  assert.equal(fightAnalysisHasStats({ away: {}, home: {} }), false);
  assert.equal(
    fightAnalysisHasStats({
      away: { record: { wins: 10, losses: 2, draws: 0, winPct: 83 } },
      home: {},
    }),
    true,
  );
  assert.equal(
    fightAnalysisHasStats({
      away: { recentForm: [{ result: "W", opponent: "X", date: null, method: null }] },
      home: {},
    }),
    true,
  );
});

test("team-pick sheet branches UFC to fight-analysis (not team-history)", () => {
  const src = readFileSync(join(root, "app/team-pick/[id].tsx"), "utf8");
  assert.match(src, /isCombatFightSport/);
  assert.match(src, /getFightAnalysis/);
  assert.match(src, /FIGHT PICK/);
  assert.match(src, /fightAnalysisHasStats/);
  // Team-history path must be disabled for combat sports.
  assert.match(src, /enabled:\s*!isFight/);
});
