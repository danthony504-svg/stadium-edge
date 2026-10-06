/**
 * Phase 2.3 — enrich reuses shared prop-sim history (no duplicate HTTP).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { enrichCoachPropSimHits } from "../lib/coachPropSimFallback.ts";
import type { ParsedPick } from "../components/PickCard.tsx";
import type { PropPoolEntry, PropSimPlayerHistoryPayload } from "../lib/api.ts";
import { clearCoachContextCache } from "../lib/coachContextCache.ts";

describe("enrichCoachPropSimHits Phase 2.3 shared history", () => {
  it("reuses authoritative shared history and does not call getPlayerHistory", async () => {
    clearCoachContextCache();
    let historyHttp = 0;
    const orig = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(typeof input === "string" ? input : (input as Request).url ?? input);
      if (url.includes("/sports/player-history")) {
        historyHttp += 1;
        return new Response(JSON.stringify({ error: "should not fetch" }), { status: 500 });
      }
      return orig(input as never);
    }) as typeof fetch;

    try {
      const pick = {
        isProp: true,
        player: "Test Player",
        sport: "mlb",
        athleteId: "33481",
        propMarketKey: "batter_hits",
        propLine: 0.5,
        propSide: "Over",
        game: "A @ B",
        pick: "Test Player Over 0.5 Hits",
        odds: -110,
      } as ParsedPick;
      const pool: PropPoolEntry[] = [
        {
          player: "Test Player",
          marketKey: "batter_hits",
          marketLabel: "Hits",
          line: 0.5,
          side: "Over",
          odds: -110,
          sport: "mlb",
          game: "A @ B",
          athleteId: "33481",
        } as PropPoolEntry,
      ];
      const shared: Record<string, PropSimPlayerHistoryPayload> = {
        "33481": {
          sport: "mlb",
          athleteId: "33481",
          labels: ["H", "AB"],
          recent: [
            { date: "2026-10-01", opponentName: "Yanks", opponentId: "10", isHome: true, stats: { H: "2", AB: "4" } },
            { date: "2026-09-30", opponentName: "Sox", opponentId: "11", isHome: false, stats: { H: "1", AB: "3" } },
            { date: "2026-09-29", opponentName: "Jays", opponentId: "12", isHome: true, stats: { H: "0", AB: "3" } },
            { date: "2026-09-28", opponentName: "Orioles", opponentId: "13", isHome: false, stats: { H: "3", AB: "5" } },
            { date: "2026-09-27", opponentName: "Rays", opponentId: "14", isHome: true, stats: { H: "1", AB: "4" } },
          ],
          vsOpponent: [],
          minutesTrend: null,
        },
      };
      const hits = new Map([
        ["Test Player|batter_hits|0.5|Over", { hitProbability: 0.61, nullReason: null }],
      ]);
      const result = await enrichCoachPropSimHits([pick], pool, hits, undefined, shared);
      assert.equal(historyHttp, 0);
      assert.ok(result.historyReused >= 1);
      assert.equal(result.historyFetched, 0);
      const slice = result.playerHistory["Test Player#33481"];
      assert.ok(slice);
      assert.equal(slice.recent?.[0]?.opp, "Yanks");
      assert.equal(slice.recent?.[0]?.date, "2026-10-01");
      // MC grade preserved — enrich did not wipe usable hit.
      assert.equal(result.hits.get("Test Player|batter_hits|0.5|Over")?.hitProbability, 0.61);
    } finally {
      globalThis.fetch = orig;
    }
  });
});
