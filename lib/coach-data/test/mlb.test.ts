import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeCoachSlate } from "../src/context";
import { createDefaultSportRegistry, enumerateSportCandidates } from "../src/sports/index";
import { createMlbAdapter } from "../src/sports/mlb";

const NOW = Date.parse("2026-07-12T20:00:00.000Z");

describe("coach-data MLB adapter", () => {
  const adapter = createMlbAdapter();

  it("exposes game and prop market definitions", () => {
    assert.ok(adapter.supportedGameMarkets().length >= 3);
    assert.ok(adapter.supportedPropMarkets().length >= 5);
  });

  it("enumerates every posted MLB line without stopping early", () => {
    const legs = adapter.enumerateCandidates({
      sport: "mlb",
      gameLines: [
        {
          gameId: "g1",
          gameLabel: "NYY @ BOS",
          marketKey: "h2h",
          marketLabel: "Moneyline",
          pick: "NYY ML",
          odds: -120,
          line: null,
          startsAt: "2026-07-12T23:00:00.000Z",
          isAlt: false,
        },
        {
          gameId: "g1",
          gameLabel: "NYY @ BOS",
          marketKey: "spreads",
          marketLabel: "Run Line",
          pick: "NYY -1.5",
          odds: 110,
          line: -1.5,
          startsAt: "2026-07-12T23:00:00.000Z",
          isAlt: false,
        },
      ],
      props: [
        {
          gameId: "g1",
          gameLabel: "NYY @ BOS",
          marketKey: "batter_hits",
          marketLabel: "Hits",
          playerId: "p1",
          playerName: "Aaron Judge",
          pick: "Over 1.5",
          odds: -110,
          line: 1.5,
          side: "Over",
          startsAt: "2026-07-12T23:00:00.000Z",
          isAlt: false,
        },
        {
          gameId: "g1",
          gameLabel: "NYY @ BOS",
          marketKey: "unsupported_prop",
          marketLabel: "Bad",
          playerId: "p2",
          playerName: "X",
          pick: "Over 1.5",
          odds: -110,
          line: 1.5,
          side: "Over",
          startsAt: "2026-07-12T23:00:00.000Z",
          isAlt: false,
        },
      ],
    });
    assert.equal(legs.length, 3);
    assert.equal(legs.filter((l) => l.kind === "player_prop").length, 1);
  });

  it("sport-specific gate rejects unsupported MLB markets", () => {
    const bad = adapter.evaluateSportSpecific(
      {
        legId: "x",
        legFingerprint: "fp",
        kind: "player_prop",
        sport: "mlb",
        gameId: "g1",
        gameLabel: "A @ B",
        marketKey: "unsupported_prop",
        marketLabel: "Bad",
        pick: "Over 1.5",
        odds: -110,
        line: 1.5,
        startsAt: null,
        isAlt: false,
      },
      {
        sport: "mlb",
        injuries: {},
        matchupHistory: {},
        playerHistory: {},
        lineMovement: {},
        trends: {},
      },
    );
    assert.equal(bad.pass, false);
  });

  it("integrates with normalized slate and default registry", () => {
    const slate = normalizeCoachSlate(
      {
        games: [
          {
            sport: "mlb",
            gameId: "g1",
            gameLabel: "NYY @ BOS",
            startsAt: new Date(NOW + 3 * 60 * 60 * 1000).toISOString(),
            status: "scheduled",
          },
        ],
        gameLines: [],
        props: [
          {
            sport: "mlb",
            gameId: "g1",
            gameLabel: "NYY @ BOS",
            marketKey: "batter_hits",
            marketLabel: "Hits",
            playerId: "p1",
            playerName: "Aaron Judge",
            pick: "Over 1.5",
            odds: -110,
            line: 1.5,
            side: "Over",
            startsAt: new Date(NOW + 3 * 60 * 60 * 1000).toISOString(),
          },
        ],
      },
      { nowMs: NOW },
    );
    const registry = createDefaultSportRegistry();
    const legs = enumerateSportCandidates(registry, slate, "mlb");
    assert.equal(legs.length, 1);
    assert.equal(legs[0]?.kind, "player_prop");
  });
});
