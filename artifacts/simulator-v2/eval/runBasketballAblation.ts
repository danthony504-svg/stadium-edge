/**
 * One-factor ablations vs restored v0.2 default (NBA/WNBA/NCAAB separate).
 * Shadow-only. Does not loosen gates.
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
  buildBasketballTotalMarket,
} from "../src/models/basketball/markets.js";
import { settleMarket } from "../src/engine/settle.js";
import { impliedProbFromAmerican } from "../src/schemas/odds.js";
import type { BasketballSport } from "../src/models/basketball/priors.js";
import {
  type CalibObs,
  evaluateFamilyGate,
  formatGateTable,
  metricsOf,
} from "./familyCalibration.js";
import { SIM_V2_ACCEPTANCE_THRESHOLDS } from "../src/flags/acceptanceGates.js";

const REPORT_DIR = join(import.meta.dirname, "report");
const PROFILES: BasketballCalibrationProfile[] = [
  "v0.2",
  "ablate_shrink",
  "ablate_shock",
  "ablate_hfa",
  "v0.3",
];

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

function ymd(y: number, m: number, d: number) {
  return `${y}${String(m).padStart(2, "0")}${String(d).padStart(2, "0")}`;
}

async function parseScoreboard(url: string, out: Game[]) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "stadium-sim-v2-ablate" } });
    if (!r.ok) return;
    const j = (await r.json()) as {
      events?: Array<{
        id?: string;
        date?: string;
        competitions?: Array<{
          competitors?: Array<{ homeAway?: string; score?: string; team?: { id?: string } }>;
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
      await new Promise((r) => setTimeout(r, 25));
    }
  } else if (sport === "nba") {
    for (const m of [10, 11, 12, 1, 2, 3, 4]) {
      const y = m >= 10 ? season : season + 1;
      for (let d = 1; d <= 28; d += 2) {
        await parseScoreboard(
          `https://site.api.espn.com/apis/site/v2/sports/${ESPN[sport]}/scoreboard?dates=${ymd(y, m, d)}`,
          out,
        );
        await new Promise((r) => setTimeout(r, 20));
      }
    }
  } else {
    for (const m of [5, 6, 7, 8, 9]) {
      for (let d = 1; d <= 28; d += 1) {
        await parseScoreboard(
          `https://site.api.espn.com/apis/site/v2/sports/${ESPN[sport]}/scoreboard?dates=${ymd(season, m, d)}`,
          out,
        );
        await new Promise((r) => setTimeout(r, 18));
      }
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
  return { teamId, ptsFor: pf / used.length, ptsAgainst: pa / used.length, recentFgScores: recent };
}

async function runSport(sport: BasketballSport) {
  if (sport !== "nba" && sport !== "wnba" && sport !== "ncaab") return "";
  const seasons = sport === "wnba" ? [2022, 2023, 2024] : [2023, 2024];
  const all: Game[] = [];
  for (const s of seasons) all.push(...(await fetchGames(sport, s)));
  const games = Array.from(new Map(all.map((g) => [g.eventId, g])).values()).sort(
    (a, b) => new Date(a.kickoffIso).getTime() - new Date(b.kickoffIso).getTime(),
  );
  const n = games.length;
  const val = games.slice(Math.floor(n * 0.55), Math.floor(n * 0.75)).slice(0, 120);
  const holdout = games.slice(Math.floor(n * 0.75)).slice(0, sport === "ncaab" ? 400 : 320);

  async function grade(set: Game[], profile: BasketballCalibrationProfile): Promise<CalibObs[]> {
    const obs: CalibObs[] = [];
    const totLine = sport === "nba" ? 224.5 : sport === "wnba" ? 162.5 : 144.5;
    for (const g of set) {
      const t = new Date(g.kickoffIso).getTime();
      const home = form(g.homeId, t, games);
      const away = form(g.awayId, t, games);
      if (!home || !away) continue;
      const tensor = buildJointBasketballTensor({
        sport,
        eventId: g.eventId,
        seed: `${sport}-ablate:${g.eventId}`,
        nDraws: 1500,
        home,
        away,
        calibrationProfile: profile,
      });
      const specs = [
        {
          family: "ml",
          m: buildBasketballMlMarket({ marketId: "ml", eventId: g.eventId, sport, side: "home" }),
          y: (g.homeFg > g.awayFg ? 1 : 0) as 0 | 1,
        },
        {
          family: "spread",
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
          family: "total",
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
          obs.push({
            y: s.y,
            p: r.simHit,
            eventId: g.eventId,
            family: s.family,
            slice: s.family,
            fold: "holdout",
          });
        }
      }
    }
    return obs;
  }

  const lines = [
    `## ${sport.toUpperCase()}`,
    `- Games: ${games.length}; val n_games≤${val.length}; holdout n_games≤${holdout.length}`,
    `- Default model version restored: **0.2.0**`,
    "",
    "### Val ablations (diagnostic — factor selection)",
    `| Profile | main n | ECE | Brier | LogLoss | vs v0.2 ΔECE |`,
    `|---------|--------|-----|-------|---------|--------------|`,
  ];
  const valBase = await grade(val, "v0.2");
  const baseEce = metricsOf(valBase).ece ?? 1;
  for (const profile of PROFILES) {
    const obs = profile === "v0.2" ? valBase : await grade(val, profile);
    const m = metricsOf(obs);
    lines.push(
      `| ${profile} | ${m.n} | ${m.ece?.toFixed(4) ?? "n/a"} | ${m.brier?.toFixed(4) ?? "n/a"} | ${m.logLoss?.toFixed(4) ?? "n/a"} | ${((m.ece ?? 0) - baseEce).toFixed(4)} |`,
    );
  }

  // Holdout gate for restored v0.2 main_all only
  const hold = await grade(holdout, "v0.2");
  const main = hold; // ml+spread+total
  const gate = evaluateFamilyGate(`${sport}:main_all:v0.2`, main);
  const byFam = ["ml", "spread", "total"].map((f) =>
    evaluateFamilyGate(`${sport}:${f}:v0.2`, hold.filter((o) => o.family === f)),
  );
  lines.push("");
  lines.push("### Holdout gates — restored v0.2 default");
  lines.push(
    `- Thresholds: minOos=${SIM_V2_ACCEPTANCE_THRESHOLDS.minOosSample}, maxEce=${SIM_V2_ACCEPTANCE_THRESHOLDS.maxEce}`,
  );
  lines.push(
    `- Integrity/latency/shadow soak not re-claimed here; this gate is calibration-only (ECE/n/Brier/LL).`,
  );
  lines.push(...formatGateTable([gate, ...byFam]));
  lines.push("");
  return lines.join("\n");
}

async function main() {
  await mkdir(REPORT_DIR, { recursive: true });
  const parts = [
    "# Basketball one-factor ablations + restored v0.2 holdout",
    "",
    "Decision: **REVERT** blanket v0.3. Default levers = v0.2. Ablations are eval-only.",
    "",
  ];
  for (const sport of ["nba", "wnba", "ncaab"] as const) {
    console.log(`ablate ${sport}`);
    parts.push(await runSport(sport));
  }
  parts.push("## Notes");
  parts.push("- Prior A/B: ncaab:main_all v0.2 ECE 0.0396 **PASS** (n=1584≥500); v0.3 failed.");
  parts.push("- That PASS was ECE+n only in familyCalibration; full serve acceptance still requires soak/latency/contracts.");
  parts.push("- Serve/allowlists unchanged.");
  await writeFile(join(REPORT_DIR, "BASKETBALL_ABLATION.md"), parts.join("\n"), "utf8");
  console.log("wrote ablation report");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
