/**
 * NHL D.2 chronological OOS for team markets (shadow).
 * ESPN hockey scoreboard — regulation periods when linescores present.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { brierScore, expectedCalibrationError, logLoss } from "../src/metrics/calibration.js";
import { buildJointHockeyTensor } from "../src/models/hockey/jointHockey.js";
import {
  buildHockeyMlMarket,
  buildHockeySpreadMarket,
  buildHockeyTotalMarket,
} from "../src/models/hockey/markets.js";
import { settleMarket } from "../src/engine/settle.js";
import { impliedProbFromAmerican } from "../src/schemas/odds.js";

const REPORT_DIR = join(import.meta.dirname, "report");

type NhlGame = {
  eventId: string;
  kickoffIso: string;
  homeId: string;
  awayId: string;
  homeFinal: number;
  awayFinal: number;
  homeReg: number;
  awayReg: number;
  season: number;
};

async function fetchSeason(season: number): Promise<NhlGame[]> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=${season}1001-${season + 1}0630&limit=1000`;
  // ESPN dates filter is weak; use seasontype weeks fallback
  const games: NhlGame[] = [];
  for (let week = 1; week <= 28; week++) {
    const wurl = `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=${season}&seasontype=2&week=${week}`;
    try {
      const r = await fetch(wurl, { headers: { "User-Agent": "stadium-sim-v2-nhl" } });
      if (!r.ok) continue;
      const j = (await r.json()) as {
        events?: Array<{
          id?: string;
          date?: string;
          competitions?: Array<{
            competitors?: Array<{
              homeAway?: string;
              score?: string;
              team?: { id?: string };
              linescores?: Array<{ value?: number }>;
            }>;
            status?: { type?: { completed?: boolean } };
          }>;
        }>;
      };
      for (const ev of j.events ?? []) {
        const c = ev.competitions?.[0];
        if (!c?.status?.type?.completed || !ev.id || !ev.date) continue;
        const home = c.competitors?.find((x) => x.homeAway === "home");
        const away = c.competitors?.find((x) => x.homeAway === "away");
        if (!home?.team?.id || !away?.team?.id) continue;
        const homeFinal = Number(home.score);
        const awayFinal = Number(away.score);
        if (!Number.isFinite(homeFinal) || !Number.isFinite(awayFinal)) continue;
        const hLs = (home.linescores ?? []).map((x) => x.value ?? 0);
        const aLs = (away.linescores ?? []).map((x) => x.value ?? 0);
        const homeReg = hLs.slice(0, 3).reduce((s, v) => s + v, 0);
        const awayReg = aLs.slice(0, 3).reduce((s, v) => s + v, 0);
        if (hLs.length < 3 || aLs.length < 3) continue;
        games.push({
          eventId: ev.id,
          kickoffIso: ev.date,
          homeId: home.team.id,
          awayId: away.team.id,
          homeFinal,
          awayFinal,
          homeReg,
          awayReg,
          season,
        });
      }
    } catch {
      /* skip week */
    }
    await new Promise((r) => setTimeout(r, 80));
  }
  // dedupe
  const by = new Map(games.map((g) => [g.eventId, g]));
  return Array.from(by.values()).sort(
    (a, b) => new Date(a.kickoffIso).getTime() - new Date(b.kickoffIso).getTime(),
  );
}

function form(teamId: string, before: number, games: NhlGame[]) {
  const prior = games.filter(
    (g) =>
      new Date(g.kickoffIso).getTime() < before &&
      (g.homeId === teamId || g.awayId === teamId),
  );
  if (prior.length < 4) return null;
  const used = prior.slice(-8);
  let gf = 0;
  let ga = 0;
  const recent: number[] = [];
  for (const g of used) {
    if (g.homeId === teamId) {
      gf += g.homeReg;
      ga += g.awayReg;
      recent.push(g.homeReg);
    } else {
      gf += g.awayReg;
      ga += g.homeReg;
      recent.push(g.awayReg);
    }
  }
  return {
    teamId,
    goalsFor: gf / used.length,
    goalsAgainst: ga / used.length,
    recentFgGoals: recent,
  };
}

async function main() {
  await mkdir(REPORT_DIR, { recursive: true });
  const train = await fetchSeason(2023);
  const hold = await fetchSeason(2024);
  const all = [...train, ...hold];
  const holdout = hold.slice(Math.floor(hold.length * 0.5)); // late season holdout proxy
  const obs: Array<{ y: 0 | 1; p: number; eventId: string; kind: string }> = [];
  const t0 = performance.now();
  let used = 0;

  for (const g of holdout.slice(0, 80)) {
    const t = new Date(g.kickoffIso).getTime();
    const home = form(g.homeId, t, all);
    const away = form(g.awayId, t, all);
    if (!home || !away) continue;
    used += 1;
    const tensor = buildJointHockeyTensor({
      sport: "nhl",
      eventId: g.eventId,
      seed: `nhl-oos:${g.eventId}`,
      nDraws: 2000,
      home,
      away,
    });
    const specs = [
      {
        kind: "ml_home",
        market: buildHockeyMlMarket({ marketId: "ml", eventId: g.eventId, side: "home" }),
        y: (g.homeFinal > g.awayFinal ? 1 : 0) as 0 | 1,
      },
      {
        kind: "total_over_5.5",
        market: buildHockeyTotalMarket({
          marketId: "tot",
          eventId: g.eventId,
          side: "over",
          line: 5.5,
        }),
        y: (g.homeFinal + g.awayFinal > 5.5 ? 1 : 0) as 0 | 1,
      },
      {
        kind: "puck_home_-1.5",
        market: buildHockeySpreadMarket({
          marketId: "pl",
          eventId: g.eventId,
          side: "home",
          postedSpread: -1.5,
        }),
        y: (g.homeFinal - g.awayFinal > 1.5 ? 1 : 0) as 0 | 1,
      },
    ];
    for (const s of specs) {
      const r = settleMarket({
        tensor,
        market: s.market,
        odds: {
          marketId: s.market.marketId,
          american: -110,
          book: "eval-grid",
          capturedAt: new Date().toISOString(),
          impliedProbRaw: impliedProbFromAmerican(-110),
          provenance: { provider: "eval-grid", fetchedAt: new Date().toISOString() },
        },
      });
      if (r.status !== "ok" || r.simHit == null) continue;
      obs.push({ y: s.y, p: r.simHit, eventId: g.eventId, kind: s.kind });
    }
  }

  const ms = performance.now() - t0;
  const pairs = obs.map((o) => ({ y: o.y, p: o.p }));
  const lines = [
    "# NHL D.2 chronological OOS (team markets)",
    "",
    "Shadow-only. Grid lines (−110), not closing lines.",
    "",
    `- Train seasons fetched: 2023 (n=${train.length}), 2024 (n=${hold.length})`,
    `- Holdout games used: ${used}`,
    `- Observations: ${obs.length}`,
    `- Mean runtime/game: ${(ms / Math.max(1, used)).toFixed(1)} ms`,
    "",
    `| Slice | n | Brier | LogLoss | ECE |`,
    `|-------|---|-------|---------|-----|`,
  ];
  const slice = (name: string, rows: typeof obs) => {
    const p = rows.map((o) => ({ y: o.y, p: o.p }));
    return `| ${name} | ${rows.length} | ${brierScore(p)?.toFixed(4) ?? "n/a"} | ${logLoss(p)?.toFixed(4) ?? "n/a"} | ${expectedCalibrationError(p, 10)?.toFixed(4) ?? "n/a"} |`;
  };
  lines.push(slice("overall", obs));
  for (const k of ["ml_home", "total_over_5.5", "puck_home_-1.5"]) {
    lines.push(slice(k, obs.filter((o) => o.kind === k)));
  }
  lines.push("");
  lines.push(`- Gate minOosSample=500: **${obs.length >= 500 ? "met" : "NOT MET"}** (n=${obs.length})`);
  lines.push("- Serve/allowlist unchanged.");
  const path = join(REPORT_DIR, "NHL_CHRONO_OOS.md");
  await writeFile(path, lines.join("\n"), "utf8");
  console.log(`wrote ${path} n=${obs.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
