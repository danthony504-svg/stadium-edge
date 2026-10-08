import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SIM_V2_DEEP_DRAWS,
  assertBaseballF5Conserved,
  buildBaseballPlayerPropMarket,
  buildBaseballTotalMarket,
  buildJointBaseballTensor,
  impliedProbFromAmerican,
  settleMarket,
} from "../src/index.js";

const now = new Date().toISOString();

describe("MLB joint milestone F.1 (shadow)", () => {
  it("enforces F5 ≤ FG on 10k draws and settles F5 total + batter alt", () => {
    const tensor = buildJointBaseballTensor({
      sport: "mlb",
      eventId: "mlb-1",
      seed: "mlb-m1",
      nDraws: SIM_V2_DEEP_DRAWS,
      home: { teamId: "h", runsFor: 4.6, runsAgainst: 4.1 },
      away: { teamId: "a", runsFor: 4.2, runsAgainst: 4.5 },
      players: [
        { playerId: "bat1", teamSide: "home", kind: "batter", usage: 0.9 },
        { playerId: "pit1", teamSide: "away", kind: "pitcher", usage: 1 },
      ],
    });
    assert.doesNotThrow(() => assertBaseballF5Conserved(tensor));

    const f5 = buildBaseballTotalMarket({
      marketId: "f5",
      eventId: "mlb-1",
      period: "f5",
      side: "over",
      line: 4.5,
    });
    const fr = settleMarket({
      tensor,
      market: f5,
      odds: {
        marketId: "f5",
        american: -115,
        book: "test",
        capturedAt: now,
        impliedProbRaw: impliedProbFromAmerican(-115),
        provenance: { provider: "test", fetchedAt: now },
      },
    });
    assert.equal(fr.status, "ok", fr.reason);

    const hits = buildBaseballPlayerPropMarket({
      marketId: "h",
      eventId: "mlb-1",
      playerId: "bat1",
      stat: "hits",
      side: "over",
      line: 0.5,
      alternate: true,
    });
    assert.equal(hits.providerMarketKey, "batter_hits_alternate");
    const hr = settleMarket({
      tensor,
      market: hits,
      odds: {
        marketId: "h",
        american: -120,
        book: "test",
        capturedAt: now,
        impliedProbRaw: impliedProbFromAmerican(-120),
        provenance: { provider: "test", fetchedAt: now },
      },
    });
    assert.equal(hr.status, "ok", hr.reason);
  });
});
