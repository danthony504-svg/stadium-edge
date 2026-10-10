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

test("redactPremiumPickForClient keeps grades/confidence/edge; strips identity/lines/odds", () => {
  const out = redactPremiumPickForClient({
    game: "Lakers @ Celtics",
    market: "Spread",
    pick: "Lakers -3.5",
    odds: -110,
    edge: "Model edge +3%",
    sport: "nba",
    player: undefined,
    startsAt: "2026-10-10T00:00:00Z",
    scores: { composite: 7.5, grade: "A-", confidencePct: 61, edgePct: 3.1 },
    finalAiScore: {
      grade: "A-",
      composite: 7.5,
      simHit: 0.55,
      confidencePct: 61,
      edgePct: 3.1,
    },
    propLine: 3.5,
    propSide: "home",
    propMarketKey: "spreads",
  });
  assert.equal(out.game, "••••••");
  assert.equal(out.sport, "nba");
  assert.equal(out.startsAt, null);
  assert.equal(out.pick, "••••••");
  assert.equal(out.odds, 0);
  assert.equal(out.edge, undefined);
  assert.equal(out.propMarketKey, undefined);
  assert.equal(out.scores?.composite, 7.5);
  assert.equal(out.scores?.confidencePct, 61);
  assert.equal(out.scores?.edgePct, 3.1);
  assert.equal(out.finalAiScore?.grade, "A-");
  assert.equal(out.finalAiScore?.composite, 7.5);
  assert.equal(out.finalAiScore?.confidencePct, 61);
  assert.equal(out.finalAiScore?.edgePct, 3.1);
  assert.equal(out.propLine, null);
});

test("redaction never fabricates confidence or edge", () => {
  const out = redactPremiumPickForClient({
    game: "A @ B",
    market: "Total",
    pick: "Over 220.5",
    odds: -110,
    finalAiScore: { grade: "B", composite: 6 },
  });
  assert.equal(out.finalAiScore?.confidencePct, null);
  assert.equal(out.finalAiScore?.edgePct, null);
  assert.equal(out.finalAiScore?.grade, "B");
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

test("snapshotForClient redacts identity when locked but keeps grades", () => {
  const client = snapshotForClient(minimalSnapshot(), {
    legs: 1,
    premiumUnlocked: false,
  });
  assert.equal(client.boardScan?.picks[0]?.pick, "••••••");
  assert.equal(client.boardScan?.picks[0]?.odds, 0);
  assert.equal(client.boardScan?.picks[0]?.game, "••••••");
  assert.equal(client.boardScan?.picks[0]?.startsAt, null);
  assert.equal(client.boardScan?.picks[0]?.finalAiScore?.grade, "A");
  assert.deepEqual(client.boardScan?.evalLinesByGame, {});
  assert.deepEqual(client.boardScan?.gameSimulations, {});
  assert.equal(client.propSimulations.length, 0);
  assert.equal(client.built.context.realOdds[0]?.pick, "••••••");
  assert.equal(client.built.context.realOdds[0]?.odds, 0);
  assert.equal(client.built.context.realOdds[0]?.game, "••••••");
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
