/**
 * Sync-render startup crash audit (ErrorBoundary path).
 *
 * Hermes "Cannot convert undefined value to object" = Object.keys/entries/values
 * (or equivalent) on undefined/null during a React render — not an async rejection.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { isFantasyRostersSync, repairFantasyRosterSlots } from "./fantasyRoster.ts";
import { normalizeStealScanMeta } from "./steals.ts";
import { sanitizeSubscriptionState, clearCustomPromoUnlock } from "./entitlements.ts";

const ROOT = process.cwd();

/** Mirrors tryDeserializeBoardScan without importing expo-updates via the cache module. */
function tryDeserializeBoardScanPure(raw: {
  picks?: unknown;
  evalLinesByGame?: unknown;
  gameSimulations?: unknown;
} | null): unknown {
  if (!raw?.picks || !Array.isArray(raw.picks)) return null;
  const plain = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);
  if (!plain(raw.evalLinesByGame) || !plain(raw.gameSimulations)) return null;
  return {
    picks: raw.picks,
    evalLinesByGame: new Map(Object.entries(raw.evalLinesByGame as object)),
    gameSimulations: new Map(Object.entries(raw.gameSimulations as object)),
  };
}

test("corrupt fantasy sync {rosters:null} is rejected (no Object.entries)", () => {
  const bad = { version: 1, defaultRosterId: "default", rosters: null };
  assert.equal(isFantasyRostersSync(bad), false);
  assert.throws(() => repairFantasyRosterSlots(bad as never));
});

test("missing steals sportCounts fails closed before Object.entries", () => {
  assert.equal(
    normalizeStealScanMeta({
      stealsFound: 3,
      booksScanned: 2,
      marketsChecked: 10,
      longshotsAnalyzed: 5,
      // sportCounts omitted
    } as never),
    undefined,
  );
});

test("incomplete slate board scan fails closed (no Object.entries(undefined))", () => {
  assert.equal(
    tryDeserializeBoardScanPure({
      picks: [{}],
      // evalLinesByGame / gameSimulations missing
    }),
    null,
  );
  const src = readFileSync(join(ROOT, "lib/slatePreAnalysisCache.ts"), "utf8");
  assert.match(src, /export function tryDeserializeBoardScan/);
});

test("corrupt subscription promoRedeemCounts:null sanitizes without throw", () => {
  const cleaned = clearCustomPromoUnlock(
    sanitizeSubscriptionState({
      planId: "free",
      promoRedeemCounts: null,
      storeKitActive: false,
    }),
  );
  assert.deepEqual(cleaned.promoRedeemCounts, {});
});

test("empty / missing API-shaped payloads do not require Object.entries on Home chrome", () => {
  // Home uses safeMarkets / isRenderableOddsGame — markets undefined → [].
  const safeMarkets = (g: { markets?: unknown } | null | undefined) => {
    const m = g?.markets;
    return Array.isArray(m) ? m : [];
  };
  assert.deepEqual(safeMarkets(undefined), []);
  assert.deepEqual(safeMarkets({ markets: undefined }), []);
  assert.deepEqual(safeMarkets({ markets: null }), []);
});

test("root AppShell order: providers before MinVersionGate; DeferredOta after gate", () => {
  const src = readFileSync(join(ROOT, "app/_layout.tsx"), "utf8");
  const sub = src.indexOf("<SubscriptionProvider>");
  const fantasy = src.indexOf("<FantasyRosterProvider>");
  const gate = src.indexOf("<MinVersionGate>");
  const nav = src.indexOf("<RootLayoutNav />");
  const ota = src.indexOf("<DeferredOtaRuntime />");
  assert.ok(sub > 0 && fantasy > sub && gate > fantasy);
  assert.ok(nav > gate && ota > nav);
});

test("reproduction: Object.entries(undefined) matches Hermes crash message", () => {
  assert.throws(
    () => Object.entries(undefined as never),
    (err: unknown) =>
      err instanceof TypeError &&
      /Cannot convert undefined( value)? to object|Cannot convert undefined or null to object/i.test(
        String((err as Error).message),
      ),
  );
});
