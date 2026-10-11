import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OPP_SHIFT_CAPS,
  aggregateFamilyMultiplier,
  buildOpportunityShiftForGame,
  buildOpportunityShiftTable,
  detectVacancyFraction,
  getOpportunityAdapter,
  isFamilyShiftAllowed,
  lookupOpportunityShift,
  opportunityMarketFamily,
  type ChannelContribution,
} from "../src/lib/opportunityShift/index.js";
import { buildProjectionMean, type PropSimulationContext } from "../src/lib/monteCarlo.js";
import { buildPropSimulationContext } from "../src/lib/monteCarloBuild.js";

const saintsGame = "Vikings @ Saints";

function nflRoster() {
  return [
    {
      player: "Saquon Barkley",
      athleteId: "sb",
      team: "Saints",
      position: "RB",
      channelUsage: {
        carries: 18,
        rz_carries: 3,
        gl_carries: 1.5,
        targets: 4,
        routes: 20,
        pass_pro_snaps: 10,
      },
    },
    {
      player: "Jalen Hurts",
      athleteId: "jh",
      team: "Saints",
      position: "QB",
      channelUsage: { designed_runs: 6, scramble_rate: 0.1, carries: 8 },
    },
    {
      player: "Backup RB",
      athleteId: "brb",
      team: "Saints",
      position: "RB",
      channelUsage: { carries: 6, rz_carries: 0.5, gl_carries: 0.3, targets: 1 },
    },
    {
      player: "WR1",
      athleteId: "wr1",
      team: "Saints",
      position: "WR",
      channelUsage: { targets: 8, routes: 30 },
    },
    {
      player: "Opp Player",
      athleteId: "opp",
      team: "Vikings",
      position: "RB",
      channelUsage: { carries: 15 },
    },
  ];
}

describe("Opportunity Shift — confirmation gates", () => {
  it("no injury → multiplier 1.0", () => {
    const table = buildOpportunityShiftTable({
      sport: "nfl",
      gameKey: saintsGame,
      team: "Saints",
      injuries: [],
      beneficiaries: nflRoster(),
    });
    const rush = lookupOpportunityShift(table, {
      player: "Backup RB",
      athleteId: "brb",
      market: "player_rush_attempts",
      sport: "nfl",
    });
    assert.equal(rush.multiplier, 1);
    assert.equal(rush.explanation, null);
  });

  it("questionable only → no redistribution", () => {
    const table = buildOpportunityShiftTable({
      sport: "nfl",
      gameKey: saintsGame,
      team: "Saints",
      injuries: [
        {
          player: "Saquon Barkley",
          athleteId: "sb",
          team: "Saints",
          position: "RB",
          status: "Questionable",
        },
      ],
      beneficiaries: nflRoster(),
    });
    assert.equal(table.vacancies.length, 0);
    const rush = lookupOpportunityShift(table, {
      player: "Backup RB",
      market: "rush_attempts",
      sport: "nfl",
    });
    assert.equal(rush.multiplier, 1);
    assert.equal(detectVacancyFraction("Questionable"), 0);
    assert.equal(detectVacancyFraction("Out"), 1);
  });

  it("confirmed OUT → family-specific redistribution (not player-wide)", () => {
    const table = buildOpportunityShiftTable({
      sport: "nfl",
      gameKey: saintsGame,
      team: "Saints",
      injuries: [
        {
          player: "Saquon Barkley",
          athleteId: "sb",
          team: "Saints",
          position: "RB",
          status: "Out",
        },
      ],
      beneficiaries: nflRoster(),
    });
    assert.ok(table.vacancies.length >= 1);

    const rushAtt = lookupOpportunityShift(table, {
      player: "Backup RB",
      athleteId: "brb",
      market: "player_rush_attempts",
      sport: "nfl",
    });
    const passYdsBackup = lookupOpportunityShift(table, {
      player: "Backup RB",
      athleteId: "brb",
      market: "player_pass_yds",
      sport: "nfl",
    });
    const hurtsRush = lookupOpportunityShift(table, {
      player: "Jalen Hurts",
      athleteId: "jh",
      market: "player_rush_attempts",
      sport: "nfl",
    });
    const hurtsPass = lookupOpportunityShift(table, {
      player: "Jalen Hurts",
      athleteId: "jh",
      market: "player_pass_yds",
      sport: "nfl",
    });
    const wrTargets = lookupOpportunityShift(table, {
      player: "WR1",
      athleteId: "wr1",
      market: "player_receptions",
      sport: "nfl",
    });

    assert.ok(rushAtt.multiplier > 1, `backup RB rush attempts ${rushAtt.multiplier}`);
    assert.ok(rushAtt.multiplier <= OPP_SHIFT_CAPS.absoluteMax);
    // Pass yards for RB should not inherit rushing vacancy as a player-wide bump
    assert.equal(passYdsBackup.multiplier, 1);
    // QB may get designed-run / RZ share — rush up, pass not auto-boosted from carries
    assert.ok(hurtsRush.multiplier >= 1);
    assert.ok(hurtsPass.multiplier <= 1.05, `QB pass should not inherit RB carries: ${hurtsPass.multiplier}`);
    // WR may get target share from pass-catching RB vacancy
    assert.ok(wrTargets.multiplier >= 1);
    assert.ok(rushAtt.explanation?.includes("Opportunity Shift:"));
    assert.ok(rushAtt.family === "rush_attempts");
  });
});

describe("Opportunity Shift — priced-in + caps + aggregation", () => {
  it("already-priced-in absence → damped / no second bump", () => {
    const roster = nflRoster().map((p) =>
      p.athleteId === "brb" ? { ...p, pricedInFactor: 1 } : p,
    );
    const table = buildOpportunityShiftTable({
      sport: "nfl",
      gameKey: saintsGame,
      team: "Saints",
      injuries: [
        {
          player: "Saquon Barkley",
          team: "Saints",
          position: "RB",
          status: "Out",
        },
      ],
      beneficiaries: roster,
    });
    const rush = lookupOpportunityShift(table, {
      player: "Backup RB",
      athleteId: "brb",
      market: "rush_attempts",
      sport: "nfl",
    });
    assert.ok(
      rush.multiplier <= 1.02,
      `priced-in should damp/zero, got ${rush.multiplier}`,
    );
  });

  it("multiple vacancies → bounded conservation (no triple-count)", () => {
    const contribs: ChannelContribution[] = [
      {
        channel: "carries",
        volumeDelta: 0.25,
        elasticity: 0.7,
        confidenceWeight: 1,
        pricedInFactor: 0,
        vacancyFingerprint: "a",
        kind: "E",
      },
      {
        channel: "rz_carries",
        volumeDelta: 0.2,
        elasticity: 0.65,
        confidenceWeight: 1,
        pricedInFactor: 0,
        vacancyFingerprint: "a",
        kind: "E",
      },
      {
        channel: "gl_carries",
        volumeDelta: 0.18,
        elasticity: 0.65,
        confidenceWeight: 1,
        pricedInFactor: 0,
        vacancyFingerprint: "a",
        kind: "E",
      },
    ];
    const naive =
      1 +
      contribs.reduce(
        (s, c) => s + c.volumeDelta * c.elasticity * c.confidenceWeight,
        0,
      );
    const bounded = aggregateFamilyMultiplier(contribs, { vacancyCount: 2 });
    assert.ok(bounded.multiplier < naive, "bounded < raw sum");
    assert.ok(bounded.multiplier <= OPP_SHIFT_CAPS.absoluteMax);
    assert.ok(bounded.multiplier >= OPP_SHIFT_CAPS.floor);
  });

  it("hard caps: normal ≤1.22, absolute ≤1.28, floor ≥0.82", () => {
    const huge: ChannelContribution[] = [
      {
        channel: "carries",
        volumeDelta: 2,
        elasticity: 1,
        confidenceWeight: 1,
        pricedInFactor: 0,
        vacancyFingerprint: "x",
        kind: "V",
      },
    ];
    const m = aggregateFamilyMultiplier(huge);
    assert.ok(m.multiplier <= OPP_SHIFT_CAPS.normalMax + 1e-9);
    const neg: ChannelContribution[] = [
      {
        channel: "pressure_allowed",
        volumeDelta: -2,
        elasticity: 1,
        confidenceWeight: 1,
        pricedInFactor: 0,
        vacancyFingerprint: "y",
        kind: "E",
      },
    ];
    const n = aggregateFamilyMultiplier(neg, { teamScalar: true });
    assert.ok(n.multiplier >= 1 - OPP_SHIFT_CAPS.teamScalarMaxDelta - 1e-9);
    assert.ok(n.multiplier >= OPP_SHIFT_CAPS.floor);
  });
});

describe("Opportunity Shift — supported-market gate + adapters", () => {
  it("unsupported markets → X / no change", () => {
    assert.equal(opportunityMarketFamily("yellow_cards", "soccer"), null);
    assert.equal(isFamilyShiftAllowed("cards", "soccer"), false);
    assert.equal(isFamilyShiftAllowed("saves", "nhl"), false);
    assert.equal(isFamilyShiftAllowed("walks", "mlb"), false);
    assert.equal(opportunityMarketFamily("player_sacks", "ncaaf"), null);
  });

  it("Tennis / UFC return no_shift", () => {
    assert.equal(getOpportunityAdapter("tennis").noShift, true);
    assert.equal(getOpportunityAdapter("ufc").noShift, true);
    assert.equal(getOpportunityAdapter("mma").noShift, true);
    for (const sport of ["tennis", "ufc"] as const) {
      const table = buildOpportunityShiftTable({
        sport,
        gameKey: "A vs B",
        team: "A",
        injuries: [{ player: "P1", team: "A", status: "Out", position: "G" }],
        beneficiaries: [{ player: "P2", team: "A", position: "G" }],
      });
      assert.ok(table.tableFingerprint.startsWith("no_shift:"));
      assert.equal(table.byBeneficiaryFamily.size, 0);
    }
  });

  it("every supported sport adapter is registered", () => {
    for (const sport of [
      "nfl",
      "ncaaf",
      "nba",
      "wnba",
      "mlb",
      "nhl",
      "soccer",
      "tennis",
      "ufc",
    ]) {
      const a = getOpportunityAdapter(sport);
      assert.equal(a.sport === sport || (sport === "ufc" && a.sport === "ufc"), true);
      assert.equal(typeof a.noShift, "boolean");
      assert.equal(typeof a.roleOf, "function");
      assert.equal(typeof a.familyRules, "function");
    }
  });

  it("NBA center out does not equally boost guard rebounds vs scoring", () => {
    const table = buildOpportunityShiftTable({
      sport: "nba",
      gameKey: "Away @ Home",
      team: "Home",
      injuries: [
        {
          player: "Starting C",
          team: "Home",
          position: "C",
          status: "Out",
        },
      ],
      beneficiaries: [
        {
          player: "Starting C",
          team: "Home",
          position: "C",
          channelUsage: { minutes: 32, reb_opps: 10, fga: 12, usage: 0.24 },
        },
        {
          player: "Starting PG",
          team: "Home",
          position: "PG",
          channelUsage: { minutes: 34, ast_opps: 7, reb_opps: 3, fga: 14, usage: 0.28 },
        },
        {
          player: "Backup C",
          team: "Home",
          position: "C",
          channelUsage: { minutes: 18, reb_opps: 6, fga: 8, usage: 0.16 },
        },
      ],
    });
    const guardReb = lookupOpportunityShift(table, {
      player: "Starting PG",
      market: "rebounds",
      sport: "nba",
    });
    const bigReb = lookupOpportunityShift(table, {
      player: "Backup C",
      market: "rebounds",
      sport: "nba",
    });
    const guardPts = lookupOpportunityShift(table, {
      player: "Starting PG",
      market: "points",
      sport: "nba",
    });
    assert.ok(bigReb.multiplier >= guardReb.multiplier);
    // Guard scoring may rise via usage/minutes; rebounds should not match big's reb uplift
    assert.ok(
      bigReb.multiplier - 1 >= (guardReb.multiplier - 1) - 1e-9,
      `big reb ${bigReb.multiplier} vs guard reb ${guardReb.multiplier}`,
    );
    assert.ok(guardPts.family === "points");
  });
});

describe("Opportunity Shift — sim integration", () => {
  it("applies family mult inside buildProjectionMean once", () => {
    const base: PropSimulationContext = {
      sport: "nfl",
      market: "player_rush_attempts",
      line: 12.5,
      side: "Over",
      recentValues: [10, 12, 11, 14, 9, 13, 12, 11],
      opportunityFamilyMult: 1.14,
    };
    const withShift = buildProjectionMean(base);
    const without = buildProjectionMean({ ...base, opportunityFamilyMult: 1 });
    assert.ok(withShift != null && without != null);
    assert.ok(withShift! > without!);
    assert.ok(Math.abs(withShift! / without! - 1.14) < 0.02);
  });

  it("suppresses ownKeyInjuries when Opportunity Shift handles same absence", () => {
    const vals = [10, 12, 11, 14, 9, 13, 12, 11];
    const a = buildProjectionMean({
      sport: "nfl",
      market: "rush_yds",
      line: 50,
      side: "Over",
      recentValues: vals,
      ownKeyInjuries: 4,
      opportunityFamilyMult: 1.1,
      opportunitySuppressOwnInjuries: true,
    });
    const b = buildProjectionMean({
      sport: "nfl",
      market: "rush_yds",
      line: 50,
      side: "Over",
      recentValues: vals,
      ownKeyInjuries: 0,
      opportunityFamilyMult: 1.1,
      opportunitySuppressOwnInjuries: false,
    });
    assert.ok(a != null && b != null);
    assert.ok(Math.abs(a! - b!) < 0.05);
  });

  it("buildPropSimulationContext attaches family lookup from game table", () => {
    const table = buildOpportunityShiftForGame({
      sport: "nfl",
      gameKey: saintsGame,
      homeTeam: "Saints",
      awayTeam: "Vikings",
      injuries: [
        {
          team: "Saints",
          entries: [
            { player: "Saquon Barkley", status: "Out", position: "RB", athleteId: "sb" },
          ],
        },
      ],
      players: nflRoster(),
    });
    const history = {
      labels: ["rushingAttempts"],
      recent: Array.from({ length: 8 }, () => ({
        stats: { rushingAttempts: "12" },
        isHome: true,
      })),
      vsOpponent: [],
    };
    const ctx = buildPropSimulationContext(
      {
        player: "Backup RB",
        athleteId: "brb",
        market: "player_rush_attempts",
        line: 10.5,
        side: "Over",
        sport: "nfl",
        isHome: true,
      },
      history,
      { sport: "nfl", opportunityShift: table },
    );
    assert.ok(ctx);
    assert.ok((ctx!.opportunityFamilyMult ?? 1) > 1);
    assert.equal(ctx!.opportunityFamily, "rush_attempts");
    assert.ok(ctx!.opportunityExplain?.startsWith("Opportunity Shift:"));
  });

  it("targets → receptions uses E (not automatic V)", () => {
    const adapter = getOpportunityAdapter("nfl");
    const rules = adapter.familyRules("targets");
    const rec = rules.find((r) => r.family === "receptions");
    assert.ok(rec);
    assert.equal(rec!.kind, "E");
    assert.ok(rec!.elasticity < 1);
  });

  it("injuries without position create no vacancies (sim-path regression)", () => {
    const table = buildOpportunityShiftForGame({
      sport: "nfl",
      gameKey: saintsGame,
      homeTeam: "Saints",
      awayTeam: "Vikings",
      injuries: [
        {
          team: "Saints",
          entries: [{ player: "Saquon Barkley", status: "Out" }],
        },
      ],
      players: nflRoster().map((p) => ({ ...p, position: null })),
    });
    assert.equal(table.vacancies.length, 0);
    const rush = lookupOpportunityShift(table, {
      player: "Backup RB",
      athleteId: "brb",
      market: "rush_attempts",
      sport: "nfl",
    });
    assert.equal(rush.multiplier, 1);
  });

  it("IR/Out non-skill players do not absorb RB carry shares", () => {
    const table = buildOpportunityShiftForGame({
      sport: "nfl",
      gameKey: "CHI @ GB",
      homeTeam: "Packers",
      awayTeam: "Bears",
      injuries: [
        {
          team: "Packers",
          entries: [
            { player: "Chris Brooks", status: "Injured Reserve", position: "RB" },
            { player: "Edgerrin Cooper", status: "Injured Reserve", position: "LB" },
            { player: "Micah Parsons", status: "Out", position: "DE" },
          ],
        },
        {
          team: "Bears",
          entries: [
            { player: "Kyle Monangai", status: "Out", position: "RB" },
            { player: "D'Andre Swift", status: "Active", position: "RB" },
            { player: "Roschon Johnson", status: "Active", position: "RB" },
          ],
        },
      ],
      players: [
        {
          player: "D'Andre Swift",
          athleteId: "4259545",
          team: "Bears",
          position: null,
        },
        {
          player: "Roschon Johnson",
          athleteId: "4426386",
          team: "Bears",
          position: null,
        },
      ],
    });
    assert.ok(!table.byBeneficiaryFamily.has("name:edgerrin cooper"));
    assert.ok(!table.byBeneficiaryFamily.has("name:micah parsons"));
    const swift = lookupOpportunityShift(table, {
      player: "D'Andre Swift",
      athleteId: "4259545",
      market: "rush_attempts",
      sport: "nfl",
    });
    assert.ok(swift.multiplier > 1);
  });
});
