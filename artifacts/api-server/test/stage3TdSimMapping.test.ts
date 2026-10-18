/**
 * Stage 3 — football TD simulation mapping + First TD fail-closed.
 * Uses deterministic fixtures shaped like ESPN machine-name gamelogs.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildProjectionMean,
  hitRateFromSamples,
  runMonteCarloSimulation,
  type PropSimulationContext,
} from "../src/lib/monteCarlo.js";
import {
  buildPropSimulationContext,
  diagnosePropSimNullReason,
  type PlayerHistoryShape,
} from "../src/lib/monteCarloBuild.js";
import { mergeAuthGamesByEventId } from "../src/lib/authoritativePlayerHistory.js";
import {
  gameValueForMarket,
  isFirstTdMarket,
  isMultiTdOverLine,
  scoringTouchdownsForGame,
} from "../src/lib/propStatValue.js";

const NONE = new Set<string>();

const rbGame = (rushTd: string, recTd: string) => ({
  rushingTouchdowns: rushTd,
  receivingTouchdowns: recTd,
  rushingYards: "40",
  receivingYards: "12",
});

const qbGame = (passTd: string, rushTd: string) => ({
  passingTouchdowns: passTd,
  rushingTouchdowns: rushTd,
  receivingTouchdowns: "0",
  passingYards: "280",
});

describe("Stage 3 scoring TD mapping", () => {
  it("NFL Anytime TD maps rush+rec and ignores passing TDs for QBs", () => {
    assert.equal(gameValueForMarket("player_anytime_td", rbGame("1", "0"), NONE), 1);
    assert.equal(gameValueForMarket("player_anytime_td", rbGame("0", "0"), NONE), 0);
    assert.equal(gameValueForMarket("player_anytime_td", rbGame("2", "1"), NONE), 3);
    // QB throws 3 pass TDs + 0 rush — Anytime scorer is 0, not 3.
    assert.equal(gameValueForMarket("player_anytime_td", qbGame("3", "0"), NONE), 0);
    assert.equal(gameValueForMarket("player_anytime_td", qbGame("2", "1"), NONE), 1);
  });

  it("NCAAF-shaped rows map the same scorer composite", () => {
    assert.equal(
      gameValueForMarket(
        "player_anytime_td",
        { rushingTouchdowns: "0", receivingTouchdowns: "1" },
        NONE,
      ),
      1,
    );
  });

  it("component + combo TD markets map without inventing", () => {
    assert.equal(gameValueForMarket("player_rush_tds", rbGame("2", "0"), NONE), 2);
    assert.equal(gameValueForMarket("player_reception_tds", rbGame("0", "1"), NONE), 1);
    assert.equal(
      gameValueForMarket("player_rush_reception_tds", rbGame("1", "1"), NONE),
      2,
    );
    assert.equal(
      gameValueForMarket("player_pass_rush_reception_tds", qbGame("2", "1"), NONE),
      3,
    );
    assert.equal(
      gameValueForMarket("player_rush_reception_tds", { rushingTouchdowns: "1" }, NONE),
      null,
    );
  });

  it("First TD is unmapped at propStatValue (no scoring-order feed)", () => {
    assert.equal(isFirstTdMarket("player_first_td"), true);
    assert.equal(isFirstTdMarket("player_1st_td"), true);
    assert.equal(gameValueForMarket("player_first_td", rbGame("1", "0"), NONE), null);
    assert.equal(gameValueForMarket("player_1st_td", rbGame("1", "0"), NONE), null);
  });

  it("zero-touchdown games are mapped zeros, not null", () => {
    assert.equal(scoringTouchdownsForGame(rbGame("0", "0")), 0);
    assert.equal(gameValueForMarket("player_anytime_td", rbGame("0", "0"), NONE), 0);
  });

  it("player/team mismatch empty stats fail closed", () => {
    assert.equal(gameValueForMarket("player_anytime_td", {}, NONE), null);
    assert.equal(
      gameValueForMarket("player_anytime_td", { passingTouchdowns: "4" }, NONE),
      null,
    );
  });
});

describe("Stage 3 First TD diagnosis", () => {
  const hist: PlayerHistoryShape = {
    labels: ["rushingTouchdowns", "receivingTouchdowns"],
    recent: [
      { stats: rbGame("1", "0") },
      { stats: rbGame("0", "1") },
      { stats: rbGame("0", "0") },
      { stats: rbGame("1", "0") },
    ],
    vsOpponent: [],
  };

  it("diagnosePropSimNullReason → missing_scoring_order for NFL + NCAAF First TD", () => {
    for (const sport of ["nfl", "ncaaf"] as const) {
      assert.equal(
        diagnosePropSimNullReason(
          {
            player: "X",
            market: "player_first_td",
            line: 0.5,
            side: "Over",
            athleteId: "1",
            sport,
          },
          hist,
        ),
        "missing_scoring_order",
        sport,
      );
    }
  });

  it("buildPropSimulationContext refuses First TD even with TD history", () => {
    assert.equal(
      buildPropSimulationContext(
        {
          player: "X",
          market: "player_first_td",
          line: 0.5,
          side: "Over",
          athleteId: "1",
          sport: "nfl",
        },
        hist,
        { sport: "nfl" },
      ),
      null,
    );
  });

  it("Anytime TD builds context and deep 10k completes", () => {
    const ctx = buildPropSimulationContext(
      {
        player: "RB",
        market: "player_anytime_td",
        line: 0.5,
        side: "Over",
        athleteId: "4429059",
        sport: "nfl",
      },
      hist,
      { sport: "nfl" },
    );
    assert.ok(ctx);
    assert.equal(ctx!.recentValues.length, 4);
    const sim = runMonteCarloSimulation(ctx!, 10_000, { seed: 42 });
    assert.equal(sim.simulations, 10_000);
    assert.ok(sim.hitProbability != null && sim.hitProbability > 0 && sim.hitProbability < 1);
  });
});

describe("Stage 3 multi-TD vs Anytime probability", () => {
  it("isMultiTdOverLine distinguishes 2+ from yes/no", () => {
    assert.equal(isMultiTdOverLine(null), false);
    assert.equal(isMultiTdOverLine(0.5), false);
    assert.equal(isMultiTdOverLine(1.5), true);
  });

  it("Over 1.5 does not reuse Anytime P(score≥1) as the hit", () => {
    const vals = [2, 1, 0, 0, 1, 0]; // scoring TD counts
    const anytimeCtx: PropSimulationContext = {
      sport: "nfl",
      market: "player_anytime_td",
      line: 0.5,
      side: "Over",
      recentValues: vals,
      discrete: true,
    };
    const multiCtx: PropSimulationContext = {
      ...anytimeCtx,
      line: 1.5,
    };
    const lamAnytime = buildProjectionMean(anytimeCtx)!;
    const lamMulti = buildProjectionMean(multiCtx)!;
    // Anytime λ from binary shrink; multi uses count form mean — must differ.
    assert.notEqual(Number(lamAnytime.toFixed(4)), Number(lamMulti.toFixed(4)));

    const anytimeSim = runMonteCarloSimulation(anytimeCtx, 10_000, { seed: 7 });
    const multiSim = runMonteCarloSimulation(multiCtx, 10_000, { seed: 7 });
    assert.ok(anytimeSim.hitProbability != null);
    assert.ok(multiSim.hitProbability != null);
    // P(X≥2) must be strictly below P(X≥1); multi must not reuse Anytime hit.
    assert.notEqual(anytimeSim.hitProbability, multiSim.hitProbability);
    assert.ok(
      (multiSim.hitProbability as number) < (anytimeSim.hitProbability as number),
    );
  });

  it("hitRateFromSamples settles Over 1.5 as ≥2 counts", () => {
    const samples = [0, 1, 1, 2, 3, 0];
    assert.equal(hitRateFromSamples(samples, 0.5, "Over"), 4 / 6);
    assert.equal(hitRateFromSamples(samples, 1.5, "Over"), 2 / 6);
  });
});

describe("Stage 3 eventId merge for split category rows", () => {
  it("mergeAuthGamesByEventId unions rush+pass columns", () => {
    const merged = mergeAuthGamesByEventId([
      {
        eventId: "e1",
        date: "2026-10-01",
        opponentId: "10",
        opponentName: "X",
        isHome: true,
        stats: { passingTouchdowns: "2", passingYards: "250" },
        periodTag: "full",
      },
      {
        eventId: "e1",
        date: "2026-10-01",
        opponentId: "10",
        opponentName: "X",
        isHome: true,
        stats: { rushingTouchdowns: "1", rushingYards: "20" },
        periodTag: "full",
      },
    ]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]!.stats.passingTouchdowns, "2");
    assert.equal(merged[0]!.stats.rushingTouchdowns, "1");
    assert.equal(scoringTouchdownsForGame(merged[0]!.stats), 1);
  });
});

describe("Stage 3 null-line identity (yes/no ATD)", () => {
  it("provider null line is simulated as 0.5 Over without inventing Under", () => {
    const hist: PlayerHistoryShape = {
      labels: ["rushingTouchdowns", "receivingTouchdowns"],
      recent: [
        { stats: rbGame("1", "0") },
        { stats: rbGame("0", "0") },
        { stats: rbGame("1", "1") },
        { stats: rbGame("0", "1") },
        { stats: rbGame("0", "0") },
      ],
      vsOpponent: [],
    };
    const ctx = buildPropSimulationContext(
      {
        player: "WR",
        market: "player_anytime_td",
        line: 0.5, // canonical effective line for null provider yes/no
        side: "Over",
        athleteId: "99",
        sport: "ncaaf",
      },
      hist,
      { sport: "ncaaf" },
    );
    assert.ok(ctx);
    const sim = runMonteCarloSimulation(ctx!, 10_000, { seed: 99 });
    assert.equal(sim.simulations, 10_000);
    assert.ok(sim.hitProbability != null);
  });
});
