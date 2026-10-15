import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeSlateFingerprint,
  isSlateSnapshotFresh,
  nearestSlateParlaySize,
  resolveSlateBoardScan,
  snapshotForClient,
  SLATE_PRE_ANALYSIS_MAX_MS,
  type BuiltChatContext,
  type SlatePreAnalysisSnapshot,
} from "../src/lib/coachSlateTypes.ts";
import { assertLockedPreviewSafe } from "../src/lib/coachLockedPreviewSafety.ts";

function minimalBuilt(overrides?: Partial<BuiltChatContext>): BuiltChatContext {
  return {
    context: {
      selectedSports: ["mlb"],
      currentSlip: [],
      realGames: [],
      realOdds: [
        {
          sport: "mlb",
          game: "A @ B",
          market: "Moneyline",
          pick: "A ML",
          odds: 150,
          startsAt: "2026-07-12T20:00:00Z",
        },
      ],
      realProps: [],
    },
    propPool: [{ sport: "mlb", game: "A @ B", marketLabel: "Hits", player: "P", line: 1, side: "Over", odds: -110 }],
    gameMeta: [],
    upsetSpots: [],
    todayOnly: false,
    tomorrowOnly: false,
    ...overrides,
  };
}

describe("coachSlateTypes", () => {
  it("computeSlateFingerprint is stable for same inputs", () => {
    const built = minimalBuilt();
    const fp = computeSlateFingerprint(built);
    assert.equal(fp, computeSlateFingerprint(built));
    assert.ok(fp.startsWith("ppg-per-drive-v1:"));
  });

  it("computeSlateFingerprint changes when odds change", () => {
    const a = minimalBuilt();
    const b = minimalBuilt({
      context: {
        ...a.context,
        realOdds: [{ ...a.context.realOdds[0]!, odds: 160 }],
      },
    });
    assert.notEqual(computeSlateFingerprint(a), computeSlateFingerprint(b));
  });

  it("isSlateSnapshotFresh respects max age", () => {
    const snap = {
      at: Date.now() - SLATE_PRE_ANALYSIS_MAX_MS - 1,
      fingerprint: "x",
      built: minimalBuilt(),
      propSimulations: [],
      boardScan: null,
      deepSimComplete: true,
    };
    assert.equal(isSlateSnapshotFresh(snap), false);
    snap.at = Date.now();
    assert.equal(isSlateSnapshotFresh(snap), true);
  });

  it("resolveSlateBoardScan picks exact precomputed ticket size", () => {
    const fiveLeg = {
      picks: Array.from({ length: 5 }, (_, i) => ({
        game: `G${i} @ H${i}`,
        market: "Moneyline",
        pick: `Team ML`,
        odds: -110,
        sport: "mlb",
      })),
      evalLinesByGame: {},
      gameSimulations: {},
      totalScanned: 100,
      totalQualified: 20,
      staging: { mainQualified: 10, altQualified: 10, mainOnTicket: 5, altOnTicket: 0 },
      note: "5-leg ticket",
    };
    const snap: SlatePreAnalysisSnapshot = {
      at: Date.now(),
      fingerprint: "x",
      built: minimalBuilt(),
      propSimulations: [],
      boardScan: null,
      tickets: { global: { 5: fiveLeg }, bySport: {} },
      deepSimComplete: true,
    };
    const resolved = resolveSlateBoardScan(snap, { legs: 5 });
    assert.equal(resolved?.picks.length, 5);
    assert.equal(resolved?.note, "5-leg ticket");
    assert.equal(nearestSlateParlaySize(7), 6);
    // 4 is a supported precomputed size in SLATE_PARLAY_SIZES.
    assert.equal(nearestSlateParlaySize(4), 4);
  });

  it("snapshotForClient does not throw on null/missing built (production 500 root cause)", () => {
    const at = Date.now();
    for (const built of [null, undefined, {}, { context: null }] as unknown[]) {
      const snap = {
        at,
        fingerprint: "broken",
        built,
        propSimulations: [],
        boardScan: {
          picks: [
            {
              game: "Secret @ Team",
              market: "Spread",
              pick: "Secret -3.5",
              odds: -110,
            },
          ],
          evalLinesByGame: {},
          gameSimulations: {},
          totalScanned: 1,
          totalQualified: 1,
          staging: {
            mainQualified: 1,
            altQualified: 0,
            mainOnTicket: 1,
            altOnTicket: 0,
          },
          note: "x",
        },
        tickets: {
          global: {
            5: {
              picks: [
                {
                  game: "Secret @ Team",
                  market: "Spread",
                  pick: "Secret -3.5",
                  odds: -110,
                },
              ],
              evalLinesByGame: {},
              gameSimulations: {},
              totalScanned: 1,
              totalQualified: 1,
              staging: {
                mainQualified: 1,
                altQualified: 0,
                mainOnTicket: 1,
                altOnTicket: 0,
              },
              note: "x",
            },
          },
          bySport: {},
        },
        deepSimComplete: true,
      } as unknown as SlatePreAnalysisSnapshot;

      const client = snapshotForClient(snap, { legs: 5, premiumUnlocked: false });
      assert.ok(client);
      assert.equal(client.built.context.realOdds.length, 0);
      const picks = client.boardScan?.picks ?? client.tickets?.global?.[5]?.picks ?? [];
      for (const p of picks) {
        assert.equal(p.game, "••••••");
        assert.equal(p.pick, "••••••");
        assert.equal(p.odds, 0);
      }
      assert.deepEqual(
        assertLockedPreviewSafe({
          content: "ok",
          pickCount: picks.length,
          requestedLegs: 5,
          cta: "Sign In / Subscribe to Reveal Picks",
          picks,
        }),
        [],
      );
    }
  });

  it("snapshotForClient redacts a healthy snapshot without exposing identity", () => {
    const pick = {
      game: "Eagles @ Jaguars",
      market: "Spread",
      pick: "Eagles -3.5",
      odds: -110,
      sport: "nfl",
      finalAiScore: { grade: "A", confidencePct: 62, edgePct: 4, composite: 8 },
    };
    const snap: SlatePreAnalysisSnapshot = {
      at: Date.now(),
      fingerprint: "ok",
      built: minimalBuilt(),
      propSimulations: [["k", { hitProbability: 0.5 }]],
      boardScan: null,
      tickets: {
        global: {
          5: {
            picks: [pick],
            evalLinesByGame: { "Eagles @ Jaguars": [] },
            gameSimulations: {},
            totalScanned: 10,
            totalQualified: 5,
            staging: {
              mainQualified: 5,
              altQualified: 0,
              mainOnTicket: 5,
              altOnTicket: 0,
            },
            note: "5-leg",
          },
        },
        bySport: {},
      },
      deepSimComplete: true,
    };
    const client = snapshotForClient(snap, { legs: 5, premiumUnlocked: false });
    const p = client.tickets?.global?.[5]?.picks?.[0];
    assert.ok(p);
    assert.equal(p.game, "••••••");
    assert.equal(p.pick, "••••••");
    assert.equal(p.odds, 0);
    assert.equal(p.finalAiScore?.grade, "A");
    assert.equal(client.propSimulations.length, 0);
    assert.equal(client.built.context.realOdds[0]?.game, "••••••");
  });

  it("snapshotForClient keeps the engine stamp through premium JSON and redaction", () => {
    const snap: SlatePreAnalysisSnapshot = {
      at: Date.now(),
      fingerprint: "ppg-per-drive-v1:1:0:::",
      simEngineStamp: "ppg-per-drive-v1",
      built: minimalBuilt(),
      propSimulations: [],
      boardScan: null,
      tickets: {
        global: {
          3: {
            picks: [],
            evalLinesByGame: {},
            gameSimulations: {
              "A @ B": {
                sport: "nfl",
                engineVersion: "ppg-per-drive-v1",
                winProbHome: 0.55,
                winProbAway: 0.45,
              },
            },
            totalScanned: 1,
            totalQualified: 0,
            staging: {
              mainQualified: 0,
              altQualified: 0,
              mainOnTicket: 0,
              altOnTicket: 0,
            },
            note: "stamp",
          },
        },
        bySport: {},
      },
      deepSimComplete: true,
    };
    const premium = JSON.parse(
      JSON.stringify(snapshotForClient(snap, { legs: 3, premiumUnlocked: true })),
    ) as SlatePreAnalysisSnapshot;
    assert.equal(premium.simEngineStamp, "ppg-per-drive-v1");
    assert.equal(premium.boardScan?.gameSimulations["A @ B"]?.engineVersion, "ppg-per-drive-v1");
    assert.equal(
      premium.tickets?.global?.[3]?.gameSimulations["A @ B"]?.engineVersion,
      "ppg-per-drive-v1",
    );
    const locked = snapshotForClient(snap, { legs: 3, premiumUnlocked: false });
    assert.equal(locked.simEngineStamp, "ppg-per-drive-v1");
    assert.deepEqual(locked.boardScan?.gameSimulations, {});
    assert.deepEqual(locked.tickets?.global?.[3]?.gameSimulations, {});
  });

  it("snapshotForClient seals a cached period rate before a premium client can grade it", () => {
    const snap: SlatePreAnalysisSnapshot = {
      at: Date.now(),
      fingerprint: "ppg-per-drive-v1:cached",
      simEngineStamp: "ppg-per-drive-v1",
      built: minimalBuilt(),
      propSimulations: [],
      boardScan: null,
      tickets: {
        global: {
          3: {
            picks: [],
            evalLinesByGame: {
              "Seattle Seahawks @ Denver Broncos": [
                {
                  sport: "nfl",
                  game: "Seattle Seahawks @ Denver Broncos",
                  market: "Q3 Spread",
                  pick: "Seahawks +1.5",
                  odds: -110,
                },
              ],
            },
            gameSimulations: {
              "Seattle Seahawks @ Denver Broncos": {
                sport: "nfl",
                engineVersion: "ppg-per-drive-v1",
                winProbHome: 0.58,
                winProbAway: 0.42,
                coverProbs: { "sea @ den|q3|spread|home|-1.5": 0.91 },
              },
            },
            totalScanned: 1,
            totalQualified: 0,
            staging: { mainQualified: 0, altQualified: 0, mainOnTicket: 0, altOnTicket: 0 },
            note: "cached",
          },
        },
        bySport: {},
      },
      deepSimComplete: true,
    };
    const premium = snapshotForClient(snap, { legs: 3, premiumUnlocked: true });
    const sim = premium.boardScan?.gameSimulations["Seattle Seahawks @ Denver Broncos"];
    const clientId = "seattle seahawks @ denver broncos|q3 spread|seahawks +1.5";
    assert.equal(sim?.coverHitRates?.[clientId], 0);
    assert.equal(sim?.coverQueryStatus?.[clientId], "unsupported_market");
    assert.equal(sim?.coverHitRates?.["sea @ den|q3|spread|home|-1.5"], 0);
    assert.equal(sim?.outcomes, undefined);
  });
});
