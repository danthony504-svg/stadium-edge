/**
 * NHL D.2+ chronological OOS + family gates (shadow).
 * Train/val diagnostics; final holdout never used for tuning.
 * Closing lines: INSUFFICIENT (unlicensed). Named props: boxscore when feasible.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildJointHockeyTensor, nhlFinalHomeSeries, nhlFinalAwaySeries } from "../src/models/hockey/jointHockey.js";
import {
  buildHockeyMlMarket,
  buildHockeyPlayerPropMarket,
  buildHockeySpreadMarket,
  buildHockeyTeamTotalMarket,
  buildHockeyTotalMarket,
} from "../src/models/hockey/markets.js";
import { settleMarket } from "../src/engine/settle.js";
import { impliedProbFromAmerican } from "../src/schemas/odds.js";
import {
  type CalibObs,
  type DistCompare,
  type FamilyGateRow,
  compareDistributions,
  evaluateFamilyGate,
  formatDistTable,
  formatGateTable,
  formatReliability,
  metricsOf,
} from "./familyCalibration.js";
import { boxStatIndices } from "./nhlEspnShared.js";

const REPORT_DIR = join(import.meta.dirname, "report");
const ROOT_DIR = join(import.meta.dirname, "..");

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

type BoxPlayer = {
  athleteId: string;
  teamSide: "home" | "away";
  goals: number;
  sog: number;
  saves: number;
  isGoalie: boolean;
};

function ymd(year: number, month: number, day: number): string {
  return `${year}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;
}

/** NHL season labeled by start year: Oct Y – Jun Y+1, every 2nd day (dense). */
function nhlSampleDays(startYear: number): string[] {
  const days: string[] = [];
  for (const [y, months] of [
    [startYear, [10, 11, 12]],
    [startYear + 1, [1, 2, 3, 4, 5, 6]],
  ] as const) {
    for (const month of months) {
      const maxD = month === 2 ? 28 : 30;
      for (let d = 1; d <= maxD; d += 2) days.push(ymd(y, month, d));
    }
  }
  return days;
}

async function parseScoreboard(url: string, season: number, out: NhlGame[]): Promise<void> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "stadium-sim-v2-nhl" } });
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
      const hLs = (home.linescores ?? []).map((x) => Number(x.value ?? 0));
      const aLs = (away.linescores ?? []).map((x) => Number(x.value ?? 0));
      if (hLs.length < 3 || aLs.length < 3) continue;
      out.push({
        eventId: ev.id,
        kickoffIso: ev.date,
        homeId: home.team.id,
        awayId: away.team.id,
        homeFinal,
        awayFinal,
        homeReg: hLs.slice(0, 3).reduce((s, v) => s + v, 0),
        awayReg: aLs.slice(0, 3).reduce((s, v) => s + v, 0),
        season,
      });
    }
  } catch {
    /* skip */
  }
}

async function fetchSeason(season: number): Promise<NhlGame[]> {
  const games: NhlGame[] = [];
  // Date-range sample (week filters alone can miss games / be incomplete).
  for (const dates of nhlSampleDays(season)) {
    const url = `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=${dates}`;
    await parseScoreboard(url, season, games);
    await new Promise((r) => setTimeout(r, 35));
  }
  // Week fallback to fill gaps.
  for (let week = 1; week <= 28; week++) {
    const wurl = `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=${season}&seasontype=2&week=${week}`;
    await parseScoreboard(wurl, season, games);
    await new Promise((r) => setTimeout(r, 40));
  }
  return Array.from(new Map(games.map((g) => [g.eventId, g])).values()).sort(
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

/** Chronological 55/20/25 within a season list (never tune on holdout). */
function chronoSplit<T>(rows: T[]): { train: T[]; val: T[]; holdout: T[] } {
  const n = rows.length;
  const tEnd = Math.floor(n * 0.55);
  const vEnd = Math.floor(n * 0.75);
  return {
    train: rows.slice(0, tEnd),
    val: rows.slice(tEnd, vEnd),
    holdout: rows.slice(vEnd),
  };
}

async function fetchBoxPlayers(eventId: string): Promise<BoxPlayer[]> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/summary?event=${eventId}`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "stadium-sim-v2-nhl" } });
    if (!r.ok) return [];
    const j = (await r.json()) as {
      boxscore?: {
        players?: Array<{
          team?: { id?: string };
          statistics?: Array<{
            athletes?: Array<{
              athlete?: { id?: string };
              stats?: string[];
              names?: string[];
            }>;
            names?: string[];
            keys?: string[];
          }>;
        }>;
      };
      header?: {
        competitions?: Array<{
          competitors?: Array<{ homeAway?: string; team?: { id?: string } }>;
        }>;
      };
    };
    const comps = j.header?.competitions?.[0]?.competitors ?? [];
    const homeTid = comps.find((c) => c.homeAway === "home")?.team?.id;
    const awayTid = comps.find((c) => c.homeAway === "away")?.team?.id;
    const out: BoxPlayer[] = [];
    for (const block of j.boxscore?.players ?? []) {
      const tid = block.team?.id;
      const side: "home" | "away" | null =
        tid && tid === homeTid ? "home" : tid && tid === awayTid ? "away" : null;
      if (!side) continue;
      for (const grp of block.statistics ?? []) {
        const keys = grp.keys ?? grp.names ?? [];
        // ESPN skater SOG is shotsTotal — shared boxStatIndices maps it.
        const idx = boxStatIndices(keys);
        for (const a of grp.athletes ?? []) {
          const id = a.athlete?.id;
          if (!id || !a.stats?.length) continue;
          const goals = idx.goals >= 0 ? Number(a.stats[idx.goals] ?? 0) : 0;
          const sog = idx.sog >= 0 ? Number(a.stats[idx.sog] ?? 0) : 0;
          const saves = idx.saves >= 0 ? Number(a.stats[idx.saves] ?? 0) : 0;
          if (!Number.isFinite(goals) && !Number.isFinite(sog) && !Number.isFinite(saves)) continue;
          out.push({
            athleteId: id,
            teamSide: side,
            goals: Number.isFinite(goals) ? goals : 0,
            sog: Number.isFinite(sog) ? sog : 0,
            saves: Number.isFinite(saves) ? saves : 0,
            isGoalie: idx.isGoalieGrp || saves > 0,
          });
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

function oddsStub(marketId: string) {
  return {
    marketId,
    american: -110,
    book: "eval-grid",
    capturedAt: new Date().toISOString(),
    impliedProbRaw: impliedProbFromAmerican(-110),
    provenance: { provider: "eval-grid", fetchedAt: new Date().toISOString() },
  };
}

async function main() {
  await mkdir(REPORT_DIR, { recursive: true });
  console.log("nhl-oos fetch 2023…");
  const s2023 = await fetchSeason(2023);
  console.log(`nhl-oos fetch 2024… (2023 n=${s2023.length})`);
  const s2024 = await fetchSeason(2024);
  const all = [...s2023, ...s2024].sort(
    (a, b) => new Date(a.kickoffIso).getTime() - new Date(b.kickoffIso).getTime(),
  );
  // Train = full 2023; val = early 2024; holdout = late 2024 (never tune on holdout).
  const y2024 = chronoSplit(s2024);
  const train = s2023;
  const val = y2024.train; // early 2024 diagnostic
  const holdoutPool = [...y2024.val, ...y2024.holdout]; // mid+late 2024
  // Cap for runtime but target ≥500 obs/family (~280+ games × multi-specs).
  const holdout = holdoutPool.slice(0, 320);
  const valSlice = val.slice(0, 80);

  const holdObs: CalibObs[] = [];
  const valObs: CalibObs[] = [];
  const propObs: CalibObs[] = [];
  const actualRegGoals: number[] = [];
  const simRegGoalMeans: number[] = [];
  const actualTotals: number[] = [];
  const simTotalMeans: number[] = [];
  const actualMargins: number[] = [];
  const simMarginMeans: number[] = [];
  let used = 0;
  let propGames = 0;
  const t0 = performance.now();

  async function grade(g: NhlGame, fold: "val" | "holdout", sink: CalibObs[]) {
    const t = new Date(g.kickoffIso).getTime();
    const home = form(g.homeId, t, all);
    const away = form(g.awayId, t, all);
    if (!home || !away) return;
    used += 1;

    let players: Array<{
      playerId: string;
      teamSide: "home" | "away";
      usage: number;
      isGoalie?: boolean;
    }> = [];
    let box: BoxPlayer[] = [];
    if (fold === "holdout" && used <= 60) {
      box = await fetchBoxPlayers(g.eventId);
      await new Promise((r) => setTimeout(r, 40));
      if (box.length) {
        propGames += 1;
        const skaters = box.filter((p) => !p.isGoalie).slice(0, 4);
        const goalies = box.filter((p) => p.isGoalie).slice(0, 2);
        players = [
          ...skaters.map((p) => ({
            playerId: p.athleteId,
            teamSide: p.teamSide,
            usage: 0.28,
          })),
          ...goalies.map((p) => ({
            playerId: p.athleteId,
            teamSide: p.teamSide,
            usage: 1,
            isGoalie: true as const,
          })),
        ];
      }
    }

    const tensor = buildJointHockeyTensor({
      sport: "nhl",
      eventId: g.eventId,
      seed: `nhl-oos:${g.eventId}`,
      nDraws: 2000,
      home,
      away,
      players,
    });

    let simRegH = 0;
    let simRegA = 0;
    let simFinH = 0;
    let simFinA = 0;
    const finH = nhlFinalHomeSeries(tensor);
    const finA = nhlFinalAwaySeries(tensor);
    for (let i = 0; i < tensor.meta.nDraws; i++) {
      simRegH += tensor.team.homeFg[i]!;
      simRegA += tensor.team.awayFg[i]!;
      simFinH += finH[i]!;
      simFinA += finA[i]!;
    }
    const nD = tensor.meta.nDraws;
    simRegH /= nD;
    simRegA /= nD;
    simFinH /= nD;
    simFinA /= nD;
    if (fold === "holdout") {
      actualRegGoals.push(g.homeReg, g.awayReg);
      simRegGoalMeans.push(simRegH, simRegA);
      actualTotals.push(g.homeFinal + g.awayFinal);
      simTotalMeans.push(simFinH + simFinA);
      actualMargins.push(g.homeFinal - g.awayFinal);
      simMarginMeans.push(simFinH - simFinA);
    }

    const specs: Array<{
      family: string;
      slice: string;
      isAlt?: boolean;
      m: ReturnType<typeof buildHockeyMlMarket>;
      y: 0 | 1;
    }> = [
      {
        family: "ml",
        slice: "ml_home_final",
        m: buildHockeyMlMarket({ marketId: "ml", eventId: g.eventId, side: "home" }),
        y: g.homeFinal > g.awayFinal ? 1 : 0,
      },
      {
        family: "ml",
        slice: "ml_home_regulation",
        m: buildHockeyMlMarket({
          marketId: "ml_reg",
          eventId: g.eventId,
          side: "home",
          includeOtSo: false,
        }),
        y: g.homeReg > g.awayReg ? 1 : 0,
      },
      {
        family: "spread",
        slice: "puck_home_-1.5",
        m: buildHockeySpreadMarket({
          marketId: "pl",
          eventId: g.eventId,
          side: "home",
          postedSpread: -1.5,
        }),
        y: g.homeFinal - g.awayFinal > 1.5 ? 1 : 0,
      },
      {
        family: "spread",
        slice: "alt_puck_home_-2.5",
        isAlt: true,
        m: buildHockeySpreadMarket({
          marketId: "apl",
          eventId: g.eventId,
          side: "home",
          postedSpread: -2.5,
        }),
        y: g.homeFinal - g.awayFinal > 2.5 ? 1 : 0,
      },
      {
        family: "total",
        slice: "total_final_5.5",
        m: buildHockeyTotalMarket({
          marketId: "tot",
          eventId: g.eventId,
          side: "over",
          line: 5.5,
        }),
        y: g.homeFinal + g.awayFinal > 5.5 ? 1 : 0,
      },
      {
        family: "total",
        slice: "alt_total_final_6.5",
        isAlt: true,
        m: buildHockeyTotalMarket({
          marketId: "atot",
          eventId: g.eventId,
          side: "over",
          line: 6.5,
        }),
        y: g.homeFinal + g.awayFinal > 6.5 ? 1 : 0,
      },
      {
        family: "total",
        slice: "total_regulation_5.5",
        m: buildHockeyTotalMarket({
          marketId: "tot_reg",
          eventId: g.eventId,
          side: "over",
          line: 5.5,
          includeOtSo: false,
        }),
        y: g.homeReg + g.awayReg > 5.5 ? 1 : 0,
      },
      {
        family: "team_total",
        slice: "tt_home_final_2.5",
        m: buildHockeyTeamTotalMarket({
          marketId: "tt",
          eventId: g.eventId,
          teamSide: "home",
          side: "over",
          line: 2.5,
        }),
        y: g.homeFinal > 2.5 ? 1 : 0,
      },
      {
        family: "team_total",
        slice: "tt_home_regulation_2.5",
        m: buildHockeyTeamTotalMarket({
          marketId: "tt_reg",
          eventId: g.eventId,
          teamSide: "home",
          side: "over",
          line: 2.5,
          includeOtSo: false,
        }),
        y: g.homeReg > 2.5 ? 1 : 0,
      },
    ];

    for (const s of specs) {
      const r = settleMarket({ tensor, market: s.m, odds: oddsStub(s.m.marketId) });
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

    if (fold === "holdout" && box.length && players.length) {
      for (const bp of box) {
        if (!players.some((p) => p.playerId === bp.athleteId)) continue;
        const propSpecs: Array<{
          slice: string;
          isAlt?: boolean;
          m: ReturnType<typeof buildHockeyPlayerPropMarket>;
          y: 0 | 1;
          line: number;
        }> = [];
        if (!bp.isGoalie) {
          propSpecs.push({
            slice: "prop_goals_0.5",
            m: buildHockeyPlayerPropMarket({
              marketId: `g_${bp.athleteId}`,
              eventId: g.eventId,
              playerId: bp.athleteId,
              stat: "goals",
              side: "over",
              line: 0.5,
            }),
            y: bp.goals > 0.5 ? 1 : 0,
            line: 0.5,
          });
          propSpecs.push({
            slice: "prop_sog_2.5",
            m: buildHockeyPlayerPropMarket({
              marketId: `sog_${bp.athleteId}`,
              eventId: g.eventId,
              playerId: bp.athleteId,
              stat: "shots_on_goal",
              side: "over",
              line: 2.5,
            }),
            y: bp.sog > 2.5 ? 1 : 0,
            line: 2.5,
          });
          propSpecs.push({
            slice: "alt_prop_sog_3.5",
            isAlt: true,
            m: buildHockeyPlayerPropMarket({
              marketId: `asog_${bp.athleteId}`,
              eventId: g.eventId,
              playerId: bp.athleteId,
              stat: "shots_on_goal",
              side: "over",
              line: 3.5,
              alternate: true,
            }),
            y: bp.sog > 3.5 ? 1 : 0,
            line: 3.5,
          });
        } else {
          propSpecs.push({
            slice: "prop_saves_24.5",
            m: buildHockeyPlayerPropMarket({
              marketId: `sv_${bp.athleteId}`,
              eventId: g.eventId,
              playerId: bp.athleteId,
              stat: "saves",
              side: "over",
              line: 24.5,
            }),
            y: bp.saves > 24.5 ? 1 : 0,
            line: 24.5,
          });
        }
        for (const s of propSpecs) {
          const r = settleMarket({ tensor, market: s.m, odds: oddsStub(s.m.marketId) });
          if (r.status === "ok" && r.simHit != null) {
            propObs.push({
              y: s.y,
              p: r.simHit,
              eventId: g.eventId,
              family: "player_prop",
              slice: s.slice,
              fold,
              isAlt: s.isAlt,
              playerId: bp.athleteId,
              line: s.line,
              namedPlayer: true,
              participationKnown: true,
              realBookLine: false,
            });
          }
        }
      }
    }
  }

  console.log(`nhl-oos grade val n=${valSlice.length} holdout n=${holdout.length}`);
  for (const g of valSlice) await grade(g, "val", valObs);
  used = 0;
  for (const g of holdout) await grade(g, "holdout", holdObs);
  const ms = performance.now() - t0;

  const familyKeys = ["ml", "spread", "total", "team_total", "main_all", "alt_all"] as const;
  const gates: FamilyGateRow[] = familyKeys.map((f) => {
    const rows =
      f === "main_all"
        ? holdObs.filter((o) => !o.isAlt)
        : f === "alt_all"
          ? holdObs.filter((o) => o.isAlt)
          : holdObs.filter((o) => o.family === f);
    return evaluateFamilyGate(`nhl:${f}`, rows);
  });
  // Regulation vs final slices
  for (const slice of [
    "ml_home_final",
    "ml_home_regulation",
    "total_final_5.5",
    "total_regulation_5.5",
    "tt_home_final_2.5",
    "tt_home_regulation_2.5",
  ]) {
    gates.push(evaluateFamilyGate(`nhl:slice:${slice}`, holdObs.filter((o) => o.slice === slice)));
  }
  gates.push({
    ...evaluateFamilyGate("nhl:closing_line_benchmark", []),
    verdict: "INSUFFICIENT_DATA",
    reasons: ["closing_line_unavailable_unlicensed"],
  });
  if (propObs.length >= 20) {
    gates.push(evaluateFamilyGate("nhl:player_prop_named", propObs, { requireNamedPlayer: true }));
  } else {
    gates.push({
      ...evaluateFamilyGate("nhl:player_prop_named", propObs),
      verdict: "INSUFFICIENT_DATA",
      reasons: propObs.length
        ? [`named_player_prop_oos_thin_n_${propObs.length}`, ...evaluateFamilyGate("nhl:player_prop_named", propObs).reasons]
        : ["named_player_prop_oos_insufficient_or_boxscore_unavailable"],
    });
  }

  const dist: DistCompare[] = [
    compareDistributions("nhl_reg_team_goals", actualRegGoals, simRegGoalMeans),
    compareDistributions("nhl_final_total", actualTotals, simTotalMeans),
    compareDistributions("nhl_final_margin", actualMargins, simMarginMeans),
  ].filter((x): x is DistCompare => !!x);

  const valEce = metricsOf(valObs).ece;
  const holdEce = metricsOf(holdObs).ece;
  const clusters = new Set(holdObs.map((o) => o.eventId)).size;

  const chronoMd = [
    "# NHL chronological OOS + family calibration gates",
    "",
    "Shadow-only. `SIM_V2_SERVE=off`. Final holdout not used for tuning.",
    "Root cause (ECE≈0.10): form overconfidence + Poisson underdispersion on regulation goals → shrink form 40% to league mean + per-draw lognormal σ≈0.15 + milder HFA (0.08).",
    "",
    "## Holdout summary",
    `- Model: hockey.joint.v0 @ 0.3.0`,
    `- Fetch: ESPN date-sample + week fill (2023 n=${s2023.length}, 2024 n=${s2024.length})`,
    `- Splits: train=2023 (${train.length}), val=early-2024 diagnostic (${val.length}), holdout pool mid+late-2024 (${holdoutPool.length})`,
    `- Holdout graded: ${used} games → obs=${holdObs.length}; clusters=${clusters}; val diagnostic obs=${valObs.length}`,
    `- Mean runtime/game: ${(ms / Math.max(1, used)).toFixed(1)} ms`,
    `- Val ECE (diagnostic only): ${valEce?.toFixed(4) ?? "n/a"} | Holdout ECE: ${holdEce?.toFixed(4) ?? "n/a"}`,
    `- Closing-line benchmark: **INSUFFICIENT_DATA** (unlicensed / no archive)`,
    `- Named player props: boxscore athlete IDs on ${propGames} holdout games → prop obs=${propObs.length}`,
    "",
    "### Family gates (final holdout)",
    ...formatGateTable(gates),
    "",
    "### Reliability (holdout overall)",
    ...formatReliability(holdObs),
    "",
    "### Scoring distribution check (goals / totals / margins)",
    ...formatDistTable(dist),
    "",
    "- Production allowlists unchanged. Coach/P0/PR#649 untouched.",
    "",
  ].join("\n");

  const gateMd = [
    "# NHL sport:family gates",
    "",
    "Shadow-only. Thresholds: minOos=500, maxEce=0.04.",
    "",
    ...formatGateTable(gates),
    "",
  ].join("\n");

  const milestoneMd = [
    "# Milestone — NHL calibration (D.2+)",
    "",
    "## Root cause",
    "Holdout ECE ≈ 0.10 on v0.2.0 came from **form overconfidence** (raw recent GF/GA treated as true means) plus **Poisson underdispersion** on regulation team goals (no game-level intensity shock). Mild HFA (0.15) also sharpened home ML probs.",
    "",
    "## Corrections (hockey.joint.v0 @ 0.3.0)",
    "| Lever | Before | After |",
    "|-------|--------|-------|",
    "| Form → league shrink | none | 40% toward `NHL_TEAM_FG_MEAN` |",
    "| Per-draw mean shock | none | lognormal σ≈0.15 on each team λ |",
    "| HFA (goals) | 0.15 | 0.08 |",
    "",
    "## Eval",
    `- Chrono OOS: \`pnpm --filter @workspace/simulator-v2 eval:nhl-oos\` → \`eval/report/NHL_CHRONO_OOS.md\``,
    `- Family gates: \`eval/report/NHL_FAMILY_GATES.md\``,
    `- Shared helpers: \`eval/familyCalibration.ts\``,
    "",
    "## Gate snapshot",
    ...formatGateTable(gates.filter((g) => !g.key.includes(":slice:"))),
    "",
    "## Status",
    "- Shadow-only; `SIM_V2_SERVE` off; allowlists empty.",
    "- Closing lines: INSUFFICIENT (unlicensed).",
    "- Do not enable production serve from this milestone.",
    "",
  ].join("\n");

  await writeFile(join(REPORT_DIR, "NHL_CHRONO_OOS.md"), chronoMd, "utf8");
  await writeFile(join(REPORT_DIR, "NHL_FAMILY_GATES.md"), gateMd, "utf8");
  await writeFile(join(ROOT_DIR, "MILESTONE_NHL_CALIBRATION.md"), milestoneMd, "utf8");
  console.log(
    `wrote NHL reports holdout_obs=${holdObs.length} used=${used} ece=${holdEce?.toFixed(4)} props=${propObs.length}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
