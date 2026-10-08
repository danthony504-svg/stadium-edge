import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SIM_V2_DEEP_DRAWS,
  attachFootballPlayerProps,
  buildFootballPlayerPropAltLadder,
  buildFootballPlayerPropMarket,
  buildJointFootballTensor,
  DEFAULT_SIM_V2_FLAGS,
  impliedProbFromAmerican,
  isMarketFamilySupported,
  selectProductionSimResult,
  settleAltLineBatch,
  settleMarket,
  validateScenarioConsistency,
  type SimV2Odds,
} from "../src/index.js";

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
    eventId: "nfl-props-1",
    seed: "props-milestone-1",
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

describe("Phase C.1 football player props (shadow)", () => {
  it("attaches joint props on 10k draws without breaking period conservation", () => {
    const tensor = attachFootballPlayerProps({
      tensor: baseTensor(SIM_V2_DEEP_DRAWS),
      players: [
        { playerId: "qb1", teamSide: "home", role: "qb", usage: 0.95 },
        { playerId: "wr1", teamSide: "home", role: "wr", usage: 0.28 },
        { playerId: "rb1", teamSide: "away", role: "rb", usage: 0.55 },
      ],
    });
    assert.equal(tensor.meta.nDraws, 10_000);
    assert.equal(tensor.meta.quality.participationReady, true);
    assert.ok(tensor.meta.playerStatKeys.includes("pass_yds"));
    const cons = validateScenarioConsistency(tensor, {
      periodSumGroup: ["q1", "q2", "q3", "q4"],
      checkDerivedHalves: true,
    });
    assert.equal(cons.ok, true, JSON.stringify(cons.issues));
    assert.ok(tensor.players.qb1?.stats.pass_yds);
    // Joint: higher home FG draws should tend to higher QB pass yds (weak correlation check).
    let hi = 0;
    let lo = 0;
    let hiN = 0;
    let loN = 0;
    for (let i = 0; i < tensor.meta.nDraws; i++) {
      const pts = tensor.team.homeFg[i]!;
      const yds = tensor.players.qb1!.stats.pass_yds[i]!;
      if (pts >= 30) {
        hi += yds;
        hiN += 1;
      } else if (pts <= 14) {
        lo += yds;
        loN += 1;
      }
    }
    assert.ok(hiN > 50 && loN > 50);
    assert.ok(hi / hiN > lo / loN, "pass yards should rise with team points on same draws");
  });

  it("settles main + alternate prop ladder from one tensor with real odds", () => {
    const tensor = attachFootballPlayerProps({
      tensor: baseTensor(2000),
      players: [{ playerId: "qb1", teamSide: "home", role: "qb", usage: 0.9 }],
    });
    const ladder = buildFootballPlayerPropAltLadder({
      marketIdPrefix: "m-pass",
      eventId: "nfl-props-1",
      sport: "nfl",
      playerId: "qb1",
      stat: "pass_yds",
      side: "over",
      lines: [249.5, 224.5, 274.5],
    });
    assert.equal(ladder[0]!.providerMarketKey, "player_pass_yds");
    assert.equal(ladder[1]!.providerMarketKey, "player_pass_yds_alternate");
    for (const m of ladder) {
      const r = settleMarket({
        tensor,
        market: m,
        odds: odds(m.marketId, -115),
      });
      assert.equal(r.status, "ok", r.reason);
      assert.ok(r.simHit != null && r.simHit > 0 && r.simHit < 1);
      assert.equal(r.providerOddsAmerican, -115);
    }
    const altMarkets = [199.5, 249.5, 299.5].map((line) =>
      buildFootballPlayerPropMarket({
        marketId: `alt-${line}`,
        eventId: "nfl-props-1",
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
    assert.equal(batch.results.length, 3);
    assert.ok(batch.results.every((x) => x.status === "ok"));
    assert.equal(batch.reusedSingleTensor, true);
  });

  it("rejects missing players and keeps Coach on V1 under default flags", () => {
    const tensor = baseTensor(500);
    const m = buildFootballPlayerPropMarket({
      marketId: "missing-player",
      eventId: "nfl-props-1",
      sport: "nfl",
      playerId: "nobody",
      stat: "rush_yds",
      side: "over",
      line: 60.5,
    });
    const r = settleMarket({ tensor, market: m, odds: odds(m.marketId, -110) });
    // Fail-closed: player absent from tensor → missing_data (not a synthetic grade).
    assert.equal(r.status, "missing_data");
    assert.equal(isMarketFamilySupported("soccer", "player_prop").supported, false);
    const prod = selectProductionSimResult({
      flags: DEFAULT_SIM_V2_FLAGS,
      sport: "nfl",
      family: "player_prop",
      v1SimHit: 0.55,
      v2: null,
    });
    assert.equal(prod.engine, "v1");
    assert.equal(prod.simHit, 0.55);
  });
});
