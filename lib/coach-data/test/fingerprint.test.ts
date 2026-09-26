import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computeContextFingerprint, computeLegFingerprint } from "../src/fingerprint";

describe("coach-data fingerprint", () => {
  it("leg fingerprint is stable for same inputs", () => {
    const input = {
      sport: "mlb",
      gameId: "NYY @ BOS",
      marketKey: "batter_hits",
      pick: "Over 1.5",
      line: 1.5,
      odds: -110,
      playerId: "p1",
      isAlt: false,
    };
    assert.equal(computeLegFingerprint(input), computeLegFingerprint(input));
  });

  it("leg fingerprint changes when odds change", () => {
    const base = {
      sport: "mlb",
      gameId: "NYY @ BOS",
      marketKey: "batter_hits",
      pick: "Over 1.5",
      line: 1.5,
      odds: -110,
      playerId: "p1",
      isAlt: false,
    };
    const changed = { ...base, odds: -105 };
    assert.notEqual(computeLegFingerprint(base), computeLegFingerprint(changed));
  });

  it("context fingerprint changes when prop count changes", () => {
    const base = {
      gameLines: [
        {
          sport: "mlb",
          gameId: "g1",
          gameLabel: "A @ B",
          marketKey: "h2h",
          marketLabel: "ML",
          pick: "A ML",
          odds: 150,
          line: null,
          startsAt: "2026-07-12T23:00:00.000Z",
        },
      ],
      props: [],
    };
    const withProp = {
      ...base,
      props: [
        {
          sport: "mlb",
          gameId: "g1",
          gameLabel: "A @ B",
          marketKey: "batter_hits",
          marketLabel: "Hits",
          playerId: "p1",
          playerName: "Player",
          pick: "Over 1.5",
          odds: -110,
          line: 1.5,
          side: "Over" as const,
          startsAt: "2026-07-12T23:00:00.000Z",
        },
      ],
    };
    assert.notEqual(
      computeContextFingerprint(base),
      computeContextFingerprint(withProp),
    );
  });
});
