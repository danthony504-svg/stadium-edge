/**
 * Football C.2.3 — role-aware anytime-TD calibration (shadow).
 *
 * 1) Fit role TD multipliers on chrono VAL only (NFL 2023 / NCAAF 2024 w1–7).
 * 2) Frozen HOLDOUT side-by-side: baseline 0.3.2 (identity) vs candidate.
 * 3) Promote to 0.3.3 ONLY if any_td ECE AND Brier AND LogLoss improve on
 *    both sports (or pooled any_td) AND pass_yds ECE/Brier/LL do not regress.
 *    Aggregate ECE alone is insufficient if Brier/LL degrade.
 *
 *   pnpm eval:prop-c23
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SIM_V2_DEEP_DRAWS } from "../src/version.js";
import { buildJointFootballTensor } from "../src/models/football/jointFootball.js";
import {
  FOOTBALL_PROP_MODEL_VERSION,
  FOOTBALL_PROP_ROLE_TD_MULTIPLIERS_IDENTITY,
  FOOTBALL_PROP_TD_RATE_TEMPER,
  FOOTBALL_PROP_YARD_BUDGET_SHOCK_SIGMA,
  attachFootballPlayerProps,
  fitRoleTdMultipliersFromRoleRates,
  type FootballPropEvalKnobs,
  type FootballPropPlayerInput,
  type FootballPropRole,
  type FootballRoleTdMultipliers,
} from "../src/models/football/playerProps.js";
import { buildFootballPlayerPropMarket } from "../src/models/football/markets.js";
import { settleMarket } from "../src/engine/settle.js";
import { impliedProbFromAmerican } from "../src/schemas/odds.js";
import { DEFAULT_FETCH_PLANS, loadOrFetchGames } from "./fetchHistoricalGames.js";
import { selectEligibleGames, type EligibleGame } from "./walkForward.js";
import { splitChronological } from "./chronoSplits.js";
import type { FootballSport } from "./types.js";
import {
  metricsOf,
  type CalibObs,
} from "./familyCalibration.js";
import { isNamedEspnAthleteId } from "./footballPropIdentity.js";

const REPORT_DIR = join(import.meta.dirname, "report");
const CACHE_DIR = join(import.meta.dirname, "cache");
const ROOT_REPORT = join(import.meta.dirname, "..");
const ESPN_PATH: Record<FootballSport, string> = {
  nfl: "football/nfl",
  ncaaf: "football/college-football",
};

type YardStat = "pass_yds" | "rush_yds" | "rec_yds";

type NamedLeader = {
  athleteId: string;
  displayName: string;
  teamId: string;
  teamSide: "home" | "away";
  value: number;
  group: "passing" | "rushing" | "receiving";
  stat: YardStat;
  anyTd: number | null;
};

type LeaderCacheFile = {
  fetchedAt: string;
  sport: FootballSport;
  byEvent: Record<string, NamedLeader[]>;
};

const MAIN_LINE: Record<FootballSport, Record<YardStat, number>> = {
  nfl: { pass_yds: 249.5, rush_yds: 64.5, rec_yds: 54.5 },
  ncaaf: { pass_yds: 239.5, rush_yds: 74.5, rec_yds: 59.5 },
};

const ALT_LINES: Record<YardStat, number[]> = {
  pass_yds: [199.5, 299.5, 349.5],
  rush_yds: [39.5, 99.5, 129.5],
  rec_yds: [34.5, 89.5, 119.5],
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function roleForLeader(group: NamedLeader["group"], mergedHasPassing: boolean): FootballPropRole {
  if (group === "passing") return "qb";
  if (group === "rushing") return mergedHasPassing ? "qb" : "rb";
  return "wr";
}

function usageFor(role: FootballPropRole, stat: YardStat): number {
  if (role === "qb" && stat === "pass_yds") return 0.95;
  if (role === "qb" && stat === "rush_yds") return 0.95;
  if (role === "rb") return 0.62;
  return 0.32;
}

function mean(xs: Float64Array | number[]): number {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i]!;
  return xs.length ? s / xs.length : 0;
}

function fmt(n: number | null | undefined, d = 4): string {
  return n == null || !Number.isFinite(n) ? "n/a" : n.toFixed(d);
}

async function loadLeaderCache(sport: FootballSport): Promise<LeaderCacheFile> {
  const path = join(CACHE_DIR, `prop_leaders_${sport}.json`);
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as LeaderCacheFile;
    if (parsed?.byEvent && typeof parsed.byEvent === "object") return parsed;
  } catch {
    /* miss */
  }
  return { fetchedAt: new Date().toISOString(), sport, byEvent: {} };
}

async function saveLeaderCache(cache: LeaderCacheFile): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  cache.fetchedAt = new Date().toISOString();
  await writeFile(join(CACHE_DIR, `prop_leaders_${cache.sport}.json`), JSON.stringify(cache), "utf8");
}

async function fetchNamedLeaders(
  sport: FootballSport,
  eventId: string,
  homeTeamId: string,
  awayTeamId: string,
): Promise<NamedLeader[]> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${ESPN_PATH[sport]}/summary?event=${eventId}`;
  const r = await fetch(url, { headers: { "User-Agent": "stadium-edge-sim-v2-prop-c23" } });
  if (!r.ok) return [];
  const j = (await r.json()) as {
    boxscore?: {
      players?: Array<{
        team?: { id?: string };
        statistics?: Array<{
          name?: string;
          athletes?: Array<{
            athlete?: { id?: string | number; displayName?: string };
            stats?: string[];
          }>;
          labels?: string[];
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
  const homeId = String(comps.find((c) => c.homeAway === "home")?.team?.id ?? homeTeamId);
  const awayId = String(comps.find((c) => c.homeAway === "away")?.team?.id ?? awayTeamId);

  const best = new Map<string, NamedLeader>();
  const tdByAthlete = new Map<string, number>();
  const tdKeyCandidates = ["passingtouchdowns", "rushingtouchdowns", "receivingtouchdowns", "td", "tds"];

  const consider = (
    group: NamedLeader["group"],
    stat: YardStat,
    keyCandidates: string[],
  ): void => {
    for (const teamBlock of j.boxscore?.players ?? []) {
      const tid = String(teamBlock.team?.id ?? "");
      const side: "home" | "away" | null =
        tid && tid === homeId ? "home" : tid && tid === awayId ? "away" : null;
      if (!side) continue;
      for (const st of teamBlock.statistics ?? []) {
        if ((st.name ?? "").toLowerCase() !== group) continue;
        const keys = (st.keys ?? []).map((k) => k.toLowerCase());
        const labels = (st.labels ?? []).map((k) => k.toLowerCase());
        let yi = keys.findIndex((k) => keyCandidates.includes(k));
        if (yi < 0) yi = labels.findIndex((k) => keyCandidates.includes(k));
        if (yi < 0) continue;
        let tdi = keys.findIndex((k) => tdKeyCandidates.includes(k));
        if (tdi < 0) tdi = labels.findIndex((k) => tdKeyCandidates.includes(k));
        for (const a of st.athletes ?? []) {
          const athleteId = String(a.athlete?.id ?? "").trim();
          if (!isNamedEspnAthleteId(athleteId)) continue;
          const raw = a.stats?.[yi];
          const v = Number(String(raw ?? "").replace(/,/g, ""));
          if (!Number.isFinite(v)) continue;
          if (tdi >= 0) {
            const tdRaw = Number(String(a.stats?.[tdi] ?? "").replace(/,/g, ""));
            if (Number.isFinite(tdRaw)) {
              tdByAthlete.set(athleteId, (tdByAthlete.get(athleteId) ?? 0) + tdRaw);
            }
          }
          const mapKey = `${side}:${stat}`;
          const prev = best.get(mapKey);
          if (prev && prev.value >= v) continue;
          best.set(mapKey, {
            athleteId,
            displayName: a.athlete?.displayName ?? "unknown",
            teamId: tid,
            teamSide: side,
            value: v,
            group,
            stat,
            anyTd: null,
          });
        }
      }
    }
  };

  consider("passing", "pass_yds", ["passingyards", "yds"]);
  consider("rushing", "rush_yds", ["rushingyards", "yds"]);
  consider("receiving", "rec_yds", ["receivingyards", "yds"]);

  const out = [...best.values()].filter((L) => isNamedEspnAthleteId(L.athleteId));
  for (const L of out) {
    L.anyTd = tdByAthlete.has(L.athleteId) ? tdByAthlete.get(L.athleteId)! : null;
  }
  return out;
}

function buildRoster(leaders: NamedLeader[]): FootballPropPlayerInput[] {
  const byId = new Map<
    string,
    { leader: NamedLeader; groups: Set<NamedLeader["group"]>; stats: Set<YardStat> }
  >();
  for (const L of leaders) {
    if (!isNamedEspnAthleteId(L.athleteId)) continue;
    const cur = byId.get(L.athleteId);
    if (!cur) {
      byId.set(L.athleteId, {
        leader: L,
        groups: new Set([L.group]),
        stats: new Set([L.stat]),
      });
    } else {
      cur.groups.add(L.group);
      cur.stats.add(L.stat);
      if (L.group === "passing") cur.leader = L;
    }
  }
  const roster: FootballPropPlayerInput[] = [];
  for (const { leader, groups } of byId.values()) {
    const hasPass = groups.has("passing");
    const role = roleForLeader(hasPass ? "passing" : leader.group, hasPass);
    const primaryStat: YardStat = hasPass ? "pass_yds" : leader.stat;
    roster.push({
      playerId: leader.athleteId,
      teamSide: leader.teamSide,
      role,
      // usage = snap / RZ volume proxy (no historical pregame RZ fields).
      usage: usageFor(role, primaryStat),
      participationStatus: role === "qb" ? "confirmed_starter" : "active",
    });
  }
  return roster;
}

type RoleTdRow = {
  role: string;
  n: number;
  actualOccurrenceRate: number;
  simMeanRate: number;
  rateGap: number;
};

type FoldMetrics = {
  sport: FootballSport;
  fold: "val" | "holdout";
  candidateId: string;
  obs: CalibObs[];
  anyTdByRole: RoleTdRow[];
  ms: number;
};

async function runFold(
  sport: FootballSport,
  games: EligibleGame[],
  leaderCache: LeaderCacheFile,
  candidateId: string,
  knobs: FootballPropEvalKnobs,
  opts: { draws: number; fold: "val" | "holdout" },
): Promise<FoldMetrics> {
  const obs: CalibObs[] = [];
  let fetched = 0;
  const t0 = performance.now();
  type TdPair = { role: string; actualOcc: 0 | 1; simRate: number };
  const tdPairs: TdPair[] = [];

  for (const eg of games) {
    const g = eg.game;
    let leaders = leaderCache.byEvent[g.eventId];
    const cacheStale =
      !leaders ||
      leaders.some((L) => !isNamedEspnAthleteId(L.athleteId) || L.anyTd === undefined);
    if (cacheStale) {
      leaders = await fetchNamedLeaders(sport, g.eventId, g.homeTeamId, g.awayTeamId);
      leaderCache.byEvent[g.eventId] = leaders;
      fetched += 1;
      if (fetched % 25 === 0) await saveLeaderCache(leaderCache);
      await sleep(80);
    }
    leaders = (leaders ?? []).filter((L) => isNamedEspnAthleteId(L.athleteId));
    if (!leaders.length) continue;

    const roster = buildRoster(leaders).filter((p) => isNamedEspnAthleteId(p.playerId));
    if (!roster.length) continue;
    const roleById = new Map(roster.map((p) => [p.playerId, p.role]));

    const tensor = attachFootballPlayerProps({
      tensor: buildJointFootballTensor({
        sport,
        eventId: g.eventId,
        seed: `prop-c23:${sport}:${g.eventId}`,
        nDraws: opts.draws,
        home: { ...eg.homeForm, teamId: g.homeTeamId },
        away: { ...eg.awayForm, teamId: g.awayTeamId },
      }),
      players: roster,
      propSeedSuffix: `c23-${candidateId}`,
      propCalibrationProfile: "v0.3.2",
      propEvalKnobs: knobs,
    });

    const gradedAnyTd = new Set<string>();

    for (const L of leaders) {
      if (!isNamedEspnAthleteId(L.athleteId)) continue;
      const expectedTeam = L.teamSide === "home" ? g.homeTeamId : g.awayTeamId;
      if (String(L.teamId) !== String(expectedTeam)) continue;

      const stats = tensor.players[L.athleteId]?.stats?.[L.stat];
      if (!stats) continue;

      const mainLine = MAIN_LINE[sport][L.stat];
      const lineSpecs: Array<{ line: number; isAlt: boolean }> = [
        { line: mainLine, isAlt: false },
        ...ALT_LINES[L.stat].map((line) => ({ line, isAlt: true })),
      ];

      for (const { line, isAlt } of lineSpecs) {
        const market = buildFootballPlayerPropMarket({
          marketId: `${g.eventId}:${L.athleteId}:${L.stat}:${line}${isAlt ? ":alt" : ""}`,
          eventId: g.eventId,
          sport,
          playerId: L.athleteId,
          stat: L.stat,
          side: "over",
          line,
          alternate: isAlt,
        });
        const settled = settleMarket({
          tensor,
          market,
          odds: {
            marketId: market.marketId,
            american: -110,
            book: "eval-grid",
            capturedAt: new Date().toISOString(),
            impliedProbRaw: impliedProbFromAmerican(-110),
            provenance: {
              provider: "eval-grid-not-closing-line",
              fetchedAt: new Date().toISOString(),
            },
          },
        });
        if (settled.status !== "ok" || settled.simHit == null) continue;
        const y: 0 | 1 = L.value > line ? 1 : 0;
        obs.push({
          y,
          p: settled.simHit,
          eventId: g.eventId,
          family: "player_prop",
          slice: `${L.stat}${isAlt ? ":alt" : ":main"}`,
          fold: opts.fold,
          isAlt,
          playerId: L.athleteId,
          line,
          namedPlayer: true,
          participationKnown: true,
          realBookLine: false,
        });
      }

      if (L.anyTd != null && !gradedAnyTd.has(L.athleteId)) {
        gradedAnyTd.add(L.athleteId);
        const anyStats = tensor.players[L.athleteId]?.stats?.any_td;
        if (!anyStats) continue;
        const market = buildFootballPlayerPropMarket({
          marketId: `${g.eventId}:${L.athleteId}:any_td:yes`,
          eventId: g.eventId,
          sport,
          playerId: L.athleteId,
          stat: "any_td",
          side: "over",
          line: 0.5,
        });
        const settled = settleMarket({
          tensor,
          market,
          odds: {
            marketId: market.marketId,
            american: -110,
            book: "eval-grid",
            capturedAt: new Date().toISOString(),
            impliedProbRaw: impliedProbFromAmerican(-110),
            provenance: {
              provider: "eval-grid-not-closing-line",
              fetchedAt: new Date().toISOString(),
            },
          },
        });
        if (settled.status === "ok" && settled.simHit != null) {
          const y: 0 | 1 = L.anyTd > 0 ? 1 : 0;
          obs.push({
            y,
            p: settled.simHit,
            eventId: g.eventId,
            family: "player_prop",
            slice: "any_td:main",
            fold: opts.fold,
            isAlt: false,
            playerId: L.athleteId,
            line: 0.5,
            namedPlayer: true,
            participationKnown: true,
            realBookLine: false,
          });
          tdPairs.push({
            role: roleById.get(L.athleteId) ?? "unknown",
            actualOcc: y,
            simRate: mean(anyStats),
          });
        }
      }
    }
  }

  if (fetched > 0) await saveLeaderCache(leaderCache);

  const roles = [...new Set(tdPairs.map((p) => p.role))].sort();
  const anyTdByRole = roles.map((role) => {
    const rows = tdPairs.filter((p) => p.role === role);
    const a = rows.reduce((s, p) => s + p.actualOcc, 0) / rows.length;
    const m = rows.reduce((s, p) => s + p.simRate, 0) / rows.length;
    return {
      role,
      n: rows.length,
      actualOccurrenceRate: a,
      simMeanRate: m,
      rateGap: m - a,
    };
  });

  return {
    sport,
    fold: opts.fold,
    candidateId,
    obs,
    anyTdByRole,
    ms: performance.now() - t0,
  };
}

type SliceMetrics = {
  n: number;
  brier: number | null;
  logLoss: number | null;
  ece: number | null;
  meanP: number;
  meanY: number;
};

function sliceOf(obs: CalibObs[], prefix: string | null): SliceMetrics {
  const rows = prefix == null ? obs : obs.filter((o) => o.slice.startsWith(prefix));
  const m = metricsOf(rows);
  return {
    n: m.n,
    brier: m.brier,
    logLoss: m.logLoss,
    ece: m.ece,
    meanP: m.meanP,
    meanY: m.meanY,
  };
}

type PromoteGate = {
  promote: boolean;
  reasons: string[];
  blockers: string[];
};

/**
 * Promote only when any_td improves ECE+Brier+LogLoss (per sport) and
 * pass_yds does not regress on ECE/Brier/LL. Reject aggregate ECE wins
 * that trade off Brier/LL.
 */
function evaluatePromoteGate(args: {
  baseNfl: FoldMetrics;
  baseNcaaf: FoldMetrics;
  candNfl: FoldMetrics;
  candNcaaf: FoldMetrics;
}): PromoteGate {
  const reasons: string[] = [];
  const blockers: string[] = [];

  const checkFamily = (
    label: string,
    base: SliceMetrics,
    cand: SliceMetrics,
    mode: "must_improve_all" | "must_not_regress",
  ) => {
    if (base.n < 100 || cand.n < 100) {
      blockers.push(`${label}_insufficient_n`);
      return;
    }
    const dEce = (cand.ece ?? 1) - (base.ece ?? 1);
    const dBrier = (cand.brier ?? 1) - (base.brier ?? 1);
    const dLl = (cand.logLoss ?? 1) - (base.logLoss ?? 1);
    reasons.push(
      `${label}_dECE=${dEce.toFixed(4)}_dBrier=${dBrier.toFixed(4)}_dLL=${dLl.toFixed(4)}`,
    );
    if (mode === "must_improve_all") {
      if (!(dEce < 0 && dBrier < 0 && dLl < 0)) {
        blockers.push(`${label}_missing_joint_ece_brier_ll_improvement`);
      }
    } else {
      // Small noise tolerance; material regression blocks.
      if (dEce > 0.002) blockers.push(`${label}_ece_regressed`);
      if (dBrier > 0.002) blockers.push(`${label}_brier_regressed`);
      if (dLl > 0.002) blockers.push(`${label}_logloss_regressed`);
    }
  };

  checkFamily(
    "nfl_any_td",
    sliceOf(args.baseNfl.obs, "any_td"),
    sliceOf(args.candNfl.obs, "any_td"),
    "must_improve_all",
  );
  checkFamily(
    "ncaaf_any_td",
    sliceOf(args.baseNcaaf.obs, "any_td"),
    sliceOf(args.candNcaaf.obs, "any_td"),
    "must_improve_all",
  );
  checkFamily(
    "nfl_pass_yds",
    sliceOf(args.baseNfl.obs, "pass_yds"),
    sliceOf(args.candNfl.obs, "pass_yds"),
    "must_not_regress",
  );
  checkFamily(
    "ncaaf_pass_yds",
    sliceOf(args.baseNcaaf.obs, "pass_yds"),
    sliceOf(args.candNcaaf.obs, "pass_yds"),
    "must_not_regress",
  );

  // Aggregate ECE-only wins that hurt Brier/LL are explicitly disallowed.
  for (const [label, baseObs, candObs] of [
    ["nfl_player_prop", args.baseNfl.obs, args.candNfl.obs],
    ["ncaaf_player_prop", args.baseNcaaf.obs, args.candNcaaf.obs],
  ] as const) {
    const b = sliceOf(baseObs, null);
    const c = sliceOf(candObs, null);
    const dEce = (c.ece ?? 1) - (b.ece ?? 1);
    const dBrier = (c.brier ?? 1) - (b.brier ?? 1);
    const dLl = (c.logLoss ?? 1) - (b.logLoss ?? 1);
    reasons.push(
      `${label}_dECE=${dEce.toFixed(4)}_dBrier=${dBrier.toFixed(4)}_dLL=${dLl.toFixed(4)}`,
    );
    if (dEce < -0.002 && (dBrier > 0.002 || dLl > 0.002)) {
      blockers.push(`${label}_ece_improved_but_brier_or_ll_degraded`);
    }
  }

  return { promote: blockers.length === 0, reasons, blockers };
}

function formatSideBySide(
  title: string,
  base: SliceMetrics,
  cand: SliceMetrics,
): string[] {
  return [
    `### ${title}`,
    "",
    `| Arm | n | Brier | LogLoss | ECE | meanP | meanY |`,
    `|-----|---|-------|---------|-----|-------|-------|`,
    `| 0.3.2 baseline | ${base.n} | ${fmt(base.brier)} | ${fmt(base.logLoss)} | ${fmt(base.ece)} | ${fmt(base.meanP, 3)} | ${fmt(base.meanY, 3)} |`,
    `| C.2.3 candidate | ${cand.n} | ${fmt(cand.brier)} | ${fmt(cand.logLoss)} | ${fmt(cand.ece)} | ${fmt(cand.meanP, 3)} | ${fmt(cand.meanY, 3)} |`,
    `| Δ (cand−base) | — | ${fmt((cand.brier ?? 0) - (base.brier ?? 0))} | ${fmt((cand.logLoss ?? 0) - (base.logLoss ?? 0))} | ${fmt((cand.ece ?? 0) - (base.ece ?? 0))} | ${fmt(cand.meanP - base.meanP, 3)} | ${fmt(cand.meanY - base.meanY, 3)} |`,
    "",
  ];
}

async function main() {
  await mkdir(REPORT_DIR, { recursive: true });
  await mkdir(CACHE_DIR, { recursive: true });

  const draws = Number(process.env.PROP_C23_DRAWS ?? process.env.PROP_FAMILY_DRAWS ?? 2000);
  const maxHoldout = process.env.PROP_C23_MAX_HOLDOUT
    ? Number(process.env.PROP_C23_MAX_HOLDOUT)
    : undefined;
  const maxVal = process.env.PROP_C23_MAX_VAL ? Number(process.env.PROP_C23_MAX_VAL) : undefined;

  const baselineKnobs: FootballPropEvalKnobs = {};
  const valRoleRows: RoleTdRow[] = [];
  const valRuns = new Map<FootballSport, FoldMetrics>();
  const holdBase = new Map<FootballSport, FoldMetrics>();
  const holdCand = new Map<FootballSport, FoldMetrics>();

  for (const sport of ["nfl", "ncaaf"] as FootballSport[]) {
    console.log(`prop-c23 ${sport}: load games...`);
    const plan = DEFAULT_FETCH_PLANS.find((p) => p.sport === sport);
    if (!plan) throw new Error(`no_fetch_plan:${sport}`);
    const { games } = await loadOrFetchGames(plan);
    const { eligible } = selectEligibleGames(games);
    const split = splitChronological(sport, eligible);
    const leaderCache = await loadLeaderCache(sport);

    const holdoutGames =
      maxHoldout != null ? split.holdout.slice(0, maxHoldout) : split.holdout;
    const valGames = maxVal != null ? split.val.slice(0, maxVal) : split.val;

    console.log(
      `prop-c23 ${sport}: val=${valGames.length} (${split.labels.val}) holdout=${holdoutGames.length} (${split.labels.holdout})`,
    );

    console.log(`prop-c23 ${sport}: val baseline (fit source)...`);
    const val = await runFold(sport, valGames, leaderCache, "val_baseline_0.3.2", baselineKnobs, {
      draws,
      fold: "val",
    });
    valRuns.set(sport, val);
    for (const r of val.anyTdByRole) valRoleRows.push(r);
  }

  const fitted: FootballRoleTdMultipliers = fitRoleTdMultipliersFromRoleRates(valRoleRows);
  console.log(`prop-c23 fitted role TD mults (val only): ${JSON.stringify(fitted)}`);

  const candidateKnobs: FootballPropEvalKnobs = { roleTdMultipliers: fitted };

  for (const sport of ["nfl", "ncaaf"] as FootballSport[]) {
    const plan = DEFAULT_FETCH_PLANS.find((p) => p.sport === sport)!;
    const { games } = await loadOrFetchGames(plan);
    const { eligible } = selectEligibleGames(games);
    const split = splitChronological(sport, eligible);
    const leaderCache = await loadLeaderCache(sport);
    const holdoutGames =
      maxHoldout != null ? split.holdout.slice(0, maxHoldout) : split.holdout;

    console.log(`prop-c23 ${sport}: holdout baseline 0.3.2...`);
    const base = await runFold(
      sport,
      holdoutGames,
      leaderCache,
      "holdout_0.3.2",
      baselineKnobs,
      { draws, fold: "holdout" },
    );
    holdBase.set(sport, base);

    console.log(`prop-c23 ${sport}: holdout C.2.3 candidate...`);
    const cand = await runFold(
      sport,
      holdoutGames,
      leaderCache,
      "holdout_c23_role_td",
      candidateKnobs,
      { draws, fold: "holdout" },
    );
    holdCand.set(sport, cand);
  }

  const gate = evaluatePromoteGate({
    baseNfl: holdBase.get("nfl")!,
    baseNcaaf: holdBase.get("ncaaf")!,
    candNfl: holdCand.get("nfl")!,
    candNcaaf: holdCand.get("ncaaf")!,
  });

  const decision = gate.promote ? "MODIFY" : "KEEP";
  const promotedVersion = gate.promote ? "0.3.3" : FOOTBALL_PROP_MODEL_VERSION;

  const md: string[] = [
    "# Football C.2.3 holdout — role-aware anytime TD (shadow)",
    "",
    "Named ESPN `athlete.id` only. Yard-budget means/shock preserved from **0.3.2** (σ=0.12).",
    "Role TD multipliers fitted on **val fold only**; holdout frozen for verify.",
    "",
    `- Draws/game: ${draws} (CI deep ${SIM_V2_DEEP_DRAWS})`,
    `- Default model version in tree: **${FOOTBALL_PROP_MODEL_VERSION}**`,
    `- Promotion decision: **${decision}** → reported version **${promotedVersion}**`,
    `- Yard shock σ=${FOOTBALL_PROP_YARD_BUDGET_SHOCK_SIGMA}; tdTemper=${FOOTBALL_PROP_TD_RATE_TEMPER}`,
    "",
    "## Val-fold fit (NOT holdout)",
    "",
    "Pooled NFL+NCAAF val role occurrence → Bernoulli intensity multipliers",
    "`m = log(1−actual)/log(1−sim)` with shrink 0.85 and clamp [0.45, 1.85]; n&lt;40 → 1.",
    "TE/flex inherit WR (receiving leaders mapped to `wr` in eval roster).",
    "",
    "| Role | Fitted mult |",
    "|------|-------------|",
    `| qb | ${fitted.qb.toFixed(3)} |`,
    `| rb | ${fitted.rb.toFixed(3)} |`,
    `| wr | ${fitted.wr.toFixed(3)} |`,
    `| te | ${fitted.te.toFixed(3)} |`,
    `| flex | ${fitted.flex.toFixed(3)} |`,
    "",
    "### Val role gaps (baseline 0.3.2)",
    "",
    `| Sport | Role | n | actualOcc | simRate | gap |`,
    `|-------|------|---|-----------|---------|-----|`,
  ];

  for (const sport of ["nfl", "ncaaf"] as FootballSport[]) {
    for (const r of valRuns.get(sport)!.anyTdByRole) {
      md.push(
        `| ${sport} | ${r.role} | ${r.n} | ${fmt(r.actualOccurrenceRate, 3)} | ${fmt(r.simMeanRate, 3)} | ${fmt(r.rateGap, 3)} |`,
      );
    }
  }
  md.push("");

  md.push("## Frozen holdout side-by-side");
  md.push("");

  for (const sport of ["nfl", "ncaaf"] as FootballSport[]) {
    const b = holdBase.get(sport)!;
    const c = holdCand.get(sport)!;
    md.push(`# ${sport.toUpperCase()} holdout`);
    md.push("");
    md.push(...formatSideBySide("any_td", sliceOf(b.obs, "any_td"), sliceOf(c.obs, "any_td")));
    md.push(...formatSideBySide("pass_yds", sliceOf(b.obs, "pass_yds"), sliceOf(c.obs, "pass_yds")));
    md.push(
      ...formatSideBySide("player_prop (overall)", sliceOf(b.obs, null), sliceOf(c.obs, null)),
    );

    md.push("### any_td role gaps");
    md.push("");
    md.push(`| Arm | Role | n | actualOcc | simRate | gap |`);
    md.push(`|-----|------|---|-----------|---------|-----|`);
    for (const r of b.anyTdByRole) {
      md.push(
        `| 0.3.2 | ${r.role} | ${r.n} | ${fmt(r.actualOccurrenceRate, 3)} | ${fmt(r.simMeanRate, 3)} | ${fmt(r.rateGap, 3)} |`,
      );
    }
    for (const r of c.anyTdByRole) {
      md.push(
        `| C.2.3 | ${r.role} | ${r.n} | ${fmt(r.actualOccurrenceRate, 3)} | ${fmt(r.simMeanRate, 3)} | ${fmt(r.rateGap, 3)} |`,
      );
    }
    md.push("");
  }

  md.push("## Promotion gate");
  md.push("");
  md.push(
    "Require: NFL+NCAAF `any_td` each improve ECE **and** Brier **and** LogLoss; `pass_yds` ECE/Brier/LL must not regress; reject aggregate ECE↑ with Brier/LL↓.",
  );
  md.push("");
  md.push(`- **Decision: ${decision}** (promote 0.3.3 = ${gate.promote ? "YES" : "NO"})`);
  md.push(`- Reasons: ${gate.reasons.join("; ")}`);
  md.push(
    `- Blockers: ${gate.blockers.length ? gate.blockers.join("; ") : "none"}`,
  );
  md.push("");
  md.push("## Identity / non-goals");
  md.push("");
  md.push("- Named athlete.id preserved; proxies rejected");
  md.push("- PASS family (`pass_yds`) means/shock unchanged from 0.3.2");
  md.push("- No serve / allowlists / Coach / P0 / PR649 / merge / OTA");
  md.push("");

  const holdoutPath = join(ROOT_REPORT, "FOOTBALL_C23_HOLDOUT.md");
  await writeFile(holdoutPath, md.join("\n"), "utf8");
  await writeFile(join(REPORT_DIR, "FOOTBALL_C23_HOLDOUT.md"), md.join("\n"), "utf8");

  const summary = {
    decision,
    promote: gate.promote,
    promotedVersion,
    currentTreeVersion: FOOTBALL_PROP_MODEL_VERSION,
    fittedRoleTdMultipliers: fitted,
    identity: FOOTBALL_PROP_ROLE_TD_MULTIPLIERS_IDENTITY,
    blockers: gate.blockers,
    reasons: gate.reasons,
    draws,
    holdout: {
      nfl: {
        baseline: {
          any_td: sliceOf(holdBase.get("nfl")!.obs, "any_td"),
          pass_yds: sliceOf(holdBase.get("nfl")!.obs, "pass_yds"),
          player_prop: sliceOf(holdBase.get("nfl")!.obs, null),
          roles: holdBase.get("nfl")!.anyTdByRole,
        },
        candidate: {
          any_td: sliceOf(holdCand.get("nfl")!.obs, "any_td"),
          pass_yds: sliceOf(holdCand.get("nfl")!.obs, "pass_yds"),
          player_prop: sliceOf(holdCand.get("nfl")!.obs, null),
          roles: holdCand.get("nfl")!.anyTdByRole,
        },
      },
      ncaaf: {
        baseline: {
          any_td: sliceOf(holdBase.get("ncaaf")!.obs, "any_td"),
          pass_yds: sliceOf(holdBase.get("ncaaf")!.obs, "pass_yds"),
          player_prop: sliceOf(holdBase.get("ncaaf")!.obs, null),
          roles: holdBase.get("ncaaf")!.anyTdByRole,
        },
        candidate: {
          any_td: sliceOf(holdCand.get("ncaaf")!.obs, "any_td"),
          pass_yds: sliceOf(holdCand.get("ncaaf")!.obs, "pass_yds"),
          player_prop: sliceOf(holdCand.get("ncaaf")!.obs, null),
          roles: holdCand.get("ncaaf")!.anyTdByRole,
        },
      },
    },
    valRoleRows,
  };
  await writeFile(
    join(REPORT_DIR, "football_c23_summary.json"),
    JSON.stringify(summary, null, 2),
    "utf8",
  );
  console.log(`wrote ${holdoutPath}`);
  console.log(`decision=${decision} promote=${gate.promote} blockers=${gate.blockers.join(",") || "none"}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
