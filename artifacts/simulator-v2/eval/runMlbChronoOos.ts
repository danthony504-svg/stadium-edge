/**
 * MLB F.2 chronological OOS for FG/F5 team markets (shadow).
 * ESPN MLB scoreboard is date-keyed (week filters return empty).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { brierScore, expectedCalibrationError, logLoss } from "../src/metrics/calibration.js";
import { buildJointBaseballTensor } from "../src/models/baseball/jointBaseball.js";
import {
  buildBaseballMlMarket,
  buildBaseballSpreadMarket,
  buildBaseballTeamTotalMarket,
  buildBaseballTotalMarket,
} from "../src/models/baseball/markets.js";
import { settleMarket } from "../src/engine/settle.js";
import { impliedProbFromAmerican } from "../src/schemas/odds.js";

const REPORT_DIR = join(import.meta.dirname, "report");

type Game = {
  eventId: string;
  kickoffIso: string;
  homeId: string;
  awayId: string;
  homeFg: number;
  awayFg: number;
  homeF5: number;
  awayF5: number;
};

function ymd(year: number, month: number, day: number): string {
  return `${year}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;
}

/** Regular-season sample: every 3rd day Apr–Jun + Aug–Sep (skip All-Star window). */
function seasonSampleDays(season: number): string[] {
  const days: string[] = [];
  for (const month of [4, 5, 6, 8, 9]) {
    const maxDay = month === 9 ? 28 : 28;
    for (let d = 1; d <= maxDay; d += 3) {
      days.push(ymd(season, month, d));
    }
  }
  return days;
}

async function fetchSeason(season: number): Promise<Game[]> {
  const out: Game[] = [];
  for (const dates of seasonSampleDays(season)) {
    const url = `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=${dates}`;
    try {
      const r = await fetch(url, { headers: { "User-Agent": "stadium-sim-v2-mlb" } });
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
        const homeFg = Number(home.score);
        const awayFg = Number(away.score);
        if (!Number.isFinite(homeFg) || !Number.isFinite(awayFg)) continue;
        const hLs = (home.linescores ?? []).map((x) => Number(x.value ?? 0));
        const aLs = (away.linescores ?? []).map((x) => Number(x.value ?? 0));
        if (hLs.length < 5 || aLs.length < 5) continue;
        out.push({
          eventId: ev.id,
          kickoffIso: ev.date,
          homeId: home.team.id,
          awayId: away.team.id,
          homeFg,
          awayFg,
          homeF5: hLs.slice(0, 5).reduce((s, v) => s + v, 0),
          awayF5: aLs.slice(0, 5).reduce((s, v) => s + v, 0),
        });
      }
    } catch {
      /* skip */
    }
    await new Promise((r) => setTimeout(r, 40));
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
  const used = prior.slice(-15);
  let rf = 0;
  let ra = 0;
  const recent: number[] = [];
  for (const g of used) {
    if (g.homeId === teamId) {
      rf += g.homeFg;
      ra += g.awayFg;
      recent.push(g.homeFg);
    } else {
      rf += g.awayFg;
      ra += g.homeFg;
      recent.push(g.awayFg);
    }
  }
  return {
    teamId,
    runsFor: rf / used.length,
    runsAgainst: ra / used.length,
    recentFgRuns: recent,
  };
}

async function main() {
  await mkdir(REPORT_DIR, { recursive: true });
  const train = await fetchSeason(2023);
  const hold = await fetchSeason(2024);
  const all = [...train, ...hold];
  // Chronological holdout: latter half of 2024 sample, capped for runtime.
  const holdout = hold.slice(Math.floor(hold.length * 0.45)).slice(0, 120);
  const obs: Array<{ y: 0 | 1; p: number; kind: string; eventId: string }> = [];
  let used = 0;
  const t0 = performance.now();
  for (const g of holdout) {
    const t = new Date(g.kickoffIso).getTime();
    const home = form(g.homeId, t, all);
    const away = form(g.awayId, t, all);
    if (!home || !away) continue;
    used += 1;
    const tensor = buildJointBaseballTensor({
      sport: "mlb",
      eventId: g.eventId,
      seed: `mlb-oos:${g.eventId}`,
      nDraws: 2000,
      home,
      away,
    });
    const specs = [
      {
        kind: "ml_home",
        m: buildBaseballMlMarket({ marketId: "ml", eventId: g.eventId, side: "home" }),
        y: (g.homeFg > g.awayFg ? 1 : 0) as 0 | 1,
      },
      {
        kind: "rl_home_-1.5",
        m: buildBaseballSpreadMarket({
          marketId: "rl",
          eventId: g.eventId,
          side: "home",
          postedSpread: -1.5,
        }),
        y: (g.homeFg - g.awayFg > 1.5 ? 1 : 0) as 0 | 1,
      },
      {
        kind: "total_8.5",
        m: buildBaseballTotalMarket({
          marketId: "tot",
          eventId: g.eventId,
          side: "over",
          line: 8.5,
        }),
        y: (g.homeFg + g.awayFg > 8.5 ? 1 : 0) as 0 | 1,
      },
      {
        kind: "tt_home_4.5",
        m: buildBaseballTeamTotalMarket({
          marketId: "tt",
          eventId: g.eventId,
          teamSide: "home",
          side: "over",
          line: 4.5,
        }),
        y: (g.homeFg > 4.5 ? 1 : 0) as 0 | 1,
      },
      {
        kind: "f5_total_4.5",
        m: buildBaseballTotalMarket({
          marketId: "f5",
          eventId: g.eventId,
          period: "f5",
          side: "over",
          line: 4.5,
        }),
        y: (g.homeF5 + g.awayF5 > 4.5 ? 1 : 0) as 0 | 1,
      },
      {
        kind: "f5_ml_home",
        m: buildBaseballMlMarket({
          marketId: "f5ml",
          eventId: g.eventId,
          period: "f5",
          side: "home",
        }),
        y: (g.homeF5 > g.awayF5 ? 1 : 0) as 0 | 1,
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
  const eventIds = [...new Set(obs.map((o) => o.eventId))];
  const lines = [
    "# MLB F.2 chronological OOS",
    "",
    "Shadow-only. Grid lines (−110). Date-sampled ESPN scoreboard (week API empty for MLB).",
    "",
    `- Train n=${train.length}, hold n=${hold.length}, used=${used}, obs=${obs.length}, games_clustered=${eventIds.length}`,
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
  for (const k of [
    "ml_home",
    "rl_home_-1.5",
    "total_8.5",
    "tt_home_4.5",
    "f5_total_4.5",
    "f5_ml_home",
  ]) {
    lines.push(slice(k, obs.filter((o) => o.kind === k)));
  }
  lines.push(`- Gate n≥500: **${obs.length >= 500 ? "met" : "NOT MET"}**`);
  lines.push("- Baseline: leakage-safe team form (prior games only); no closing-line book baseline in this run.");
  lines.push("- Serve/allowlist unchanged (`SIM_V2_SERVE=off`).");
  const path = join(REPORT_DIR, "MLB_CHRONO_OOS.md");
  await writeFile(path, lines.join("\n"), "utf8");
  console.log(`wrote ${path} n=${obs.length} used=${used}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
