import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildProjectionMean, type PropSimulationContext } from "../src/lib/monteCarlo.js";
import { buildPropSimulationContext } from "../src/lib/monteCarloBuild.js";
import {
  aggregateReceivingMatchupForQb,
  buildPreSimShiftFactors,
  combinedCapProof,
  computeOpponentMatchupShift,
  computeVenueShift,
  filterSeriesForMarket,
  isFullGameMarket,
  isPeriodMarket,
  PRE_SIM_SHIFT_CAPS,
  shrinkRatioToOne,
} from "../src/lib/preSimShift/index.js";
import {
  buildOpportunityShiftForGame,
  lookupOpportunityShift,
} from "../src/lib/opportunityShift/index.js";

function series(n: number, value: number): number[] {
  return Array.from({ length: n }, () => value);
}

describe("preSimShift formulas", () => {
  it("Venue Shift: home split vs season with shrinkage + caps", () => {
    const season = [...series(10, 70), ...series(5, 90)]; // season ~76.7
    const home = series(6, 95); // strong home
    const r = computeVenueShift({
      sport: "nfl",
      market: "player_pass_yds",
      isHome: true,
      seasonValues: season,
      homeValues: home,
      awayValues: series(6, 55),
    });
    assert.ok(r.factor > 1);
    assert.ok(r.factor <= PRE_SIM_SHIFT_CAPS.venueMax);
    assert.ok(r.sample >= 3);
    assert.match(String(r.explain), /Venue Shift/);
  });

  it("Venue Shift sample-size fallback → 1.0 when n < 3", () => {
    const r = computeVenueShift({
      sport: "nfl",
      market: "player_rush_yds",
      isHome: true,
      seasonValues: series(10, 60),
      homeValues: [100, 110], // n=2
      awayValues: series(5, 40),
    });
    assert.equal(r.factor, 1);
  });

  it("Opponent Matchup Shift: vs-opp vs season + defense index dampening", () => {
    const r = computeOpponentMatchupShift({
      sport: "nfl",
      market: "player_reception_yds",
      seasonValues: series(10, 50),
      vsOpponentValues: series(5, 75),
      defenseIndex: 1.1,
    });
    assert.ok(r.factor > 1);
    assert.ok(r.factor <= PRE_SIM_SHIFT_CAPS.matchupMax);
    assert.equal(r.usedVsOpponent, true);
  });

  it("shrinkRatioToOne regresses small samples toward 1", () => {
    const big = shrinkRatioToOne(1.3, 20);
    const small = shrinkRatioToOne(1.3, 2);
    assert.ok(big > small);
    assert.ok(Math.abs(small - 1) < Math.abs(big - 1));
  });

  it("combined cap proof: opp×venue×matchup max is clamped", () => {
    const proof = combinedCapProof();
    assert.ok(proof.rawProduct > PRE_SIM_SHIFT_CAPS.combinedMax);
    assert.equal(proof.capped, PRE_SIM_SHIFT_CAPS.combinedMax);
  });

  it("log-space combine clamps family-level movement", () => {
    const pre = buildPreSimShiftFactors({
      sport: "nfl",
      market: "player_pass_yds",
      isHome: true,
      seasonValues: series(12, 60),
      homeValues: series(8, 90),
      awayValues: series(8, 40),
      vsOpponentValues: series(6, 95),
      opportunityShift: 1.28,
    });
    assert.ok(pre.combinedShift <= PRE_SIM_SHIFT_CAPS.combinedMax);
    assert.ok(pre.combinedShift >= PRE_SIM_SHIFT_CAPS.combinedMin);
    assert.ok(pre.opportunityShift === 1.28);
    assert.ok(pre.venueShift > 1);
    assert.ok(pre.opponentMatchupShift > 1);
  });
});

describe("preSimShift no double-counting", () => {
  it("suppresses soft venue blend when venueShift is active", () => {
    const season = series(12, 70);
    const home = series(8, 100);
    const base: PropSimulationContext = {
      sport: "nfl",
      market: "player_pass_yds",
      line: 250.5,
      side: "Over",
      recentValues: season,
      homeValues: home,
      awayValues: series(8, 50),
      vsOpponentValues: [],
      isHome: true,
      suppressSoftVenueBlend: false,
      opportunityFamilyMult: 1,
      combinedPreSimMult: 1,
    };
    const soft = buildProjectionMean(base)!;

    const withFormalVenue = buildPreSimShiftFactors({
      sport: "nfl",
      market: "player_pass_yds",
      isHome: true,
      seasonValues: season,
      homeValues: home,
      awayValues: series(8, 50),
      vsOpponentValues: [],
      opportunityShift: 1,
    });
    const formal = buildProjectionMean({
      ...base,
      suppressSoftVenueBlend: true,
      venueFamilyMult: withFormalVenue.venueShift,
      combinedPreSimMult: withFormalVenue.combinedShift,
    })!;

    // Soft blend and formal venue both raise mean, but applying BOTH would
    // overshoot. Formal path with suppress must not equal soft×venue.
    const doubleCounted = soft * withFormalVenue.venueShift;
    assert.ok(Math.abs(formal - doubleCounted) > 0.5);
    assert.equal(withFormalVenue.suppressSoftVenueBlend, true);
  });

  it("suppresses soft vsOpponent blend when matchupShift used vs-opp series", () => {
    const season = series(12, 50);
    const vs = series(6, 80);
    const pre = buildPreSimShiftFactors({
      sport: "nfl",
      market: "player_reception_yds",
      isHome: true,
      seasonValues: season,
      homeValues: series(6, 55),
      awayValues: series(6, 45),
      vsOpponentValues: vs,
      opportunityShift: 1,
    });
    assert.equal(pre.suppressSoftVsOpponentBlend, true);
    assert.ok(pre.opponentMatchupShift > 1);

    const withSoft: PropSimulationContext = {
      sport: "nfl",
      market: "player_reception_yds",
      line: 60.5,
      side: "Over",
      recentValues: season,
      vsOpponentValues: vs,
      homeValues: series(6, 55),
      awayValues: series(6, 45),
      isHome: true,
      suppressSoftVsOpponentBlend: false,
      suppressSoftVenueBlend: true,
      opportunityFamilyMult: 1,
      combinedPreSimMult: 1,
    };
    const softMean = buildProjectionMean(withSoft)!;
    const formalMean = buildProjectionMean({
      ...withSoft,
      suppressSoftVsOpponentBlend: true,
      matchupFamilyMult: pre.opponentMatchupShift,
      combinedPreSimMult: pre.combinedShift,
    })!;
    const double = softMean * pre.opponentMatchupShift;
    assert.ok(Math.abs(formalMean - double) > 0.5);
  });

  it("unrelated families stay at 1.0 for venue/matchup when market unmapped", () => {
    const pre = buildPreSimShiftFactors({
      sport: "tennis",
      market: "player_aces",
      isHome: true,
      seasonValues: series(10, 8),
      homeValues: series(6, 12),
      awayValues: series(6, 4),
      vsOpponentValues: series(4, 14),
      opportunityShift: 1,
    });
    assert.equal(pre.venueShift, 1);
    assert.equal(pre.opponentMatchupShift, 1);
    assert.equal(pre.combinedShift, 1);
  });
});

describe("preSimShift period guards", () => {
  it("detects period vs full-game markets", () => {
    assert.equal(isPeriodMarket("player_pass_yds_1h"), true);
    assert.equal(isPeriodMarket("player_points_q1"), true);
    assert.equal(isFullGameMarket("player_pass_yds"), true);
    assert.equal(isFullGameMarket("player_rush_yds"), true);
  });

  it("full-game filter drops period-tagged series values", () => {
    const values = [10, 20, 30, 40];
    const tags = ["full", "1h", "full", "q1"];
    const filtered = filterSeriesForMarket("player_points", values, tags);
    assert.deepEqual(filtered, [10, 30]);
  });

  it("period market does not strip tags (period props may use period series)", () => {
    const values = [10, 20, 30];
    const tags = ["1h", "1h", "1h"];
    const filtered = filterSeriesForMarket("player_points_1h", values, tags);
    assert.equal(filtered.length, 3);
  });

  it("1H-tagged values do not change full-game venue factor", () => {
    const seasonFull = series(10, 20);
    // Mild home edge so venue sits below the 1.12 cap.
    const homeFull = series(6, 22);
    const without1h = computeVenueShift({
      sport: "nba",
      market: "player_points",
      isHome: true,
      seasonValues: seasonFull,
      homeValues: homeFull,
      awayValues: series(6, 18),
    });
    assert.ok(without1h.factor > 1);
    assert.ok(without1h.factor < PRE_SIM_SHIFT_CAPS.venueMax);
    // Contaminating home series with extreme 1H values must be filterable.
    const contaminatedHome = [...homeFull, 80, 80, 80];
    const tags = [
      ...homeFull.map(() => "full"),
      "1h",
      "1h",
      "1h",
    ];
    const filteredHome = filterSeriesForMarket(
      "player_points",
      contaminatedHome,
      tags,
    );
    assert.deepEqual(filteredHome, homeFull);
    const withFilter = computeVenueShift({
      sport: "nba",
      market: "player_points",
      isHome: true,
      seasonValues: seasonFull,
      homeValues: filteredHome,
      awayValues: series(6, 18),
    });
    assert.equal(without1h.factor, withFilter.factor);
    // Without filter, contamination would inflate venue.
    const polluted = computeVenueShift({
      sport: "nba",
      market: "player_points",
      isHome: true,
      seasonValues: seasonFull,
      homeValues: contaminatedHome,
      awayValues: series(6, 18),
    });
    assert.ok(polluted.factor > withFilter.factor);
  });
});

describe("preSimShift NFL before/after examples", () => {
  const labels = ["passingYards", "rushingYards", "receivingYards"];

  function hist(opts: {
    pass?: number;
    rush?: number;
    rec?: number;
    homePass?: number;
    awayPass?: number;
    vsPass?: number;
    n?: number;
  }) {
    const n = opts.n ?? 10;
    const recent = Array.from({ length: n }, (_, i) => ({
      stats: {
        passingYards: String(opts.pass ?? 240),
        rushingYards: String(opts.rush ?? 30),
        receivingYards: String(opts.rec ?? 55),
      },
      isHome: i % 2 === 0,
    }));
    // Override home/away means via dedicated games
    const homeGames = Array.from({ length: 6 }, () => ({
      stats: {
        passingYards: String(opts.homePass ?? opts.pass ?? 260),
        rushingYards: String(opts.rush ?? 35),
        receivingYards: String(opts.rec ?? 60),
      },
      isHome: true as const,
    }));
    const awayGames = Array.from({ length: 6 }, () => ({
      stats: {
        passingYards: String(opts.awayPass ?? 200),
        rushingYards: String(opts.rush ?? 25),
        receivingYards: String(opts.rec ?? 45),
      },
      isHome: false as const,
    }));
    return {
      labels,
      recent: [...homeGames, ...awayGames],
      vsOpponent: Array.from({ length: 4 }, () => ({
        stats: {
          passingYards: String(opts.vsPass ?? 280),
          rushingYards: String((opts.rush ?? 30) + 10),
          receivingYards: String((opts.rec ?? 55) + 20),
        },
      })),
    };
  }

  it("QB passing yards: opportunity × venue × matchup raises combined", () => {
    const table = buildOpportunityShiftForGame({
      sport: "nfl",
      gameKey: "PHI @ DAL",
      homeTeam: "Cowboys",
      awayTeam: "Eagles",
      injuries: [
        {
          team: "Eagles",
          entries: [
            { player: "Saquon Barkley", status: "Out", position: "RB", athleteId: "sb" },
          ],
        },
      ],
      players: [
        { player: "Jalen Hurts", athleteId: "jh", team: "Eagles", position: "QB", isHome: false },
        { player: "Backup RB", athleteId: "brb", team: "Eagles", position: "RB", isHome: false },
        { player: "A.J. Brown", athleteId: "ajb", team: "Eagles", position: "WR", isHome: false },
      ],
    });
    const history = hist({ pass: 230, homePass: 270, awayPass: 210, vsPass: 290 });
    const after = buildPropSimulationContext(
      {
        player: "Jalen Hurts",
        athleteId: "jh",
        market: "player_pass_yds",
        line: 245.5,
        side: "Over",
        sport: "nfl",
        isHome: false,
      },
      history,
      { sport: "nfl", opportunityShift: table },
    )!;
    assert.ok(after);
    // True baseline: no soft blends, no pre-sim mults (formal path off).
    const baselineMean = buildProjectionMean({
      ...after,
      suppressSoftVenueBlend: true,
      suppressSoftVsOpponentBlend: true,
      opportunityFamilyMult: 1,
      venueFamilyMult: 1,
      matchupFamilyMult: 1,
      combinedPreSimMult: 1,
    })!;
    const meanAfter = buildProjectionMean(after)!;
    assert.ok((after.combinedPreSimMult ?? 1) !== 1);
    assert.ok((after.venueFamilyMult ?? 1) > 0);
    assert.ok((after.matchupFamilyMult ?? 1) > 1);
    assert.equal(after.suppressSoftVenueBlend, true);
    assert.equal(after.suppressSoftVsOpponentBlend, true);
    // Formal combined mult moves mean vs a no-blend baseline.
    assert.ok(Math.abs(meanAfter - baselineMean) > 0.01);
    assert.ok(
      Math.abs(meanAfter / baselineMean - (after.combinedPreSimMult ?? 1)) < 0.02,
    );
  });

  it("WR receiving yards: matchup shifts without flat-boosting all receivers equally", () => {
    const hot = buildPreSimShiftFactors({
      sport: "nfl",
      market: "player_reception_yds",
      isHome: true,
      seasonValues: series(10, 50),
      homeValues: series(6, 55),
      awayValues: series(6, 45),
      vsOpponentValues: series(5, 80),
      opportunityShift: 1,
    });
    const cold = buildPreSimShiftFactors({
      sport: "nfl",
      market: "player_reception_yds",
      isHome: true,
      seasonValues: series(10, 50),
      homeValues: series(6, 55),
      awayValues: series(6, 45),
      vsOpponentValues: series(5, 30),
      opportunityShift: 1,
    });
    assert.ok(hot.opponentMatchupShift > cold.opponentMatchupShift);
  });

  it("RB rushing yards: venue away regression + opportunity from Saquon OUT", () => {
    const table = buildOpportunityShiftForGame({
      sport: "nfl",
      gameKey: "PHI @ DAL",
      homeTeam: "Cowboys",
      awayTeam: "Eagles",
      injuries: [
        {
          team: "Eagles",
          entries: [
            { player: "Saquon Barkley", status: "Out", position: "RB", athleteId: "sb" },
          ],
        },
      ],
      players: [
        {
          player: "Backup RB",
          athleteId: "brb",
          team: "Eagles",
          position: "RB",
          isHome: false,
          channelUsage: { carries: 8 },
        },
        {
          player: "Jalen Hurts",
          athleteId: "jh",
          team: "Eagles",
          position: "QB",
          isHome: false,
          channelUsage: { carries: 6, designed_runs: 5 },
        },
      ],
    });
    const rush = lookupOpportunityShift(table, {
      player: "Backup RB",
      athleteId: "brb",
      market: "player_rush_yds",
      sport: "nfl",
    });
    assert.ok(rush.multiplier > 1);
    const pre = buildPreSimShiftFactors({
      sport: "nfl",
      market: "player_rush_yds",
      isHome: false,
      seasonValues: series(10, 55),
      homeValues: series(5, 70),
      awayValues: series(5, 40),
      vsOpponentValues: series(4, 35),
      opportunityShift: rush.multiplier,
      opportunityExplain: rush.explanation,
    });
    assert.ok(pre.opportunityShift > 1);
    assert.ok(pre.combinedShift !== 1);
  });

  it("QB receiving coupling aggregates role-specific WR factors", () => {
    const agg = aggregateReceivingMatchupForQb([1.1, 1.08, 1.0, 0.95]);
    assert.ok(agg != null && agg > 1);
    const pass = computeOpponentMatchupShift({
      sport: "nfl",
      market: "player_pass_yds",
      seasonValues: series(10, 240),
      vsOpponentValues: series(4, 250),
      coupledReceivingMatchup: agg,
    });
    const passNoCouple = computeOpponentMatchupShift({
      sport: "nfl",
      market: "player_pass_yds",
      seasonValues: series(10, 240),
      vsOpponentValues: series(4, 250),
    });
    // Coupling should move factor when receiving aggregate ≠ 1
    assert.ok(Math.abs(pass.factor - passNoCouple.factor) > 1e-6 || agg === 1);
  });
});

describe("preSimShift non-NFL example (NBA)", () => {
  it("home points venue + vs-opp matchup combine under caps", () => {
    const pre = buildPreSimShiftFactors({
      sport: "nba",
      market: "player_points",
      isHome: true,
      seasonValues: series(12, 22),
      homeValues: series(7, 26),
      awayValues: series(7, 18),
      vsOpponentValues: series(4, 28),
      opportunityShift: 1.05,
    });
    assert.ok(pre.venueShift > 1);
    assert.ok(pre.opponentMatchupShift > 1);
    assert.ok(pre.combinedShift > 1);
    assert.ok(pre.combinedShift <= PRE_SIM_SHIFT_CAPS.combinedMax);
    assert.match(String(pre.combinedExplain), /Pre-sim combined/);
  });
});

describe("preSimShift HTTP/Coach shared builder", () => {
  it("identical inputs → identical factors (simulate ≡ coach path)", () => {
    const opts = {
      sport: "mlb",
      market: "batter_hits",
      isHome: true as const,
      seasonValues: series(15, 1.1),
      homeValues: series(8, 1.35),
      awayValues: series(7, 0.9),
      vsOpponentValues: series(5, 1.5),
      opportunityShift: 1.08,
      opportunityExplain: "Opportunity Shift: test",
    };
    const a = buildPreSimShiftFactors(opts);
    const b = buildPreSimShiftFactors(opts);
    assert.deepEqual(a, b);
  });

  it("buildPropSimulationContext (HTTP+Coach) embeds shared preSim factors", () => {
    const history = {
      labels: ["H"],
      recent: Array.from({ length: 12 }, (_, i) => ({
        stats: { H: String(i % 2 === 0 ? 2 : 1) },
        isHome: i % 2 === 0,
      })),
      vsOpponent: Array.from({ length: 4 }, () => ({
        stats: { H: "3" },
      })),
    };
    const ctx = buildPropSimulationContext(
      {
        player: "Test Batter",
        athleteId: "tb1",
        market: "batter_hits",
        line: 1.5,
        side: "Over",
        sport: "mlb",
        isHome: true,
      },
      history,
      { sport: "mlb" },
    );
    assert.ok(ctx);
    const direct = buildPreSimShiftFactors({
      sport: "mlb",
      market: "batter_hits",
      isHome: true,
      seasonValues: ctx!.recentValues,
      homeValues: ctx!.homeValues ?? [],
      awayValues: ctx!.awayValues ?? [],
      vsOpponentValues: ctx!.vsOpponentValues ?? [],
      opportunityShift: 1,
    });
    assert.equal(ctx!.combinedPreSimMult, direct.combinedShift);
    assert.equal(ctx!.venueFamilyMult, direct.venueShift);
    assert.equal(ctx!.matchupFamilyMult, direct.opponentMatchupShift);
    assert.equal(ctx!.suppressSoftVenueBlend, direct.suppressSoftVenueBlend);
    assert.equal(ctx!.suppressSoftVsOpponentBlend, direct.suppressSoftVsOpponentBlend);
  });
});
