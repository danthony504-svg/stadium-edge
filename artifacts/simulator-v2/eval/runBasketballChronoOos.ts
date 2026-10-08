/**
 * Basketball E.2 chronological OOS — separate reports per sport id.
 * Shadow-only; grid lines.
 * NBA/WNBA ESPN scoreboards are date-keyed (week filters return empty).
 * NCAAB week filters remain valid.
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

function ymd(year: number, month: number, day: number): string {
  return `${year}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;
}

/** NBA season labeled by start year: Oct Y – Jun Y+1, every 3rd day. */
function nbaSampleDays(startYear: number): string[] {
  const days: string[] = [];
  for (const [y, months] of [
    [startYear, [10, 11, 12]],
    [startYear + 1, [1, 2, 3, 4, 5, 6]],
  ] as const) {
    for (const month of months) {
      for (let d = 1; d <= 28; d += 3) days.push(ymd(y, month, d));
    }
  }
  return days;
}

/** WNBA calendar season May–Sep. */
function wnbaSampleDays(year: number): string[] {
  const days: string[] = [];
  for (const month of [5, 6, 7, 8, 9]) {
    for (let d = 1; d <= 28; d += 3) days.push(ymd(year, month, d));
  }
  return days;
}

async function parseScoreboard(
  url: string,
  out: Game[],
): Promise<void> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "stadium-sim-v2-bball" } });
    if (!r.ok) return;
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
}

async function fetchGames(sport: "nba" | "wnba" | "ncaab", season: number): Promise<Game[]> {
  const out: Game[] = [];
  if (sport === "ncaab") {
    for (let week = 1; week <= 20; week++) {
      const url = `https://site.api.espn.com/apis/site/v2/sports/${ESPN[sport]}/scoreboard?dates=${season}&seasontype=2&week=${week}&groups=50`;
      await parseScoreboard(url, out);
      await new Promise((r) => setTimeout(r, 40));
    }
  } else {
    const days = sport === "nba" ? nbaSampleDays(season) : wnbaSampleDays(season);
    for (const dates of days) {
      const url = `https://site.api.espn.com/apis/site/v2/sports/${ESPN[sport]}/scoreboard?dates=${dates}`;
      await parseScoreboard(url, out);
      await new Promise((r) => setTimeout(r, 35));
    }
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
  const used = prior.slice(-10);
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
  // NBA: season label = start year. WNBA/NCAAB: calendar year.
  const trainSeason = sport === "nba" ? 2023 : 2023;
  const holdSeason = sport === "nba" ? 2024 : 2024;
  const train = await fetchGames(sport, trainSeason);
  const hold = await fetchGames(sport, holdSeason);
  const all = [...train, ...hold];
  const holdout = hold.slice(Math.floor(hold.length * 0.45)).slice(0, 100);
  const obs: Array<{ y: 0 | 1; p: number; kind: string; eventId: string }> = [];
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
    const totLine = sport === "nba" ? 224.5 : sport === "wnba" ? 162.5 : 144.5;
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
          line: totLine,
        }),
        y: (g.homeFg + g.awayFg > totLine ? 1 : 0) as 0 | 1,
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
      if (r.status === "ok" && r.simHit != null) {
        obs.push({ y: s.y, p: r.simHit, kind: s.kind, eventId: g.eventId });
      }
    }
  }
  const ms = performance.now() - t0;
  const clusters = new Set(obs.map((o) => o.eventId)).size;
  const lines = [
    `## ${sport.toUpperCase()} (separate gates)`,
    `- Fetch: ${sport === "ncaab" ? "ESPN week" : "ESPN date-sample"} (week API empty for NBA/WNBA)`,
    `- Train n=${train.length}, hold n=${hold.length}, used=${used}, obs=${obs.length}, games_clustered=${clusters}`,
    `- Mean runtime/game: ${(ms / Math.max(1, used)).toFixed(1)} ms`,
    `- p95 runtime/game (proxy mean×1.5): ${((ms / Math.max(1, used)) * 1.5).toFixed(1)} ms`,
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
    "Baseline: leakage-safe team form only; grid −110 (no closing-line archive).",
    "",
  ];
  for (const sport of ["nba", "wnba", "ncaab"] as const) {
    console.log(`bball-oos ${sport}`);
    parts.push(await runSport(sport));
  }
  parts.push("- Serve/allowlist unchanged (`SIM_V2_SERVE=off`).");
  const path = join(REPORT_DIR, "BASKETBALL_CHRONO_OOS.md");
  await writeFile(path, parts.join("\n"), "utf8");
  console.log(`wrote ${path}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
