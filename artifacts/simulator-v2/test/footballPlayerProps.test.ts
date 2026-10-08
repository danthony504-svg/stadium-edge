import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SIM_V2_DEEP_DRAWS,
  FOOTBALL_PROP_MODEL_VERSION,
  FOOTBALL_PROP_YARD_BUDGET_SHOCK_SIGMA,
  attachFootballPlayerProps,
  buildFootballPlayerPropAltLadder,
  buildFootballPlayerPropMarket,
  buildJointFootballTensor,
  DEFAULT_SIM_V2_FLAGS,
  footballPropModelVersionForProfile,
  footballPropSupportsAlternate,
  impliedProbFromAmerican,
  isMarketFamilySupported,
  mapProviderPropKeyToStat,
  selectProductionSimResult,
  settleAltLineBatch,
  settleMarket,
  validateScenarioConsistency,
  type SimV2Odds,
} from "../src/index.js";
import { isNamedEspnAthleteId } from "../eval/footballPropIdentity.js";

const now = new Date().toISOString();

function odds(marketId: string, american: number): SimV2Odds {
  return {
    marketId,
    american,
    book: "test",
    capturedAt: now,
    impliedProbRaw: impliedProbFromAmerican(american),
    provenance: { provider: "test", fetchedAt: now },
  };
}

function baseTensor(nDraws: number) {
  return buildJointFootballTensor({
    sport: "nfl",
    eventId: "nfl-props-c2",
    seed: "props-c2",
    nDraws,
    home: {
      teamId: "home",
      scoredByQuarter: [5, 6, 5, 7],
      allowedByQuarter: [4, 6, 5, 6],
      ptsFor: 23,
      ptsAgainst: 21,
    },
    away: {
      teamId: "away",
      scoredByQuarter: [3, 5, 4, 6],
      allowedByQuarter: [5, 6, 5, 7],
      ptsFor: 18,
      ptsAgainst: 23,
    },
  });
}

describe("Phase C.2 football player props (shadow)", () => {
  it("10k joint props conserve periods and share team pass budget", () => {
    const tensor = attachFootballPlayerProps({
      tensor: baseTensor(SIM_V2_DEEP_DRAWS),
      players: [
        { playerId: "qb1", teamSide: "home", role: "qb", usage: 0.95, participationStatus: "confirmed_starter" },
        { playerId: "wr1", teamSide: "home", role: "wr", usage: 0.3 },
        { playerId: "wr2", teamSide: "home", role: "wr", usage: 0.25 },
      ],
    });
    assert.equal(tensor.meta.nDraws, 10_000);
    const cons = validateScenarioConsistency(tensor, {
      periodSumGroup: ["q1", "q2", "q3", "q4"],
      checkDerivedHalves: true,
    });
    assert.equal(cons.ok, true, JSON.stringify(cons.issues));

    // Shared budget: WR rec yards should rise with QB pass yards on same draws.
    let hi = 0;
    let lo = 0;
    let hiN = 0;
    let loN = 0;
    for (let i = 0; i < 2000; i++) {
      const py = tensor.players.qb1!.stats.pass_yds[i]!;
      const ry = tensor.players.wr1!.stats.rec_yds[i]! + tensor.players.wr2!.stats.rec_yds[i]!;
      if (py >= 300) {
        hi += ry;
        hiN += 1;
      } else if (py <= 180) {
        lo += ry;
        loN += 1;
      }
    }
    assert.ok(hiN > 20 && loN > 20);
    assert.ok(hi / hiN > lo / loN * 0.9, "receiver yards should track team pass volume");
  });

  it("maps provider keys and settles mains, alts, QH, DST", () => {
    assert.equal(mapProviderPropKeyToStat("player_pass_yds_alternate"), "pass_yds");
    assert.equal(mapProviderPropKeyToStat("player_pass_yds_q1"), "pass_yds_q1");
    assert.equal(mapProviderPropKeyToStat("player_kicking_points"), "kicking_points");
    assert.equal(mapProviderPropKeyToStat("player_invented"), null);
    assert.equal(footballPropSupportsAlternate("pass_yds"), true);
    assert.equal(footballPropSupportsAlternate("kicking_points"), false);

    const tensor = attachFootballPlayerProps({
      tensor: baseTensor(3000),
      players: [
        { playerId: "qb1", teamSide: "home", role: "qb", usage: 0.9 },
        { playerId: "k1", teamSide: "home", role: "k", usage: 1 },
        { playerId: "lb1", teamSide: "away", role: "dst_lb", usage: 0.8 },
      ],
    });

    const ladder = buildFootballPlayerPropAltLadder({
      marketIdPrefix: "m-pass",
      eventId: "nfl-props-c2",
      sport: "nfl",
      playerId: "qb1",
      stat: "pass_yds",
      side: "over",
      lines: [249.5, 224.5, 274.5],
    });
    for (const m of ladder) {
      const r = settleMarket({ tensor, market: m, odds: odds(m.marketId, -115) });
      assert.equal(r.status, "ok", `${m.marketId}:${r.reason}`);
      assert.equal(r.providerOddsAmerican, -115);
    }

    const q1 = buildFootballPlayerPropMarket({
      marketId: "q1",
      eventId: "nfl-props-c2",
      sport: "nfl",
      playerId: "qb1",
      stat: "pass_yds_q1",
      side: "over",
      line: 49.5,
    });
    assert.equal(q1.providerMarketKey, "player_pass_yds_q1");
    assert.equal(q1.period, "q1");
    const qr = settleMarket({ tensor, market: q1, odds: odds("q1", -110) });
    assert.equal(qr.status, "ok", qr.reason);

    const kick = buildFootballPlayerPropMarket({
      marketId: "k",
      eventId: "nfl-props-c2",
      sport: "nfl",
      playerId: "k1",
      stat: "kicking_points",
      side: "over",
      line: 7.5,
    });
    assert.equal(settleMarket({ tensor, market: kick, odds: odds("k", -105) }).status, "ok");

    const tack = buildFootballPlayerPropMarket({
      marketId: "t",
      eventId: "nfl-props-c2",
      sport: "nfl",
      playerId: "lb1",
      stat: "tackles_assists",
      side: "over",
      line: 5.5,
    });
    assert.equal(settleMarket({ tensor, market: tack, odds: odds("t", -120) }).status, "ok");

    const altMarkets = [199.5, 249.5, 299.5].map((line) =>
      buildFootballPlayerPropMarket({
        marketId: `alt-${line}`,
        eventId: "nfl-props-c2",
        sport: "nfl",
        playerId: "qb1",
        stat: "pass_yds",
        side: "over",
        line,
        alternate: true,
      }),
    );
    const batch = settleAltLineBatch({
      tensor,
      markets: altMarkets,
      oddsByMarketId: Object.fromEntries(altMarkets.map((m) => [m.marketId, odds(m.marketId, -110)])),
    });
    assert.ok(batch.results.every((x) => x.status === "ok"));
  });

  it("rejects OUT players and keeps Coach on V1", () => {
    const tensor = attachFootballPlayerProps({
      tensor: baseTensor(500),
      players: [
        { playerId: "qb1", teamSide: "home", role: "qb", usage: 0.9, participationStatus: "out" },
        { playerId: "qb2", teamSide: "home", role: "qb", usage: 0.9, participationStatus: "active" },
      ],
    });
    const outM = buildFootballPlayerPropMarket({
      marketId: "out",
      eventId: "nfl-props-c2",
      sport: "nfl",
      playerId: "qb1",
      stat: "pass_yds",
      side: "over",
      line: 220.5,
    });
    const outR = settleMarket({ tensor, market: outM, odds: odds("out", -110) });
    assert.equal(outR.status, "missing_data");

    const okM = buildFootballPlayerPropMarket({
      marketId: "ok",
      eventId: "nfl-props-c2",
      sport: "nfl",
      playerId: "qb2",
      stat: "pass_yds",
      side: "over",
      line: 220.5,
    });
    assert.equal(settleMarket({ tensor, market: okM, odds: odds("ok", -110) }).status, "ok");

    assert.equal(isMarketFamilySupported("soccer", "player_prop").supported, false);
    const prod = selectProductionSimResult({
      flags: DEFAULT_SIM_V2_FLAGS,
      sport: "nfl",
      family: "player_prop",
      v1SimHit: 0.55,
      v2: null,
    });
    assert.equal(prod.engine, "v1");
  });
});

describe("Phase C.2.2 prop calibration knobs", () => {
  it("exports prop model 0.3.2 and yard-budget shock sigma 0.12", () => {
    assert.equal(FOOTBALL_PROP_MODEL_VERSION, "0.3.2");
    assert.equal(FOOTBALL_PROP_YARD_BUDGET_SHOCK_SIGMA, 0.12);
    const tensor = attachFootballPlayerProps({
      tensor: baseTensor(500),
      players: [{ playerId: "qb1", teamSide: "home", role: "qb", usage: 0.95, participationStatus: "confirmed_starter" }],
    });
    assert.ok(tensor.meta.quality.warnings.some((w) => w.includes("prop_yard_budget_shock_0.12")));
    assert.ok(tensor.meta.quality.warnings.some((w) => w.includes("football_prop_model_0.3.2")));
    const yds = tensor.players.qb1!.stats.pass_yds;
    let var_ = 0;
    let m = 0;
    for (let i = 0; i < yds.length; i++) m += yds[i]!;
    m /= yds.length;
    for (let i = 0; i < yds.length; i++) var_ += (yds[i]! - m) ** 2;
    var_ /= yds.length;
    assert.ok(var_ > 100, "pass yards should have material dispersion after budget shock");
  });

  it("propCalibrationProfile v0.2 vs v0.3.2 changes means, shock, and reported version", () => {
    assert.equal(footballPropModelVersionForProfile("v0.2"), "0.2.0");
    assert.equal(footballPropModelVersionForProfile("v0.3.2"), "0.3.2");
    assert.equal(footballPropModelVersionForProfile(), "0.3.2");

    const players = [
      { playerId: "3139477", teamSide: "home" as const, role: "qb" as const, usage: 0.95, participationStatus: "confirmed_starter" as const },
    ];
    const prior = attachFootballPlayerProps({
      tensor: baseTensor(2000),
      players,
      propCalibrationProfile: "v0.2",
    });
    const cal = attachFootballPlayerProps({
      tensor: baseTensor(2000),
      players,
      propCalibrationProfile: "v0.3.2",
    });

    assert.ok(prior.meta.quality.warnings.some((w) => w === "football_prop_model_0.2.0"));
    assert.ok(prior.meta.quality.warnings.some((w) => w === "prop_yard_budget_shock_none"));
    assert.ok(prior.meta.quality.warnings.some((w) => w === "prop_calibration_profile_v0.2"));
    assert.ok(cal.meta.quality.warnings.some((w) => w === "football_prop_model_0.3.2"));
    assert.ok(cal.meta.quality.warnings.some((w) => w.includes("prop_yard_budget_shock_0.12")));

    const meanOf = (xs: Float64Array) => {
      let s = 0;
      for (let i = 0; i < xs.length; i++) s += xs[i]!;
      return s / xs.length;
    };
    const varOf = (xs: Float64Array) => {
      const m = meanOf(xs);
      let s = 0;
      for (let i = 0; i < xs.length; i++) s += (xs[i]! - m) ** 2;
      return s / xs.length;
    };
    const priorYds = prior.players["3139477"]!.stats.pass_yds;
    const calYds = cal.players["3139477"]!.stats.pass_yds;
    const priorMean = meanOf(priorYds);
    const calMean = meanOf(calYds);
    // v0.2 pass budget 8.5·pts+120 > v0.3.2 5.8·pts+90 → higher prior mean.
    assert.ok(priorMean > calMean + 20, `expected prior mean ${priorMean} >> cal ${calMean}`);
    // Shock adds multiplicative noise; CV should be higher on calibrated profile
    // even though absolute variance tracks the (lower) Poisson mean.
    const priorCv = Math.sqrt(varOf(priorYds)) / Math.max(1e-6, priorMean);
    const calCv = Math.sqrt(varOf(calYds)) / Math.max(1e-6, calMean);
    assert.ok(calCv > priorCv, `expected cal CV ${calCv} > prior CV ${priorCv}`);
  });

  it("rejects proxy athlete ids for named-player A/B grounding", () => {
    assert.equal(isNamedEspnAthleteId("3139477"), true);
    assert.equal(isNamedEspnAthleteId("home_qb"), false);
    assert.equal(isNamedEspnAthleteId("away_rb"), false);
    assert.equal(isNamedEspnAthleteId("home_wr"), false);
    assert.equal(isNamedEspnAthleteId(""), false);
    assert.equal(isNamedEspnAthleteId(undefined), false);
    assert.equal(isNamedEspnAthleteId("qb1"), false);
  });
});
