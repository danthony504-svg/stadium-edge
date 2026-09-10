import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computeLegFingerprint } from "@workspace/coach-data";
import type { CoachCandidateLeg } from "@workspace/coach-types";

import {
  buildPropSimRequest,
  computeEdgePct,
  computeEvPct,
  isDeepSimComplete,
  normalizePropSimRow,
} from "../src/normalize";
import { CoachSimService } from "../src/service";
import { InMemorySimCacheStore } from "@workspace/coach-sim-cache";

const baseCandidate: CoachCandidateLeg = {
  legId: "g1:prop:hits",
  legFingerprint: computeLegFingerprint({
    sport: "mlb",
    gameId: "g1",
    marketKey: "batter_hits",
    pick: "Over 1.5",
    line: 1.5,
    odds: -110,
    playerId: "p1",
    isAlt: false,
  }),
  kind: "player_prop",
  sport: "mlb",
  gameId: "g1",
  gameLabel: "NYY @ BOS",
  marketKey: "batter_hits",
  marketLabel: "Hits",
  pick: "Over 1.5",
  odds: -110,
  line: 1.5,
  startsAt: "2026-07-12T23:00:00.000Z",
  isAlt: false,
  playerId: "p1",
  playerName: "Aaron Judge",
  propSide: "Over",
};

describe("coach-sim normalize", () => {
  it("builds prop sim request from candidate leg", () => {
    const req = buildPropSimRequest(baseCandidate);
    assert.ok(req);
    assert.equal(req.market, "batter_hits");
    assert.equal(req.side, "Over");
  });

  it("computes positive EV for favorable hit rate", () => {
    const ev = computeEvPct(0.56, -110);
    assert.ok(ev > 0);
    const edge = computeEdgePct(0.56, -110);
    assert.ok(edge > 0);
  });

  it("normalizes API row into CoachSimResult", () => {
    const result = normalizePropSimRow(baseCandidate.legFingerprint, "deep", {
      simulations: 10_000,
      hitProbability: 0.56,
      confidenceScore: 58,
    }, -110);
    assert.ok(result);
    assert.equal(result.iterations, 10_000);
    assert.ok(isDeepSimComplete(result));
  });
});

describe("coach-sim service", () => {
  it("calls executor only on cache miss", async () => {
    let apiCalls = 0;
    const service = new CoachSimService({
      store: new InMemorySimCacheStore(),
      executePropSim: async () => {
        apiCalls += 1;
        return {
          props: [{ simulations: 10_000, hitProbability: 0.56 }],
        };
      },
    });

    await service.simulateCandidateDeep(baseCandidate, "ctx:1");
    await service.simulateCandidateDeep(baseCandidate, "ctx:1");

    assert.equal(apiCalls, 1);
  });

  it("re-simulates when odds change produces new fingerprint", async () => {
    let apiCalls = 0;
    const service = new CoachSimService({
      store: new InMemorySimCacheStore(),
      executePropSim: async () => {
        apiCalls += 1;
        return {
          props: [{ simulations: 10_000, hitProbability: 0.56 }],
        };
      },
    });

    await service.simulateCandidateDeep(baseCandidate, "ctx:1");

    const changedOdds: CoachCandidateLeg = {
      ...baseCandidate,
      odds: -105,
      legFingerprint: computeLegFingerprint({
        sport: "mlb",
        gameId: "g1",
        marketKey: "batter_hits",
        pick: "Over 1.5",
        line: 1.5,
        odds: -105,
        playerId: "p1",
        isAlt: false,
      }),
    };
    await service.simulateCandidateDeep(changedOdds, "ctx:1");

    assert.equal(apiCalls, 2);
  });
});
