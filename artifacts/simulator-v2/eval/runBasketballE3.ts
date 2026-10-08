/**
 * Basketball E.3 — league-specific one-factor holdout verification.
 * Promote only if ECE AND Brier AND LogLoss improve vs v0.2 on identical holdout.
 * Leagues never share parameters. Shadow-only.
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
import { evaluateFamilyGate, formatGateTable, metricsOf, type CalibObs } from "./familyCalibration.js";

const REPORT_DIR = join(import.meta.dirname, "report");

const CANDIDATE: Record<"nba" | "wnba" | "ncaab", BasketballCalibrationProfile> = {
  nba: "nba_e3",
  wnba: "wnba_e3", // alias of v0.2 — expect no promote
  ncaab: "ncaab_e3",
};

const ESPN = {
  nba: "basketball/nba",
  wnba: "basketball/wnba",
  ncaab: "basketball/mens-college-basketball",
} as const;

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
    const r = await fetch(url, { headers: { "User-Agent": "stadium-sim-v2-e3" } });
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
    for (const year of [season]) {
      for (const m of [5, 6, 7, 8, 9]) {
        for (let d = 1; d <= 28; d++) {
          await parseScoreboard(
            `https://site.api.espn.com/apis/site/v2/sports/${ESPN[sport]}/scoreboard?dates=${ymd(year, m, d)}`,
            out,
          );
          await new Promise((r) => setTimeout(r, 18));
        }
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

async function grade(
  sport: BasketballSport,
  holdout: Game[],
  games: Game[],
  profile: BasketballCalibrationProfile,
): Promise<CalibObs[]> {
  const obs: CalibObs[] = [];
  const totLine = sport === "nba" ? 224.5 : sport === "wnba" ? 162.5 : 144.5;
  for (const g of holdout) {
    const t = new Date(g.kickoffIso).getTime();
    const home = form(g.homeId, t, games);
    const away = form(g.awayId, t, games);
    if (!home || !away) continue;
    const tensor = buildJointBasketballTensor({
      sport,
      eventId: g.eventId,
      seed: `${sport}-e3:${g.eventId}`,
      nDraws: 2000,
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

type Promo = {
  sport: string;
  candidate: string;
  promote: boolean;
  reason: string;
  base: ReturnType<typeof metricsOf>;
  cand: ReturnType<typeof metricsOf>;
};

async function runSport(sport: "nba" | "wnba" | "ncaab"): Promise<{ md: string; promo: Promo }> {
  const seasons = sport === "wnba" ? [2022, 2023, 2024] : [2023, 2024];
  const all: Game[] = [];
  for (const s of seasons) all.push(...(await fetchGames(sport, s)));
  const games = Array.from(new Map(all.map((g) => [g.eventId, g])).values()).sort(
    (a, b) => new Date(a.kickoffIso).getTime() - new Date(b.kickoffIso).getTime(),
  );
  const holdCap = sport === "ncaab" ? 400 : sport === "nba" ? 320 : 220;
  const holdout = games.slice(Math.floor(games.length * 0.75)).slice(0, holdCap);
  const candidate = CANDIDATE[sport];
  const baseObs = await grade(sport, holdout, games, "v0.2");
  const candObs = await grade(sport, holdout, games, candidate);
  const base = metricsOf(baseObs);
  const cand = metricsOf(candObs);
  const eceOk = (cand.ece ?? 1) < (base.ece ?? 1);
  const brierOk = (cand.brier ?? 1) <= (base.brier ?? 1) + 1e-6;
  const llOk = (cand.logLoss ?? 1) <= (base.logLoss ?? 1) + 1e-6;
  const identical = candidate === "wnba_e3" || candidate === "v0.2";
  const promote = !identical && eceOk && brierOk && llOk;
  const reason = identical
    ? "no_candidate_factor"
    : promote
      ? "holdout_ece_brier_ll_improve"
      : `blocked eceOk=${eceOk} brierOk=${brierOk} llOk=${llOk}`;

  const gates = [
    evaluateFamilyGate(`${sport}:main_all:v0.2`, baseObs),
    evaluateFamilyGate(`${sport}:main_all:${candidate}`, candObs),
    ...(["ml", "spread", "total"] as const).flatMap((f) => [
      evaluateFamilyGate(`${sport}:${f}:v0.2`, baseObs.filter((o) => o.family === f)),
      evaluateFamilyGate(
        `${sport}:${f}:${candidate}`,
        candObs.filter((o) => o.family === f),
      ),
    ]),
  ];

  const md = [
    `## ${sport.toUpperCase()}`,
    `- Holdout games: ${holdout.length}; candidate: \`${candidate}\` (one factor)`,
    `- v0.2 → candidate: ECE ${base.ece?.toFixed(4)} → ${cand.ece?.toFixed(4)} (Δ${((cand.ece ?? 0) - (base.ece ?? 0)).toFixed(4)})`,
    `- Brier ${base.brier?.toFixed(4)} → ${cand.brier?.toFixed(4)}; LogLoss ${base.logLoss?.toFixed(4)} → ${cand.logLoss?.toFixed(4)}`,
    `- **Promote: ${promote ? "YES" : "NO"}** — ${reason}`,
    "",
    ...formatGateTable(gates),
    "",
  ].join("\n");

  return {
    md,
    promo: { sport, candidate, promote, reason, base, cand },
  };
}

async function main() {
  await mkdir(REPORT_DIR, { recursive: true });
  const parts = [
    "# Basketball E.3 — league-specific one-factor holdout",
    "",
    "Promote only if ECE **and** Brier **and** LogLoss improve vs v0.2 on identical holdout.",
    "Default remains v0.2 unless promotion YES. Leagues independent. Shadow-only.",
    "",
  ];
  const promos: Promo[] = [];
  for (const sport of ["nba", "wnba", "ncaab"] as const) {
    console.log(`e3 ${sport}`);
    const { md, promo } = await runSport(sport);
    parts.push(md);
    promos.push(promo);
  }
  parts.push("## Promotion board");
  parts.push("| League | Candidate | Promote | Reason |");
  parts.push("|--------|-----------|---------|--------|");
  for (const p of promos) {
    parts.push(`| ${p.sport} | ${p.candidate} | **${p.promote ? "YES" : "NO"}** | ${p.reason} |`);
  }
  parts.push("");
  parts.push("Defaults stay v0.2 unless YES — update `E3_PROMOTED` in jointBasketball.ts accordingly.");
  parts.push("- Serve/allowlists unchanged.");
  await writeFile(join(REPORT_DIR, "BASKETBALL_E3.md"), parts.join("\n"), "utf8");
  await writeFile(join(REPORT_DIR, "basketball_e3_promos.json"), JSON.stringify(promos, null, 2), "utf8");
  console.log("wrote E.3 reports");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
