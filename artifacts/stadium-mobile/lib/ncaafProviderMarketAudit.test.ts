/**
 * NCAAF Odds API market-key audit — locks provider keys (not FanDuel labels)
 * and proves screenshot Coach player-prop markets are real feed keys.
 *
 * Source of truth: https://the-odds-api.com/sports-odds-data/betting-markets.html
 * Sport key: americanfootball_ncaaf
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { humanizeOddsApiMarketKey } from "./postedMarketDiscovery.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const propsSrc = readFileSync(join(root, "artifacts/api-server/src/routes/props.ts"), "utf8");
const oddsSrc = readFileSync(join(root, "artifacts/api-server/src/routes/odds.ts"), "utf8");

function extractObjectBlock(src: string, label: string): string {
  const idx = src.indexOf(label);
  assert.ok(idx >= 0, `missing ${label}`);
  const slice = src.slice(idx, idx + 4000);
  const end = slice.indexOf("};");
  assert.ok(end > 0, `unclosed ${label}`);
  return slice.slice(0, end);
}

function ncaafArrayAfter(block: string): string {
  const m = block.match(/ncaaf:\s*\[([\s\S]*?)\]/);
  assert.ok(m, "missing ncaaf array");
  return m[1]!;
}

/** Exact additional-market keys Odds API documents for team POINTS totals. */
const ODDS_API_TEAM_POINTS_KEYS = [
  "team_totals",
  "alternate_team_totals",
  "team_totals_h1",
  "team_totals_h2",
  "team_totals_q1",
  "team_totals_q2",
  "team_totals_q3",
  "team_totals_q4",
  "alternate_team_totals_h1",
  "alternate_team_totals_h2",
  "alternate_team_totals_q1",
  "alternate_team_totals_q2",
  "alternate_team_totals_q3",
  "alternate_team_totals_q4",
] as const;

/**
 * FanDuel-style TEAM YARD markets — real on some college books, but The Odds API
 * documents no keys for them. Coach must never invent these.
 */
const UNSUPPORTED_TEAM_YARD_CONCEPTS = [
  "team_total_yards",
  "team_rush_yards",
  "team_receiving_yards",
  "team_pass_yards",
  "alternate_team_rush_yards",
  "alternate_team_receiving_yards",
  "team_yards",
] as const;

/** Screenshot Coach cards: Kevin Jennings Pass TDs, Carlos Hernandez / Jordan Faison Rec Yds. */
const SCREENSHOT_PLAYER_PROP_KEYS = ["player_pass_tds", "player_reception_yds"] as const;

describe("NCAAF Odds API provider market audit", () => {
  test("server odds.ts requests documented team POINTS + period/alt keys", () => {
    const periodBlock = extractObjectBlock(oddsSrc, "const PERIOD_MARKETS_DEFAULT");
    for (const key of ODDS_API_TEAM_POINTS_KEYS) {
      assert.ok(periodBlock.includes(`"${key}"`), `odds.ts must request ${key}`);
    }
    for (const key of [
      "alternate_spreads",
      "alternate_totals",
      "spreads_h1",
      "spreads_q1",
      "spreads_q2",
      "spreads_q3",
      "spreads_q4",
      "totals_h1",
      "totals_q1",
      "alternate_spreads_q1",
      "alternate_totals_q2",
    ]) {
      assert.ok(periodBlock.includes(`"${key}"`), `odds.ts must request ${key}`);
    }
    // No team-yard keys anywhere in the football period allowlist.
    for (const key of UNSUPPORTED_TEAM_YARD_CONCEPTS) {
      assert.ok(!periodBlock.includes(key), `odds.ts must not request invented ${key}`);
    }
  });

  test("team POINTS totals humanize; team yards do not become Team Total", () => {
    assert.equal(humanizeOddsApiMarketKey("team_totals"), "Team Total");
    assert.equal(humanizeOddsApiMarketKey("alternate_team_totals"), "Alt Team Total");
    assert.equal(humanizeOddsApiMarketKey("team_totals_q2"), "Q2 Team Total");
    assert.equal(humanizeOddsApiMarketKey("spreads_q1"), "Q1 Spread");
    assert.equal(humanizeOddsApiMarketKey("alternate_spreads_q1"), "Q1 Alt Spread");
    for (const key of UNSUPPORTED_TEAM_YARD_CONCEPTS) {
      const label = humanizeOddsApiMarketKey(key);
      assert.ok(
        !/^team total$/i.test(label) && !/^(q\d|1h|2h)\s+(alt\s+)?team total$/i.test(label),
        `unsupported ${key} must not normalize to Team Total points label (got ${label})`,
      );
    }
  });

  test("screenshot player-prop markets are Odds API NCAAF keys + server-allowlisted", () => {
    // Official docs: NFL, NCAAF, CFL Player Props include player_pass_tds and
    // player_reception_yds. Named athletes require a live ODDS_API_KEY probe.
    const core = ncaafArrayAfter(extractObjectBlock(propsSrc, "export const MARKETS_BY_SPORT"));
    const alts = ncaafArrayAfter(extractObjectBlock(propsSrc, "export const ALT_MARKETS_BY_SPORT"));
    const altExt = ncaafArrayAfter(
      extractObjectBlock(propsSrc, "export const ALT_MARKETS_EXTENDED_BY_SPORT"),
    );
    for (const key of SCREENSHOT_PLAYER_PROP_KEYS) {
      assert.ok(core.includes(`"${key}"`), `core NCAAF MARKETS_BY_SPORT must request ${key}`);
    }
    assert.ok(alts.includes('"player_reception_yds_alternate"'));
    assert.ok(altExt.includes('"player_pass_tds_alternate"'));
  });

  test("audit matrix: supported vs unsupported college team concepts", () => {
    const matrix: Array<{ concept: string; providerKey: string | null; supported: boolean }> = [
      { concept: "Team Total Yards O/U", providerKey: null, supported: false },
      { concept: "Team Alternate Total Yards", providerKey: null, supported: false },
      { concept: "Team Rush Yards O/U", providerKey: null, supported: false },
      { concept: "Team Alternate Rush Yards", providerKey: null, supported: false },
      { concept: "Team Receiving Yards O/U", providerKey: null, supported: false },
      { concept: "Team Alternate Receiving Yards", providerKey: null, supported: false },
      { concept: "Team Total Points", providerKey: "team_totals", supported: true },
      { concept: "Team Alternate Total Points", providerKey: "alternate_team_totals", supported: true },
      { concept: "Full-game alternate spreads", providerKey: "alternate_spreads", supported: true },
      { concept: "Full-game alternate totals", providerKey: "alternate_totals", supported: true },
      { concept: "1H team totals", providerKey: "team_totals_h1", supported: true },
      { concept: "2H team totals", providerKey: "team_totals_h2", supported: true },
      { concept: "Q1–Q4 spreads/totals/team markets", providerKey: "spreads_q1|totals_q1|team_totals_q1", supported: true },
      { concept: "Player pass TDs (screenshot)", providerKey: "player_pass_tds", supported: true },
      { concept: "Player reception yards (screenshot)", providerKey: "player_reception_yds", supported: true },
    ];

    for (const row of matrix) {
      if (row.supported) {
        assert.ok(row.providerKey, `${row.concept} must list an exact provider key`);
      } else {
        assert.equal(row.providerKey, null, `${row.concept} must stay unsupported (no fabricate)`);
      }
    }
  });
});
