import assert from "node:assert/strict";
import test from "node:test";

import { isActivePaidEntitlement } from "../src/lib/subscriptionEntitlement.ts";
import {
  redactPremiumPickForClient,
  snapshotForClient,
  type SlatePreAnalysisSnapshot,
} from "../src/lib/coachSlateTypes.ts";

test("isActivePaidEntitlement: Go/Pro active", () => {
  assert.equal(
    isActivePaidEntitlement({
      planId: "go",
      storeKitActive: true,
      status: "active",
      expiresAt: null,
    }),
    true,
  );
  assert.equal(
    isActivePaidEntitlement({
      planId: "pro",
      storeKitActive: true,
      status: "active",
      expiresAt: new Date(Date.now() + 86_400_000),
    }),
    true,
  );
});

test("isActivePaidEntitlement: expired / revoked / refunded / paused locked", () => {
  assert.equal(
    isActivePaidEntitlement({
      planId: "go",
      storeKitActive: false,
      status: "expired",
      expiresAt: new Date(Date.now() - 1000),
    }),
    false,
  );
  assert.equal(
    isActivePaidEntitlement({
      planId: "pro",
      storeKitActive: true,
      status: "refunded",
      expiresAt: null,
    }),
    false,
  );
  assert.equal(
    isActivePaidEntitlement({
      planId: "go",
      storeKitActive: true,
      status: "revoked",
      expiresAt: null,
    }),
    false,
  );
  assert.equal(
    isActivePaidEntitlement({
      planId: "go",
      storeKitActive: true,
      status: "paused",
      expiresAt: null,
    }),
    false,
  );
});

test("isActivePaidEntitlement: cancelled-at-expiration still active before expiresAt", () => {
  assert.equal(
    isActivePaidEntitlement({
      planId: "go",
      storeKitActive: true,
      status: "cancelled",
      expiresAt: new Date(Date.now() + 86_400_000),
    }),
    true,
  );
  assert.equal(
    isActivePaidEntitlement({
      planId: "go",
      storeKitActive: true,
      status: "cancelled",
      expiresAt: new Date(Date.now() - 1000),
    }),
    false,
  );
});

test("redactPremiumPickForClient keeps public fields, strips premium", () => {
  const out = redactPremiumPickForClient({
    game: "Lakers @ Celtics",
    market: "Spread",
    pick: "Lakers -3.5",
    odds: -110,
    edge: "Model edge +3%",
    sport: "nba",
    player: undefined,
    startsAt: "2026-10-10T00:00:00Z",
    scores: { composite: 7.5 },
    finalAiScore: { grade: "A-", composite: 7.5, simHit: 0.55 },
    propLine: 3.5,
    propSide: "home",
  });
  assert.equal(out.game, "Lakers @ Celtics");
  assert.equal(out.sport, "nba");
  assert.equal(out.startsAt, "2026-10-10T00:00:00Z");
  assert.equal(out.pick, "••••••");
  assert.equal(out.odds, 0);
  assert.equal(out.edge, undefined);
  assert.equal(out.scores, undefined);
  assert.equal(out.finalAiScore, undefined);
  assert.equal(out.propLine, null);
});

function minimalSnapshot(): SlatePreAnalysisSnapshot {
  return {
    at: Date.now(),
    fingerprint: "test",
    built: {
      context: {
        selectedSports: ["nba"],
        currentSlip: [],
        realGames: [{ sport: "nba", game: "Lakers @ Celtics", startsAt: "2026-10-10T00:00:00Z" }],
        realOdds: [
          {
            sport: "nba",
            game: "Lakers @ Celtics",
            market: "Spread",
            pick: "Lakers -3.5",
            odds: -110,
            edge: 0.04,
          },
        ],
        realProps: [],
      },
      propPool: [],
      gameMeta: [],
      upsetSpots: [],
      todayOnly: true,
      tomorrowOnly: false,
    },
    propSimulations: [["x", { hitProbability: 0.6 }]],
    boardScan: {
      picks: [
        {
          game: "Lakers @ Celtics",
          market: "Spread",
          pick: "Lakers -3.5",
          odds: -110,
          edge: "edge",
          sport: "nba",
          startsAt: "2026-10-10T00:00:00Z",
          finalAiScore: { grade: "A", composite: 8, simHit: 0.6 },
        },
      ],
      evalLinesByGame: {
        "Lakers @ Celtics": [
          {
            sport: "nba",
            game: "Lakers @ Celtics",
            market: "Spread",
            pick: "Lakers -3.5",
            odds: -110,
          },
        ],
      },
      gameSimulations: { "Lakers @ Celtics": { winProbHome: 0.55 } },
      totalScanned: 10,
      totalQualified: 1,
      staging: { mainQualified: 1, altQualified: 0, mainOnTicket: 1, altOnTicket: 0 },
      note: "ok",
    },
    deepSimComplete: true,
  };
}

test("snapshotForClient redacts premium when locked", () => {
  const client = snapshotForClient(minimalSnapshot(), {
    legs: 1,
    premiumUnlocked: false,
  });
  assert.equal(client.boardScan?.picks[0]?.pick, "••••••");
  assert.equal(client.boardScan?.picks[0]?.odds, 0);
  assert.equal(client.boardScan?.picks[0]?.game, "Lakers @ Celtics");
  assert.equal(client.boardScan?.picks[0]?.startsAt, "2026-10-10T00:00:00Z");
  assert.deepEqual(client.boardScan?.evalLinesByGame, {});
  assert.deepEqual(client.boardScan?.gameSimulations, {});
  assert.equal(client.propSimulations.length, 0);
  assert.equal(client.built.context.realOdds[0]?.pick, "••••••");
  assert.equal(client.built.context.realOdds[0]?.odds, 0);
});

test("snapshotForClient keeps premium when unlocked", () => {
  const client = snapshotForClient(minimalSnapshot(), {
    legs: 1,
    premiumUnlocked: true,
  });
  assert.equal(client.boardScan?.picks[0]?.pick, "Lakers -3.5");
  assert.equal(client.boardScan?.picks[0]?.odds, -110);
  assert.ok((client.propSimulations?.length ?? 0) > 0);
});
