/**
 * Cold concurrency probe for ESPN player-search (bypasses cachedJson).
 * Verifies Phase 2.2 ATHLETE_IDENTITY_CONCURRENCY=4 remains near-optimal.
 */
import { writeFileSync } from "node:fs";
import { mapWithConcurrency } from "../src/lib/propSimCtxCache.ts";

const PLAYERS = [
  "Tristan Peters",
  "Miguel Vargas",
  "Kyle Teel",
  "Chase Meidroth",
  "Brayan Rocchio",
  "Travis Bazzana",
  "Patrick Bailey",
  "Andrew Benintendi",
  "Jo Adell",
];

async function searchOnce(player: string): Promise<{ ms: number; status: number; id: string | null }> {
  const t0 = performance.now();
  const url =
    `https://site.web.api.espn.com/apis/common/v3/search?region=us&lang=en&limit=12&type=player&query=` +
    encodeURIComponent(player);
  const r = await fetch(url, { cache: "no-store" });
  const data = (await r.json()) as {
    items?: Array<{ id?: string; league?: string; defaultLeagueSlug?: string }>;
  };
  let id: string | null = null;
  for (const it of data.items ?? []) {
    const league = String(it.league || it.defaultLeagueSlug || "").toLowerCase();
    if (league === "mlb" && it.id) {
      id = String(it.id);
      break;
    }
  }
  return { ms: Math.round(performance.now() - t0), status: r.status, id };
}

async function bench(concurrency: number) {
  const t0 = performance.now();
  const results = await mapWithConcurrency(PLAYERS, concurrency, async (p) => searchOnce(p));
  return {
    concurrency,
    wallMs: Math.round(performance.now() - t0),
    providerCalls: results.length,
    errors: results.filter((r) => r.status >= 400).length,
    rateLimited: results.filter((r) => r.status === 429).length,
    avgMs: Math.round(results.reduce((s, r) => s + r.ms, 0) / results.length),
    maxMs: Math.max(...results.map((r) => r.ms)),
    resolved: results.filter((r) => r.id).length,
  };
}

async function main() {
  const rows = [];
  for (const c of [1, 2, 4, 6]) {
    // Small gap so ESPN isn't slammed between levels
    if (rows.length) await new Promise((r) => setTimeout(r, 300));
    rows.push(await bench(c));
    console.error(JSON.stringify(rows[rows.length - 1]));
  }
  const report = {
    generatedAt: new Date().toISOString(),
    note: "Cold direct ESPN search (no cachedJson) — verifies conc 4",
    players: PLAYERS.length,
    rows,
    recommended: 4,
  };
  writeFileSync("/opt/cursor/artifacts/coach-phase22-concurrency-cold.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
