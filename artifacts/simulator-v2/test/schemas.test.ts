import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SimV2EventSchema,
  SimV2MarketSchema,
  SimV2OddsSchema,
  SimV2PlayerSchema,
  impliedProbFromAmerican,
} from "../src/index.js";

const now = new Date().toISOString();
const provenance = [{ provider: "the-odds-api", fetchedAt: now, providerEventId: "evt1" }];

describe("SimV2 schemas", () => {
  it("parses event with provider provenance and timestamps", () => {
    const event = SimV2EventSchema.parse({
      eventId: "e1",
      sport: "nfl",
      startTime: now,
      home: { teamId: "h", name: "Home", side: "home" },
      away: { teamId: "a", name: "Away", side: "away" },
      provenance,
      asOf: now,
    });
    assert.equal(event.sport, "nfl");
    assert.equal(event.provenance[0].provider, "the-odds-api");
  });

  it("requires participation evidence on players", () => {
    const player = SimV2PlayerSchema.parse({
      playerId: "p1",
      name: "Test",
      teamId: "h",
      participation: {
        status: "confirmed_starter",
        evidenceSource: "espn-depth",
        evidenceAt: now,
        expectedParticipation: 0.95,
      },
      provenance,
    });
    assert.equal(player.participation.status, "confirmed_starter");
  });

  it("requires settlement rules on markets", () => {
    const market = SimV2MarketSchema.parse({
      marketId: "m1",
      eventId: "e1",
      sport: "nfl",
      family: "total",
      providerMarketKey: "totals",
      period: "fg",
      side: "over",
      line: 44.5,
      settlement: {
        ruleId: "fg_total_over",
        description: "Full-game total over line",
        settlePath: "team.totalFg",
        comparator: "gt",
        lineApplies: true,
        period: "fg",
      },
      listedAt: now,
      provenance,
    });
    assert.equal(market.settlement.settlePath, "team.totalFg");
  });

  it("preserves provider odds and computes implied from american only", () => {
    const odds = SimV2OddsSchema.parse({
      marketId: "m1",
      american: -110,
      book: "draftkings",
      capturedAt: now,
      impliedProbRaw: impliedProbFromAmerican(-110),
      provenance: provenance[0],
    });
    assert.equal(odds.american, -110);
    assert.ok(odds.impliedProbRaw > 0.5 && odds.impliedProbRaw < 0.53);
  });
});
