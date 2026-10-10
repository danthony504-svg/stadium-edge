/**
 * Regression: GET /coach/slate and free open-parlay preview must not 500
 * when the precomputed slate row is missing, malformed, or redaction throws.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  assertLockedPreviewSafe,
  buildLockedPreviewFromSlateRow,
  emptyLockedPreview,
} from "../src/lib/coachOpenParlayPreviewCore.ts";
import { normalizeCoachPrecomputedSlateRow } from "../src/lib/coachSlateRow.ts";
import { snapshotForClient } from "../src/lib/coachSlateTypes.ts";

/** Mirror the coachSlate GET response shape after the hotfix degrade path. */
function simulateCoachSlateGet(row: ReturnType<typeof normalizeCoachPrecomputedSlateRow>) {
  const premiumUnlocked = false;
  const hasUsableSnapshot = !!(row.snapshot && (row.fresh || row.instantServe));
  let clientSnapshot = null as ReturnType<typeof snapshotForClient> | null;
  if (row.snapshot && hasUsableSnapshot) {
    clientSnapshot = snapshotForClient(row.snapshot, {
      legs: 5,
      premiumUnlocked,
    });
    if (!premiumUnlocked && clientSnapshot?.boardScan?.picks?.length) {
      const leak = clientSnapshot.boardScan.picks.some(
        (p) =>
          (p.game && p.game !== "••••••") ||
          (p.pick && p.pick !== "••••••") ||
          (typeof p.odds === "number" && p.odds !== 0),
      );
      if (leak) clientSnapshot = null;
    }
  }
  return {
    status: 200 as const,
    body: {
      snapshot: clientSnapshot,
      fresh: row.fresh,
      instantServe: row.instantServe,
      premiumUnlocked,
    },
  };
}

test("GET /coach/slate degrade: missing row → 200 empty, not 500", () => {
  const res = simulateCoachSlateGet(normalizeCoachPrecomputedSlateRow(null));
  assert.equal(res.status, 200);
  assert.equal(res.body.snapshot, null);
  assert.equal(res.body.premiumUnlocked, false);
});

test("GET /coach/slate degrade: malformed built still 200 and redacted", () => {
  const row = normalizeCoachPrecomputedSlateRow({
    data: {
      at: Date.now(),
      fingerprint: "x",
      built: null,
      propSimulations: [],
      boardScan: null,
      tickets: {
        global: {
          5: {
            picks: [
              {
                game: "Chiefs @ Bills",
                market: "Spread",
                pick: "Chiefs -2.5",
                odds: -115,
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
    },
    updatedAt: "2026-10-10T12:00:00.000Z",
    deepSimComplete: true,
  });
  // Pre-fix: snapshotForClient threw on built=null → route 500.
  const res = simulateCoachSlateGet(row);
  assert.equal(res.status, 200);
  assert.ok(res.body.snapshot);
  const picks = res.body.snapshot?.tickets?.global?.[5]?.picks ?? [];
  assert.ok(picks.length >= 1);
  assert.equal(picks[0]?.game, "••••••");
  assert.equal(picks[0]?.pick, "••••••");
  assert.equal(picks[0]?.odds, 0);
  assert.equal(res.body.premiumUnlocked, false);
});

test("GET /coach/slate degrade: string updatedAt does not throw", () => {
  assert.doesNotThrow(() =>
    normalizeCoachPrecomputedSlateRow({
      data: {
        at: Date.now(),
        fingerprint: "x",
        built: {
          context: {
            selectedSports: [],
            currentSlip: [],
            realGames: [],
            realOdds: [],
            realProps: [],
          },
          propPool: [],
          gameMeta: [],
          upsetSpots: [],
          todayOnly: false,
          tomorrowOnly: false,
        },
        propSimulations: [],
        boardScan: null,
        deepSimComplete: false,
      },
      updatedAt: "not-a-date-object",
      deepSimComplete: false,
    }),
  );
});

test("POST /chat open-parlay: malformed slate yields locked empty preview (no 500)", () => {
  const preview = buildLockedPreviewFromSlateRow("5 leg NFL parlay", {
    snapshot: {
      at: Date.now(),
      fingerprint: "x",
      // @ts-expect-error intentional production malformation
      built: null,
      propSimulations: [],
      boardScan: null,
      tickets: {
        global: {
          5: {
            picks: [
              {
                game: "Lakers @ Celtics",
                market: "Moneyline",
                pick: "Lakers ML",
                odds: 130,
                player: "LeBron",
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
    },
    fresh: true,
    instantServe: true,
  });
  assert.deepEqual(assertLockedPreviewSafe(preview), []);
  assert.equal(preview.cta.includes("Subscribe") || preview.cta.includes("Sign"), true);
  for (const p of preview.picks) {
    assert.equal(p.game, "••••••");
    assert.equal(p.pick, "••••••");
    assert.equal(p.odds, 0);
    assert.equal(p.player, undefined);
  }
});

test("POST /chat open-parlay: store read failure path serves empty lock", () => {
  const preview = emptyLockedPreview(5);
  assert.equal(preview.pickCount, 0);
  assert.deepEqual(assertLockedPreviewSafe(preview), []);
  assert.match(preview.content, /locked/i);
});
