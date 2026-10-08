/**
 * MLB F.5 acceptance evidence + FG ML / team_total v0.3.2 decision.
 *
 * - F5 family metrics on frozen chrono holdout under current default profile
 * - VAL-guided v0.3.2 (strength-preserve) vs prior default v0.3.1
 * - Holdout applied once for promotion decision (no holdout tuning loop)
 * - Named props: separate hits / HR / K / RBI / SB gate rows (even if FAIL)
 * - Shadow-only. Still NOT production allowlist. SIM_V2_SERVE off.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type BaseballCalibrationProfile,
  baseballProfileLevers,
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
import { SIM_V2_DEEP_DRAWS } from "../src/version.js";
import {
  type CalibObs,
  clusteredEceSe,
  discriminationProxy,
  evaluateFamilyGate,
  meanAbsDevFromHalf,
  metricsOf,
  shrinkTo50Flag,
} from "./familyCalibration.js";

const REPORT_DIR = join(import.meta.dirname, "report");
const CACHE_DIR = join(import.meta.dirname, "cache");
const PRIOR_DEFAULT: BaseballCalibrationProfile = "v0.3.1";
const CANDIDATE: BaseballCalibrationProfile = "v0.3.2";
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
  rbis: number;
  stolenBases: number;
  battingOrder?: number;
  confirmedStarter: boolean;
};

type FoldName = "val" | "holdout";

type FamMetrics = {
  profile: BaseballCalibrationProfile;
  fold: FoldName;
  family: string;
  n: number;
  games: number;
  effN: number;
  brier: number | null;
  logLoss: number | null;
  ece: number | null;
  eceSe: number | null;
  meanAbsDevFromHalf: number;
  separation: number | null;
  auc: number | null;
  verdict: string;
  reasons: string[];
};

function fmt(n: number | null | undefined, d = 4): string {
  return n == null || !Number.isFinite(n) ? "n/a" : n.toFixed(d);
}

function pct(xs: number[], p: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))));
  return s[i]!;
}

async function loadGames(): Promise<Game[]> {
  const cachePath = join(CACHE_DIR, "mlb_disc_games_2023_2024.json");
  const raw = await readFile(cachePath, "utf8");
  const parsed = JSON.parse(raw) as Game[];
  if (!Array.isArray(parsed) || parsed.length < 3000) {
    throw new Error(`mlb_disc_cache_incomplete:${cachePath}`);
  }
  return parsed.sort(
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

function familyRows(obs: CalibObs[], family: string): CalibObs[] {
  if (family === "main_all") return obs.filter((o) => !o.isAlt && o.family !== "player_prop");
  if (family === "alt_all") return obs.filter((o) => !!o.isAlt && o.family !== "player_prop");
  if (family === "player_prop_named") {
    return obs.filter((o) => o.family === "player_prop" && o.namedPlayer);
  }
  if (family.startsWith("prop_")) {
    const stat = family.slice("prop_".length);
    return obs.filter(
      (o) => o.family === "player_prop" && o.namedPlayer && (o.slice?.startsWith(stat) ?? false),
    );
  }
  return obs.filter((o) => o.family === family);
}

function famMetrics(
  profile: BaseballCalibrationProfile,
  fold: FoldName,
  family: string,
  rows: CalibObs[],
): FamMetrics {
  const gate = evaluateFamilyGate(`mlb:${family}:${fold}`, rows, {
    requireNamedPlayer: family.startsWith("prop_") || family === "player_prop_named",
  });
  const disc = discriminationProxy(rows);
  return {
    profile,
    fold,
    family,
    n: gate.n,
    games: gate.nGames,
    effN: gate.effectiveN,
    brier: gate.brier,
    logLoss: gate.logLoss,
    ece: gate.ece,
    eceSe: gate.eceSe ?? clusteredEceSe(rows, 200, `f5acc:${profile}:${fold}:${family}`),
    meanAbsDevFromHalf: meanAbsDevFromHalf(rows),
    separation: disc.separation,
    auc: disc.auc,
    verdict: gate.verdict,
    reasons: gate.reasons,
  };
}

type Sink = {
  obs: CalibObs[];
  propObs: CalibObs[];
  runtimesMs: number[];
  used: number;
};

function emptySink(): Sink {
  return { obs: [], propObs: [], runtimesMs: [], used: 0 };
}

function gradeTeamGame(
  g: Game,
  allGames: Game[],
  profile: BaseballCalibrationProfile,
  fold: FoldName,
  sink: Sink,
): { home: NonNullable<ReturnType<typeof form>>; away: NonNullable<ReturnType<typeof form>> } | null {
  const t = new Date(g.kickoffIso).getTime();
  const home = form(g.homeId, t, allGames);
  const away = form(g.awayId, t, allGames);
  if (!home || !away) return null;

  const t0 = performance.now();
  const tensor = buildJointBaseballTensor({
    sport: "mlb",
    eventId: g.eventId,
    seed: `mlb-f5acc:${fold}:${profile}:${g.eventId}`,
    nDraws: 2000,
    home,
    away,
    calibrationProfile: profile,
  });
  sink.runtimesMs.push(performance.now() - t0);
  sink.used += 1;

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
        fold,
        isAlt: s.isAlt,
        realBookLine: false,
      });
    }
  }
  return { home, away };
}

function idxOf(keys: string[], name: string): number {
  const n = name.toLowerCase();
  return keys.findIndex((k) => String(k).toLowerCase().replace(/\s+/g, "") === n.replace(/\s+/g, ""));
}

async function fetchBoxPlayers(
  eventId: string,
  homeId: string,
  awayId: string,
): Promise<BoxPlayer[]> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=${eventId}`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "stadium-sim-v2-mlb-f5" } });
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
            athletes?: Array<{ athlete?: { id?: string | number }; stats?: string[] }>;
          }>;
        }>;
      };
    };
    const out: BoxPlayer[] = [];
    for (const block of j.boxscore?.players ?? []) {
      const tid = block.team?.id != null ? String(block.team.id) : "";
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
          const ri = idxOf(keys, "RBIs") >= 0 ? idxOf(keys, "RBIs") : idxOf(keys, "rbi");
          const sbi =
            idxOf(keys, "stolenBases") >= 0
              ? idxOf(keys, "stolenBases")
              : idxOf(keys, "stolenbases");
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
              rbis: ri >= 0 ? Number(a.stats[ri] ?? 0) : 0,
              stolenBases: sbi >= 0 ? Number(a.stats[sbi] ?? 0) : 0,
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
            rbis: 0,
            stolenBases: 0,
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

async function gradeProps(
  games: Array<{
    g: Game;
    home: NonNullable<ReturnType<typeof form>>;
    away: NonNullable<ReturnType<typeof form>>;
  }>,
  profile: BaseballCalibrationProfile,
  sink: Sink,
  cap = 120,
): Promise<{ attempted: number; ok: number; fail: number }> {
  let attempted = 0;
  let ok = 0;
  let fail = 0;
  const n = Math.min(games.length, cap);
  for (let i = 0; i < n; i++) {
    const { g, home, away } = games[i]!;
    attempted += 1;
    const box = await fetchBoxPlayers(g.eventId, g.homeId, g.awayId);
    await new Promise((r) => setTimeout(r, 25));
    if (!box.length) {
      fail += 1;
      continue;
    }
    ok += 1;
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
      seed: `mlb-f5acc-prop:${profile}:${g.eventId}`,
      nDraws: 2000,
      home,
      away,
      players,
      calibrationProfile: profile,
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
              },
              {
                slice: "hr_0.5",
                stat: "home_runs" as const,
                line: 0.5,
                y: (p.homeRuns > 0.5 ? 1 : 0) as 0 | 1,
              },
              {
                slice: "rbi_0.5",
                stat: "rbis" as const,
                line: 0.5,
                y: (p.rbis > 0.5 ? 1 : 0) as 0 | 1,
              },
              {
                slice: "sb_0.5",
                stat: "stolen_bases" as const,
                line: 0.5,
                y: (p.stolenBases > 0.5 ? 1 : 0) as 0 | 1,
              },
            ]
          : [
              {
                slice: "k_5.5",
                stat: "strikeouts" as const,
                line: 5.5,
                y: (p.strikeouts > 5.5 ? 1 : 0) as 0 | 1,
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
          sink.propObs.push({
            y: s.y,
            p: r.simHit,
            eventId: g.eventId,
            family: "player_prop",
            slice: s.slice,
            fold: "holdout",
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
  return { attempted, ok, fail };
}

async function main() {
  await mkdir(REPORT_DIR, { recursive: true });
  const games = await loadGames();
  const folds = chronoFolds(games);

  const freezePath = join(REPORT_DIR, "MLB_AB_HOLDOUT_GAMES.json");
  const freeze = JSON.parse(await readFile(freezePath, "utf8")) as {
    n: number;
    eventIds: string[];
  };
  const byId = new Map(games.map((g) => [g.eventId, g]));
  const holdoutFrozen = freeze.eventIds
    .map((id) => byId.get(id))
    .filter((g): g is Game => !!g);
  if (holdoutFrozen.length < MIN_OOS) {
    throw new Error(
      `frozen_holdout_incomplete: found=${holdoutFrozen.length} expected=${freeze.n}`,
    );
  }

  const valFrozen: Game[] = [];
  for (const g of folds.val) {
    const t = new Date(g.kickoffIso).getTime();
    if (form(g.homeId, t, games) && form(g.awayId, t, games)) {
      valFrozen.push(g);
      if (valFrozen.length >= 560) break;
    }
  }

  const priorLevers = baseballProfileLevers(PRIOR_DEFAULT);
  const candLevers = baseballProfileLevers(CANDIDATE);

  // --- VAL diagnostics (tuning / decision only) ---
  const valPrior = emptySink();
  const valCand = emptySink();
  console.log(`VAL grade n=${valFrozen.length} × {${PRIOR_DEFAULT}, ${CANDIDATE}}…`);
  for (const g of valFrozen) {
    gradeTeamGame(g, games, PRIOR_DEFAULT, "val", valPrior);
    gradeTeamGame(g, games, CANDIDATE, "val", valCand);
  }

  const valFamilies = ["ml", "team_total", "f5"] as const;
  const valRows: FamMetrics[] = [];
  for (const f of valFamilies) {
    valRows.push(famMetrics(PRIOR_DEFAULT, "val", f, familyRows(valPrior.obs, f)));
    valRows.push(famMetrics(CANDIDATE, "val", f, familyRows(valCand.obs, f)));
  }
  const valMlPrior = valRows.find((r) => r.profile === PRIOR_DEFAULT && r.family === "ml")!;
  const valMlCand = valRows.find((r) => r.profile === CANDIDATE && r.family === "ml")!;
  const valTtPrior = valRows.find((r) => r.profile === PRIOR_DEFAULT && r.family === "team_total")!;
  const valTtCand = valRows.find((r) => r.profile === CANDIDATE && r.family === "team_total")!;

  // --- Holdout once (both profiles for promotion compare; F5 under eventual default) ---
  const holdPrior = emptySink();
  const holdCand = emptySink();
  const holdFormsPrior: Array<{
    g: Game;
    home: NonNullable<ReturnType<typeof form>>;
    away: NonNullable<ReturnType<typeof form>>;
  }> = [];
  console.log(`Holdout grade n=${holdoutFrozen.length} × {${PRIOR_DEFAULT}, ${CANDIDATE}} (once)…`);
  for (const g of holdoutFrozen) {
    const a = gradeTeamGame(g, games, PRIOR_DEFAULT, "holdout", holdPrior);
    const b = gradeTeamGame(g, games, CANDIDATE, "holdout", holdCand);
    if (a) holdFormsPrior.push({ g, home: a.home, away: a.away });
    void b;
  }

  const holdFamilies = ["ml", "spread", "total", "team_total", "f5", "main_all", "alt_all"] as const;
  const holdPriorM = Object.fromEntries(
    holdFamilies.map((f) => [f, famMetrics(PRIOR_DEFAULT, "holdout", f, familyRows(holdPrior.obs, f))]),
  ) as Record<(typeof holdFamilies)[number], FamMetrics>;
  const holdCandM = Object.fromEntries(
    holdFamilies.map((f) => [f, famMetrics(CANDIDATE, "holdout", f, familyRows(holdCand.obs, f))]),
  ) as Record<(typeof holdFamilies)[number], FamMetrics>;

  // Promotion: holdout ML ECE↓, no shrink-to-50 vs prior, no Brier/LL regression.
  const shrinkMl = shrinkTo50Flag({
    eceBefore: holdPriorM.ml.ece,
    eceAfter: holdCandM.ml.ece,
    madBefore: holdPriorM.ml.meanAbsDevFromHalf,
    madAfter: holdCandM.ml.meanAbsDevFromHalf,
  });
  const shrinkTt = shrinkTo50Flag({
    eceBefore: holdPriorM.team_total.ece,
    eceAfter: holdCandM.team_total.ece,
    madBefore: holdPriorM.team_total.meanAbsDevFromHalf,
    madAfter: holdCandM.team_total.meanAbsDevFromHalf,
  });
  const eceImproved =
    holdCandM.ml.ece != null &&
    holdPriorM.ml.ece != null &&
    holdCandM.ml.ece < holdPriorM.ml.ece - 1e-6;
  const brierOk =
    holdCandM.ml.brier != null &&
    holdPriorM.ml.brier != null &&
    holdCandM.ml.brier <= holdPriorM.ml.brier + 1e-4;
  const llOk =
    holdCandM.ml.logLoss != null &&
    holdPriorM.ml.logLoss != null &&
    holdCandM.ml.logLoss <= holdPriorM.ml.logLoss + 1e-4;
  const promote = eceImproved && !shrinkMl.flagged && brierOk && llOk;
  const defaultProfile: BaseballCalibrationProfile = promote ? CANDIDATE : PRIOR_DEFAULT;
  const fgMlDecision: "KEEP" | "MODIFY" = promote ? "KEEP" : "MODIFY";

  // F5 acceptance under resulting default profile
  const f5Sink = defaultProfile === CANDIDATE ? holdCand : holdPrior;
  const f5 = famMetrics(defaultProfile, "holdout", "f5", familyRows(f5Sink.obs, "f5"));
  const f5Pass =
    f5.n >= MIN_OOS && f5.ece != null && f5.ece <= MAX_ECE && f5.verdict === "PASS";
  const p95Runtime = pct(f5Sink.runtimesMs, 0.95);

  // Named props on default profile (separate hits/HR/K/RBI/SB)
  const propFinal = emptySink();
  console.log(`Named props (hits/HR/K/RBI/SB) under ${defaultProfile}…`);
  const propStats = await gradeProps(holdFormsPrior, defaultProfile, propFinal, 120);

  const propSlices = [
    { key: "prop_hits", prefix: "hits" },
    { key: "prop_hr", prefix: "hr" },
    { key: "prop_k", prefix: "k" },
    { key: "prop_rbi", prefix: "rbi" },
    { key: "prop_sb", prefix: "sb" },
  ] as const;
  const propGates = propSlices.map(({ key, prefix }) => {
    const rows = propFinal.propObs.filter((o) => o.slice.startsWith(prefix));
    return famMetrics(defaultProfile, "holdout", key, rows);
  });
  const propNamed = famMetrics(
    defaultProfile,
    "holdout",
    "player_prop_named",
    familyRows(propFinal.propObs, "player_prop_named"),
  );

  const md = [
    "# MLB F.5 acceptance — F5 family + FG ML rework",
    "",
    "Shadow-only. `SIM_V2_SERVE=off`. **Still NOT production allowlist.**",
    "Frozen chronological holdout (`MLB_AB_HOLDOUT_GAMES.json`). VAL for levers only; holdout applied once.",
    `Thresholds: minOos=${MIN_OOS}, maxEce=${MAX_ECE}.`,
    "",
    "## Setup",
    "",
    `- Games cache: ${games.length}; chrono 55/20/25 → train ${folds.train.length} / val ${folds.val.length} / holdout ${folds.holdout.length}`,
    `- Frozen holdout graded: ${holdoutFrozen.length}; VAL diagnostic: ${valFrozen.length}`,
    `- Prior default: **${PRIOR_DEFAULT}** (${JSON.stringify({
      shrink: priorLevers.shrinkWeight,
      sigma: priorLevers.gameShockSigma,
      hfa: priorLevers.homeEdge,
      strengthPreserve: priorLevers.strengthPreserve,
      formResidual: priorLevers.formResidualWeight,
    })})`,
    `- Candidate: **${CANDIDATE}** (${JSON.stringify({
      shrink: candLevers.shrinkWeight,
      sigma: candLevers.gameShockSigma,
      hfa: candLevers.homeEdge,
      strengthPreserve: candLevers.strengthPreserve,
      formResidual: candLevers.formResidualWeight,
    })})`,
    `- Resulting default after holdout gate: **${defaultProfile}** (promote=${promote})`,
    `- Settlement integrity: F5⊆FG conserved on every draw; unit test \`test/baseballJoint.test.ts\` asserts \`assertBaseballF5Conserved\` at \`SIM_V2_DEEP_DRAWS=${SIM_V2_DEEP_DRAWS}\` (10k draws) for all profiles including v0.3.2`,
    `- SP / batting-order participation: **fail-closed** (unchanged)`,
    "",
    "## F5 family — frozen holdout (default profile)",
    "",
    `| Family | Profile | n | games | effN | Brier | LogLoss | ECE | ECE_SE | Verdict |`,
    `|--------|---------|---|-------|------|-------|---------|-----|--------|---------|`,
    `| f5 | ${f5.profile} | ${f5.n} | ${f5.games} | ${fmt(f5.effN, 1)} | ${fmt(f5.brier)} | ${fmt(f5.logLoss)} | ${fmt(f5.ece)} | ${fmt(f5.eceSe)} | **${f5.verdict}** |`,
    "",
    `- p95 runtime / game (team markets, 2k draws): **${fmt(p95Runtime, 1)} ms**`,
    `- Acceptance vs minOos=${MIN_OOS} maxEce=${MAX_ECE}: **${f5Pass ? "PASS" : "FAIL / NEAR-GATE"}**`,
    f5.reasons.length ? `- Reasons: ${f5.reasons.join("; ")}` : "- Reasons: (none)",
    `- Note: still **NOT** production allowlist / serve`,
    "",
    "### F5 slices (default profile)",
    "",
    (() => {
      const slices = ["f5_total_4.5", "f5_ml_home", "alt_f5_total_5.5"];
      const lines = [
        `| Slice | n | Brier | LogLoss | ECE |`,
        `|-------|---|-------|---------|-----|`,
      ];
      for (const sl of slices) {
        const rows = f5Sink.obs.filter((o) => o.family === "f5" && o.slice === sl);
        const m = metricsOf(rows);
        lines.push(
          `| ${sl} | ${m.n} | ${fmt(m.brier)} | ${fmt(m.logLoss)} | ${fmt(m.ece)} |`,
        );
      }
      return lines.join("\n");
    })(),
    "",
    "## VAL diagnostics (not holdout-tuned)",
    "",
    `| Family | Profile | n | ECE | Brier | LogLoss | sep | mad½ | AUC |`,
    `|--------|---------|---|-----|-------|---------|-----|-------|-----|`,
    ...valRows.map(
      (r) =>
        `| ${r.family} | ${r.profile} | ${r.n} | ${fmt(r.ece)} | ${fmt(r.brier)} | ${fmt(r.logLoss)} | ${fmt(r.separation)} | ${fmt(r.meanAbsDevFromHalf)} | ${fmt(r.auc)} |`,
    ),
    "",
    `- VAL ML sep Δ (${CANDIDATE}−${PRIOR_DEFAULT}): ${fmt((valMlCand.separation ?? 0) - (valMlPrior.separation ?? 0))}`,
    `- VAL ML mad½ Δ: ${fmt(valMlCand.meanAbsDevFromHalf - valMlPrior.meanAbsDevFromHalf)}`,
    `- VAL TT sep Δ: ${fmt((valTtCand.separation ?? 0) - (valTtPrior.separation ?? 0))}`,
    "",
    "## Holdout once — FG ML / team_total promotion",
    "",
    `| Family | v0.3.1 ECE | v0.3.2 ECE | ΔECE | v0.3.1 Brier | v0.3.2 Brier | v0.3.1 LL | v0.3.2 LL | mad½ 0.3.1→0.3.2 | sep 0.3.1→0.3.2 | shrink50? |`,
    `|--------|------------|------------|------|--------------|--------------|-----------|-----------|------------------|-----------------|-----------|`,
    `| ml | ${fmt(holdPriorM.ml.ece)} | ${fmt(holdCandM.ml.ece)} | ${fmt((holdCandM.ml.ece ?? 0) - (holdPriorM.ml.ece ?? 0))} | ${fmt(holdPriorM.ml.brier)} | ${fmt(holdCandM.ml.brier)} | ${fmt(holdPriorM.ml.logLoss)} | ${fmt(holdCandM.ml.logLoss)} | ${fmt(holdPriorM.ml.meanAbsDevFromHalf)}→${fmt(holdCandM.ml.meanAbsDevFromHalf)} | ${fmt(holdPriorM.ml.separation)}→${fmt(holdCandM.ml.separation)} | ${shrinkMl.flagged ? "FLAG" : "ok"} |`,
    `| team_total | ${fmt(holdPriorM.team_total.ece)} | ${fmt(holdCandM.team_total.ece)} | ${fmt((holdCandM.team_total.ece ?? 0) - (holdPriorM.team_total.ece ?? 0))} | ${fmt(holdPriorM.team_total.brier)} | ${fmt(holdCandM.team_total.brier)} | ${fmt(holdPriorM.team_total.logLoss)} | ${fmt(holdCandM.team_total.logLoss)} | ${fmt(holdPriorM.team_total.meanAbsDevFromHalf)}→${fmt(holdCandM.team_total.meanAbsDevFromHalf)} | ${fmt(holdPriorM.team_total.separation)}→${fmt(holdCandM.team_total.separation)} | ${shrinkTt.flagged ? "FLAG" : "ok"} |`,
    `| f5 | ${fmt(holdPriorM.f5.ece)} | ${fmt(holdCandM.f5.ece)} | ${fmt((holdCandM.f5.ece ?? 0) - (holdPriorM.f5.ece ?? 0))} | ${fmt(holdPriorM.f5.brier)} | ${fmt(holdCandM.f5.brier)} | ${fmt(holdPriorM.f5.logLoss)} | ${fmt(holdCandM.f5.logLoss)} | ${fmt(holdPriorM.f5.meanAbsDevFromHalf)}→${fmt(holdCandM.f5.meanAbsDevFromHalf)} | ${fmt(holdPriorM.f5.separation)}→${fmt(holdCandM.f5.separation)} | n/a |`,
    "",
    "### Promotion criteria (holdout ML)",
    "",
    `- ECE improved vs ${PRIOR_DEFAULT}: **${eceImproved}**`,
    `- shrink-to-50 FLAG: **${shrinkMl.flagged}** (${shrinkMl.note})`,
    `- Brier non-regression: **${brierOk}**`,
    `- LogLoss non-regression: **${llOk}**`,
    `- **Promote default → ${CANDIDATE}: ${promote}**`,
    `- FG ML decision: **${fgMlDecision}**`,
    "",
    "## Full family table (holdout, both profiles)",
    "",
    `| Family | Profile | n | games | effN | Brier | LogLoss | ECE | ECE_SE | sep | mad½ | Verdict |`,
    `|--------|---------|---|-------|------|-------|---------|-----|--------|-----|-------|---------|`,
    ...holdFamilies.flatMap((f) => {
      const a = holdPriorM[f];
      const b = holdCandM[f];
      return [
        `| ${f} | ${a.profile} | ${a.n} | ${a.games} | ${fmt(a.effN, 1)} | ${fmt(a.brier)} | ${fmt(a.logLoss)} | ${fmt(a.ece)} | ${fmt(a.eceSe)} | ${fmt(a.separation)} | ${fmt(a.meanAbsDevFromHalf)} | **${a.verdict}** |`,
        `| ${f} | ${b.profile} | ${b.n} | ${b.games} | ${fmt(b.effN, 1)} | ${fmt(b.brier)} | ${fmt(b.logLoss)} | ${fmt(b.ece)} | ${fmt(b.eceSe)} | ${fmt(b.separation)} | ${fmt(b.meanAbsDevFromHalf)} | **${b.verdict}** |`,
      ];
    }),
    "",
    "## Named props — separate gates (even if FAIL)",
    "",
    `- Boxscore attempted=${propStats.attempted} ok=${propStats.ok} fail=${propStats.fail}; aggregate named n=${propNamed.n}`,
    "",
    `| Gate | n | games | effN | Brier | LogLoss | ECE | ECE_SE | Verdict | reasons |`,
    `|------|---|-------|------|-------|---------|-----|--------|---------|---------|`,
    `| player_prop_named | ${propNamed.n} | ${propNamed.games} | ${fmt(propNamed.effN, 1)} | ${fmt(propNamed.brier)} | ${fmt(propNamed.logLoss)} | ${fmt(propNamed.ece)} | ${fmt(propNamed.eceSe)} | **${propNamed.verdict}** | ${propNamed.reasons.join("; ") || "—"} |`,
    ...propGates.map(
      (g) =>
        `| ${g.family} | ${g.n} | ${g.games} | ${fmt(g.effN, 1)} | ${fmt(g.brier)} | ${fmt(g.logLoss)} | ${fmt(g.ece)} | ${fmt(g.eceSe)} | **${g.verdict}** | ${g.reasons.join("; ") || "—"} |`,
    ),
    "",
    "## Isolation / blockers",
    "",
    "- Shadow-only; production allowlists empty; Coach / P0 / OTA untouched",
    "- SP + batting-order fail-closed preserved",
    "- Closing-line archive still unavailable (INSUFFICIENT)",
    `- FG ML: **${fgMlDecision}**` +
      (promote
        ? " — default promoted to v0.3.2"
        : " — keep default v0.3.1; v0.3.2 retained as A/B profile"),
    f5Pass
      ? "- F5 family: gate PASS on frozen holdout under default profile"
      : `- F5 family: not full PASS (ECE=${fmt(f5.ece)}, verdict=${f5.verdict}) — evidence package recorded; not allowlisted`,
    "",
  ].join("\n");

  await writeFile(join(REPORT_DIR, "MLB_F5_ACCEPTANCE.md"), md, "utf8");

  const summary = {
    defaultProfile,
    promote,
    fgMlDecision,
    f5,
    p95RuntimeMs: p95Runtime,
    f5Pass,
    val: { mlPrior: valMlPrior, mlCand: valMlCand, ttPrior: valTtPrior, ttCand: valTtCand },
    holdout: { prior: holdPriorM, candidate: holdCandM },
    shrinkMl,
    shrinkTt,
    promotionChecks: { eceImproved, shrinkFlagged: shrinkMl.flagged, brierOk, llOk },
    props: { stats: propStats, named: propNamed, byStat: propGates },
    deepDrawsConservationTest: SIM_V2_DEEP_DRAWS,
    notProductionAllowlist: true,
  };
  await writeFile(
    join(REPORT_DIR, "MLB_F5_ACCEPTANCE_SUMMARY.json"),
    JSON.stringify(summary, null, 2),
    "utf8",
  );

  // Machine-readable decision for post-step default promotion in source.
  await writeFile(
    join(REPORT_DIR, "MLB_F5_DEFAULT_DECISION.json"),
    JSON.stringify(
      {
        promote,
        defaultProfile,
        fgMlDecision,
        priorDefault: PRIOR_DEFAULT,
        candidate: CANDIDATE,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        defaultProfile,
        promote,
        fgMlDecision,
        f5: { n: f5.n, ece: f5.ece, verdict: f5.verdict, p95ms: p95Runtime },
        ml: {
          ece031: holdPriorM.ml.ece,
          ece032: holdCandM.ml.ece,
          shrink: shrinkMl.flagged,
        },
        propNamedN: propNamed.n,
      },
      null,
      2,
    ),
  );
  console.log(`wrote ${join(REPORT_DIR, "MLB_F5_ACCEPTANCE.md")}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
