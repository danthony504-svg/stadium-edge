import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  getSimV2Flags,
  resetSimV2FlagsCache,
  resolveCoachSimHit,
} from "../src/lib/simulatorV2Bridge.js";

describe("simulatorV2Bridge Coach isolation", () => {
  const keys = [
    "SIM_V2_ENABLED",
    "SIM_V2_SHADOW_ONLY",
    "SIM_V2_SERVE",
    "SIM_V2_ACCEPTED_FAMILIES",
    "SIM_V2_FORCE_V1",
  ] as const;
  const prev: Partial<Record<(typeof keys)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const k of keys) prev[k] = process.env[k];
    resetSimV2FlagsCache();
    for (const k of keys) delete process.env[k];
  });

  afterEach(() => {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
    resetSimV2FlagsCache();
  });

  it("defaults keep V2 master off and shadow-only", () => {
    const flags = getSimV2Flags();
    assert.equal(flags.masterEnabled, false);
    assert.equal(flags.shadowOnly, true);
    assert.equal(flags.serveEnabled, false);
  });

  it("resolveCoachSimHit always returns V1 under Phase A defaults", () => {
    const resolved = resolveCoachSimHit({
      sport: "nfl",
      family: "total",
      v1SimHit: 0.58,
      v2: null,
    });
    assert.equal(resolved.engine, "v1");
    assert.equal(resolved.simHit, 0.58);
  });

  it("even with master+shadow on, Coach still gets V1 hit", () => {
    process.env.SIM_V2_ENABLED = "true";
    process.env.SIM_V2_SHADOW_ONLY = "true";
    resetSimV2FlagsCache();
    const resolved = resolveCoachSimHit({
      sport: "nfl",
      family: "total",
      v1SimHit: 0.42,
      v2: {
        schemaVersion: "sim.v2.1",
        engineId: "simulator-v2",
        marketId: "m",
        eventId: "e",
        sport: "nfl",
        family: "total",
        status: "ok",
        simHit: 0.91,
        providerOddsAmerican: -110,
        impliedProbRaw: 0.5238,
        edgePct: 38,
        evPct: 70,
        modelId: "would-be-model",
        modelVersion: "1",
        dataFingerprint: "x",
        nDraws: 10000,
        seed: "s",
        latencyMs: 2,
        computedAt: new Date().toISOString(),
      },
    });
    assert.equal(resolved.engine, "v1");
    assert.equal(resolved.simHit, 0.42);
  });
});
