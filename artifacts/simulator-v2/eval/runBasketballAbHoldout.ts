/**
 * Independent OOS A/B: basketball.joint v0.2 vs v0.3 on identical chrono holdout.
 * Separate NBA / WNBA / NCAAB gates. Shadow-only.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type BasketballCalibrationProfile,
  buildJointBasketballTensor,
} from "../src/models/basketball/jointBasketball.js";
import {
  buildBasketballMlMarket,
  buildBasketballSpreadMarket,
  buildBasketballTeamTotalMarket,
  buildBasketballTotalMarket,
} from "../src/models/basketball/markets.js";
import { settleMarket } from "../src/engine/settle.js";
import { impliedProbFromAmerican } from "../src/schemas/odds.js";
import type { BasketballSport } from "../src/models/basketball/priors.js";
import {
  type CalibObs,
  type FamilyGateRow,
  compareDistributions,
  effectiveSampleSize,
  evaluateFamilyGate,
  formatDistTable,
  formatGateTable,
  metricsOf,
} from "./familyCalibration.js";

const REPORT_DIR = join(import.meta.dirname, "report");
const PROFILES: BasketballCalibrationProfile[] = ["v0.2", "v0.3"];

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
    const r = await fetch(url, { headers: { "User-Agent": "stadium-sim-v2-bball-ab" } });
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
      await parseScoreboard(
        `https://site.api.espn.com/apis/site/v2/sports/${ESPN[sport]}/scoreboard?dates=${season}&seasontype=2&week=${week}&groups=50`,
        out,
      );
      await new Promise((r) => setTimeout(r, 30));
    }
  } else if (sport === "nba") {
    for (const dates of nbaDays(season, 2)) {
      await parseScoreboard(
        `https://site.api.espn.com/apis/site/v2/sports/${ESPN[sport]}/scoreboard?dates=${dates}`,
        out,
      );
      await new Promise((r) => setTimeout(r, 25));
    }
  } else {
    for (const dates of wnbaDays(season, 1)) {
      await parseScoreboard(
        `https://site.api.espn.com/apis/site/v2/sports/${ESPN[sport]}/scoreboard?dates=${dates}`,
        out,
      );
      await new Promise((r) => setTimeout(r, 20));
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
  return {
    train: games.slice(0, Math.floor(n * 0.55)),
    val: games.slice(Math.floor(n * 0.55), Math.floor(n * 0.75)),
    holdout: games.slice(Math.floor(n * 0.75)),
  };
}

function meanAbsDevFromHalf(rows: CalibObs[]): number {
  if (!rows.length) return 0;
  return rows.reduce((s, r) => s + Math.abs(r.p - 0.5), 0) / rows.length;
}

function withinDrawVar(tensor: ReturnType<typeof buildJointBasketballTensor>): number {
  const n = tensor.meta.nDraws;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const tot = tensor.team.homeFg[i]! + tensor.team.awayFg[i]!;
    sum += tot;
    sumSq += tot * tot;
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

async function runSport(sport: BasketballSport) {
  if (sport !== "nba" && sport !== "wnba" && sport !== "ncaab") {
    return { md: "", gates: [] as FamilyGateRow[], rows: [] as string[] };
  }
  const seasons = sport === "wnba" ? [2022, 2023, 2024] : [2023, 2024];
  const all: Game[] = [];
  for (const s of seasons) all.push(...(await fetchGames(sport, s)));
  const games = Array.from(new Map(all.map((g) => [g.eventId, g])).values()).sort(
    (a, b) => new Date(a.kickoffIso).getTime() - new Date(b.kickoffIso).getTime(),
  );
  const folds = chronoFolds(games);
  const holdCap = sport === "ncaab" ? 400 : sport === "nba" ? 320 : 220;
  const holdout = folds.holdout.slice(0, holdCap);

  const byProfile = new Map<BasketballCalibrationProfile, CalibObs[]>();
  const distActualTot: number[] = [];
  const distActualMar: number[] = [];
  const distSimTot = new Map<BasketballCalibrationProfile, number[]>();
  const distSimMar = new Map<BasketballCalibrationProfile, number[]>();
  const drawVars = new Map<BasketballCalibrationProfile, number[]>();
  const runtimes = new Map<BasketballCalibrationProfile, number[]>();
  for (const p of PROFILES) {
    byProfile.set(p, []);
    distSimTot.set(p, []);
    distSimMar.set(p, []);
    drawVars.set(p, []);
    runtimes.set(p, []);
  }

  for (const g of holdout) {
    const t = new Date(g.kickoffIso).getTime();
    const home = form(g.homeId, t, games);
    const away = form(g.awayId, t, games);
    if (!home || !away) continue;
    distActualTot.push(g.homeFg + g.awayFg);
    distActualMar.push(g.homeFg - g.awayFg);
    const totLine = sport === "nba" ? 224.5 : sport === "wnba" ? 162.5 : 144.5;

    for (const profile of PROFILES) {
      const t0 = performance.now();
      const tensor = buildJointBasketballTensor({
        sport,
        eventId: g.eventId,
        seed: `${sport}-ab:${g.eventId}`,
        nDraws: 2000,
        home,
        away,
        calibrationProfile: profile,
      });
      runtimes.get(profile)!.push(performance.now() - t0);
      drawVars.get(profile)!.push(withinDrawVar(tensor));
      let simTot = 0;
      let simMar = 0;
      for (let i = 0; i < tensor.meta.nDraws; i++) {
        simTot += tensor.team.homeFg[i]! + tensor.team.awayFg[i]!;
        simMar += tensor.team.homeFg[i]! - tensor.team.awayFg[i]!;
      }
      distSimTot.get(profile)!.push(simTot / tensor.meta.nDraws);
      distSimMar.get(profile)!.push(simMar / tensor.meta.nDraws);

      const specs = [
        {
          family: "ml",
          slice: "ml_home",
          m: buildBasketballMlMarket({ marketId: "ml", eventId: g.eventId, sport, side: "home" }),
          y: (g.homeFg > g.awayFg ? 1 : 0) as 0 | 1,
        },
        {
          family: "spread",
          slice: "spread_home_-3.5",
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
          family: "spread",
          slice: "alt_spread_home_-7.5",
          isAlt: true,
          m: buildBasketballSpreadMarket({
            marketId: "asp",
            eventId: g.eventId,
            sport,
            side: "home",
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
            side: "over",
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
            side: "over",
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
            teamSide: "home",
            side: "over",
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
          byProfile.get(profile)!.push({
            y: s.y,
            p: r.simHit,
            eventId: g.eventId,
            family: s.family,
            slice: s.slice,
            fold: "holdout",
            isAlt: s.isAlt,
            realBookLine: false,
          });
        }
      }
    }
  }

  const families = ["ml", "spread", "total", "team_total", "main_all", "alt_all"] as const;
  const abLines: string[] = [
    `| Family | v0.2 ECE | v0.3 ECE | ΔECE | v0.2 Brier | v0.3 Brier | ΔBrier | v0.2 LL | v0.3 LL | mad½ 0.2→0.3 | shrink50? | n | v0.2 | v0.3 |`,
    `|--------|----------|----------|------|------------|------------|--------|---------|---------|--------------|-----------|---|------|------|`,
  ];
  const gates: FamilyGateRow[] = [];
  for (const f of families) {
    const pick = (obs: CalibObs[]) =>
      f === "main_all"
        ? obs.filter((o) => !o.isAlt)
        : f === "alt_all"
          ? obs.filter((o) => o.isAlt)
          : obs.filter((o) => o.family === f);
    const a = pick(byProfile.get("v0.2")!);
    const b = pick(byProfile.get("v0.3")!);
    const ga = evaluateFamilyGate(`${sport}:${f}:v0.2`, a);
    const gb = evaluateFamilyGate(`${sport}:${f}:v0.3`, b);
    gates.push(ga, gb);
    const ma = metricsOf(a);
    const mb = metricsOf(b);
    const madA = meanAbsDevFromHalf(a);
    const madB = meanAbsDevFromHalf(b);
    const madDrop = madA > 1e-9 ? (madA - madB) / madA : 0;
    const eceDrop = (ma.ece ?? 1) - (mb.ece ?? 1);
    const shrink50 = eceDrop > 0.01 && madDrop > 0.25 ? "YES" : "no";
    abLines.push(
      `| ${sport}:${f} | ${ma.ece?.toFixed(4) ?? "n/a"} | ${mb.ece?.toFixed(4) ?? "n/a"} | ${((mb.ece ?? 0) - (ma.ece ?? 0)).toFixed(4)} | ${ma.brier?.toFixed(4) ?? "n/a"} | ${mb.brier?.toFixed(4) ?? "n/a"} | ${((mb.brier ?? 0) - (ma.brier ?? 0)).toFixed(4)} | ${ma.logLoss?.toFixed(4) ?? "n/a"} | ${mb.logLoss?.toFixed(4) ?? "n/a"} | ${madA.toFixed(3)}→${madB.toFixed(3)} | ${shrink50} | ${b.length} | **${ga.verdict}** | **${gb.verdict}** |`,
    );
  }
  gates.push({
    ...evaluateFamilyGate(`${sport}:closing_line_benchmark`, []),
    verdict: "INSUFFICIENT_DATA",
    reasons: ["closing_line_unavailable_unlicensed"],
  });
  gates.push({
    ...evaluateFamilyGate(`${sport}:player_prop_named`, []),
    verdict: "INSUFFICIENT_DATA",
    reasons: ["named_player_prop_oos_not_wired_this_pass"],
  });

  const distRows = [];
  for (const p of PROFILES) {
    const d1 = compareDistributions(`${sport}_total_${p}`, distActualTot, distSimTot.get(p)!);
    const d2 = compareDistributions(`${sport}_margin_${p}`, distActualMar, distSimMar.get(p)!);
    if (d1) distRows.push(d1);
    if (d2) distRows.push(d2);
  }
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const p95 = (xs: number[]) => {
    if (!xs.length) return 0;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(0.95 * (s.length - 1)))]!;
  };

  const md = [
    `## ${sport.toUpperCase()} A/B (identical holdout)`,
    `- Holdout games graded: ${holdout.length} (train/val unused for grading; chrono freeze)`,
    `- Draws/game: 2000; odds: eval-grid −110 (not closing lines)`,
    `- Within-draw total var: v0.2=${avg(drawVars.get("v0.2")!).toFixed(2)} → v0.3=${avg(drawVars.get("v0.3")!).toFixed(2)}`,
    `- p95 runtime/game: v0.2=${p95(runtimes.get("v0.2")!).toFixed(1)} ms → v0.3=${p95(runtimes.get("v0.3")!).toFixed(1)} ms`,
    `- Game clusters (main_all v0.3): ${new Set(byProfile.get("v0.3")!.filter((o) => !o.isAlt).map((o) => o.eventId)).size}; effN=${effectiveSampleSize(byProfile.get("v0.3")!.filter((o) => !o.isAlt).map((o) => o.eventId)).toFixed(1)}`,
    "",
    "### Before / after",
    ...abLines,
    "",
    "### Gates (both profiles)",
    ...formatGateTable(gates),
    "",
    "### Scoring distribution",
    ...formatDistTable(distRows),
    "",
  ].join("\n");

  return { md, gates, rows: abLines.slice(2) };
}

async function main() {
  await mkdir(REPORT_DIR, { recursive: true });
  const parts = [
    "# Basketball A/B chronological holdout (v0.2 vs v0.3)",
    "",
    "Shadow-only. Identical holdout games/markets/odds per league. Gates unchanged (minOos=500, maxEce=0.04).",
    "shrink50=YES when ECE improves >0.01 and mean |p−0.5| drops >25% (suspect confidence collapse).",
    "",
  ];
  const allGates: FamilyGateRow[] = [];
  const summaryRows: string[] = [];
  for (const sport of ["nba", "wnba", "ncaab"] as const) {
    console.log(`bball-ab ${sport}`);
    const { md, gates, rows } = await runSport(sport);
    parts.push(md);
    allGates.push(...gates);
    summaryRows.push(...rows);
  }
  parts.push("## Aggregate before/after rows");
  parts.push(
    `| Family | v0.2 ECE | v0.3 ECE | ΔECE | v0.2 Brier | v0.3 Brier | ΔBrier | v0.2 LL | v0.3 LL | mad½ 0.2→0.3 | shrink50? | n | v0.2 | v0.3 |`,
  );
  parts.push(
    `|--------|----------|----------|------|------------|------------|--------|---------|---------|--------------|-----------|---|------|------|`,
  );
  parts.push(...summaryRows);
  parts.push("");
  parts.push("- Production allowlists unchanged; SIM_V2_SERVE=off.");
  await writeFile(join(REPORT_DIR, "BASKETBALL_AB_HOLDOUT.md"), parts.join("\n"), "utf8");
  await writeFile(
    join(REPORT_DIR, "BASKETBALL_AB_GATES.md"),
    ["# Basketball A/B family gates", "", ...formatGateTable(allGates), ""].join("\n"),
    "utf8",
  );
  console.log("wrote basketball AB reports");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
