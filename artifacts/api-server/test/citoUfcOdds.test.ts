import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  adjustUnavailableMarkets,
  parseCitoOddsPayload,
  UFC_PROP_MARKET_LABELS,
} from "../src/lib/citoUfcOdds.ts";
import { buildUfcPropRecommendations } from "../src/lib/ufcPropRecommendations.ts";
import { buildFightPickAnalysis } from "../src/lib/fightPickAnalysis.ts";
import { runFightMonteCarlo } from "../src/lib/ufcMonteCarlo.ts";
import type { Fighter } from "../src/lib/ufc.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(__dirname, "fixtures/cito-fight-odds.json"), "utf8"),
);

function fighter(partial: Partial<Fighter> & { name: string }): Fighter {
  return {
    resolvedName: partial.name,
    athleteId: "1",
    weightClass: "Heavyweight",
    record: { wins: 15, losses: 2, draws: 0, winPct: 88 },
    stats: {
      strikeAccuracy: 55,
      strikeLPM: 5,
      takedownAccuracy: 45,
      takedownAvg: 1.5,
      submissionAvg: 0.3,
      finishPct: 70,
      decisionPct: 20,
    },
    profile: {
      age: 30,
      heightIn: 76,
      displayHeight: "6' 4\"",
      reachIn: 80,
      displayReach: '80"',
      stance: "Orthodox",
      citizenship: "UK",
    },
    methods: {
      koWins: 8,
      tkoWins: 2,
      subWins: 1,
      decisionWins: 4,
      koLosses: null,
      tkoLosses: 1,
      subLosses: null,
    },
    style: "striker",
    dataSources: ["espn"],
    recentForm: [],
    ...partial,
  };
}

describe("citoUfcOdds", () => {
  it("parses fixture into normalized UFC prop markets", () => {
    const markets = parseCitoOddsPayload(fixture, "Tom Aspinall", "Jon Jones");
    const keys = markets.map((m) => m.key);
    assert.ok(keys.includes("method_of_victory"));
    assert.ok(keys.includes("exact_round"));
    assert.ok(keys.includes("goes_distance"));
    assert.ok(keys.includes("ko_tko"));
    const mov = markets.find((m) => m.key === "method_of_victory");
    assert.ok(mov && mov.outcomes.length >= 6);
    assert.equal(mov.label, UFC_PROP_MARKET_LABELS.method_of_victory);
  });

  it("adjustUnavailableMarkets removes labels when props exist", () => {
    const base = [
      "Method of victory",
      "Fight goes the distance / doesn't go the distance",
      "Over/Under rounds",
      "Fighter total strikes",
    ] as const;
    const adjusted = adjustUnavailableMarkets(base, [
      "method_of_victory",
      "goes_distance",
      "exact_round",
    ]);
    assert.ok(!adjusted.includes("Method of victory"));
    assert.ok(!adjusted.includes("Fight goes the distance / doesn't go the distance"));
    assert.ok(!adjusted.includes("Over/Under rounds"));
    assert.ok(adjusted.includes("Fighter total strikes"));
  });
});

describe("buildUfcPropRecommendations", () => {
  it("returns recommendations only for posted outcomes", () => {
    const markets = parseCitoOddsPayload(fixture, "Tom Aspinall", "Jon Jones");
    const away = fighter({ name: "Tom Aspinall" });
    const home = fighter({ name: "Jon Jones", record: { wins: 27, losses: 1, draws: 0, winPct: 96 } });
    const sim = runFightMonteCarlo({ away, home, lean: null, comparison: { reachAdvantageIn: null, reachAdvantageFighter: null, styleMatchup: null, unavailable: [] } });
    const pre = buildFightPickAnalysis(away, home, { reachAdvantageIn: null, reachAdvantageFighter: null, styleMatchup: null, unavailable: [] }, 4, [
      "method_of_victory",
      "goes_distance",
    ]);
    const recs = buildUfcPropRecommendations(markets, away.name, home.name, sim, pre);
    assert.ok(recs.length > 0);
    for (const r of recs) {
      assert.ok(r.market);
      assert.ok(r.pick);
      assert.ok(Number.isFinite(r.odds));
    }
  });
});
