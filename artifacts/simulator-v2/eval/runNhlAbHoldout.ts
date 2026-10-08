/**
 * Independent OOS A/B: hockey.joint v0.2.0 vs v0.3.0 on identical chrono holdout.
 * Shadow-only. No serve / allowlists / Coach / P0 / merge / OTA.
 * Freeze: train=2023, val=early-2024 diagnostic, holdout=mid+late-2024 (capped).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildJointHockeyTensor,
  nhlFinalAwaySeries,
  nhlFinalHomeSeries,
  resolveHockeyCalibration,
  type HockeyCalibrationProfile,
} from "../src/models/hockey/jointHockey.js";
import {
  buildHockeyMlMarket,
  buildHockeyPlayerPropMarket,
  buildHockeySpreadMarket,
  buildHockeyTeamTotalMarket,
  buildHockeyTotalMarket,
} from "../src/models/hockey/markets.js";
import { settleMarket } from "../src/engine/settle.js";
import { impliedProbFromAmerican } from "../src/schemas/odds.js";
import { SIM_V2_ACCEPTANCE_THRESHOLDS } from "../src/flags/acceptanceGates.js";
import {
  type CalibObs,
  type DistCompare,
  type FamilyGateRow,
  compareDistributions,
  evaluateFamilyGate,
  formatDistTable,
  formatGateTable,
  formatReliability,
  meanAbsDevFromHalf,
} from "./familyCalibration.js";
import { boxStatIndices } from "./nhlEspnShared.js";

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

type BoxPlayer = {
  athleteId: string;
  teamSide: "home" | "away";
  goals: number;
  sog: number;
  saves: number;
  isGoalie: boolean;
};

type ProfileBundle = {
  profile: HockeyCalibrationProfile;
  version: string;
  obs: CalibObs[];
  propObs: CalibObs[];
  actualRegGoals: number[];
  simRegGoalMeans: number[];
  actualTotals: number[];
  simTotalMeans: number[];
  actualMargins: number[];
  simMarginMeans: number[];
  /** Per-draw team goal samples for variance (pooled across holdout games). */
  simRegGoalDrawVars: number[];
  gameRuntimesMs: number[];
  used: number;
  propGames: number;
  rejectedUnverifiedProps: number;
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
    const r = await fetch(url, { headers: { "User-Agent": "stadium-sim-v2-nhl-ab" } });
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
  for (const dates of nhlSampleDays(season)) {
    const url = `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=${dates}`;
    await parseScoreboard(url, season, games);
    await new Promise((r) => setTimeout(r, 35));
  }
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
    const r = await fetch(url, { headers: { "User-Agent": "stadium-sim-v2-nhl-ab" } });
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
        // shotsTotal is ESPN's skater SOG column — bare sog|shots regex misses it.
        const idx = boxStatIndices(keys);
        for (const a of grp.athletes ?? []) {
          const id = a.athlete?.id;
          // Named props require verified athlete IDs — reject unverified identity.
          if (!id || typeof id !== "string" || !id.trim() || !a.stats?.length) continue;
          const goals = idx.goals >= 0 ? Number(a.stats[idx.goals] ?? 0) : 0;
          const sog = idx.sog >= 0 ? Number(a.stats[idx.sog] ?? 0) : 0;
          const saves = idx.saves >= 0 ? Number(a.stats[idx.saves] ?? 0) : 0;
          if (!Number.isFinite(goals) && !Number.isFinite(sog) && !Number.isFinite(saves)) continue;
          out.push({
            athleteId: id.trim(),
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

function percentile(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))));
  return s[i]!;
}

function sampleVariance(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
}

function emptyBundle(profile: HockeyCalibrationProfile): ProfileBundle {
  const calib = resolveHockeyCalibration(profile);
  return {
    profile,
    version: calib.modelVersion,
    obs: [],
    propObs: [],
    actualRegGoals: [],
    simRegGoalMeans: [],
    actualTotals: [],
    simTotalMeans: [],
    actualMargins: [],
    simMarginMeans: [],
    simRegGoalDrawVars: [],
    gameRuntimesMs: [],
    used: 0,
    propGames: 0,
    rejectedUnverifiedProps: 0,
  };
}

type AbFamilyKey =
  | "ml_final"
  | "ml_regulation"
  | "spread"
  | "total_final"
  | "total_regulation"
  | "team_total"
  | "alt_all"
  | "alt_spread"
  | "alt_total"
  | "alt_player_prop"
  | "player_prop_named"
  | "main_all";

function familyRows(bundle: ProfileBundle, key: AbFamilyKey): CalibObs[] {
  const all = [...bundle.obs, ...bundle.propObs];
  switch (key) {
    case "ml_final":
      return bundle.obs.filter((o) => o.slice === "ml_home_final");
    case "ml_regulation":
      return bundle.obs.filter((o) => o.slice === "ml_home_regulation");
    case "spread":
      return bundle.obs.filter((o) => o.family === "spread" && !o.isAlt);
    case "total_final":
      return bundle.obs.filter((o) => o.slice === "total_final_5.5");
    case "total_regulation":
      return bundle.obs.filter((o) => o.slice === "total_regulation_5.5");
    case "team_total":
      return bundle.obs.filter((o) => o.family === "team_total" && !o.isAlt);
    case "alt_all":
      return all.filter((o) => o.isAlt);
    case "alt_spread":
      return bundle.obs.filter((o) => o.family === "spread" && o.isAlt);
    case "alt_total":
      return bundle.obs.filter((o) => o.family === "total" && o.isAlt);
    case "alt_player_prop":
      return bundle.propObs.filter((o) => o.isAlt);
    case "player_prop_named":
      return bundle.propObs.filter((o) => o.namedPlayer && !!o.playerId);
    case "main_all":
      return all.filter((o) => !o.isAlt);
    default:
      return [];
  }
}

type ExtendedGate = FamilyGateRow & {
  meanAbsDevFromHalf: number | null;
};

function evaluateAbGate(key: string, rows: CalibObs[], opts?: { requireNamedPlayer?: boolean }): ExtendedGate {
  const base = evaluateFamilyGate(key, rows, opts);
  return { ...base, meanAbsDevFromHalf: meanAbsDevFromHalf(rows) };
}

/** Flag shrink-to-50: ECE↓ but sharpness collapses without variance improvement. */
function detectShrinkTo50(
  before: ExtendedGate,
  after: ExtendedGate,
  beforeVarRatio: number | null,
  afterVarRatio: number | null,
): { flagged: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (before.ece == null || after.ece == null || before.meanAbsDevFromHalf == null || after.meanAbsDevFromHalf == null) {
    return { flagged: false, reasons: ["insufficient_metrics"] };
  }
  const eceDown = after.ece < before.ece - 1e-6;
  const madBefore = before.meanAbsDevFromHalf;
  const madAfter = after.meanAbsDevFromHalf;
  const madCollapse = madBefore > 1e-6 && madAfter / madBefore < 0.65;
  let varianceImproved = false;
  if (beforeVarRatio != null && afterVarRatio != null && Number.isFinite(beforeVarRatio) && Number.isFinite(afterVarRatio)) {
    const beforeDist = Math.abs(Math.log(Math.max(beforeVarRatio, 1e-9)));
    const afterDist = Math.abs(Math.log(Math.max(afterVarRatio, 1e-9)));
    varianceImproved = afterDist + 0.05 < beforeDist;
  }
  if (eceDown && madCollapse && !varianceImproved) {
    reasons.push(
      `shrink_to_50:ece_${before.ece.toFixed(4)}_to_${after.ece.toFixed(4)}_mad_${madBefore.toFixed(4)}_to_${madAfter.toFixed(4)}_no_var_improve`,
    );
  }
  return { flagged: reasons.length > 0, reasons };
}

function gradeGame(
  g: NhlGame,
  all: NhlGame[],
  box: BoxPlayer[],
  profile: HockeyCalibrationProfile,
  bundle: ProfileBundle,
): void {
  const t = new Date(g.kickoffIso).getTime();
  const home = form(g.homeId, t, all);
  const away = form(g.awayId, t, all);
  if (!home || !away) return;

  const t0 = performance.now();
  let players: Array<{
    playerId: string;
    teamSide: "home" | "away";
    usage: number;
    isGoalie?: boolean;
  }> = [];

  if (box.length) {
    const skaters = box.filter((p) => !p.isGoalie && !!p.athleteId).slice(0, 4);
    const goalies = box.filter((p) => p.isGoalie && !!p.athleteId).slice(0, 2);
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
    if (players.length) bundle.propGames += 1;
  }

  const tensor = buildJointHockeyTensor({
    sport: "nhl",
    eventId: g.eventId,
    seed: `nhl-ab:${profile}:${g.eventId}`,
    nDraws: 2000,
    home,
    away,
    players,
    calibrationProfile: profile,
  });

  let simRegH = 0;
  let simRegA = 0;
  let simFinH = 0;
  let simFinA = 0;
  const finH = nhlFinalHomeSeries(tensor);
  const finA = nhlFinalAwaySeries(tensor);
  const homeDraws: number[] = [];
  const awayDraws: number[] = [];
  for (let i = 0; i < tensor.meta.nDraws; i++) {
    const hr = tensor.team.homeFg[i]!;
    const ar = tensor.team.awayFg[i]!;
    homeDraws.push(hr);
    awayDraws.push(ar);
    simRegH += hr;
    simRegA += ar;
    simFinH += finH[i]!;
    simFinA += finA[i]!;
  }
  const nD = tensor.meta.nDraws;
  simRegH /= nD;
  simRegA /= nD;
  simFinH /= nD;
  simFinA /= nD;

  bundle.used += 1;
  bundle.actualRegGoals.push(g.homeReg, g.awayReg);
  bundle.simRegGoalMeans.push(simRegH, simRegA);
  bundle.actualTotals.push(g.homeFinal + g.awayFinal);
  bundle.simTotalMeans.push(simFinH + simFinA);
  bundle.actualMargins.push(g.homeFinal - g.awayFinal);
  bundle.simMarginMeans.push(simFinH - simFinA);
  const hv = sampleVariance(homeDraws);
  const av = sampleVariance(awayDraws);
  if (hv != null) bundle.simRegGoalDrawVars.push(hv);
  if (av != null) bundle.simRegGoalDrawVars.push(av);

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
      bundle.obs.push({
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

  if (box.length && players.length) {
    for (const bp of box) {
      if (!bp.athleteId) {
        bundle.rejectedUnverifiedProps += 1;
        continue;
      }
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
          bundle.propObs.push({
            y: s.y,
            p: r.simHit,
            eventId: g.eventId,
            family: "player_prop",
            slice: s.slice,
            fold: "holdout",
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

  bundle.gameRuntimesMs.push(performance.now() - t0);
}

function buildGates(bundle: ProfileBundle): ExtendedGate[] {
  const keys: AbFamilyKey[] = [
    "ml_final",
    "ml_regulation",
    "spread",
    "total_final",
    "total_regulation",
    "team_total",
    "alt_spread",
    "alt_total",
    "alt_player_prop",
    "alt_all",
    "main_all",
    "player_prop_named",
  ];
  const gates: ExtendedGate[] = [];
  for (const k of keys) {
    const rows = familyRows(bundle, k);
    if (k === "player_prop_named") {
      if (rows.length >= 20) {
        gates.push(evaluateAbGate(`nhl:${k}`, rows, { requireNamedPlayer: true }));
      } else {
        const g = evaluateAbGate(`nhl:${k}`, rows, { requireNamedPlayer: true });
        gates.push({
          ...g,
          verdict: "INSUFFICIENT_DATA",
          reasons: rows.length
            ? [`named_player_prop_oos_thin_n_${rows.length}`, ...g.reasons]
            : ["named_player_prop_oos_insufficient_or_boxscore_unavailable"],
        });
      }
    } else {
      gates.push(evaluateAbGate(`nhl:${k}`, rows));
    }
  }
  return gates;
}

function formatAbCompareTable(
  beforeGates: ExtendedGate[],
  afterGates: ExtendedGate[],
): string[] {
  const lines = [
    `| Family | v0.2 ECE | v0.3 ECE | ΔECE | v0.2 Brier | v0.3 Brier | v0.2 mad½ | v0.3 mad½ | v0.2 n | v0.3 n | v0.2 verdict | v0.3 verdict |`,
    `|--------|----------|----------|------|------------|------------|-----------|-----------|--------|--------|--------------|--------------|`,
  ];
  const byKey = new Map(afterGates.map((g) => [g.key, g]));
  for (const b of beforeGates) {
    const a = byKey.get(b.key);
    if (!a) continue;
    const dEce =
      b.ece != null && a.ece != null ? (a.ece - b.ece).toFixed(4) : "n/a";
    lines.push(
      `| ${b.key} | ${b.ece?.toFixed(4) ?? "n/a"} | ${a.ece?.toFixed(4) ?? "n/a"} | ${dEce} | ${b.brier?.toFixed(4) ?? "n/a"} | ${a.brier?.toFixed(4) ?? "n/a"} | ${b.meanAbsDevFromHalf?.toFixed(4) ?? "n/a"} | ${a.meanAbsDevFromHalf?.toFixed(4) ?? "n/a"} | ${b.n} | ${a.n} | **${b.verdict}** | **${a.verdict}** |`,
    );
  }
  return lines;
}

function formatExtendedGateTable(rows: ExtendedGate[]): string[] {
  const lines = [
    `| Family | Verdict | n | games | effN | Brier | LogLoss | ECE | ECE_SE | mad½ | bias | overconf90 | reasons |`,
    `|--------|---------|---|-------|------|-------|---------|-----|--------|------|------|------------|---------|`,
  ];
  for (const r of rows) {
    const o90 =
      r.overconf90.hitRate != null
        ? `${r.overconf90.hitRate.toFixed(3)}(n=${r.overconf90.n})`
        : `n/a(n=${r.overconf90.n})`;
    lines.push(
      `| ${r.key} | **${r.verdict}** | ${r.n} | ${r.nGames} | ${r.effectiveN.toFixed(1)} | ${r.brier?.toFixed(4) ?? "n/a"} | ${r.logLoss?.toFixed(4) ?? "n/a"} | ${r.ece?.toFixed(4) ?? "n/a"} | ${r.eceSe?.toFixed(4) ?? "n/a"} | ${r.meanAbsDevFromHalf?.toFixed(4) ?? "n/a"} | ${r.bias.toFixed(3)} | ${o90} | ${r.reasons.join("; ") || "—"} |`,
    );
  }
  return lines;
}

async function main() {
  await mkdir(REPORT_DIR, { recursive: true });
  console.log("nhl-ab fetch 2023…");
  const s2023 = await fetchSeason(2023);
  console.log(`nhl-ab fetch 2024… (2023 n=${s2023.length})`);
  const s2024 = await fetchSeason(2024);
  const all = [...s2023, ...s2024].sort(
    (a, b) => new Date(a.kickoffIso).getTime() - new Date(b.kickoffIso).getTime(),
  );

  // Identical freeze to runNhlChronoOos: train=2023, val=early-2024, holdout mid+late-2024.
  const y2024 = chronoSplit(s2024);
  const holdoutPool = [...y2024.val, ...y2024.holdout];
  const holdout = holdoutPool.slice(0, 320);

  const freeze = {
    protocol: "nhl_ab_chrono_holdout_v1",
    modelId: "hockey.joint.v0",
    profiles: ["v0.2", "v0.3"] as const,
    seasons: { train: 2023, holdout: 2024 },
    splits: {
      trainGames: s2023.length,
      valEarly2024: y2024.train.length,
      holdoutPool: holdoutPool.length,
      holdoutGradedCap: 320,
      holdoutEventIds: holdout.map((g) => g.eventId),
    },
    gates: {
      maxEce: SIM_V2_ACCEPTANCE_THRESHOLDS.maxEce,
      minOos: SIM_V2_ACCEPTANCE_THRESHOLDS.minOosSample,
    },
    shadowOnly: true,
  };
  await writeFile(join(REPORT_DIR, "nhl_ab_holdout_freeze.json"), JSON.stringify(freeze, null, 2), "utf8");

  // Prefetch boxscores once for the first 60 form-ready games (shared across profiles).
  const boxes = new Map<string, BoxPlayer[]>();
  let formReady = 0;
  for (const g of holdout) {
    const t = new Date(g.kickoffIso).getTime();
    if (!form(g.homeId, t, all) || !form(g.awayId, t, all)) continue;
    formReady += 1;
    if (formReady <= 60) {
      const box = await fetchBoxPlayers(g.eventId);
      boxes.set(g.eventId, box);
      await new Promise((r) => setTimeout(r, 40));
    }
  }

  const v02 = emptyBundle("v0.2");
  const v03 = emptyBundle("v0.3");

  console.log(`nhl-ab grade holdout n=${holdout.length} (identical games × 2 profiles)`);
  for (const g of holdout) {
    const box = boxes.get(g.eventId) ?? [];
    gradeGame(g, all, box, "v0.2", v02);
    gradeGame(g, all, box, "v0.3", v03);
  }

  const gates02 = buildGates(v02);
  const gates03 = buildGates(v03);

  const dist02: DistCompare[] = [
    compareDistributions("nhl_reg_team_goals", v02.actualRegGoals, v02.simRegGoalMeans),
    compareDistributions("nhl_final_total", v02.actualTotals, v02.simTotalMeans),
    compareDistributions("nhl_final_margin", v02.actualMargins, v02.simMarginMeans),
  ].filter((x): x is DistCompare => !!x);
  const dist03: DistCompare[] = [
    compareDistributions("nhl_reg_team_goals", v03.actualRegGoals, v03.simRegGoalMeans),
    compareDistributions("nhl_final_total", v03.actualTotals, v03.simTotalMeans),
    compareDistributions("nhl_final_margin", v03.actualMargins, v03.simMarginMeans),
  ].filter((x): x is DistCompare => !!x);

  const actualRegVar = sampleVariance(v02.actualRegGoals);
  const meanSimDrawVar02 =
    v02.simRegGoalDrawVars.length > 0
      ? v02.simRegGoalDrawVars.reduce((a, b) => a + b, 0) / v02.simRegGoalDrawVars.length
      : null;
  const meanSimDrawVar03 =
    v03.simRegGoalDrawVars.length > 0
      ? v03.simRegGoalDrawVars.reduce((a, b) => a + b, 0) / v03.simRegGoalDrawVars.length
      : null;
  const varRatio02 =
    actualRegVar != null && actualRegVar > 1e-9 && meanSimDrawVar02 != null
      ? meanSimDrawVar02 / actualRegVar
      : null;
  const varRatio03 =
    actualRegVar != null && actualRegVar > 1e-9 && meanSimDrawVar03 != null
      ? meanSimDrawVar03 / actualRegVar
      : null;

  const main02 = gates02.find((g) => g.key === "nhl:main_all")!;
  const main03 = gates03.find((g) => g.key === "nhl:main_all")!;
  const shrink = detectShrinkTo50(main02, main03, varRatio02, varRatio03);

  const rt02 = {
    mean: v02.gameRuntimesMs.length
      ? v02.gameRuntimesMs.reduce((a, b) => a + b, 0) / v02.gameRuntimesMs.length
      : null,
    p90: percentile(v02.gameRuntimesMs, 0.9),
    p95: percentile(v02.gameRuntimesMs, 0.95),
  };
  const rt03 = {
    mean: v03.gameRuntimesMs.length
      ? v03.gameRuntimesMs.reduce((a, b) => a + b, 0) / v03.gameRuntimesMs.length
      : null,
    p90: percentile(v03.gameRuntimesMs, 0.9),
    p95: percentile(v03.gameRuntimesMs, 0.95),
  };

  const overallVerdict = (gates: ExtendedGate[]): "PASS" | "FAIL" | "INSUFFICIENT_DATA" => {
    const scored = gates.filter((g) => g.key !== "nhl:player_prop_named" || g.n >= 20);
    if (!scored.length) return "INSUFFICIENT_DATA";
    if (scored.every((g) => g.verdict === "PASS")) return "PASS";
    if (scored.some((g) => g.verdict === "FAIL")) return "FAIL";
    return "INSUFFICIENT_DATA";
  };

  const verdict02 = overallVerdict(gates02);
  const verdict03 = overallVerdict(gates03);

  const holdMd = [
    "# NHL A/B holdout — hockey.joint v0.2.0 vs v0.3.0",
    "",
    "Shadow-only independent OOS A/B on **identical chrono holdout**. No serve/allowlists/Coach/P0/merge/OTA.",
    "",
    "## Freeze",
    `- Protocol: \`${freeze.protocol}\``,
    `- Train: 2023 (n=${s2023.length}); val diagnostic early-2024 (n=${y2024.train.length})`,
    `- Holdout pool mid+late-2024 (n=${holdoutPool.length}); graded cap ${holdout.length} eventIds`,
    `- Freeze manifest: \`eval/report/nhl_ab_holdout_freeze.json\``,
    `- Games graded: v0.2=${v02.used}, v0.3=${v03.used} (must match)`,
    `- Gates unchanged: maxEce=${SIM_V2_ACCEPTANCE_THRESHOLDS.maxEce}, minOos=${SIM_V2_ACCEPTANCE_THRESHOLDS.minOosSample}`,
    "",
    "## Profiles",
    "| Profile | Version | shrink | shock σ | HFA |",
    "|---------|---------|--------|---------|-----|",
    "| v0.2 | 0.2.0 | 0 | 0 | 0.15 |",
    "| v0.3 | 0.3.0 | 0.4 | 0.15 | 0.08 |",
    "",
    "## Before / after (primary families)",
    ...formatAbCompareTable(gates02, gates03),
    "",
    "## Shrink-to-50 check (main_all)",
    shrink.flagged
      ? `- **FLAGGED**: ${shrink.reasons.join("; ")}`
      : `- Not flagged. ${shrink.reasons.join("; ") || "ECE/mad½/variance pattern OK or inconclusive."}`,
    `- meanAbsDevFromHalf: v0.2=${main02.meanAbsDevFromHalf?.toFixed(4) ?? "n/a"} → v0.3=${main03.meanAbsDevFromHalf?.toFixed(4) ?? "n/a"}`,
    `- ECE: v0.2=${main02.ece?.toFixed(4) ?? "n/a"} → v0.3=${main03.ece?.toFixed(4) ?? "n/a"}`,
    "",
    "## Scoring variance (sim draw var vs actual reg team goals)",
    `| Profile | actualVar | meanSimDrawVar | varRatio |`,
    `|---------|-----------|----------------|----------|`,
    `| v0.2 | ${actualRegVar?.toFixed(3) ?? "n/a"} | ${meanSimDrawVar02?.toFixed(3) ?? "n/a"} | ${varRatio02?.toFixed(3) ?? "n/a"} |`,
    `| v0.3 | ${actualRegVar?.toFixed(3) ?? "n/a"} | ${meanSimDrawVar03?.toFixed(3) ?? "n/a"} | ${varRatio03?.toFixed(3) ?? "n/a"} |`,
    "",
    "### Distribution check v0.2",
    ...formatDistTable(dist02),
    "",
    "### Distribution check v0.3",
    ...formatDistTable(dist03),
    "",
    "## Runtime (ms / game)",
    `| Profile | mean | p90 | p95 |`,
    `|---------|------|-----|-----|`,
    `| v0.2 | ${rt02.mean?.toFixed(1) ?? "n/a"} | ${rt02.p90?.toFixed(1) ?? "n/a"} | ${rt02.p95?.toFixed(1) ?? "n/a"} |`,
    `| v0.3 | ${rt03.mean?.toFixed(1) ?? "n/a"} | ${rt03.p90?.toFixed(1) ?? "n/a"} | ${rt03.p95?.toFixed(1) ?? "n/a"} |`,
    "",
    "## Named player props",
    `- Verified athlete IDs only; unverified identity rejected.`,
    `- v0.2 prop games=${v02.propGames} obs=${v02.propObs.length} rejected=${v02.rejectedUnverifiedProps}`,
    `- v0.3 prop games=${v03.propGames} obs=${v03.propObs.length} rejected=${v03.rejectedUnverifiedProps}`,
    "",
    "## Reliability (v0.3 main_all holdout)",
    ...formatReliability(familyRows(v03, "main_all")),
    "",
    "## Overall verdicts",
    `- v0.2: **${verdict02}**`,
    `- v0.3: **${verdict03}**`,
    "",
    "- Production allowlists unchanged. Coach/P0/PR#649 untouched.",
    "",
  ].join("\n");

  const gateMd = [
    "# NHL A/B family gates — v0.2 vs v0.3",
    "",
    `Shadow-only. Thresholds: minOos=${SIM_V2_ACCEPTANCE_THRESHOLDS.minOosSample}, maxEce=${SIM_V2_ACCEPTANCE_THRESHOLDS.maxEce}.`,
    "",
    "## v0.2.0 gates",
    ...formatExtendedGateTable(gates02),
    "",
    "## v0.3.0 gates",
    ...formatExtendedGateTable(gates03),
    "",
    "## Compact gate table (shared formatter)",
    "### v0.2",
    ...formatGateTable(gates02),
    "",
    "### v0.3",
    ...formatGateTable(gates03),
    "",
    `## Overall: v0.2=**${verdict02}** | v0.3=**${verdict03}** | shrink_to_50=${shrink.flagged ? "FLAGGED" : "ok"}`,
    "",
  ].join("\n");

  const summary = {
    freeze: {
      holdoutEvents: holdout.length,
      graded02: v02.used,
      graded03: v03.used,
    },
    verdicts: { v02: verdict02, v03: verdict03 },
    shrinkTo50: shrink,
    variance: {
      actualRegVar,
      meanSimDrawVar02,
      meanSimDrawVar03,
      varRatio02,
      varRatio03,
    },
    runtimeMs: { v02: rt02, v03: rt03 },
    mainAll: {
      v02: {
        ece: main02.ece,
        brier: main02.brier,
        logLoss: main02.logLoss,
        n: main02.n,
        games: main02.nGames,
        effN: main02.effectiveN,
        eceSe: main02.eceSe,
        meanAbsDevFromHalf: main02.meanAbsDevFromHalf,
        overconf90: main02.overconf90,
        overconf95: main02.overconf95,
        verdict: main02.verdict,
      },
      v03: {
        ece: main03.ece,
        brier: main03.brier,
        logLoss: main03.logLoss,
        n: main03.n,
        games: main03.nGames,
        effN: main03.effectiveN,
        eceSe: main03.eceSe,
        meanAbsDevFromHalf: main03.meanAbsDevFromHalf,
        overconf90: main03.overconf90,
        overconf95: main03.overconf95,
        verdict: main03.verdict,
      },
    },
    gates02,
    gates03,
  };

  await writeFile(join(REPORT_DIR, "NHL_AB_HOLDOUT.md"), holdMd, "utf8");
  await writeFile(join(REPORT_DIR, "NHL_AB_GATES.md"), gateMd, "utf8");
  await writeFile(join(REPORT_DIR, "nhl_ab_summary.json"), JSON.stringify(summary, null, 2), "utf8");

  console.log(
    JSON.stringify(
      {
        wrote: ["NHL_AB_HOLDOUT.md", "NHL_AB_GATES.md", "nhl_ab_summary.json"],
        graded: { v02: v02.used, v03: v03.used },
        verdicts: { v02: verdict02, v03: verdict03 },
        shrinkTo50: shrink.flagged,
        mainEce: { v02: main02.ece, v03: main03.ece },
        mad: { v02: main02.meanAbsDevFromHalf, v03: main03.meanAbsDevFromHalf },
        varRatio: { v02: varRatio02, v03: varRatio03 },
      },
      null,
      2,
    ),
  );

  // Soft assert identical game counts — hard fail if freeze broken.
  if (v02.used !== v03.used) {
    console.error(`holdout_game_count_mismatch v02=${v02.used} v03=${v03.used}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
