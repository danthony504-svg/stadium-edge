/**
 * Phase 2.3 — authoritative history share + single-flight + enrich reuse.
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  loadAuthoritativePlayerHistory,
  toPropSimHistoryShape,
  toEnrichmentHistory,
  clearAuthoritativePlayerHistoryForTests,
  authoritativePlayerHistoryKey,
  AUTHORITATIVE_PLAYER_HISTORY_TTL_MS,
  type AuthoritativePlayerHistory,
} from "../src/lib/authoritativePlayerHistory.ts";
import { fetchEspnPlayerHistory } from "../src/lib/espnPlayerHistory.ts";

describe("authoritativePlayerHistory", () => {
  beforeEach(() => {
    clearAuthoritativePlayerHistoryForTests();
  });

  it("TTL matches enrichment / propsim-ctx freshness (30m)", () => {
    assert.equal(AUTHORITATIVE_PLAYER_HISTORY_TTL_MS, 30 * 60_000);
  });

  it("key isolates sport + athleteId", () => {
    assert.equal(
      authoritativePlayerHistoryKey("MLB", "123"),
      "auth-hist:mlb:123",
    );
    assert.notEqual(
      authoritativePlayerHistoryKey("mlb", "1"),
      authoritativePlayerHistoryKey("nfl", "1"),
    );
  });

  it("toPropSimHistoryShape strips enrich-only date/opponentName (MC parity)", () => {
    const auth: AuthoritativePlayerHistory = {
      sport: "mlb",
      athleteId: "99",
      labels: ["H", "AB"],
      loadedAtMs: Date.now(),
      flat: [
        {
          eventId: "e1",
          date: "2026-10-01",
          opponentId: "10",
          opponentName: "Yankees",
          isHome: true,
          stats: { H: "2", AB: "4" },
        },
        {
          eventId: "e2",
          date: "2026-09-30",
          opponentId: "11",
          opponentName: "Red Sox",
          isHome: false,
          stats: { H: "1", AB: "3" },
        },
      ],
    };
    const shape = toPropSimHistoryShape(auth, "10");
    assert.equal(shape.recent.length, 2);
    assert.ok(!("date" in shape.recent[0]!));
    assert.ok(!("opponentName" in shape.recent[0]!));
    assert.equal(shape.recent[0]!.stats.H, "2");
    assert.equal(shape.recent[0]!.isHome, true);
    assert.equal(shape.vsOpponent.length, 1);
    assert.equal(shape.vsOpponent[0]!.stats.H, "2");
    assert.equal(shape.minutesTrend, undefined);
  });

  it("toEnrichmentHistory keeps date/opp/minutes for grading parity with getPlayerHistory", () => {
    const auth: AuthoritativePlayerHistory = {
      sport: "nba",
      athleteId: "1",
      labels: ["PTS", "MIN"],
      loadedAtMs: Date.now(),
      flat: Array.from({ length: 6 }, (_, i) => ({
        eventId: `e${i}`,
        date: `2026-10-0${i + 1}`,
        opponentId: "2",
        opponentName: "Opp",
        isHome: i % 2 === 0,
        stats: { PTS: String(20 + i), MIN: String(30 + i) },
      })),
    };
    const enrich = toEnrichmentHistory(auth, "2");
    assert.equal(enrich.recent[0]!.date, "2026-10-01");
    assert.equal(enrich.recent[0]!.opponentName, "Opp");
    assert.ok(enrich.minutesTrend);
    assert.ok(enrich.vsOpponent.length >= 1);
  });

  it("concurrent loads coalesce to one in-flight Promise", async () => {
    let fetches = 0;
    const orig = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("gamelog")) {
        fetches += 1;
        await new Promise((r) => setTimeout(r, 40));
        return new Response(
          JSON.stringify({
            labels: ["H"],
            names: ["H"],
            events: {
              e1: {
                gameDate: "2026-10-01",
                atVs: "vs",
                opponent: { id: "1", displayName: "A" },
              },
            },
            seasonTypes: [
              { categories: [{ events: [{ eventId: "e1", stats: ["2"] }] }] },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return orig(input as never);
    }) as typeof fetch;

    try {
      const [a, b, c] = await Promise.all([
        loadAuthoritativePlayerHistory("mlb", "424242"),
        loadAuthoritativePlayerHistory("mlb", "424242"),
        loadAuthoritativePlayerHistory("mlb", "424242"),
      ]);
      assert.ok(a.history);
      assert.ok(b.history);
      assert.ok(c.history);
      // At least one waiter coalesced; ESPN gamelog fetched once (cachedJson may add 1).
      assert.ok(a.coalesced || b.coalesced || c.coalesced);
      assert.equal(fetches, 1);
      // Propsim wrapper shares the same store.
      const shape = await fetchEspnPlayerHistory("mlb", "424242");
      assert.ok(shape?.recent.length);
      assert.equal(fetches, 1);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("clears in-flight on failure so a retry can proceed", async () => {
    let calls = 0;
    const orig = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("gamelog")) {
        calls += 1;
        if (calls === 1) {
          return new Response("nope", { status: 500 });
        }
        return new Response(
          JSON.stringify({
            labels: ["H"],
            names: ["H"],
            events: {
              e1: {
                gameDate: "2026-10-01",
                atVs: "vs",
                opponent: { id: "1", displayName: "A" },
              },
            },
            seasonTypes: [
              { categories: [{ events: [{ eventId: "e1", stats: ["1"] }] }] },
            ],
          }),
          { status: 200 },
        );
      }
      return orig(input as never);
    }) as typeof fetch;

    try {
      const first = await loadAuthoritativePlayerHistory("mlb", "777");
      assert.equal(first.history, null);
      const second = await loadAuthoritativePlayerHistory("mlb", "777");
      assert.ok(second.history);
      assert.equal(calls, 2);
    } finally {
      globalThis.fetch = orig;
    }
  });
});
