/**
 * Basketball E.2 chronological OOS — separate reports per sport id (NBA focus).
 * Shadow-only; grid lines.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { brierScore, expectedCalibrationError, logLoss } from "../src/metrics/calibration.js";
import { buildJointBasketballTensor } from "../src/models/basketball/jointBasketball.js";
import {
  buildBasketballMlMarket,
  buildBasketballSpreadMarket,
  buildBasketballTotalMarket,
} from "../src/models/basketball/markets.js";
import { settleMarket } from "../src/engine/settle.js";
import { impliedProbFromAmerican } from "../src/schemas/odds.js";
import type { BasketballSport } from "../src/models/basketball/priors.js";

const REPORT_DIR = join(import.meta.dirname, "report");

const ESPN: Record<"nba" | "wnba" | "ncaab", string> = {
  nba: "basketball/nba",
  wnba: "basketball/wnba",
  ncaab: "basketball/mens-college-basketball",
};

type Game = {
  eventId: string;
  kickoffIso: string;
  homeId: string;
  awayId: string;
  homeFg: number;
  awayFg: number;
};

async function fetchGames(sport: "nba" | "wnba" | "ncaab", season: number): Promise<Game[]> {
  const out: Game[] = [];
  for (let week = 1; week <= 20; week++) {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${ESPN[sport]}/scoreboard?dates=${season}&seasontype=2&week=${week}`;
    try {
      const r = await fetch(url, { headers: { "User-Agent": "stadium-sim-v2-bball" } });
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
        const homeFg = Number(home.score);
        const awayFg = Number(away.score);
        if (!Number.isFinite(homeFg) || !Number.isFinite(awayFg)) continue;
        out.push({
          eventId: ev.id,
          kickoffIso: ev.date,
          homeId: home.team.id,
          awayId: away.team.id,
          homeFg,
          awayFg,
        });
      }
    } catch {
      /* skip */
    }
    await new Promise((r) => setTimeout(r, 60));
  }
  return Array.from(new Map(out.map((g) => [g.eventId, g])).values()).sort(
    (a, b) => new Date(a.kickoffIso).getTime() - new Date(b.kickoffIso).getTime(),
  );
}

function form(teamId: string, before: number, games: Game[]) {
  const prior = games.filter(
    (g) =>
      new Date(g.kickoffIso).getTime() < before &&
      (g.homeId === teamId || g.awayId === teamId),
  );
  if (prior.length < 4) return null;
  const used = prior.slice(-8);
  let pf = 0;
  let pa = 0;
  const recent: number[] = [];
  for (const g of used) {
    if (g.homeId === teamId) {
      pf += g.homeFg;
      pa += g.awayFg;
      recent.push(g.homeFg);
    } else {
      pf += g.awayFg;
      pa += g.homeFg;
      recent.push(g.awayFg);
    }
  }
  return {
    teamId,
    ptsFor: pf / used.length,
    ptsAgainst: pa / used.length,
    recentFgScores: recent,
  };
}

async function runSport(sport: BasketballSport) {
  if (sport !== "nba" && sport !== "wnba" && sport !== "ncaab") return "";
  const train = await fetchGames(sport, sport === "nba" ? 2023 : 2023);
  const hold = await fetchGames(sport, 2024);
  const all = [...train, ...hold];
  const holdout = hold.slice(Math.floor(hold.length * 0.5)).slice(0, 60);
  const obs: Array<{ y: 0 | 1; p: number; kind: string }> = [];
  let used = 0;
  const t0 = performance.now();
  for (const g of holdout) {
    const t = new Date(g.kickoffIso).getTime();
    const home = form(g.homeId, t, all);
    const away = form(g.awayId, t, all);
    if (!home || !away) continue;
    used += 1;
    const tensor = buildJointBasketballTensor({
      sport,
      eventId: g.eventId,
      seed: `${sport}-oos:${g.eventId}`,
      nDraws: 2000,
      home,
      away,
    });
    const specs = [
      {
        kind: "ml_home",
        m: buildBasketballMlMarket({
          marketId: "ml",
          eventId: g.eventId,
          sport,
          side: "home",
        }),
        y: (g.homeFg > g.awayFg ? 1 : 0) as 0 | 1,
      },
      {
        kind: "spread_home_-3.5",
        m: buildBasketballSpreadMarket({
          marketId: "sp",
          eventId: g.eventId,
          sport,
          side: "home",
          postedSpread: -3.5,
        }),
        y: (g.homeFg + 3.5 > g.awayFg ? 1 : 0) as 0 | 1,
      },
      {
        kind: "total",
        m: buildBasketballTotalMarket({
          marketId: "tot",
          eventId: g.eventId,
          sport,
          side: "over",
          line: sport === "nba" ? 224.5 : sport === "wnba" ? 162.5 : 144.5,
        }),
        y: (g.homeFg + g.awayFg >
        (sport === "nba" ? 224.5 : sport === "wnba" ? 162.5 : 144.5)
          ? 1
          : 0) as 0 | 1,
      },
    ];
    for (const s of specs) {
      const r = settleMarket({
        tensor,
        market: s.m,
        odds: {
          marketId: s.m.marketId,
          american: -110,
          book: "eval-grid",
          capturedAt: new Date().toISOString(),
          impliedProbRaw: impliedProbFromAmerican(-110),
          provenance: { provider: "eval-grid", fetchedAt: new Date().toISOString() },
        },
      });
      if (r.status === "ok" && r.simHit != null) obs.push({ y: s.y, p: r.simHit, kind: s.kind });
    }
  }
  const ms = performance.now() - t0;
  const lines = [
    `## ${sport.toUpperCase()} (separate gates)`,
    `- Train n=${train.length}, hold n=${hold.length}, used=${used}, obs=${obs.length}`,
    `- Mean runtime/game: ${(ms / Math.max(1, used)).toFixed(1)} ms`,
    `| Slice | n | Brier | LogLoss | ECE |`,
    `|-------|---|-------|---------|-----|`,
  ];
  const slice = (name: string, rows: typeof obs) => {
    const p = rows.map((o) => ({ y: o.y, p: o.p }));
    return `| ${name} | ${rows.length} | ${brierScore(p)?.toFixed(4) ?? "n/a"} | ${logLoss(p)?.toFixed(4) ?? "n/a"} | ${expectedCalibrationError(p, 10)?.toFixed(4) ?? "n/a"} |`;
  };
  lines.push(slice("overall", obs));
  for (const k of ["ml_home", "spread_home_-3.5", "total"]) {
    lines.push(slice(k, obs.filter((o) => o.kind === k)));
  }
  lines.push(`- Gate n≥500: **${obs.length >= 500 ? "met" : "NOT MET"}**`);
  lines.push("");
  return lines.join("\n");
}

async function main() {
  await mkdir(REPORT_DIR, { recursive: true });
  const parts = [
    "# Basketball E.2 chronological OOS",
    "",
    "Shadow-only. Separate sport sections — NBA pass does not enable WNBA/NCAAB.",
    "",
  ];
  for (const sport of ["nba", "wnba", "ncaab"] as const) {
    console.log(`bball-oos ${sport}`);
    parts.push(await runSport(sport));
  }
  const path = join(REPORT_DIR, "BASKETBALL_CHRONO_OOS.md");
  await writeFile(path, parts.join("\n"), "utf8");
  console.log(`wrote ${path}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
