/**
 * Per-family football prop diagnose on frozen chrono holdout (v0.3.2).
 * Named ESPN athlete.id only — proxies rejected. Shadow-only.
 *
 * Reports pass/rush/rec/any_td × main/alt × NFL/NCAAF:
 * Brier, LogLoss, ECE, n, games, effN, clustered ECE SE, reliability,
 * overconf@0.8/0.9/0.95, meanP/meanY/bias/meanAbsDevFromHalf.
 * any_td: sim rate vs actual leader TD occurrence (rarity check).
 *
 * Val-fold ONLY probes generative candidates (higher yard shock / TD temper).
 * Holdout never used for coefficient choice.
 *
 *   pnpm eval:prop-family
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SIM_V2_DEEP_DRAWS } from "../src/version.js";
import { buildJointFootballTensor } from "../src/models/football/jointFootball.js";
import {
  FOOTBALL_PROP_MODEL_VERSION,
  FOOTBALL_PROP_TD_RATE_TEMPER,
  FOOTBALL_PROP_YARD_BUDGET_SHOCK_SIGMA,
  attachFootballPlayerProps,
  type FootballPropEvalKnobs,
  type FootballPropPlayerInput,
  type FootballPropRole,
} from "../src/models/football/playerProps.js";
import { buildFootballPlayerPropMarket } from "../src/models/football/markets.js";
import { settleMarket } from "../src/engine/settle.js";
import { impliedProbFromAmerican } from "../src/schemas/odds.js";
import { DEFAULT_FETCH_PLANS, loadOrFetchGames } from "./fetchHistoricalGames.js";
import { selectEligibleGames, type EligibleGame } from "./walkForward.js";
import { splitChronological } from "./chronoSplits.js";
import type { FootballSport } from "./types.js";
import {
  clusteredEceSe,
  effectiveSampleSize,
  evaluateFamilyGate,
  formatReliability,
  metricsOf,
  overconfidenceBand,
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

type LeaderStat = "pass_yds" | "rush_yds" | "rec_yds" | "any_td";
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

type Candidate = {
  id: string;
  knobs: FootballPropEvalKnobs;
  note: string;
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

const FAMILY_SLICES: Array<{ key: string; filter: (o: CalibObs) => boolean }> = [
  { key: "player_prop", filter: () => true },
  { key: "pass_yds", filter: (o) => o.slice.startsWith("pass_yds") },
  { key: "pass_yds:main", filter: (o) => o.slice === "pass_yds:main" },
  { key: "pass_yds:alt", filter: (o) => o.slice === "pass_yds:alt" },
  { key: "rush_yds", filter: (o) => o.slice.startsWith("rush_yds") },
  { key: "rush_yds:main", filter: (o) => o.slice === "rush_yds:main" },
  { key: "rush_yds:alt", filter: (o) => o.slice === "rush_yds:alt" },
  { key: "rec_yds", filter: (o) => o.slice.startsWith("rec_yds") },
  { key: "rec_yds:main", filter: (o) => o.slice === "rec_yds:main" },
  { key: "rec_yds:alt", filter: (o) => o.slice === "rec_yds:alt" },
  { key: "any_td", filter: (o) => o.slice.startsWith("any_td") },
  { key: "any_td:main", filter: (o) => o.slice === "any_td:main" },
];

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

function meanAbsDevFromHalf(obs: CalibObs[]): number {
  if (!obs.length) return 0;
  let s = 0;
  for (const o of obs) s += Math.abs(o.p - 0.5);
  return s / obs.length;
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
  const r = await fetch(url, { headers: { "User-Agent": "stadium-edge-sim-v2-prop-family" } });
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
      usage: usageFor(role, primaryStat),
      participationStatus: role === "qb" ? "confirmed_starter" : "active",
    });
  }
  return roster;
}

type AnyTdDiag = {
  n: number;
  actualOccurrenceRate: number;
  simMeanRate: number;
  rateGap: number;
  actualMeanTdCount: number;
  byRole: Array<{
    role: string;
    n: number;
    actualOccurrenceRate: number;
    simMeanRate: number;
    rateGap: number;
  }>;
  diagnosis: string;
};

type FoldRun = {
  sport: FootballSport;
  fold: "val" | "holdout";
  candidateId: string;
  knobs: FootballPropEvalKnobs;
  gamesAttempted: number;
  gamesWithLeaders: number;
  namedPlayers: number;
  rejectedProxyOrMissing: number;
  obs: CalibObs[];
  anyTd: AnyTdDiag;
  ms: number;
};

async function runFold(
  sport: FootballSport,
  games: EligibleGame[],
  leaderCache: LeaderCacheFile,
  candidate: Candidate,
  opts: { draws: number; fold: "val" | "holdout" },
): Promise<FoldRun> {
  const obs: CalibObs[] = [];
  const namedIds = new Set<string>();
  let gamesWithLeaders = 0;
  let rejectedProxyOrMissing = 0;
  let fetched = 0;
  const t0 = performance.now();

  type TdPair = { role: string; actualOcc: 0 | 1; simRate: number; tdCount: number };
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
    gamesWithLeaders += 1;

    const roster = buildRoster(leaders);
    for (const p of roster) {
      if (!isNamedEspnAthleteId(p.playerId)) {
        rejectedProxyOrMissing += 1;
        continue;
      }
      namedIds.add(p.playerId);
    }
    const namedRoster = roster.filter((p) => isNamedEspnAthleteId(p.playerId));
    if (!namedRoster.length) continue;

    const roleById = new Map(namedRoster.map((p) => [p.playerId, p.role]));

    const tensor = attachFootballPlayerProps({
      tensor: buildJointFootballTensor({
        sport,
        eventId: g.eventId,
        seed: `prop-family:${sport}:${g.eventId}`,
        nDraws: opts.draws,
        home: { ...eg.homeForm, teamId: g.homeTeamId },
        away: { ...eg.awayForm, teamId: g.awayTeamId },
      }),
      players: namedRoster,
      propSeedSuffix: `family-${candidate.id}`,
      propCalibrationProfile: "v0.3.2",
      propEvalKnobs: candidate.knobs,
    });

    const gradedAnyTd = new Set<string>();

    for (const L of leaders) {
      if (!isNamedEspnAthleteId(L.athleteId)) {
        rejectedProxyOrMissing += 1;
        continue;
      }
      const expectedTeam = L.teamSide === "home" ? g.homeTeamId : g.awayTeamId;
      if (String(L.teamId) !== String(expectedTeam)) {
        rejectedProxyOrMissing += 1;
        continue;
      }

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
        if (anyStats) {
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
              tdCount: L.anyTd,
            });
          }
        }
      }
    }
  }

  if (fetched > 0) await saveLeaderCache(leaderCache);

  const bad = obs.filter((o) => !o.namedPlayer || !isNamedEspnAthleteId(o.playerId));
  if (bad.length) {
    throw new Error(`${sport}:${opts.fold}:${candidate.id}: graded_proxy_n_${bad.length}`);
  }

  const anyTd = summarizeAnyTd(tdPairs);
  return {
    sport,
    fold: opts.fold,
    candidateId: candidate.id,
    knobs: candidate.knobs,
    gamesAttempted: games.length,
    gamesWithLeaders,
    namedPlayers: namedIds.size,
    rejectedProxyOrMissing,
    obs,
    anyTd,
    ms: performance.now() - t0,
  };
}

function summarizeAnyTd(pairs: Array<{ role: string; actualOcc: 0 | 1; simRate: number; tdCount: number }>): AnyTdDiag {
  if (!pairs.length) {
    return {
      n: 0,
      actualOccurrenceRate: 0,
      simMeanRate: 0,
      rateGap: 0,
      actualMeanTdCount: 0,
      byRole: [],
      diagnosis: "no_any_td_observations",
    };
  }
  const actualOccurrenceRate = pairs.reduce((s, p) => s + p.actualOcc, 0) / pairs.length;
  const simMeanRate = pairs.reduce((s, p) => s + p.simRate, 0) / pairs.length;
  const rateGap = simMeanRate - actualOccurrenceRate;
  const actualMeanTdCount = pairs.reduce((s, p) => s + p.tdCount, 0) / pairs.length;
  const roles = [...new Set(pairs.map((p) => p.role))].sort();
  const byRole = roles.map((role) => {
    const rows = pairs.filter((p) => p.role === role);
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
  let diagnosis = "any_td_rates_aligned";
  if (rateGap > 0.08) diagnosis = "model_overpredicts_leader_td_occurrence";
  else if (rateGap < -0.08) diagnosis = "model_underpredicts_leader_td_occurrence_ignores_leader_td_frequency";
  else if (Math.abs(rateGap) <= 0.08 && actualOccurrenceRate > 0.55 && simMeanRate > 0.55) {
    diagnosis = "leaders_td_common_residual_ece_is_shape_not_mean_rarity";
  }
  // Skill non-QB: if WR/RB overpredict while leaders rarely score → rarity miss.
  const skill = byRole.filter((r) => r.role === "wr" || r.role === "rb" || r.role === "te");
  if (skill.some((r) => r.n >= 40 && r.rateGap > 0.12 && r.actualOccurrenceRate < 0.45)) {
    diagnosis = "skill_any_td_ignores_rarity_overconfident_vs_leaders";
  }
  return {
    n: pairs.length,
    actualOccurrenceRate,
    simMeanRate,
    rateGap,
    actualMeanTdCount,
    byRole,
    diagnosis,
  };
}

type FamilyRow = {
  sport: string;
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
  bias: number;
  meanAbsDevFromHalf: number;
  overconf80: { n: number; hitRate: number | null };
  overconf90: { n: number; hitRate: number | null };
  overconf95: { n: number; hitRate: number | null };
};

function familyRows(sport: FootballSport, obs: CalibObs[]): FamilyRow[] {
  const out: FamilyRow[] = [];
  for (const slice of FAMILY_SLICES) {
    const rows = obs.filter(slice.filter);
    if (!rows.length && slice.key.startsWith("any_td")) continue;
    const m = metricsOf(rows);
    const games = new Set(rows.map((r) => r.eventId)).size;
    const effN = effectiveSampleSize(rows.map((r) => r.eventId));
    const eceSe = clusteredEceSe(rows, 200, `fam:${sport}:${slice.key}`);
    out.push({
      sport,
      family: slice.key,
      n: m.n,
      games,
      effN,
      brier: m.brier,
      logLoss: m.logLoss,
      ece: m.ece,
      eceSe,
      meanP: m.meanP,
      meanY: m.meanY,
      bias: m.bias,
      meanAbsDevFromHalf: meanAbsDevFromHalf(rows),
      overconf80: overconfidenceBand(rows, 0.8),
      overconf90: overconfidenceBand(rows, 0.9),
      overconf95: overconfidenceBand(rows, 0.95),
    });
  }
  return out;
}

function formatFamilyTable(rows: FamilyRow[]): string[] {
  const lines = [
    `| Sport | Family | n | games | effN | Brier | LogLoss | ECE | ECE_SE | meanP | meanY | bias | MAD½ | o80 n/hit | o90 n/hit | o95 n/hit |`,
    `|-------|--------|---|-------|------|-------|---------|-----|--------|-------|-------|------|------|-----------|-----------|-----------|`,
  ];
  for (const r of rows) {
    const band = (b: { n: number; hitRate: number | null }) =>
      `${b.n}/${b.hitRate == null ? "n/a" : b.hitRate.toFixed(3)}`;
    lines.push(
      `| ${r.sport} | ${r.family} | ${r.n} | ${r.games} | ${r.effN.toFixed(1)} | ${fmt(r.brier)} | ${fmt(r.logLoss)} | ${fmt(r.ece)} | ${fmt(r.eceSe)} | ${fmt(r.meanP, 3)} | ${fmt(r.meanY, 3)} | ${fmt(r.bias, 3)} | ${fmt(r.meanAbsDevFromHalf, 3)} | ${band(r.overconf80)} | ${band(r.overconf90)} | ${band(r.overconf95)} |`,
    );
  }
  return lines;
}

type ValScore = {
  candidateId: string;
  nflEce: number | null;
  ncaafEce: number | null;
  nflAnyTdEce: number | null;
  ncaafAnyTdEce: number | null;
  nflBrier: number | null;
  ncaafBrier: number | null;
  nflO95: { n: number; hitRate: number | null };
  ncaafO95: { n: number; hitRate: number | null };
  clearWin: boolean;
  reasons: string[];
};

function scoreValCandidate(
  baseline: Map<FootballSport, FoldRun>,
  cand: Map<FootballSport, FoldRun>,
  candidateId: string,
): ValScore {
  const reasons: string[] = [];
  const metr = (run: FoldRun | undefined, fam: string) => {
    if (!run) return null;
    const rows = fam === "player_prop" ? run.obs : run.obs.filter((o) => o.slice.startsWith(fam));
    return metricsOf(rows);
  };
  const nflB = metr(baseline.get("nfl"), "player_prop");
  const ncaafB = metr(baseline.get("ncaaf"), "player_prop");
  const nflC = metr(cand.get("nfl"), "player_prop");
  const ncaafC = metr(cand.get("ncaaf"), "player_prop");
  const nflTdB = metr(baseline.get("nfl"), "any_td");
  const ncaafTdB = metr(baseline.get("ncaaf"), "any_td");
  const nflTdC = metr(cand.get("nfl"), "any_td");
  const ncaafTdC = metr(cand.get("ncaaf"), "any_td");

  const nflO95 = overconfidenceBand(cand.get("nfl")?.obs ?? [], 0.95);
  const ncaafO95 = overconfidenceBand(cand.get("ncaaf")?.obs ?? [], 0.95);
  const nflO95b = overconfidenceBand(baseline.get("nfl")?.obs ?? [], 0.95);
  const ncaafO95b = overconfidenceBand(baseline.get("ncaaf")?.obs ?? [], 0.95);

  let wins = 0;
  let losses = 0;
  const checkEce = (label: string, b: number | null | undefined, c: number | null | undefined) => {
    if (b == null || c == null) return;
    const d = c - b;
    if (d <= -0.008) {
      wins += 1;
      reasons.push(`${label}_ece_improved_${d.toFixed(4)}`);
    } else if (d >= 0.005) {
      losses += 1;
      reasons.push(`${label}_ece_worse_${d.toFixed(4)}`);
    } else {
      reasons.push(`${label}_ece_flat_${d.toFixed(4)}`);
    }
  };
  checkEce("nfl", nflB?.ece, nflC?.ece);
  checkEce("ncaaf", ncaafB?.ece, ncaafC?.ece);
  checkEce("nfl_any_td", nflTdB?.ece, nflTdC?.ece);
  checkEce("ncaaf_any_td", ncaafTdB?.ece, ncaafTdC?.ece);

  const checkBrier = (label: string, b: number | null | undefined, c: number | null | undefined) => {
    if (b == null || c == null) return;
    if (c > b + 0.008) {
      losses += 1;
      reasons.push(`${label}_brier_regressed_${(c - b).toFixed(4)}`);
    }
  };
  checkBrier("nfl", nflB?.brier, nflC?.brier);
  checkBrier("ncaaf", ncaafB?.brier, ncaafC?.brier);

  // Extreme overconf: do not accept candidates that worsen p95 hit rate.
  const checkO95 = (
    label: string,
    b: { n: number; hitRate: number | null },
    c: { n: number; hitRate: number | null },
  ) => {
    if (b.n < 10 || c.n < 10 || b.hitRate == null || c.hitRate == null) return;
    if (c.hitRate >= b.hitRate + 0.05) {
      wins += 1;
      reasons.push(`${label}_o95_hit_improved`);
    } else if (c.hitRate + 0.03 < b.hitRate) {
      losses += 1;
      reasons.push(`${label}_o95_hit_worse`);
    }
  };
  checkO95("nfl", nflO95b, nflO95);
  checkO95("ncaaf", ncaafO95b, ncaafO95);

  // Uniform TD temper is unsafe when holdout/val role gaps have opposite signs
  // (RB overpredict vs WR underpredict) — require role-aware lever, not global ×k.
  if (candidateId.includes("td_")) {
    reasons.push("uniform_td_temper_blocked_until_role_aware_rates");
    losses += 1;
  }

  // Clear win: multi-sport ECE progress, no regressions, and not a blocked lever.
  const clearWin = wins >= 2 && losses === 0 && candidateId !== "baseline_0.3.2";
  if (!clearWin && candidateId !== "baseline_0.3.2") {
    reasons.push("no_safe_val_fold_win_without_holdout_tuning");
  }

  return {
    candidateId,
    nflEce: nflC?.ece ?? null,
    ncaafEce: ncaafC?.ece ?? null,
    nflAnyTdEce: nflTdC?.ece ?? null,
    ncaafAnyTdEce: ncaafTdC?.ece ?? null,
    nflBrier: nflC?.brier ?? null,
    ncaafBrier: ncaafC?.brier ?? null,
    nflO95,
    ncaafO95,
    clearWin,
    reasons,
  };
}

async function main() {
  await mkdir(REPORT_DIR, { recursive: true });
  await mkdir(CACHE_DIR, { recursive: true });

  const draws = Number(process.env.PROP_FAMILY_DRAWS ?? process.env.PROP_OOS_DRAWS ?? 2000);
  const maxHoldout = process.env.PROP_FAMILY_MAX_HOLDOUT
    ? Number(process.env.PROP_FAMILY_MAX_HOLDOUT)
    : undefined;
  const maxVal = process.env.PROP_FAMILY_MAX_VAL
    ? Number(process.env.PROP_FAMILY_MAX_VAL)
    : undefined;
  const skipValProbe = process.env.PROP_FAMILY_SKIP_VAL === "1";

  const baseline: Candidate = {
    id: "baseline_0.3.2",
    knobs: {},
    note: `shock=${FOOTBALL_PROP_YARD_BUDGET_SHOCK_SIGMA} tdTemper=${FOOTBALL_PROP_TD_RATE_TEMPER}`,
  };
  const candidates: Candidate[] = [
    baseline,
    {
      id: "shock_0.16",
      knobs: { yardBudgetShockSigma: 0.16 },
      note: "higher yard-budget shock only",
    },
    {
      id: "td_temper_0.75",
      knobs: { tdRateTemper: 0.75 },
      note: "temper TD generative rates ×0.75",
    },
    {
      id: "shock_0.16_td_0.75",
      knobs: { yardBudgetShockSigma: 0.16, tdRateTemper: 0.75 },
      note: "combined higher shock + TD temper",
    },
  ];

  const md: string[] = [
    "# Football prop family diagnose (frozen holdout, v0.3.2)",
    "",
    "Shadow-only. **Named ESPN `athlete.id` required** — proxies rejected, identity grounding kept.",
    "",
    `- Model version: **${FOOTBALL_PROP_MODEL_VERSION}**`,
    `- Yard-budget shock σ=${FOOTBALL_PROP_YARD_BUDGET_SHOCK_SIGMA}; tdTemper default=${FOOTBALL_PROP_TD_RATE_TEMPER}`,
    `- Draws/game: ${draws} (CI deep ${SIM_V2_DEEP_DRAWS})`,
    "- Odds: eval-grid −110 (not closing lines)",
    "- Holdout never used for parameter fitting; val-fold probes are diagnostic only",
    "",
  ];

  const holdoutFamilyAll: FamilyRow[] = [];
  const holdoutRuns = new Map<FootballSport, FoldRun>();
  const valBaseline = new Map<FootballSport, FoldRun>();
  const valByCandidate = new Map<string, Map<FootballSport, FoldRun>>();

  for (const sport of ["nfl", "ncaaf"] as FootballSport[]) {
    console.log(`prop-family ${sport}: load games...`);
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
      `prop-family ${sport}: holdout=${holdoutGames.length} (${split.labels.holdout}) val=${valGames.length} (${split.labels.val})`,
    );

    console.log(`prop-family ${sport}: holdout baseline...`);
    const hold = await runFold(sport, holdoutGames, leaderCache, baseline, {
      draws,
      fold: "holdout",
    });
    holdoutRuns.set(sport, hold);
    const fam = familyRows(sport, hold.obs);
    holdoutFamilyAll.push(...fam);

    md.push(`# ${sport.toUpperCase()} holdout (${split.labels.holdout})`);
    md.push("");
    md.push(`- Games attempted: ${hold.gamesAttempted}; with named leaders: ${hold.gamesWithLeaders}`);
    md.push(`- Distinct named athletes: ${hold.namedPlayers}`);
    md.push(`- Rejected proxy/missing: ${hold.rejectedProxyOrMissing}`);
    md.push(`- Settled obs: ${hold.obs.length}`);
    md.push(`- Runtime: ${(hold.ms / 1000).toFixed(1)}s`);
    md.push("");
    md.push("## Per-family metrics");
    md.push("");
    md.push(...formatFamilyTable(fam));
    md.push("");

    // Reliability per coarse family
    for (const key of ["player_prop", "pass_yds", "rush_yds", "rec_yds", "any_td"] as const) {
      const rows =
        key === "player_prop" ? hold.obs : hold.obs.filter((o) => o.slice.startsWith(key));
      if (!rows.length) continue;
      md.push(`### Reliability — ${sport}:${key}`);
      md.push("");
      md.push(...formatReliability(rows));
      md.push("");
      const gate = evaluateFamilyGate(`${sport}:holdout:${key}`, rows, {
        requireNamedPlayer: true,
      });
      md.push(
        `- Gate: **${gate.verdict}** ECE=${fmt(gate.ece)} SE=${fmt(gate.eceSe)} reasons: ${gate.reasons.join("; ") || "—"}`,
      );
      md.push("");
    }

    md.push("## any_td rarity diagnosis");
    md.push("");
    const td = hold.anyTd;
    md.push(`- n=${td.n} actualOccurrence(Y>0)=${fmt(td.actualOccurrenceRate, 3)} simMeanRate=${fmt(td.simMeanRate, 3)} gap(sim−act)=${fmt(td.rateGap, 3)}`);
    md.push(`- actualMeanTdCount=${fmt(td.actualMeanTdCount, 3)} (count, not Bernoulli)`);
    md.push(`- **diagnosis:** ${td.diagnosis}`);
    md.push("");
    md.push(`| Role | n | actualOcc | simRate | gap |`);
    md.push(`|------|---|-----------|---------|-----|`);
    for (const r of td.byRole) {
      md.push(
        `| ${r.role} | ${r.n} | ${fmt(r.actualOccurrenceRate, 3)} | ${fmt(r.simMeanRate, 3)} | ${fmt(r.rateGap, 3)} |`,
      );
    }
    md.push("");

    if (!skipValProbe) {
      for (const cand of candidates) {
        console.log(`prop-family ${sport}: val ${cand.id}...`);
        const run = await runFold(sport, valGames, leaderCache, cand, {
          draws,
          fold: "val",
        });
        if (cand.id === baseline.id) valBaseline.set(sport, run);
        let m = valByCandidate.get(cand.id);
        if (!m) {
          m = new Map();
          valByCandidate.set(cand.id, m);
        }
        m.set(sport, run);
      }
    }
  }

  md.push("# Val-fold generative probes (NOT holdout)");
  md.push("");
  md.push(
    "Candidates compared on chronological **val** only. Clear win requires ≥2 ECE improvements (nfl/ncaaf/any_td) with zero ECE/Brier regressions.",
  );
  md.push("");

  const scores: ValScore[] = [];
  if (!skipValProbe) {
    md.push(
      `| Candidate | NFL ECE | NCAAF ECE | NFL any_td ECE | NCAAF any_td ECE | NFL Brier | NCAAF Brier | clearWin |`,
    );
    md.push(
      `|-----------|---------|-----------|----------------|------------------|-----------|-------------|----------|`,
    );
    for (const cand of candidates) {
      const score = scoreValCandidate(valBaseline, valByCandidate.get(cand.id)!, cand.id);
      scores.push(score);
      md.push(
        `| ${cand.id} (${cand.note}) | ${fmt(score.nflEce)} | ${fmt(score.ncaafEce)} | ${fmt(score.nflAnyTdEce)} | ${fmt(score.ncaafAnyTdEce)} | ${fmt(score.nflBrier)} | ${fmt(score.ncaafBrier)} | ${score.clearWin ? "**YES**" : "no"} |`,
      );
      md.push(`- reasons: ${score.reasons.join("; ")}`);
    }
    md.push("");
  } else {
    md.push("_Val probe skipped (`PROP_FAMILY_SKIP_VAL=1`)._");
    md.push("");
  }

  const winners = scores.filter((s) => s.clearWin);
  const decision =
    winners.length === 1
      ? { kind: "MODIFY" as const, winner: winners[0]! }
      : { kind: "KEEP" as const, winner: null };

  md.push("# Decision input");
  md.push("");
  if (decision.kind === "KEEP") {
    md.push(
      `- **KEEP** model **${FOOTBALL_PROP_MODEL_VERSION}** — no clear val-fold generative win (or multiple/ambiguous). Holdout unused for tuning.`,
    );
    md.push("- Param deltas: none");
  } else {
    md.push(
      `- Val-fold supports candidate **${decision.winner!.candidateId}** — see MILESTONE_FOOTBALL_DECISION.md for whether MODIFY was applied.`,
    );
  }
  md.push("");
  md.push("## Holdout summary (untouched chrono)");
  md.push("");
  md.push(...formatFamilyTable(holdoutFamilyAll));
  md.push("");
  md.push("## Identity");
  md.push("");
  md.push("- Proxies graded: **0** (`isNamedEspnAthleteId` hard reject)");
  md.push("- No serve / allowlists / Coach / P0 / PR649 / merge / OTA");
  md.push("");

  const diagnosePath = join(REPORT_DIR, "FOOTBALL_FAMILY_DIAGNOSE.md");
  await writeFile(diagnosePath, md.join("\n"), "utf8");
  // Also mirror to package root for the requested artifact name.
  await writeFile(join(ROOT_REPORT, "FOOTBALL_FAMILY_DIAGNOSE.md"), md.join("\n"), "utf8");
  console.log(`wrote ${diagnosePath}`);

  // Emit machine-readable decision hint for the milestone writer.
  const hint = {
    decisionHint: decision.kind,
    modelVersion: FOOTBALL_PROP_MODEL_VERSION,
    shock: FOOTBALL_PROP_YARD_BUDGET_SHOCK_SIGMA,
    tdTemper: FOOTBALL_PROP_TD_RATE_TEMPER,
    winners: winners.map((w) => w.candidateId),
    scores,
    holdout: Object.fromEntries(
      [...holdoutRuns.entries()].map(([sport, run]) => [
        sport,
        {
          n: run.obs.length,
          ...metricsOf(run.obs),
          anyTd: run.anyTd,
          families: familyRows(sport, run.obs),
        },
      ]),
    ),
  };
  await writeFile(
    join(REPORT_DIR, "football_family_diagnose_summary.json"),
    JSON.stringify(hint, null, 2),
    "utf8",
  );
  console.log(`decisionHint=${decision.kind} winners=${winners.map((w) => w.candidateId).join(",") || "none"}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
