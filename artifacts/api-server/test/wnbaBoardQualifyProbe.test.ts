/**
 * Live probe: how many WNBA props on tonight's board would qualify for Coach
 * delivery using client-side game-log sim (production API paths).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { gameValueForMarket, computeAmbiguous } from "../src/lib/propStatValue.ts";

const API = "https://stadium-edge.onrender.com/api";

function americanToProb(odds: number): number {
  if (odds > 0) return 100 / (odds + 100);
  return -odds / (-odds + 100);
}

function localHit(
  recent: { stats?: Record<string, string> }[],
  market: string,
  line: number,
  side: "Over" | "Under",
): number | null {
  if (!recent.length) return null;
  const ambiguous = new Set<string>();
  const vals = recent
    .map((g) => gameValueForMarket(market, g.stats ?? {}, ambiguous))
    .filter((v): v is number => v != null)
    .slice(0, 10);
  if (vals.length < 3) return null;
  const hits = vals.filter((v) => (side === "Under" ? v < line : v >= line)).length;
  return hits / vals.length;
}

function gradable(hit: number | null): boolean {
  return hit != null && Number.isFinite(hit) && hit > 0 && hit < 1;
}

test("WNBA live board: count props with gradable client sim + positive edge", async () => {
  const oddsRes = await fetch(`${API}/sports/odds?sport=wnba`);
  assert.equal(oddsRes.ok, true);
  const oddsGames = (await oddsRes.json()) as Array<{
    id: string;
    homeTeam: string;
    awayTeam: string;
    commenceTime: string;
  }>;
  assert.ok(oddsGames.length > 0, "expected WNBA odds games");

  const espnRes = await fetch(
    "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard",
  );
  const espn = (await espnRes.json()) as {
    events?: Array<{
      id: string;
      competitions?: Array<{
        competitors?: Array<{ homeAway?: string; team?: { id?: string; displayName?: string } }>;
      }>;
    }>;
  };

  const teamIdsByGame = new Map<string, { homeTeamId: string; awayTeamId: string }>();
  for (const ev of espn.events ?? []) {
    const comp = ev.competitions?.[0];
    const home = comp?.competitors?.find((c) => c.homeAway === "home")?.team;
    const away = comp?.competitors?.find((c) => c.homeAway === "away")?.team;
    if (!home?.id || !away?.id || !home.displayName || !away.displayName) continue;
    const label = `${away.displayName} @ ${home.displayName}`.toLowerCase();
    teamIdsByGame.set(label, { homeTeamId: home.id, awayTeamId: away.id });
  }

  let scanned = 0;
  let withHistory = 0;
  let gradableSims = 0;
  let positiveEdge = 0;
  const samples: string[] = [];

  for (const g of oddsGames.slice(0, 4)) {
    const label = `${g.awayTeam} @ ${g.homeTeam}`.toLowerCase();
    const ids = teamIdsByGame.get(label);
    const q = new URLSearchParams({
      sport: "wnba",
      eventId: g.id,
      home: g.homeTeam,
      away: g.awayTeam,
    });
    if (ids) {
      q.set("homeTeamId", ids.homeTeamId);
      q.set("awayTeamId", ids.awayTeamId);
    }
    const propsRes = await fetch(`${API}/sports/props?${q.toString()}`);
    if (!propsRes.ok) continue;
    const body = (await propsRes.json()) as {
      props?: Array<{
        player: string;
        market: string;
        line: number;
        overPrice?: number | null;
        underPrice?: number | null;
        athleteId?: string | null;
      }>;
    };

    const historyCache = new Map<string, { stats?: Record<string, string> }[]>();

    for (const p of body.props ?? []) {
      for (const side of ["Over", "Under"] as const) {
        const odds = side === "Over" ? p.overPrice : p.underPrice;
        if (odds == null || p.line == null) continue;
        scanned += 1;

        let athleteId = p.athleteId;
        if (!athleteId) {
          const sr = await fetch(`${API}/sports/player-search?query=${encodeURIComponent(p.player)}`);
          const sj = (await sr.json()) as { results?: Array<{ athleteId: string; sport: string }> };
          athleteId = sj.results?.find((r) => r.sport === "wnba")?.athleteId ?? null;
        }
        if (!athleteId) continue;

        if (!historyCache.has(athleteId)) {
          const hr = await fetch(`${API}/sports/player-history?sport=wnba&athleteId=${athleteId}`);
          if (!hr.ok) continue;
          const hj = (await hr.json()) as { recent?: { stats?: Record<string, string> }[] };
          historyCache.set(athleteId, hj.recent ?? []);
        }
        const recent = historyCache.get(athleteId) ?? [];
        if (!recent.length) continue;
        withHistory += 1;

        const hit = localHit(recent, p.market, p.line, side);
        if (!gradable(hit)) continue;
        gradableSims += 1;

        const implied = americanToProb(odds);
        const edge = Math.round(((hit! - implied) * 1000)) / 10;
        if (edge > 0 && hit! > implied) {
          positiveEdge += 1;
          if (samples.length < 8) {
            samples.push(
              `${p.player} ${side} ${p.line} ${p.market} @ ${odds}: sim ${(hit! * 100).toFixed(1)}% edge ${edge}%`,
            );
          }
        }
      }
    }
  }

  console.log(
    JSON.stringify({ scanned, withHistory, gradableSims, positiveEdge, samples }, null, 2),
  );
  // Honest board may still be 0 on a efficient night — test documents live counts.
  assert.ok(scanned > 0, "expected to scan posted WNBA prop sides");
});
