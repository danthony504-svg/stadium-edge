/**
 * Independent OOS A/B: baseball.joint v0.2.0 (pre-correction) vs v0.3.0 (corrected).
 * Identical chronological holdout games/markets/odds. Shadow-only.
 * Freeze holdout list once; grade BOTH profiles. No SIM_V2_SERVE / allowlists.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type BaseballCalibrationProfile,
  buildJointBaseballTensor,
} from "../src/models/baseball/jointBaseball.js";
import {
  buildBaseballMlMarket,
  buildBaseballPlayerPropMarket,
  buildBaseballSpreadMarket,
  buildBaseballTeamTotalMarket,
  buildBaseballTotalMarket,
} from "../src/models/baseball/markets.js";
import { settleMarket } from "../src/engine/settle.js";
import { impliedProbFromAmerican } from "../src/schemas/odds.js";
import { SIM_V2_ACCEPTANCE_THRESHOLDS } from "../src/flags/acceptanceGates.js";
import {
  type CalibObs,
  type FamilyGateRow,
  compareDistributions,
  evaluateFamilyGate,
  formatDistTable,
  formatGateTable,
  overconfidenceBand,
} from "./familyCalibration.js";

const REPORT_DIR = join(import.meta.dirname, "report");
const PROFILES: BaseballCalibrationProfile[] = ["v0.2", "v0.3"];
const MIN_OOS = SIM_V2_ACCEPTANCE_THRESHOLDS.minOosSample;
const MAX_ECE = SIM_V2_ACCEPTANCE_THRESHOLDS.maxEce;

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

type AbMetrics = {
  profile: BaseballCalibrationProfile;
  family: string;
  n: number;
  games: number;
  effN: number;
  brier: number | null;
  logLoss: number | null;
  ece: number | null;
  eceSe: number | null;
  meanP: number;
  meanY: number;
  meanAbsDevFromHalf: number;
  overconf80: { n: number; hitRate: number | null };
  overconf90: { n: number; hitRate: number | null };
  overconf95: { n: number; hitRate: number | null };
  p95RuntimeMs: number | null;
  verdict: FamilyGateRow["verdict"];
  reasons: string[];
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
      const r = await fetch(url, { headers: { "User-Agent": "stadium-sim-v2-mlb-ab" } });
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
    const r = await fetch(url, { headers: { "User-Agent": "stadium-sim-v2-mlb-ab" } });
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
            // Require ESPN athlete id — reject missing identity.
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
            if (order >= 5) break;
          }
        }
        if (grp.type === "pitching") {
          const ki = idxOf(keys, "strikeouts");
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

function meanAbsDevFromHalf(rows: CalibObs[]): number {
  if (!rows.length) return 0;
  return rows.reduce((s, r) => s + Math.abs(r.p - 0.5), 0) / rows.length;
}

function p95(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil(0.95 * s.length) - 1));
  return s[i]!;
}

function familyRows(obs: CalibObs[], family: string): CalibObs[] {
  if (family === "main_all") return obs.filter((o) => !o.isAlt && o.family !== "player_prop");
  if (family === "alt_all") return obs.filter((o) => !!o.isAlt && o.family !== "player_prop");
  if (family === "player_prop_named") {
    return obs.filter((o) => o.family === "player_prop" && o.namedPlayer === true);
  }
  return obs.filter((o) => o.family === family);
}

function abMetricsFor(
  profile: BaseballCalibrationProfile,
  family: string,
  rows: CalibObs[],
  runtimesMs: number[],
): AbMetrics {
  const gate =
    family === "player_prop_named"
      ? evaluateFamilyGate(`mlb:${family}`, rows, { requireNamedPlayer: true })
      : evaluateFamilyGate(`mlb:${family}`, rows);
  return {
    profile,
    family,
    n: gate.n,
    games: gate.nGames,
    effN: gate.effectiveN,
    brier: gate.brier,
    logLoss: gate.logLoss,
    ece: gate.ece,
    eceSe: gate.eceSe,
    meanP: gate.meanP,
    meanY: gate.meanY,
    meanAbsDevFromHalf: meanAbsDevFromHalf(rows),
    overconf80: overconfidenceBand(rows, 0.8),
    overconf90: overconfidenceBand(rows, 0.9),
    overconf95: overconfidenceBand(rows, 0.95),
    p95RuntimeMs: p95(runtimesMs),
    verdict: gate.verdict,
    reasons: gate.reasons,
  };
}

/** Flag ECE gains driven mainly by collapse of |p-0.5| toward 0.5. */
function shrinkTo50Diagnosis(
  before: AbMetrics,
  after: AbMetrics,
): { flagged: boolean; note: string } {
  const eceBefore = before.ece;
  const eceAfter = after.ece;
  if (eceBefore == null || eceAfter == null) {
    return { flagged: false, note: "insufficient_ece" };
  }
  const deltaEce = eceAfter - eceBefore;
  const madBefore = before.meanAbsDevFromHalf;
  const madAfter = after.meanAbsDevFromHalf;
  const madDrop = madBefore - madAfter;
  const madDropPct = madBefore > 1e-9 ? madDrop / madBefore : 0;
  // ECE improved (ΔECE < 0) primarily via |p-0.5| collapse (≥25% relative drop)
  // while absolute ECE gain is modest relative to the confidence collapse.
  const eceImproved = deltaEce < -0.005;
  const madCollapsed = madDropPct >= 0.25 && madDrop >= 0.02;
  const flagged = eceImproved && madCollapsed;
  const note = flagged
    ? `SHRINK_TO_50_SUSPECT: ΔECE=${deltaEce.toFixed(4)} but meanAbsDevFromHalf ${madBefore.toFixed(4)}→${madAfter.toFixed(4)} (drop ${(madDropPct * 100).toFixed(1)}%) — ECE gain may be from probs collapsing toward 0.5`
    : `ok: ΔECE=${deltaEce.toFixed(4)}, meanAbsDevFromHalf ${madBefore.toFixed(4)}→${madAfter.toFixed(4)} (Δ=${(-madDrop).toFixed(4)}, ${(madDropPct * 100).toFixed(1)}% drop)`;
  return { flagged, note };
}

function fmt(n: number | null | undefined, d = 4): string {
  return n == null || !Number.isFinite(n) ? "n/a" : n.toFixed(d);
}

function delta(a: number | null, b: number | null): string {
  if (a == null || b == null) return "n/a";
  const d = b - a;
  return `${d >= 0 ? "+" : ""}${d.toFixed(4)}`;
}

async function main() {
  await mkdir(REPORT_DIR, { recursive: true });

  console.log("fetching ESPN MLB seasons 2023–2024 (date-sample)…");
  const s2023 = await fetchSeason(2023, 1);
  const s2024 = await fetchSeason(2024, 1);
  const games = Array.from(
    new Map([...s2023, ...s2024].map((g) => [g.eventId, g])).values(),
  ).sort((a, b) => new Date(a.kickoffIso).getTime() - new Date(b.kickoffIso).getTime());

  const folds = chronoFolds(games);
  // Freeze holdout once (same list for both profiles). Cap matches chrono OOS.
  const holdoutFrozen = folds.holdout.slice(0, 560);
  const holdoutIds = holdoutFrozen.map((g) => g.eventId);
  await writeFile(
    join(REPORT_DIR, "MLB_AB_HOLDOUT_GAMES.json"),
    JSON.stringify(
      {
        frozenAt: new Date().toISOString(),
        n: holdoutIds.length,
        eventIds: holdoutIds,
        firstKickoff: holdoutFrozen[0]?.kickoffIso ?? null,
        lastKickoff: holdoutFrozen[holdoutFrozen.length - 1]?.kickoffIso ?? null,
      },
      null,
      2,
    ),
    "utf8",
  );

  type DistBucket = {
    actualTotals: number[];
    simTotalMeans: number[];
    simTotalVars: number[];
    actualMargins: number[];
    simMarginMeans: number[];
    simMarginVars: number[];
  };
  const byProfile: Record<
    BaseballCalibrationProfile,
    {
      obs: CalibObs[];
      propObs: CalibObs[];
      runtimesMs: number[];
      dist: DistBucket;
      used: number;
    }
  > = {
    "v0.2": {
      obs: [],
      propObs: [],
      runtimesMs: [],
      dist: {
        actualTotals: [],
        simTotalMeans: [],
        simTotalVars: [],
        actualMargins: [],
        simMarginMeans: [],
        simMarginVars: [],
      },
      used: 0,
    },
    "v0.3": {
      obs: [],
      propObs: [],
      runtimesMs: [],
      dist: {
        actualTotals: [],
        simTotalMeans: [],
        simTotalVars: [],
        actualMargins: [],
        simMarginMeans: [],
        simMarginVars: [],
      },
      used: 0,
    },
  };

  const holdForms: Array<{
    g: Game;
    home: NonNullable<ReturnType<typeof form>>;
    away: NonNullable<ReturnType<typeof form>>;
  }> = [];

  function gradeTeam(
    g: Game,
    home: NonNullable<ReturnType<typeof form>>,
    away: NonNullable<ReturnType<typeof form>>,
    profile: BaseballCalibrationProfile,
  ) {
    const sink = byProfile[profile];
    const t0 = performance.now();
    const tensor = buildJointBaseballTensor({
      sport: "mlb",
      eventId: g.eventId,
      seed: `mlb-ab:${g.eventId}`,
      nDraws: 2000,
      home,
      away,
      calibrationProfile: profile,
    });
    const ms = performance.now() - t0;
    sink.runtimesMs.push(ms);
    sink.used += 1;

    let simTot = 0;
    let simMar = 0;
    let totSq = 0;
    let marSq = 0;
    for (let i = 0; i < tensor.meta.nDraws; i++) {
      const tot = tensor.team.homeFg[i]! + tensor.team.awayFg[i]!;
      const mar = tensor.team.homeFg[i]! - tensor.team.awayFg[i]!;
      simTot += tot;
      simMar += mar;
      totSq += tot * tot;
      marSq += mar * mar;
    }
    const n = tensor.meta.nDraws;
    simTot /= n;
    simMar /= n;
    const totVar = totSq / n - simTot * simTot;
    const marVar = marSq / n - simMar * simMar;
    sink.dist.actualTotals.push(g.homeFg + g.awayFg);
    sink.dist.simTotalMeans.push(simTot);
    sink.dist.simTotalVars.push(totVar);
    sink.dist.actualMargins.push(g.homeFg - g.awayFg);
    sink.dist.simMarginMeans.push(simMar);
    sink.dist.simMarginVars.push(marVar);

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
        sink.obs.push({
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

  console.log(`frozen holdout n=${holdoutFrozen.length}; grading v0.2 + v0.3…`);
  for (const g of holdoutFrozen) {
    const t = new Date(g.kickoffIso).getTime();
    const home = form(g.homeId, t, games);
    const away = form(g.awayId, t, games);
    if (!home || !away) continue;
    holdForms.push({ g, home, away });
    for (const profile of PROFILES) {
      gradeTeam(g, home, away, profile);
    }
  }

  let propGamesAttempted = 0;
  let propGamesOk = 0;
  let propFetchFail = 0;
  let propRejectedNoId = 0;
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
    // Reject any row lacking ESPN athlete id (already filtered in fetch).
    const named = box.filter((p) => !!p.playerId);
    propRejectedNoId += box.length - named.length;
    if (!named.length) {
      propFetchFail += 1;
      continue;
    }
    propGamesOk += 1;
    const players = named.map((p) => ({
      playerId: p.playerId,
      teamSide: p.teamSide,
      kind: p.kind,
      usage: p.kind === "pitcher" ? 1 : 0.85,
      battingOrder: p.battingOrder ?? null,
      confirmedStarter: p.confirmedStarter,
      oppPitcherKPer9: 8.5,
    }));
    for (const profile of PROFILES) {
      const tensor = buildJointBaseballTensor({
        sport: "mlb",
        eventId: g.eventId,
        seed: `mlb-ab-prop:${g.eventId}`,
        nDraws: 2000,
        home,
        away,
        players,
        calibrationProfile: profile,
      });
      for (const p of named) {
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
            byProfile[profile].propObs.push({
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
  }

  const familyKeys = [
    "ml",
    "spread",
    "total",
    "team_total",
    "f5",
    "main_all",
    "alt_all",
    "player_prop_named",
  ] as const;

  const metricsByProfile: Record<BaseballCalibrationProfile, AbMetrics[]> = {
    "v0.2": [],
    "v0.3": [],
  };
  for (const profile of PROFILES) {
    const allObs = [...byProfile[profile].obs, ...byProfile[profile].propObs];
    for (const f of familyKeys) {
      const rows = familyRows(allObs, f);
      metricsByProfile[profile].push(
        abMetricsFor(profile, f, rows, byProfile[profile].runtimesMs),
      );
    }
  }

  // Closing line: always INSUFFICIENT
  const closingGate = evaluateFamilyGate("mlb:closing_line_benchmark", [], {
    requireRealBook: true,
  });
  closingGate.verdict = "INSUFFICIENT_DATA";
  closingGate.reasons = ["closing_line_unavailable_unlicensed"];

  const abTable: Array<{
    family: string;
    before: AbMetrics;
    after: AbMetrics;
    deltaEce: string;
    deltaBrier: string;
    deltaLogLoss: string;
    shrink: ReturnType<typeof shrinkTo50Diagnosis>;
  }> = [];
  for (const f of familyKeys) {
    const before = metricsByProfile["v0.2"].find((m) => m.family === f)!;
    const after = metricsByProfile["v0.3"].find((m) => m.family === f)!;
    abTable.push({
      family: f,
      before,
      after,
      deltaEce: delta(before.ece, after.ece),
      deltaBrier: delta(before.brier, after.brier),
      deltaLogLoss: delta(before.logLoss, after.logLoss),
      shrink: shrinkTo50Diagnosis(before, after),
    });
  }

  const distLines: string[] = [];
  for (const profile of PROFILES) {
    const d = byProfile[profile].dist;
    const tot = compareDistributions(`mlb_total_${profile}`, d.actualTotals, d.simTotalMeans);
    const mar = compareDistributions(`mlb_margin_${profile}`, d.actualMargins, d.simMarginMeans);
    const meanDrawVarTot =
      d.simTotalVars.length > 0
        ? d.simTotalVars.reduce((a, b) => a + b, 0) / d.simTotalVars.length
        : NaN;
    const meanDrawVarMar =
      d.simMarginVars.length > 0
        ? d.simMarginVars.reduce((a, b) => a + b, 0) / d.simMarginVars.length
        : NaN;
    distLines.push(`### ${profile}`);
    distLines.push(
      ...formatDistTable([tot, mar].filter((x): x is NonNullable<typeof x> => !!x)),
    );
    distLines.push(
      `- Mean within-draw sim var (totals): ${fmt(meanDrawVarTot, 2)}; (margins): ${fmt(meanDrawVarMar, 2)}`,
    );
    distLines.push("");
  }

  const shrinkFlags = abTable.filter((r) => r.shrink.flagged);
  const gatesV02 = metricsByProfile["v0.2"].map((m) => ({
    key: `mlb:${m.family}:v0.2`,
    verdict: m.verdict,
    n: m.n,
    nGames: m.games,
    nPlayers: 0,
    effectiveN: m.effN,
    brier: m.brier,
    logLoss: m.logLoss,
    ece: m.ece,
    eceSe: m.eceSe,
    meanP: m.meanP,
    meanY: m.meanY,
    bias: m.meanP - m.meanY,
    reasons: m.reasons,
    overconf80: m.overconf80,
    overconf90: m.overconf90,
    overconf95: m.overconf95,
  })) satisfies FamilyGateRow[];
  const gatesV03 = metricsByProfile["v0.3"].map((m) => ({
    key: `mlb:${m.family}:v0.3`,
    verdict: m.verdict,
    n: m.n,
    nGames: m.games,
    nPlayers: 0,
    effectiveN: m.effN,
    brier: m.brier,
    logLoss: m.logLoss,
    ece: m.ece,
    eceSe: m.eceSe,
    meanP: m.meanP,
    meanY: m.meanY,
    bias: m.meanP - m.meanY,
    reasons: m.reasons,
    overconf80: m.overconf80,
    overconf90: m.overconf90,
    overconf95: m.overconf95,
  })) satisfies FamilyGateRow[];

  const holdMd = [
    "# MLB A/B holdout: baseball.joint v0.2.0 vs v0.3.0",
    "",
    "Shadow-only independent OOS. Identical chronological holdout games/markets/odds (−110 grid).",
    "`SIM_V2_SERVE` off. No allowlist / Coach / P0 changes.",
    "",
    "## Setup",
    "",
    `- Games fetched: ${games.length} (2023=${s2023.length}, 2024=${s2024.length})`,
    `- Chrono split 55/20/25 → train ${folds.train.length} / val ${folds.val.length} / holdout ${folds.holdout.length}`,
    `- **Frozen holdout graded:** ${holdoutFrozen.length} games (ids in \`MLB_AB_HOLDOUT_GAMES.json\`)`,
    `- Graded with form: v0.2 used=${byProfile["v0.2"].used}, v0.3 used=${byProfile["v0.3"].used}`,
    `- Profiles: **v0.2** = no shrink, no lognormal shock, HFA 0.1, version 0.2.0; **v0.3** = shrink 0.4 / σ0.18 / HFA 0.05 / version 0.3.0`,
    `- Thresholds (unchanged): minOos=${MIN_OOS}, maxEce=${MAX_ECE}`,
    `- Closing-line benchmark: **INSUFFICIENT_DATA** (no licensed archive)`,
    `- Named props: ESPN athlete id required; attempted ${propGamesAttempted}, ok ${propGamesOk}, fetch_fail ${propFetchFail}, rejected_no_id ${propRejectedNoId}`,
    `- p95 runtime proxy (team markets/game): v0.2=${fmt(p95(byProfile["v0.2"].runtimesMs), 1)} ms, v0.3=${fmt(p95(byProfile["v0.3"].runtimesMs), 1)} ms`,
    "",
    "## Before/after by family (v0.2 → v0.3)",
    "",
    `| Family | n | games | ECE v0.2 | ECE v0.3 | ΔECE | Brier v0.2 | Brier v0.3 | ΔBrier | LogLoss v0.2 | LogLoss v0.3 | ΔLogLoss | meanAbsDev½ v0.2 | meanAbsDev½ v0.3 | Verdict v0.2 | Verdict v0.3 |`,
    `|--------|---|-------|----------|----------|------|------------|------------|--------|--------------|--------------|----------|------------------|------------------|--------------|--------------|`,
    ...abTable.map((r) => {
      const b = r.before;
      const a = r.after;
      return `| ${r.family} | ${a.n} | ${a.games} | ${fmt(b.ece)} | ${fmt(a.ece)} | ${r.deltaEce} | ${fmt(b.brier)} | ${fmt(a.brier)} | ${r.deltaBrier} | ${fmt(b.logLoss)} | ${fmt(a.logLoss)} | ${r.deltaLogLoss} | ${fmt(b.meanAbsDevFromHalf)} | ${fmt(a.meanAbsDevFromHalf)} | **${b.verdict}** | **${a.verdict}** |`;
    }),
    "",
    "## Extended metrics (per family × profile)",
    "",
    `| Profile | Family | n | games | effN | meanP | meanY | meanAbsDev½ | oc80 n/hit | oc90 n/hit | oc95 n/hit | p95 ms | ECE_SE |`,
    `|---------|--------|---|-------|------|-------|-------|-------------|------------|------------|------------|--------|--------|`,
    ...PROFILES.flatMap((p) =>
      metricsByProfile[p].map((m) => {
        const oc = (o: { n: number; hitRate: number | null }) =>
          `${o.n}/${o.hitRate == null ? "n/a" : o.hitRate.toFixed(3)}`;
        return `| ${p} | ${m.family} | ${m.n} | ${m.games} | ${m.effN.toFixed(1)} | ${fmt(m.meanP)} | ${fmt(m.meanY)} | ${fmt(m.meanAbsDevFromHalf)} | ${oc(m.overconf80)} | ${oc(m.overconf90)} | ${oc(m.overconf95)} | ${fmt(m.p95RuntimeMs, 1)} | ${fmt(m.eceSe)} |`;
      }),
    ),
    "",
    "## Shrink-to-50 diagnosis",
    "",
    "ECE improvements that coincide with large drops in `meanAbsDevFromHalf` (|p−0.5|) are flagged as possible shrink-to-50 artifacts.",
    "",
    ...abTable.map((r) => `- **${r.family}**: ${r.shrink.note}`),
    "",
    shrinkFlags.length
      ? `**Flagged families (${shrinkFlags.length}):** ${shrinkFlags.map((r) => r.family).join(", ")}`
      : "**No family flagged** for shrink-to-50 (ECE gains not primarily from |p−0.5| collapse).",
    "",
    "## Scoring distribution (actual vs sim mean)",
    "",
    ...distLines,
    "## Closing line",
    "",
    ...formatGateTable([closingGate]),
    "",
    "## Gate tables by profile",
    "",
    "### v0.2.0 (pre-correction)",
    ...formatGateTable(gatesV02),
    "",
    "### v0.3.0 (corrected)",
    ...formatGateTable(gatesV03),
    "",
    "- F5⊆FG conserved in both profiles (unit-tested).",
    "- Same seed → different tensors only via profile levers.",
    "",
  ].join("\n");

  const blockers: string[] = [];
  for (const r of abTable) {
    if (r.after.verdict === "FAIL") {
      blockers.push(`${r.family}:v0.3 FAIL — ${r.after.reasons.join("; ") || "ece/sample"}`);
    }
    if (r.after.verdict === "INSUFFICIENT_DATA") {
      blockers.push(
        `${r.family}:v0.3 INSUFFICIENT — ${r.after.reasons.join("; ") || "sample"}`,
      );
    }
  }
  blockers.push("closing_line_benchmark: INSUFFICIENT_DATA (unlicensed)");
  if (shrinkFlags.length) {
    blockers.push(
      `shrink_to_50_suspect: ${shrinkFlags.map((r) => r.family).join(", ")}`,
    );
  }

  const gateMd = [
    "# MLB A/B family gates (v0.2 vs v0.3)",
    "",
    "Shadow-only. Thresholds **not loosened**: minOosSample=500, maxEce=0.04.",
    "Identical frozen chronological holdout for both profiles.",
    "",
    "## Verdict summary (v0.3 corrected)",
    "",
    `| Family | v0.2 | v0.3 | ΔECE | ΔBrier | ΔLogLoss | shrink-to-50 |`,
    `|--------|------|------|------|--------|----------|--------------|`,
    ...abTable.map(
      (r) =>
        `| ${r.family} | **${r.before.verdict}** | **${r.after.verdict}** | ${r.deltaEce} | ${r.deltaBrier} | ${r.deltaLogLoss} | ${r.shrink.flagged ? "FLAG" : "ok"} |`,
    ),
    `| closing_line | **INSUFFICIENT_DATA** | **INSUFFICIENT_DATA** | n/a | n/a | n/a | n/a |`,
    "",
    "## Blockers",
    "",
    ...blockers.map((b) => `- ${b}`),
    "",
    "## Full gate rows",
    "",
    "### v0.2",
    ...formatGateTable(gatesV02),
    "",
    "### v0.3",
    ...formatGateTable(gatesV03),
    "",
    "### Closing line",
    ...formatGateTable([closingGate]),
    "",
  ].join("\n");

  const holdPath = join(REPORT_DIR, "MLB_AB_HOLDOUT.md");
  const gatePath = join(REPORT_DIR, "MLB_AB_GATES.md");
  await writeFile(holdPath, holdMd, "utf8");
  await writeFile(gatePath, gateMd, "utf8");

  // Machine-readable summary for agent return
  const summary = {
    holdoutGames: holdoutFrozen.length,
    used: { "v0.2": byProfile["v0.2"].used, "v0.3": byProfile["v0.3"].used },
    families: abTable.map((r) => ({
      family: r.family,
      n: r.after.n,
      games: r.after.games,
      ece_v02: r.before.ece,
      ece_v03: r.after.ece,
      deltaEce: r.before.ece != null && r.after.ece != null ? r.after.ece - r.before.ece : null,
      brier_v02: r.before.brier,
      brier_v03: r.after.brier,
      deltaBrier:
        r.before.brier != null && r.after.brier != null ? r.after.brier - r.before.brier : null,
      logLoss_v02: r.before.logLoss,
      logLoss_v03: r.after.logLoss,
      deltaLogLoss:
        r.before.logLoss != null && r.after.logLoss != null
          ? r.after.logLoss - r.before.logLoss
          : null,
      meanAbsDev_v02: r.before.meanAbsDevFromHalf,
      meanAbsDev_v03: r.after.meanAbsDevFromHalf,
      verdict_v02: r.before.verdict,
      verdict_v03: r.after.verdict,
      shrinkTo50: r.shrink.flagged,
    })),
    shrinkTo50Families: shrinkFlags.map((r) => r.family),
    blockers,
    closingLine: "INSUFFICIENT_DATA",
  };
  await writeFile(
    join(REPORT_DIR, "MLB_AB_SUMMARY.json"),
    JSON.stringify(summary, null, 2),
    "utf8",
  );

  console.log(`wrote ${holdPath}`);
  console.log(`wrote ${gatePath}`);
  console.log(
    JSON.stringify(
      {
        holdout: holdoutFrozen.length,
        shrinkFlags: shrinkFlags.map((r) => r.family),
        verdicts: Object.fromEntries(abTable.map((r) => [r.family, r.after.verdict])),
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
