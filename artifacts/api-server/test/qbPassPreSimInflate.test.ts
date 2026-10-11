/**
 * Regression: QB pass volume/efficiency must not receive unexplained ~1.21×
 * pre-sim inflate from duplicated injury/opportunity factors or post-elasticity
 * cap equalization.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateFamilyMultiplier,
  buildOpportunityShiftForGame,
  lookupOpportunityShift,
  OPP_SHIFT_CAPS,
  type ChannelContribution,
} from "../src/lib/opportunityShift/index.ts";
import {
  buildPreSimShiftFactors,
  marketShiftKind,
} from "../src/lib/preSimShift/index.ts";
import { buildProjectionMean } from "../src/lib/monteCarlo.ts";
import { buildPropSimulationContext } from "../src/lib/monteCarloBuild.ts";

const SHOUGH = {
  player: "Tyler Shough",
  athleteId: "4360689",
  team: "New Orleans Saints",
  position: "QB",
  channelUsage: { pass_attempts: 43, designed_runs: 2.75, carries: 2.75 },
  channelUsageSamples: { pass_attempts: 4, designed_runs: 4, carries: 4 },
};

const OLAVE = {
  player: "Chris Olave",
  athleteId: "4361370",
  team: "New Orleans Saints",
  position: "WR",
  channelUsage: { targets: 12, routes: 12 },
  channelUsageSamples: { targets: 4, routes: 4 },
};

const KAMARA = {
  player: "Alvin Kamara",
  athleteId: "3054850",
  team: "New Orleans Saints",
  position: "RB",
  channelUsage: {
    carries: 14,
    targets: 4,
    routes: 4,
    designed_runs: 14,
    rz_carries: 2.5,
    gl_carries: 1.2,
  },
  channelUsageSamples: {
    carries: 8,
    targets: 8,
    routes: 8,
    designed_runs: 8,
    rz_carries: 8,
    gl_carries: 8,
  },
};

describe("QB pass pre-sim inflate — factor attribution fixes", () => {
  it("elasticity applies before volume cap: yards < attempts for same vacancy", () => {
    const volBase: ChannelContribution = {
      channel: "pass_attempts",
      volumeDelta: 0.55,
      elasticity: 1,
      confidenceWeight: 1,
      pricedInFactor: 0,
      vacancyFingerprint: "qb-out",
      kind: "V",
    };
    const attempts = aggregateFamilyMultiplier([{ ...volBase, elasticity: 1, kind: "V" }]);
    const completions = aggregateFamilyMultiplier([
      { ...volBase, elasticity: 0.75, kind: "E" },
    ]);
    const yards = aggregateFamilyMultiplier([
      { ...volBase, elasticity: 0.7, kind: "E" },
    ]);
    assert.ok(attempts.multiplier <= OPP_SHIFT_CAPS.normalMax + 1e-9);
    assert.ok(completions.multiplier < attempts.multiplier - 0.02);
    assert.ok(yards.multiplier < attempts.multiplier - 0.02);
    // 1 + 0.22*0.7 = 1.154 — must not saturate at 1.22
    assert.ok(yards.multiplier < 1.18);
    assert.ok(Math.abs(yards.multiplier - (1 + 0.22 * 0.7)) < 0.02);
  });

  it("ungrounded Out QB does not invent starter pass-attempt vacancy", () => {
    const table = buildOpportunityShiftForGame({
      sport: "nfl",
      gameKey: "vik@no",
      homeTeam: "New Orleans Saints",
      awayTeam: "Minnesota Vikings",
      injuries: [
        {
          team: "New Orleans Saints",
          entries: [{ player: "Backup QB", status: "Out", position: "QB" }],
        },
      ],
      players: [SHOUGH, OLAVE, KAMARA],
    });
    assert.equal(table.vacancies.length, 0, "no synthetic QB vacancy channels");
    for (const market of [
      "player_pass_attempts",
      "player_pass_completions",
      "player_pass_yds",
    ]) {
      const hit = lookupOpportunityShift(table, {
        player: SHOUGH.player,
        athleteId: SHOUGH.athleteId,
        market,
        sport: "nfl",
      });
      assert.equal(hit.multiplier, 1);
      assert.equal(hit.suppressOwnKeyInjuries, false);
    }
  });

  it("starter already at vacated QB volume gets zero exclusive-role uplift", () => {
    const table = buildOpportunityShiftForGame({
      sport: "nfl",
      gameKey: "vik@no",
      homeTeam: "New Orleans Saints",
      awayTeam: "Minnesota Vikings",
      injuries: [
        {
          team: "New Orleans Saints",
          entries: [
            { player: "Spencer Rattler", status: "Out", position: "QB", athleteId: "rattler" },
          ],
        },
      ],
      players: [
        SHOUGH,
        {
          player: "Spencer Rattler",
          athleteId: "rattler",
          team: "New Orleans Saints",
          position: "QB",
          // Demoted starter's old volume — less than Shough's current baseline.
          channelUsage: { pass_attempts: 32, designed_runs: 3 },
          channelUsageSamples: { pass_attempts: 8, designed_runs: 8 },
        },
        OLAVE,
      ],
    });
    for (const market of [
      "player_pass_attempts",
      "player_pass_completions",
      "player_pass_yds",
    ]) {
      const hit = lookupOpportunityShift(table, {
        player: SHOUGH.player,
        athleteId: SHOUGH.athleteId,
        market,
        sport: "nfl",
      });
      // Near-1 only: designed_runs may apply a tiny negative pass elasticity,
      // but demoted-QB pass_attempts mass must not create ≥1.08/1.22 uplift.
      assert.ok(
        hit.multiplier <= 1.02,
        `${market} must not stack demoted-QB volume onto current starter (got ${hit.multiplier})`,
      );
      assert.ok(hit.multiplier >= 0.95, `${market} unexpected deflation ${hit.multiplier}`);
    }
  });

  it("RB committee uplift still reaches volume cap (not QB-exclusive absorption)", () => {
    const table = buildOpportunityShiftForGame({
      sport: "nfl",
      gameKey: "g",
      homeTeam: "New Orleans Saints",
      awayTeam: "Minnesota Vikings",
      injuries: [
        {
          team: "New Orleans Saints",
          entries: [
            { player: "Kendre Miller", status: "Out", position: "RB", athleteId: "km" },
          ],
        },
      ],
      players: [
        KAMARA,
        {
          player: "Kendre Miller",
          athleteId: "km",
          team: "New Orleans Saints",
          position: "RB",
          channelUsage: {
            carries: 12,
            rz_carries: 2,
            gl_carries: 1,
            targets: 2,
            routes: 10,
          },
          channelUsageSamples: {
            carries: 6,
            rz_carries: 6,
            gl_carries: 6,
            targets: 6,
            routes: 6,
          },
        },
      ],
    });
    const hit = lookupOpportunityShift(table, {
      player: KAMARA.player,
      athleteId: KAMARA.athleteId,
      market: "player_rush_attempts",
      sport: "nfl",
    });
    assert.ok(hit.multiplier > 1.05, `RB uplift expected, got ${hit.multiplier}`);
  });

  it("pass_completions is volume-kind; pass_yds remains efficiency", () => {
    assert.equal(marketShiftKind("player_pass_completions", "nfl"), "volume");
    assert.equal(marketShiftKind("player_pass_attempts", "nfl"), "volume");
    assert.equal(marketShiftKind("player_pass_yds", "nfl"), "efficiency");
    assert.equal(marketShiftKind("player_receptions", "nfl"), "volume");
    assert.equal(marketShiftKind("player_reception_yds", "nfl"), "efficiency");
    assert.equal(marketShiftKind("player_rush_attempts", "nfl"), "volume");
  });

  it("WR target vacancy does not inflate QB pass markets", () => {
    const table = buildOpportunityShiftForGame({
      sport: "nfl",
      gameKey: "g",
      homeTeam: "New Orleans Saints",
      awayTeam: "Minnesota Vikings",
      injuries: [
        {
          team: "New Orleans Saints",
          entries: [
            { player: "Jordyn Tyson", status: "Injured Reserve", position: "WR" },
          ],
        },
      ],
      players: [SHOUGH, OLAVE, KAMARA],
    });
    for (const market of [
      "player_pass_attempts",
      "player_pass_completions",
      "player_pass_yds",
      "player_pass_longest_completion",
    ]) {
      const hit = lookupOpportunityShift(table, {
        player: SHOUGH.player,
        athleteId: SHOUGH.athleteId,
        market,
        sport: "nfl",
      });
      assert.equal(hit.multiplier, 1, market);
    }
    const olave = lookupOpportunityShift(table, {
      player: OLAVE.player,
      athleteId: OLAVE.athleteId,
      market: "player_receptions",
      sport: "nfl",
    });
    assert.ok(olave.multiplier > 1, "Olave should receive target redistribution");
  });

  it("Shough-like hist + injury context stays below extreme 1.18× band", () => {
    const completions = [30, 29, 27, 35];
    const attempts = [48, 42, 34, 56];
    const yards = [286, 255, 252, 410];
    const table = buildOpportunityShiftForGame({
      sport: "nfl",
      gameKey: "vik@no",
      homeTeam: "New Orleans Saints",
      awayTeam: "Minnesota Vikings",
      injuries: [
        {
          team: "New Orleans Saints",
          entries: [
            { player: "Jeremiah Wright", status: "Out", position: "G" },
            { player: "Backup QB", status: "Out", position: "QB" },
            { player: "Jordyn Tyson", status: "Injured Reserve", position: "WR" },
          ],
        },
      ],
      players: [SHOUGH, OLAVE, KAMARA],
    });

    const cases: Array<[string, number[]]> = [
      ["player_pass_completions", completions],
      ["player_pass_attempts", attempts],
      ["player_pass_yds", yards],
    ];
    for (const [market, vals] of cases) {
      const hit = lookupOpportunityShift(table, {
        player: SHOUGH.player,
        athleteId: SHOUGH.athleteId,
        market,
        sport: "nfl",
      });
      const pre = buildPreSimShiftFactors({
        sport: "nfl",
        market,
        isHome: true,
        seasonValues: vals,
        homeValues: vals.slice(0, 2),
        awayValues: vals.slice(2),
        vsOpponentValues: [],
        opportunityShift: hit.multiplier,
        opportunityExplain: hit.explanation,
      });
      const bare = buildProjectionMean({
        sport: "nfl",
        market,
        line: 0,
        side: "Over",
        recentValues: vals,
      });
      const full = buildProjectionMean({
        sport: "nfl",
        market,
        line: 0,
        side: "Over",
        recentValues: vals,
        ownKeyInjuries: 9,
        oppKeyInjuries: 6,
        combinedPreSimMult: pre.combinedShift,
        opportunitySuppressOwnInjuries: hit.suppressOwnKeyInjuries,
        suppressSoftVenueBlend: pre.suppressSoftVenueBlend,
        suppressSoftVsOpponentBlend: pre.suppressSoftVsOpponentBlend,
      });
      assert.ok(bare != null && full != null);
      const ratio = full! / bare!;
      assert.ok(
        ratio < 1.18,
        `${market} ratio ${ratio.toFixed(3)} must stay below extreme band (opp=${hit.multiplier}, combined=${pre.combinedShift})`,
      );
    }
  });

  it("cross-player: 5 NFL QBs + WR/RB volume props stay coherent", () => {
    const qbs = [
      { player: "QB A", athleteId: "qa", team: "Team A", attempts: 38 },
      { player: "QB B", athleteId: "qb", team: "Team B", attempts: 34 },
      { player: "QB C", athleteId: "qc", team: "Team C", attempts: 41 },
      { player: "QB D", athleteId: "qd", team: "Team D", attempts: 29 },
      { player: "QB E", athleteId: "qe", team: "Team E", attempts: 36 },
    ];
    for (const q of qbs) {
      const table = buildOpportunityShiftForGame({
        sport: "nfl",
        gameKey: `${q.athleteId}-g`,
        homeTeam: q.team,
        awayTeam: "Opp",
        injuries: [
          {
            team: q.team,
            entries: [{ player: "Backup", status: "Out", position: "QB" }],
          },
        ],
        players: [
          {
            player: q.player,
            athleteId: q.athleteId,
            team: q.team,
            position: "QB",
            channelUsage: { pass_attempts: q.attempts },
            channelUsageSamples: { pass_attempts: 5 },
          },
        ],
      });
      const hit = lookupOpportunityShift(table, {
        player: q.player,
        athleteId: q.athleteId,
        market: "player_pass_attempts",
        sport: "nfl",
      });
      assert.equal(hit.multiplier, 1, `${q.player}: ungrounded backup must not inflate`);
    }

    // NCAAF QBs — same adapter path
    for (const id of ["n1", "n2", "n3"]) {
      const table = buildOpportunityShiftForGame({
        sport: "ncaaf",
        gameKey: id,
        homeTeam: "Home U",
        awayTeam: "Away U",
        injuries: [
          {
            team: "Home U",
            entries: [{ player: "Backup", status: "Out", position: "QB" }],
          },
        ],
        players: [
          {
            player: `NCAAF QB ${id}`,
            athleteId: id,
            team: "Home U",
            position: "QB",
            channelUsage: { pass_attempts: 30 },
            channelUsageSamples: { pass_attempts: 4 },
          },
        ],
      });
      const hit = lookupOpportunityShift(table, {
        player: `NCAAF QB ${id}`,
        athleteId: id,
        market: "player_pass_attempts",
        sport: "ncaaf",
      });
      assert.equal(hit.multiplier, 1);
    }
  });

  it("buildPropSimulationContext: Olave receptions still receive WR vacancy uplift", () => {
    const table = buildOpportunityShiftForGame({
      sport: "nfl",
      gameKey: "g",
      homeTeam: "New Orleans Saints",
      awayTeam: "Minnesota Vikings",
      injuries: [
        {
          team: "New Orleans Saints",
          entries: [
            { player: "Jordyn Tyson", status: "Injured Reserve", position: "WR" },
          ],
        },
      ],
      players: [SHOUGH, OLAVE, KAMARA],
    });
    const history = {
      labels: ["REC", "TGTS", "YDS"],
      recent: [8, 9, 7, 11].map((rec, i) => ({
        stats: {
          receptions: String(rec),
          REC: String(rec),
          receivingTargets: String(rec + 3),
          TGTS: String(rec + 3),
          receivingYards: String(rec * 12),
        },
        isHome: i % 2 === 0,
      })),
      vsOpponent: [],
    };
    const ctx = buildPropSimulationContext(
      {
        player: OLAVE.player,
        athleteId: OLAVE.athleteId,
        market: "player_receptions",
        line: 6.5,
        side: "Over",
        sport: "nfl",
        isHome: true,
      },
      history,
      { sport: "nfl", opportunityShift: table, ownKeyInjuries: 3, oppKeyInjuries: 2 },
    );
    assert.ok(ctx);
    assert.ok((ctx!.opportunityFamilyMult ?? 1) > 1);
    assert.equal(ctx!.opportunitySuppressOwnInjuries, true);
  });
});
