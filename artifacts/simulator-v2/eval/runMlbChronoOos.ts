/**
 * MLB chronological OOS + family calibration gates (shadow).
 * ESPN MLB scoreboard is date-keyed (week filters return empty).
 * Train/val diagnostic only; final holdout never used for tuning.
 * Closing lines: INSUFFICIENT (no licensed archive).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildJointBaseballTensor } from "../src/models/baseball/jointBaseball.js";
import {
  buildBaseballMlMarket,
  buildBaseballPlayerPropMarket,
  buildBaseballSpreadMarket,
  buildBaseballTeamTotalMarket,
  buildBaseballTotalMarket,
} from "../src/models/baseball/markets.js";
import { settleMarket } from "../src/engine/settle.js";
import { impliedProbFromAmerican } from "../src/schemas/odds.js";
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

type BoxPlayer = {
  playerId: string;
  teamSide: "home" | "away";
  kind: "batter" | "pitcher";
  hits: number;
  homeRuns: number;
  strikeouts: number;
  battingOrder?: number;
  confirmedStarter: boolean;
};

function ymd(year: number, month: number, day: number): string {
  return `${year}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;
}

/** Dense regular-season sample: every day Apr–Jun + Aug–Sep (skip All-Star window). */
function seasonSampleDays(season: number, step = 1): string[] {
  const days: string[] = [];
  for (const month of [4, 5, 6, 8, 9]) {
    const maxDay = month === 9 ? 28 : 30;
    for (let d = 1; d <= maxDay; d += step) {
      days.push(ymd(season, month, d));
    }
  }
  return days;
}

async function fetchSeason(season: number, step = 1): Promise<Game[]> {
  const out: Game[] = [];
  for (const dates of seasonSampleDays(season, step)) {
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
    await new Promise((r) => setTimeout(r, 25));
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

function chronoFolds(games: Game[]): { train: Game[]; val: Game[]; holdout: Game[] } {
  const n = games.length;
  const tEnd = Math.floor(n * 0.55);
  const vEnd = Math.floor(n * 0.75);
  return {
    train: games.slice(0, tEnd),
    val: games.slice(tEnd, vEnd),
    holdout: games.slice(vEnd),
  };
}

function idxOf(keys: string[], name: string): number {
  return keys.findIndex((k) => k.toLowerCase() === name.toLowerCase());
}

async function fetchBoxPlayers(
  eventId: string,
  homeId: string,
  awayId: string,
): Promise<BoxPlayer[]> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=${eventId}`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "stadium-sim-v2-mlb" } });
    if (!r.ok) return [];
    const j = (await r.json()) as {
      boxscore?: {
        players?: Array<{
          team?: { id?: string };
          statistics?: Array<{
            type?: string;
            keys?: string[];
            names?: string[];
            labels?: string[];
            athletes?: Array<{
              athlete?: { id?: string | number };
              stats?: string[];
            }>;
          }>;
        }>;
      };
    };
    const out: BoxPlayer[] = [];
    for (const block of j.boxscore?.players ?? []) {
      const tid = block.team?.id;
      if (!tid) continue;
      const teamSide: "home" | "away" | null =
        tid === homeId ? "home" : tid === awayId ? "away" : null;
      if (!teamSide) continue;
      for (const grp of block.statistics ?? []) {
        const keys = grp.keys ?? grp.names ?? grp.labels ?? [];
        const athletes = grp.athletes ?? [];
        if (grp.type === "batting") {
          const hi = idxOf(keys, "hits");
          const hri = idxOf(keys, "homeRuns");
          const ki = idxOf(keys, "strikeouts");
          let order = 0;
          for (const a of athletes) {
            const id = a.athlete?.id != null ? String(a.athlete.id) : "";
            if (!id || !a.stats?.length) continue;
            order += 1;
            const hits = hi >= 0 ? Number(a.stats[hi] ?? 0) : NaN;
            const hr = hri >= 0 ? Number(a.stats[hri] ?? 0) : NaN;
            if (!Number.isFinite(hits) || !Number.isFinite(hr)) continue;
            out.push({
              playerId: id,
              teamSide,
              kind: "batter",
              hits,
              homeRuns: hr,
              strikeouts: ki >= 0 ? Number(a.stats[ki] ?? 0) : 0,
              battingOrder: order,
              confirmedStarter: order <= 9,
            });
            if (order >= 5) break; // top of order — enough for named-prop sample
          }
        }
        if (grp.type === "pitching") {
          const ki = idxOf(keys, "strikeouts");
          // First listed pitcher ≈ starter for ESPN MLB boxscore.
          const a = athletes[0];
          const id = a?.athlete?.id != null ? String(a.athlete.id) : "";
          if (!id || ki < 0 || !a?.stats) continue;
          const ks = Number(a.stats[ki] ?? 0);
          if (!Number.isFinite(ks)) continue;
          out.push({
            playerId: id,
            teamSide,
            kind: "pitcher",
            hits: 0,
            homeRuns: 0,
            strikeouts: ks,
            confirmedStarter: true,
          });
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

async function main() {
  await mkdir(REPORT_DIR, { recursive: true });
  // Dense every-other-day across 2023–2024 → enough holdout for ≥500/family where data allows.
  const s2023 = await fetchSeason(2023, 1);
  const s2024 = await fetchSeason(2024, 1);
  const games = Array.from(
    new Map([...s2023, ...s2024].map((g) => [g.eventId, g])).values(),
  ).sort((a, b) => new Date(a.kickoffIso).getTime() - new Date(b.kickoffIso).getTime());

  const folds = chronoFolds(games);
  // Target ≥500 holdout obs/family: ~1 ML obs/game → grade up to 560 holdout games.
  const holdout = folds.holdout.slice(0, 560);
  const valSlice = folds.val.slice(0, 100);

  const holdObs: CalibObs[] = [];
  const valObs: CalibObs[] = [];
  const propObs: CalibObs[] = [];
  const actualTotals: number[] = [];
  const simTotalMeans: number[] = [];
  const actualMargins: number[] = [];
  const simMarginMeans: number[] = [];
  let used = 0;
  let propGamesAttempted = 0;
  let propGamesOk = 0;
  let propFetchFail = 0;
  const t0 = performance.now();

  async function gradeTeam(g: Game, fold: "val" | "holdout", sink: CalibObs[]) {
    const t = new Date(g.kickoffIso).getTime();
    const home = form(g.homeId, t, games);
    const away = form(g.awayId, t, games);
    if (!home || !away) return null;
    used += 1;
    const tensor = buildJointBaseballTensor({
      sport: "mlb",
      eventId: g.eventId,
      seed: `mlb-oos:${g.eventId}`,
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

    const specs: Array<{
      family: string;
      slice: string;
      isAlt?: boolean;
      m: ReturnType<typeof buildBaseballMlMarket>;
      y: 0 | 1;
    }> = [
      {
        family: "ml",
        slice: "ml_home",
        m: buildBaseballMlMarket({ marketId: "ml", eventId: g.eventId, side: "home" }),
        y: g.homeFg > g.awayFg ? 1 : 0,
      },
      {
        family: "spread",
        slice: "rl_home_-1.5",
        m: buildBaseballSpreadMarket({
          marketId: "rl",
          eventId: g.eventId,
          side: "home",
          postedSpread: -1.5,
        }),
        y: g.homeFg - g.awayFg > 1.5 ? 1 : 0,
      },
      {
        family: "spread",
        slice: "alt_rl_home_-2.5",
        isAlt: true,
        m: buildBaseballSpreadMarket({
          marketId: "arl",
          eventId: g.eventId,
          side: "home",
          postedSpread: -2.5,
        }),
        y: g.homeFg - g.awayFg > 2.5 ? 1 : 0,
      },
      {
        family: "total",
        slice: "total_8.5",
        m: buildBaseballTotalMarket({
          marketId: "tot",
          eventId: g.eventId,
          side: "over",
          line: 8.5,
        }),
        y: g.homeFg + g.awayFg > 8.5 ? 1 : 0,
      },
      {
        family: "total",
        slice: "alt_total_10.5",
        isAlt: true,
        m: buildBaseballTotalMarket({
          marketId: "atot",
          eventId: g.eventId,
          side: "over",
          line: 10.5,
        }),
        y: g.homeFg + g.awayFg > 10.5 ? 1 : 0,
      },
      {
        family: "team_total",
        slice: "tt_home_4.5",
        m: buildBaseballTeamTotalMarket({
          marketId: "tt",
          eventId: g.eventId,
          teamSide: "home",
          side: "over",
          line: 4.5,
        }),
        y: g.homeFg > 4.5 ? 1 : 0,
      },
      {
        family: "f5",
        slice: "f5_total_4.5",
        m: buildBaseballTotalMarket({
          marketId: "f5",
          eventId: g.eventId,
          period: "f5",
          side: "over",
          line: 4.5,
        }),
        y: g.homeF5 + g.awayF5 > 4.5 ? 1 : 0,
      },
      {
        family: "f5",
        slice: "f5_ml_home",
        m: buildBaseballMlMarket({
          marketId: "f5ml",
          eventId: g.eventId,
          period: "f5",
          side: "home",
        }),
        y: g.homeF5 > g.awayF5 ? 1 : 0,
      },
      {
        family: "f5",
        slice: "alt_f5_total_5.5",
        isAlt: true,
        m: buildBaseballTotalMarket({
          marketId: "af5",
          eventId: g.eventId,
          period: "f5",
          side: "over",
          line: 5.5,
        }),
        y: g.homeF5 + g.awayF5 > 5.5 ? 1 : 0,
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
    return { home, away };
  }

  for (const g of valSlice) await gradeTeam(g, "val", valObs);
  used = 0;
  const holdForms: Array<{
    g: Game;
    home: NonNullable<ReturnType<typeof form>>;
    away: NonNullable<ReturnType<typeof form>>;
  }> = [];
  for (const g of holdout) {
    const formPair = await gradeTeam(g, "holdout", holdObs);
    if (formPair) holdForms.push({ g, home: formPair.home, away: formPair.away });
  }

  // Named player props: attempt ESPN boxscore athlete IDs (hits / HR / K).
  // Cap summary fetches for runtime; require named IDs + participation.
  const propCap = Math.min(holdForms.length, 120);
  for (let i = 0; i < propCap; i++) {
    const { g, home, away } = holdForms[i]!;
    propGamesAttempted += 1;
    const box = await fetchBoxPlayers(g.eventId, g.homeId, g.awayId);
    await new Promise((r) => setTimeout(r, 30));
    if (!box.length) {
      propFetchFail += 1;
      continue;
    }
    propGamesOk += 1;
    const players = box.map((p) => ({
      playerId: p.playerId,
      teamSide: p.teamSide,
      kind: p.kind,
      usage: p.kind === "pitcher" ? 1 : 0.85,
      battingOrder: p.battingOrder ?? null,
      confirmedStarter: p.confirmedStarter,
      oppPitcherKPer9: 8.5,
    }));
    const tensor = buildJointBaseballTensor({
      sport: "mlb",
      eventId: g.eventId,
      seed: `mlb-oos-prop:${g.eventId}`,
      nDraws: 2000,
      home,
      away,
      players,
    });
    for (const p of box) {
      const propSpecs =
        p.kind === "batter"
          ? [
              {
                slice: "hits_0.5",
                stat: "hits" as const,
                line: 0.5,
                y: (p.hits > 0.5 ? 1 : 0) as 0 | 1,
                alt: false,
              },
              {
                slice: "hr_0.5",
                stat: "home_runs" as const,
                line: 0.5,
                y: (p.homeRuns > 0.5 ? 1 : 0) as 0 | 1,
                alt: false,
              },
            ]
          : [
              {
                slice: "k_5.5",
                stat: "strikeouts" as const,
                line: 5.5,
                y: (p.strikeouts > 5.5 ? 1 : 0) as 0 | 1,
                alt: false,
              },
              {
                slice: "alt_k_4.5",
                stat: "strikeouts" as const,
                line: 4.5,
                y: (p.strikeouts > 4.5 ? 1 : 0) as 0 | 1,
                alt: true,
              },
            ];
      for (const s of propSpecs) {
        const m = buildBaseballPlayerPropMarket({
          marketId: `${p.playerId}:${s.slice}`,
          eventId: g.eventId,
          playerId: p.playerId,
          stat: s.stat,
          side: "over",
          line: s.line,
          alternate: s.alt,
        });
        const r = settleMarket({
          tensor,
          market: m,
          odds: {
            marketId: m.marketId,
            american: -110,
            book: "eval-grid",
            capturedAt: new Date().toISOString(),
            impliedProbRaw: impliedProbFromAmerican(-110),
            provenance: { provider: "eval-grid", fetchedAt: new Date().toISOString() },
          },
        });
        if (r.status === "ok" && r.simHit != null) {
          propObs.push({
            y: s.y,
            p: r.simHit,
            eventId: g.eventId,
            family: "player_prop",
            slice: s.slice,
            fold: "holdout",
            isAlt: s.alt,
            playerId: p.playerId,
            namedPlayer: true,
            participationKnown: true,
            realBookLine: false,
            line: s.line,
          });
        }
      }
    }
  }

  const ms = performance.now() - t0;
  const eventIds = [...new Set(holdObs.map((o) => o.eventId))];

  const familyKeys = ["ml", "spread", "total", "team_total", "f5", "main_all", "alt_all"] as const;
  const gates = familyKeys.map((f) => {
    const rows =
      f === "main_all"
        ? holdObs.filter((o) => !o.isAlt)
        : f === "alt_all"
          ? holdObs.filter((o) => o.isAlt)
          : holdObs.filter((o) => o.family === f);
    return evaluateFamilyGate(`mlb:${f}`, rows);
  });

  gates.push({
    ...evaluateFamilyGate("mlb:closing_line_benchmark", [], { requireRealBook: true }),
    verdict: "INSUFFICIENT_DATA",
    reasons: ["closing_line_unavailable_unlicensed"],
  });

  const propGate = evaluateFamilyGate("mlb:player_prop_named", propObs, {
    requireNamedPlayer: true,
  });
  if (propObs.length < 500) {
    propGate.verdict = "INSUFFICIENT_DATA";
    if (!propGate.reasons.some((r) => r.includes("named_player") || r.startsWith("oos_sample"))) {
      propGate.reasons.push(
        `named_prop_oos_n_${propObs.length}_lt_500_attempted_games_${propGamesAttempted}_ok_${propGamesOk}_fetch_fail_${propFetchFail}`,
      );
    } else {
      propGate.reasons.push(
        `boxscore_attempted_${propGamesAttempted}_ok_${propGamesOk}_fail_${propFetchFail}`,
      );
    }
  }
  gates.push(propGate);

  const dist = [
    compareDistributions("mlb_total", actualTotals, simTotalMeans),
    compareDistributions("mlb_margin", actualMargins, simMarginMeans),
  ].filter((x): x is NonNullable<typeof x> => !!x);

  const valEce = metricsOf(valObs).ece;
  const holdEce = metricsOf(holdObs).ece;
  const mlRows = holdObs.filter((o) => o.family === "ml");

  const oosMd = [
    "# MLB chronological OOS + family calibration gates",
    "",
    "Shadow-only. `SIM_V2_SERVE=off`. Final holdout not used for tuning.",
    "Root cause (ML ECE ≈0.229 on F.2): underdispersed independent Poisson innings + insufficient form shrinkage → overconfident ML probs.",
    "Correction (`baseball.joint.v0` **0.3.0**): shrink form 40% toward `MLB_TEAM_FG_MEAN`, per-draw lognormal game shock (σ≈0.18), milder home edge (0.05).",
    "",
    `- Games fetched: ${games.length} (2023=${s2023.length}, 2024=${s2024.length}); train ${folds.train.length} / val ${folds.val.length} / holdout ${folds.holdout.length} (55/20/25)`,
    `- Holdout graded: ${used} games → obs=${holdObs.length}; games_clustered=${eventIds.length}; val diagnostic obs=${valObs.length}`,
    `- Mean runtime/game: ${(ms / Math.max(1, used)).toFixed(1)} ms`,
    `- Val ECE (diagnostic only): ${valEce?.toFixed(4) ?? "n/a"} | Holdout ECE: ${holdEce?.toFixed(4) ?? "n/a"} | ML holdout ECE: ${metricsOf(mlRows).ece?.toFixed(4) ?? "n/a"}`,
    `- Closing-line benchmark: **INSUFFICIENT_DATA** (no licensed historical odds source)`,
    `- Named player props: attempted ESPN summary boxscore athlete IDs (hits/HR/K); n=${propObs.length} from ${propGamesOk}/${propGamesAttempted} games`,
    "",
    "### Family gates (final holdout)",
    ...formatGateTable(gates),
    "",
    "### Reliability (holdout ML)",
    ...formatReliability(mlRows),
    "",
    "### Reliability (holdout overall)",
    ...formatReliability(holdObs),
    "",
    "### Scoring distribution check (actual vs sim mean)",
    ...formatDistTable(dist),
    "",
    "- Grid lines (−110). Production allowlists unchanged.",
    "",
  ].join("\n");

  const gateMd = [
    "# MLB sport:family gates",
    "",
    "Shadow-only family verdicts on chronological holdout (55/20/25). Never tune on holdout.",
    "",
    ...formatGateTable(gates),
    "",
    "## Notes",
    `- minOosSample=${500}, maxEce=${0.04} from acceptanceGates`,
    `- effectiveN = Kish ESS from game clusters`,
    `- closing_line_benchmark → INSUFFICIENT_DATA (unlicensed)`,
    `- player_prop_named → ${propGate.verdict} (n=${propObs.length})`,
    "",
  ].join("\n");

  const path = join(REPORT_DIR, "MLB_CHRONO_OOS.md");
  const gatePath = join(REPORT_DIR, "MLB_FAMILY_GATES.md");
  await writeFile(path, oosMd, "utf8");
  await writeFile(gatePath, gateMd, "utf8");
  console.log(
    `wrote ${path} hold_obs=${holdObs.length} used=${used} prop_obs=${propObs.length} ml_ece=${metricsOf(mlRows).ece?.toFixed(4)}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
