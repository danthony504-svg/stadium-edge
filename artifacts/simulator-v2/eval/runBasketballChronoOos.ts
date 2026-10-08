/**
 * Basketball chronological OOS with family gates (shadow).
 * Train/val for diagnostics; final holdout never used for tuning.
 * Closing lines: INSUFFICIENT (no licensed archive).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildJointBasketballTensor } from "../src/models/basketball/jointBasketball.js";
import {
  buildBasketballMlMarket,
  buildBasketballSpreadMarket,
  buildBasketballTotalMarket,
  buildBasketballTeamTotalMarket,
} from "../src/models/basketball/markets.js";
import { settleMarket } from "../src/engine/settle.js";
import { impliedProbFromAmerican } from "../src/schemas/odds.js";
import type { BasketballSport } from "../src/models/basketball/priors.js";
import {
  type CalibObs,
  compareDistributions,
  evaluateFamilyGate,
  formatDistTable,
  formatGateTable,
  formatReliability,
  metricsOf,
} from "./familyCalibration.js";

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

function nbaDays(startYear: number, step: number): string[] {
  const days: string[] = [];
  for (const [y, months] of [
    [startYear, [10, 11, 12]],
    [startYear + 1, [1, 2, 3, 4, 5, 6]],
  ] as const) {
    for (const month of months) {
      for (let d = 1; d <= 28; d += step) days.push(ymd(y, month, d));
    }
  }
  return days;
}

function wnbaDays(year: number, step: number): string[] {
  const days: string[] = [];
  for (const month of [5, 6, 7, 8, 9]) {
    for (let d = 1; d <= 28; d += step) days.push(ymd(year, month, d));
  }
  return days;
}

async function parseScoreboard(url: string, out: Game[]): Promise<void> {
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
      await new Promise((r) => setTimeout(r, 35));
    }
  } else if (sport === "nba") {
    for (const dates of nbaDays(season, 2)) {
      await parseScoreboard(
        `https://site.api.espn.com/apis/site/v2/sports/${ESPN[sport]}/scoreboard?dates=${dates}`,
        out,
      );
      await new Promise((r) => setTimeout(r, 30));
    }
  } else {
    for (const dates of wnbaDays(season, 1)) {
      await parseScoreboard(
        `https://site.api.espn.com/apis/site/v2/sports/${ESPN[sport]}/scoreboard?dates=${dates}`,
        out,
      );
      await new Promise((r) => setTimeout(r, 25));
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
  const used = prior.slice(-12);
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

function chronoFolds(games: Game[]) {
  const n = games.length;
  const tEnd = Math.floor(n * 0.55);
  const vEnd = Math.floor(n * 0.75);
  return {
    train: games.slice(0, tEnd),
    val: games.slice(tEnd, vEnd),
    holdout: games.slice(vEnd),
  };
}

async function runSport(sport: BasketballSport) {
  if (sport !== "nba" && sport !== "wnba" && sport !== "ncaab") {
    return { md: "", gates: [] as ReturnType<typeof evaluateFamilyGate>[] };
  }

  const seasons =
    sport === "wnba" ? [2022, 2023, 2024] : sport === "nba" ? [2023, 2024] : [2023, 2024];
  const all: Game[] = [];
  for (const s of seasons) all.push(...(await fetchGames(sport, s)));
  const games = Array.from(new Map(all.map((g) => [g.eventId, g])).values()).sort(
    (a, b) => new Date(a.kickoffIso).getTime() - new Date(b.kickoffIso).getTime(),
  );
  const folds = chronoFolds(games);
  const holdCap = sport === "ncaab" ? 400 : sport === "nba" ? 320 : 220;
  const holdout = folds.holdout.slice(0, holdCap);
  const valSlice = folds.val.slice(0, 100);

  const holdObs: CalibObs[] = [];
  const valObs: CalibObs[] = [];
  const actualTotals: number[] = [];
  const simTotalMeans: number[] = [];
  const actualMargins: number[] = [];
  const simMarginMeans: number[] = [];
  const t0 = performance.now();

  async function grade(g: Game, fold: "val" | "holdout", sink: CalibObs[]) {
    const t = new Date(g.kickoffIso).getTime();
    const home = form(g.homeId, t, games);
    const away = form(g.awayId, t, games);
    if (!home || !away) return;
    const tensor = buildJointBasketballTensor({
      sport,
      eventId: g.eventId,
      seed: `${sport}-oos:${g.eventId}`,
      nDraws: 2000,
      home,
      away,
    });
    let simTot = 0;
    let simMar = 0;
    for (let i = 0; i < tensor.meta.nDraws; i++) {
      simTot += tensor.team.homeFg[i]! + tensor.team.awayFg[i]!;
      simMar += tensor.team.homeFg[i]! - tensor.team.awayFg[i]!;
    }
    simTot /= tensor.meta.nDraws;
    simMar /= tensor.meta.nDraws;
    if (fold === "holdout") {
      actualTotals.push(g.homeFg + g.awayFg);
      simTotalMeans.push(simTot);
      actualMargins.push(g.homeFg - g.awayFg);
      simMarginMeans.push(simMar);
    }

    const totLine = sport === "nba" ? 224.5 : sport === "wnba" ? 162.5 : 144.5;
    const specs = [
      {
        family: "ml",
        slice: "ml_home",
        m: buildBasketballMlMarket({ marketId: "ml", eventId: g.eventId, sport, side: "home" as const }),
        y: (g.homeFg > g.awayFg ? 1 : 0) as 0 | 1,
      },
      {
        family: "spread",
        slice: "spread_home_-3.5",
        m: buildBasketballSpreadMarket({
          marketId: "sp",
          eventId: g.eventId,
          sport,
          side: "home" as const,
          postedSpread: -3.5,
        }),
        y: (g.homeFg + 3.5 > g.awayFg ? 1 : 0) as 0 | 1,
      },
      {
        family: "spread",
        slice: "alt_spread_home_-7.5",
        isAlt: true,
        m: buildBasketballSpreadMarket({
          marketId: "asp",
          eventId: g.eventId,
          sport,
          side: "home" as const,
          postedSpread: -7.5,
        }),
        y: (g.homeFg + 7.5 > g.awayFg ? 1 : 0) as 0 | 1,
      },
      {
        family: "total",
        slice: "total_main",
        m: buildBasketballTotalMarket({
          marketId: "tot",
          eventId: g.eventId,
          sport,
          side: "over" as const,
          line: totLine,
        }),
        y: (g.homeFg + g.awayFg > totLine ? 1 : 0) as 0 | 1,
      },
      {
        family: "total",
        slice: "alt_total",
        isAlt: true,
        m: buildBasketballTotalMarket({
          marketId: "atot",
          eventId: g.eventId,
          sport,
          side: "over" as const,
          line: totLine + 8,
        }),
        y: (g.homeFg + g.awayFg > totLine + 8 ? 1 : 0) as 0 | 1,
      },
      {
        family: "team_total",
        slice: "tt_home",
        m: buildBasketballTeamTotalMarket({
          marketId: "tt",
          eventId: g.eventId,
          sport,
          teamSide: "home" as const,
          side: "over" as const,
          line: totLine / 2,
        }),
        y: (g.homeFg > totLine / 2 ? 1 : 0) as 0 | 1,
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
        sink.push({
          y: s.y,
          p: r.simHit,
          eventId: g.eventId,
          family: s.family,
          slice: s.slice,
          fold,
          isAlt: s.isAlt,
          realBookLine: false,
        });
      }
    }
  }

  for (const g of valSlice) await grade(g, "val", valObs);
  for (const g of holdout) await grade(g, "holdout", holdObs);
  const ms = performance.now() - t0;

  const families = ["ml", "spread", "total", "team_total", "main_all", "alt_all"] as const;
  const gates = families.map((f) => {
    const rows =
      f === "main_all"
        ? holdObs.filter((o) => !o.isAlt)
        : f === "alt_all"
          ? holdObs.filter((o) => o.isAlt)
          : holdObs.filter((o) => o.family === f);
    return evaluateFamilyGate(`${sport}:${f}`, rows);
  });
  gates.push({
    ...evaluateFamilyGate(`${sport}:closing_line_benchmark`, []),
    verdict: "INSUFFICIENT_DATA" as const,
    reasons: ["closing_line_unavailable_unlicensed"],
  });
  gates.push({
    ...evaluateFamilyGate(`${sport}:player_prop_named`, []),
    verdict: "INSUFFICIENT_DATA" as const,
    reasons: ["named_player_prop_oos_not_wired_this_pass"],
  });

  const dist = [
    compareDistributions(`${sport}_total`, actualTotals, simTotalMeans),
    compareDistributions(`${sport}_margin`, actualMargins, simMarginMeans),
  ].filter((x): x is NonNullable<typeof x> => !!x);

  const valEce = metricsOf(valObs).ece;
  const holdEce = metricsOf(holdObs).ece;

  const md = [
    `## ${sport.toUpperCase()} (separate gates)`,
    `- Model: basketball.joint.v0 @ 0.3.0 (mild shrink 0.2 + game shock; milder HFA)`,
    `- Games fetched: ${games.length} (train ${folds.train.length} / val ${folds.val.length} / holdout ${folds.holdout.length})`,
    `- Holdout graded: ${holdout.length} games → obs=${holdObs.length}; val diagnostic obs=${valObs.length}`,
    `- Mean runtime/game: ${(ms / Math.max(1, holdout.length)).toFixed(1)} ms`,
    `- Val ECE (diagnostic only): ${valEce?.toFixed(4) ?? "n/a"} | Holdout ECE: ${holdEce?.toFixed(4) ?? "n/a"}`,
    `- Closing-line benchmark: **INSUFFICIENT_DATA** (no licensed historical odds source wired)`,
    `- Named player props: not in this team-market pass`,
    "",
    "### Family gates (final holdout)",
    ...formatGateTable(gates),
    "",
    "### Reliability (holdout overall)",
    ...formatReliability(holdObs),
    "",
    "### Scoring distribution check",
    ...formatDistTable(dist),
    "",
  ].join("\n");

  return { md, gates };
}

async function main() {
  await mkdir(REPORT_DIR, { recursive: true });
  const parts = [
    "# Basketball chronological OOS + family calibration gates",
    "",
    "Shadow-only. SIM_V2_SERVE=off. Final holdout not used for tuning.",
    "Root cause: form overconfidence + underdispersed margins → mild shrink (0.2) + lognormal shock + reduced HFA.",
    "",
  ];
  const allGates: ReturnType<typeof evaluateFamilyGate>[] = [];
  for (const sport of ["nba", "wnba", "ncaab"] as const) {
    console.log(`bball-oos ${sport}`);
    const { md, gates } = await runSport(sport);
    parts.push(md);
    allGates.push(...gates);
  }
  parts.push("## Aggregate verdicts");
  parts.push(...formatGateTable(allGates));
  parts.push("");
  parts.push("- Production allowlists unchanged.");
  const path = join(REPORT_DIR, "BASKETBALL_CHRONO_OOS.md");
  await writeFile(path, parts.join("\n"), "utf8");
  await writeFile(
    join(REPORT_DIR, "BASKETBALL_FAMILY_GATES.md"),
    ["# Basketball sport:family gates", "", ...formatGateTable(allGates), ""].join("\n"),
    "utf8",
  );
  console.log(`wrote ${path}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
