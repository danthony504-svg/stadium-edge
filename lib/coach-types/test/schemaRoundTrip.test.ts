import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fixtures } from "../src/fixtures/index";
import {
  coachGateEvaluationSchema,
  coachScanManifestSchema,
  coachSnapshotSchema,
  coachTicketResponseSchema,
  coachTicketSchema,
  coachV2SlateResponseSchema,
} from "../src/schemas/index";

describe("coach-types schema round-trip", () => {
  it("parses and re-serializes gate evaluation fixture", () => {
    const parsed = coachGateEvaluationSchema.parse(fixtures.gateEvaluation);
    assert.equal(parsed.allPassed, true);
    assert.equal(parsed.results.length, 10);
    const json = JSON.stringify(parsed);
    const again = coachGateEvaluationSchema.parse(JSON.parse(json));
    assert.deepEqual(again, parsed);
  });

  it("parses scan manifest with completeness invariant", () => {
    const parsed = coachScanManifestSchema.parse(fixtures.scanManifest);
    assert.equal(parsed.scanComplete, true);
    assert.equal(parsed.marketsSeen, parsed.marketsPosted);
    assert.equal(parsed.propsSeen, parsed.propsPosted);
  });

  it("rejects incomplete scan manifest marked complete", () => {
    assert.throws(() =>
      coachScanManifestSchema.parse({
        ...fixtures.scanManifest,
        propsSeen: fixtures.scanManifest.propsPosted - 1,
      }),
    );
  });

  it("parses ticket fixture", () => {
    const parsed = coachTicketSchema.parse(fixtures.ticket);
    assert.equal(parsed.deliveredLegs, 5);
    assert.equal(parsed.propCount, 4);
  });

  it("parses partial ticket response with shortfall", () => {
    const parsed = coachTicketResponseSchema.parse(fixtures.partialTicketResponse);
    assert.equal(parsed.shortfall?.deliveredLegs, 8);
    assert.equal(parsed.shortfall?.requestedLegs, 10);
    assert.match(parsed.shortfall?.message ?? "", /No filler picks/);
  });

  it("rejects ready ticket with zero legs", () => {
    assert.throws(() =>
      coachTicketResponseSchema.parse({
        ...fixtures.partialTicketResponse,
        ticket: {
          ...fixtures.partialTicketResponse.ticket,
          deliveredLegs: 0,
        },
      }),
    );
  });

  it("parses full snapshot fixture for mobile adapter contract", () => {
    const parsed = coachSnapshotSchema.parse(fixtures.snapshot);
    assert.equal(parsed.serveable, true);
    assert.equal(parsed.tickets.global[5]?.deliveredLegs, 5);
    const json = JSON.stringify(parsed);
    const again = coachSnapshotSchema.parse(JSON.parse(json));
    assert.equal(again.fingerprint, parsed.fingerprint);
    assert.equal(again.deepSimComplete, parsed.deepSimComplete);
    assert.equal(again.tickets.global[5]?.deliveredLegs, 5);
  });

  it("parses v2 slate response wrapping snapshot", () => {
    const parsed = coachV2SlateResponseSchema.parse({
      snapshot: fixtures.snapshot,
      fresh: true,
      instantServe: true,
      refreshing: false,
      computedAt: "2026-07-12T20:04:33.000Z",
      deepSimComplete: true,
      maxAgeMs: 900_000,
      activeSports: ["mlb"],
    });
    assert.equal(parsed.snapshot?.fingerprint, fixtures.snapshot.fingerprint);
  });
});
