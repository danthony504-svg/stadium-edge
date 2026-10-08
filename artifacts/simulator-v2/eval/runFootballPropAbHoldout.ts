/**
 * Independent shadow A/B: football prop prior (v0.2) vs calibrated (v0.3.2)
 * on identical chronological holdout. Named ESPN athlete.id only — no proxies.
 *
 * Shadow-only. No serve / allowlists / Coach / P0 / merge / OTA.
 *
 *   pnpm eval:prop-ab
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SIM_V2_DEEP_DRAWS } from "../src/version.js";
import { buildJointFootballTensor } from "../src/models/football/jointFootball.js";
import {
  FOOTBALL_PROP_YARD_BUDGET_SHOCK_SIGMA,
  attachFootballPlayerProps,
  footballPropModelVersionForProfile,
  type FootballPropPlayerInput,
  type FootballPropRole,
  type PropCalibrationProfile,
} from "../src/models/football/playerProps.js";
import { buildFootballPlayerPropMarket } from "../src/models/football/markets.js";
import { settleMarket } from "../src/engine/settle.js";
import { impliedProbFromAmerican } from "../src/schemas/odds.js";
import { DEFAULT_FETCH_PLANS, loadOrFetchGames } from "./fetchHistoricalGames.js";
import { selectEligibleGames, type EligibleGame } from "./walkForward.js";
import { splitChronological } from "./chronoSplits.js";
import type { FootballSport } from "./types.js";
import {
  compareDistributions,
  evaluateFamilyGate,
  formatDistTable,
  formatGateTable,
  formatReliability,
  metricsOf,
  overconfidenceBand,
  type CalibObs,
  type DistCompare,
  type FamilyGateRow,
} from "./familyCalibration.js";
import { isNamedEspnAthleteId } from "./footballPropIdentity.js";

const REPORT_DIR = join(import.meta.dirname, "report");
const CACHE_DIR = join(import.meta.dirname, "cache");
const ESPN_PATH: Record<FootballSport, string> = {
  nfl: "football/nfl",
  ncaaf: "football/college-football",
};

const PROFILES: PropCalibrationProfile[] = ["v0.2", "v0.3.2"];

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
  /** Sum of pass+rush+rec TDs for this athlete when parseable; else null. */
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

function variance(xs: Float64Array | number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += (xs[i]! - m) ** 2;
  return s / xs.length;
}

function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const arr = [...xs].sort((a, b) => a - b);
  const i = Math.min(arr.length - 1, Math.max(0, Math.floor(p * (arr.length - 1))));
  return arr[i]!;
}

function meanAbsDevFromHalf(obs: CalibObs[]): number {
  if (!obs.length) return 0;
  let s = 0;
  for (const o of obs) s += Math.abs(o.p - 0.5);
  return s / obs.length;
}

function shrinkTo50Diagnosis(obs: CalibObs[]): {
  meanAbsDevFromHalf: number;
  fracNearHalf: number;
  fracExtreme: number;
  note: string;
} {
  if (!obs.length) {
    return {
      meanAbsDevFromHalf: 0,
      fracNearHalf: 0,
      fracExtreme: 0,
      note: "no_observations",
    };
  }
  const mad = meanAbsDevFromHalf(obs);
  const near = obs.filter((o) => Math.abs(o.p - 0.5) <= 0.05).length / obs.length;
  const extreme = obs.filter((o) => o.p >= 0.9 || o.p <= 0.1).length / obs.length;
  let note = "ok_dispersion";
  if (mad < 0.08 && near > 0.45) note = "shrink_to_50_suspected";
  else if (mad < 0.12 && near > 0.35) note = "mild_shrink_toward_50";
  else if (extreme > 0.45 && mad > 0.35) note = "over_sharp_vs_50";
  return { meanAbsDevFromHalf: mad, fracNearHalf: near, fracExtreme: extreme, note };
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
  const r = await fetch(url, { headers: { "User-Agent": "stadium-edge-sim-v2-prop-ab" } });
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

type ProfileRun = {
  profile: PropCalibrationProfile;
  modelVersion: string;
  sport: FootballSport;
  gamesAttempted: number;
  gamesWithLeaders: number;
  namedPlayers: number;
  rejectedProxyOrMissing: number;
  obs: CalibObs[];
  distPairs: Array<{ label: string; actual: number; simMean: number; simVar: number; simP90: number }>;
  gameMs: number[];
  ms: number;
};

async function runProfileHoldout(
  sport: FootballSport,
  games: EligibleGame[],
  leaderCache: LeaderCacheFile,
  profile: PropCalibrationProfile,
  opts: { draws: number; maxGames?: number },
): Promise<ProfileRun> {
  const slice = opts.maxGames != null ? games.slice(0, opts.maxGames) : games;
  const obs: CalibObs[] = [];
  const distPairs: ProfileRun["distPairs"] = [];
  const namedIds = new Set<string>();
  let gamesWithLeaders = 0;
  let rejectedProxyOrMissing = 0;
  const gameMs: number[] = [];
  const t0 = performance.now();
  let fetched = 0;
  const modelVersion = footballPropModelVersionForProfile(profile);

  for (const eg of slice) {
    const g = eg.game;
    const g0 = performance.now();
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
    // Filter cache entries that may predate named-id hardening.
    leaders = (leaders ?? []).filter((L) => isNamedEspnAthleteId(L.athleteId));
    if (!leaders.length) {
      gameMs.push(performance.now() - g0);
      continue;
    }
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
    if (!namedRoster.length) {
      gameMs.push(performance.now() - g0);
      continue;
    }

    const tensor = attachFootballPlayerProps({
      tensor: buildJointFootballTensor({
        sport,
        eventId: g.eventId,
        seed: `prop-ab:${sport}:${g.eventId}`,
        nDraws: opts.draws,
        home: { ...eg.homeForm, teamId: g.homeTeamId },
        away: { ...eg.awayForm, teamId: g.awayTeamId },
      }),
      players: namedRoster,
      propSeedSuffix: `ab-${profile}`,
      propCalibrationProfile: profile,
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
      const simMean = mean(stats);
      const arr = Array.from(stats);
      distPairs.push({
        label: `${sport}:${L.stat}`,
        actual: L.value,
        simMean,
        simVar: variance(stats),
        simP90: percentile(arr, 0.9),
      });

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
          fold: "holdout",
          isAlt,
          playerId: L.athleteId,
          line,
          namedPlayer: true,
          participationKnown: true,
          realBookLine: false,
        });
      }

      // any_td when TD column was parseable for this named athlete.
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
              fold: "holdout",
              isAlt: false,
              playerId: L.athleteId,
              line: 0.5,
              namedPlayer: true,
              participationKnown: true,
              realBookLine: false,
            });
            distPairs.push({
              label: `${sport}:any_td`,
              actual: L.anyTd,
              simMean: mean(anyStats),
              simVar: variance(anyStats),
              simP90: percentile(Array.from(anyStats), 0.9),
            });
          }
        }
      }
    }
    gameMs.push(performance.now() - g0);
  }

  if (fetched > 0) await saveLeaderCache(leaderCache);

  return {
    profile,
    modelVersion,
    sport,
    gamesAttempted: slice.length,
    gamesWithLeaders,
    namedPlayers: namedIds.size,
    rejectedProxyOrMissing,
    obs,
    distPairs,
    gameMs,
    ms: performance.now() - t0,
  };
}

function distCompareFromPairs(pairs: ProfileRun["distPairs"]): DistCompare[] {
  const by = new Map<string, { actual: number[]; simMean: number[] }>();
  for (const p of pairs) {
    const cur = by.get(p.label) ?? { actual: [], simMean: [] };
    cur.actual.push(p.actual);
    cur.simMean.push(p.simMean);
    by.set(p.label, cur);
  }
  const out: DistCompare[] = [];
  for (const [label, v] of by) {
    const d = compareDistributions(label, v.actual, v.simMean);
    if (d) out.push(d);
  }
  return out;
}

function gateRowsForHoldout(sport: FootballSport, profile: PropCalibrationProfile, hold: CalibObs[]): FamilyGateRow[] {
  const rows: FamilyGateRow[] = [];
  const prefix = `${sport}:${profile}`;
  rows.push(evaluateFamilyGate(`${prefix}:player_prop`, hold, { requireNamedPlayer: true }));
  for (const stat of ["pass_yds", "rush_yds", "rec_yds", "any_td"] as LeaderStat[]) {
    const statRows = hold.filter((o) => o.slice.startsWith(stat));
    if (stat === "any_td" && !statRows.length) continue;
    rows.push(
      evaluateFamilyGate(`${prefix}:player_prop:${stat}`, statRows, { requireNamedPlayer: true }),
    );
    rows.push(
      evaluateFamilyGate(
        `${prefix}:player_prop:${stat}:main`,
        hold.filter((o) => o.slice === `${stat}:main`),
        { requireNamedPlayer: true },
      ),
    );
    if (stat !== "any_td") {
      rows.push(
        evaluateFamilyGate(
          `${prefix}:player_prop:${stat}:alt`,
          hold.filter((o) => o.slice === `${stat}:alt`),
          { requireNamedPlayer: true },
        ),
      );
    }
  }
  rows.push(
    evaluateFamilyGate(`${prefix}:closing_line_benchmark`, [], { requireRealBook: true }),
  );
  return rows;
}

function fmtNum(n: number | null | undefined, d = 4): string {
  return n == null || !Number.isFinite(n) ? "n/a" : n.toFixed(d);
}

async function main() {
  await mkdir(REPORT_DIR, { recursive: true });
  await mkdir(CACHE_DIR, { recursive: true });

  const draws = Number(process.env.PROP_AB_DRAWS ?? process.env.PROP_OOS_DRAWS ?? 2000);
  const maxHoldout = process.env.PROP_AB_MAX_HOLDOUT
    ? Number(process.env.PROP_AB_MAX_HOLDOUT)
    : process.env.PROP_OOS_MAX_HOLDOUT
      ? Number(process.env.PROP_OOS_MAX_HOLDOUT)
      : undefined;

  const holdoutParts: string[] = [
    "# Football prop A/B holdout — prior v0.2 vs calibrated v0.3.2",
    "",
    "Shadow-only independent OOS. Identical chrono holdout games for both profiles.",
    "**Named ESPN `athlete.id` only** — `home_qb` / missing identity rejected (not graded).",
    "",
    `- Profiles: \`v0.2\` → model **0.2.0** (pass 8.5·pts+120, rush 3.2·pts+60, rec 5.5·pts+80, **no** yardBudgetShock); \`v0.3.2\` → model **0.3.2** (current means + σ=${FOOTBALL_PROP_YARD_BUDGET_SHOCK_SIGMA} shock).`,
    `- Draws/game: ${draws} (CI deep contract ${SIM_V2_DEEP_DRAWS}).`,
    "- Odds: eval-grid −110 (not closing lines).",
    "- Gates unchanged: minOos=500, maxEce=0.04.",
    "- No serve / allowlists / Coach / P0 / OTA.",
    "",
  ];

  const gateParts: string[] = [
    "# Football A/B family gates (holdout)",
    "",
    "Thresholds: minOos=500, maxEce=0.04. Verdicts: **PASS** | **FAIL** | **INSUFFICIENT_DATA**.",
    "",
  ];

  const allGates: FamilyGateRow[] = [];
  const abSummary: Array<{
    sport: FootballSport;
    family: string;
    v02: FamilyGateRow;
    v032: FamilyGateRow;
    mad02: number;
    mad032: number;
  }> = [];

  for (const sport of ["nfl", "ncaaf"] as FootballSport[]) {
    console.log(`prop-ab ${sport}: load games...`);
    const plan = DEFAULT_FETCH_PLANS.find((p) => p.sport === sport);
    if (!plan) throw new Error(`no_fetch_plan:${sport}`);
    const { games } = await loadOrFetchGames(plan);
    const { eligible } = selectEligibleGames(games);
    const split = splitChronological(sport, eligible);
    const leaderCache = await loadLeaderCache(sport);

    const holdoutGames = maxHoldout != null ? split.holdout.slice(0, maxHoldout) : split.holdout;
    console.log(
      `prop-ab ${sport}: holdout=${holdoutGames.length} (label=${split.labels.holdout}) profiles=${PROFILES.join(",")}`,
    );

    const runs = new Map<PropCalibrationProfile, ProfileRun>();
    for (const profile of PROFILES) {
      console.log(`prop-ab ${sport}: running ${profile}...`);
      const run = await runProfileHoldout(sport, holdoutGames, leaderCache, profile, {
        draws,
        maxGames: undefined, // already sliced
      });
      runs.set(profile, run);
      console.log(
        `prop-ab ${sport}:${profile}: n=${run.obs.length} games=${run.gamesWithLeaders} named=${run.namedPlayers} rejected=${run.rejectedProxyOrMissing} p95ms=${percentile(run.gameMs, 0.95).toFixed(1)}`,
      );
    }

    const run02 = runs.get("v0.2")!;
    const run032 = runs.get("v0.3.2")!;

    // Keep only observation keys present in BOTH profiles (identical graded set).
    const obsKey = (o: CalibObs) =>
      `${o.eventId}|${o.playerId}|${o.slice}|${o.line ?? ""}|${o.isAlt ? "alt" : "main"}`;
    const keys02 = new Set(run02.obs.map(obsKey));
    const keys032 = new Set(run032.obs.map(obsKey));
    const shared = new Set([...keys02].filter((k) => keys032.has(k)));
    const dropped02 = run02.obs.length - shared.size;
    const dropped032 = run032.obs.length - shared.size;
    run02.obs = run02.obs.filter((o) => shared.has(obsKey(o)));
    run032.obs = run032.obs.filter((o) => shared.has(obsKey(o)));
    if (run02.obs.length !== run032.obs.length) {
      throw new Error(`${sport}: paired_obs_mismatch_${run02.obs.length}_vs_${run032.obs.length}`);
    }

    // Proxy confirmation: zero graded obs with non-named ids.
    for (const run of [run02, run032]) {
      const bad = run.obs.filter((o) => !o.namedPlayer || !isNamedEspnAthleteId(o.playerId));
      if (bad.length) {
        throw new Error(`${sport}:${run.profile}: graded_proxy_or_unnamed_n_${bad.length}`);
      }
    }

    const gates02 = gateRowsForHoldout(sport, "v0.2", run02.obs);
    const gates032 = gateRowsForHoldout(sport, "v0.3.2", run032.obs);
    allGates.push(...gates02, ...gates032);

    const familyKeys = new Set([
      ...gates02.map((g) => g.key.replace(`${sport}:v0.2:`, "")),
      ...gates032.map((g) => g.key.replace(`${sport}:v0.3.2:`, "")),
    ]);

    holdoutParts.push(`# ${sport.toUpperCase()}`);
    holdoutParts.push("");
    holdoutParts.push(`- Holdout label: ${split.labels.holdout}`);
    holdoutParts.push(`- Holdout games (identical for A/B): ${holdoutGames.length}`);
    holdoutParts.push(
      `- Games with named leaders: v0.2=${run02.gamesWithLeaders} / v0.3.2=${run032.gamesWithLeaders}`,
    );
    holdoutParts.push(
      `- Distinct named athletes: v0.2=${run02.namedPlayers} / v0.3.2=${run032.namedPlayers}`,
    );
    holdoutParts.push(
      `- Rejected proxy/missing identity (not graded): v0.2=${run02.rejectedProxyOrMissing} / v0.3.2=${run032.rejectedProxyOrMissing}`,
    );
    holdoutParts.push(
      `- Settled obs (paired): ${run02.obs.length} (dropped unpaired v0.2=${dropped02} v0.3.2=${dropped032})`,
    );
    holdoutParts.push(
      `- Runtime p95 ms/game: v0.2=${percentile(run02.gameMs, 0.95).toFixed(1)} / v0.3.2=${percentile(run032.gameMs, 0.95).toFixed(1)}`,
    );
    holdoutParts.push(`- Proxy players graded: **none** (asserted)`);
    holdoutParts.push("");

    holdoutParts.push("## Before/after by family (v0.2 → v0.3.2)");
    holdoutParts.push("");
    holdoutParts.push(
      `| Family | v0.2 (prior) | v0.3.2 (calibrated) | MAD½ v0.2 | MAD½ v0.3.2 | shrink-to-50 |`,
    );
    holdoutParts.push(
      `|--------|--------------|---------------------|-----------|-------------|--------------|`,
    );

    for (const fam of [...familyKeys].sort()) {
      const a = gates02.find((g) => g.key === `${sport}:v0.2:${fam}`);
      const b = gates032.find((g) => g.key === `${sport}:v0.3.2:${fam}`);
      if (!a && !b) continue;
      const sliceFilter = (obs: CalibObs[]): CalibObs[] => {
        if (fam === "player_prop") return obs;
        if (fam === "closing_line_benchmark") return [];
        const rest = fam.replace(/^player_prop:?/, "");
        if (!rest) return obs;
        if (rest.endsWith(":main") || rest.endsWith(":alt")) {
          return obs.filter((o) => o.slice === rest);
        }
        return obs.filter((o) => o.slice.startsWith(rest));
      };
      const madA = meanAbsDevFromHalf(sliceFilter(run02.obs));
      const madB = meanAbsDevFromHalf(sliceFilter(run032.obs));
      const shrinkB = shrinkTo50Diagnosis(sliceFilter(run032.obs));
      if (a && b && !fam.startsWith("closing_line")) {
        abSummary.push({
          sport,
          family: fam,
          v02: a,
          v032: b,
          mad02: madA,
          mad032: madB,
        });
      }
      const fmtG = (r: FamilyGateRow | undefined) =>
        r
          ? `**${r.verdict}** n=${r.n} Brier=${fmtNum(r.brier)} LL=${fmtNum(r.logLoss)} ECE=${fmtNum(r.ece)} SE=${fmtNum(r.eceSe)}`
          : "—";
      holdoutParts.push(
        `| ${sport}:${fam} | ${fmtG(a)} | ${fmtG(b)} | ${fmtNum(madA, 3)} | ${fmtNum(madB, 3)} | ${shrinkB.note} |`,
      );
    }
    holdoutParts.push("");

    for (const [label, run] of [
      ["v0.2", run02],
      ["v0.3.2", run032],
    ] as const) {
      const shrink = shrinkTo50Diagnosis(run.obs);
      const o80 = overconfidenceBand(run.obs, 0.8);
      const o90 = overconfidenceBand(run.obs, 0.9);
      const o95 = overconfidenceBand(run.obs, 0.95);
      const m = metricsOf(run.obs);
      holdoutParts.push(`## ${sport.toUpperCase()} profile ${label} (model ${run.modelVersion})`);
      holdoutParts.push("");
      holdoutParts.push(
        `- n=${m.n} games=${run.gamesWithLeaders} effN≈ named athletes ${run.namedPlayers}`,
      );
      holdoutParts.push(
        `- Brier=${fmtNum(m.brier)} LogLoss=${fmtNum(m.logLoss)} ECE=${fmtNum(m.ece)} bias=${fmtNum(m.bias, 3)}`,
      );
      holdoutParts.push(
        `- meanAbsDevFromHalf=${fmtNum(shrink.meanAbsDevFromHalf, 3)} fracNearHalf(|p−0.5|≤0.05)=${fmtNum(shrink.fracNearHalf, 3)} fracExtreme(p≤0.1|p≥0.9)=${fmtNum(shrink.fracExtreme, 3)} → **${shrink.note}**`,
      );
      holdoutParts.push(
        `- overconf80 hit=${fmtNum(o80.hitRate, 3)} (n=${o80.n}); overconf90=${fmtNum(o90.hitRate, 3)} (n=${o90.n}); overconf95=${fmtNum(o95.hitRate, 3)} (n=${o95.n})`,
      );
      holdoutParts.push(
        `- runtime: total=${(run.ms / 1000).toFixed(1)}s mean=${(run.ms / Math.max(1, run.gamesAttempted)).toFixed(1)}ms/game p95=${percentile(run.gameMs, 0.95).toFixed(1)}ms`,
      );
      holdoutParts.push("");
      holdoutParts.push("### Family gates");
      holdoutParts.push("");
      const gates = label === "v0.2" ? gates02 : gates032;
      holdoutParts.push(...formatGateTable(gates));
      holdoutParts.push("");
      holdoutParts.push("### Dist compare");
      holdoutParts.push("");
      const dists = distCompareFromPairs(run.distPairs);
      if (dists.length) holdoutParts.push(...formatDistTable(dists));
      else holdoutParts.push("_insufficient pairs_");
      holdoutParts.push("");
      holdoutParts.push("### Reliability");
      holdoutParts.push("");
      holdoutParts.push(...formatReliability(run.obs));
      holdoutParts.push("");
    }
  }

  gateParts.push(...formatGateTable(allGates));
  gateParts.push("");
  gateParts.push("## A/B summary (non-CL families)");
  gateParts.push("");
  gateParts.push(
    `| Sport | Family | v0.2 | v0.3.2 | ΔECE | MAD½ 0.2 | MAD½ 0.3.2 |`,
  );
  gateParts.push(`|-------|--------|------|--------|------|----------|------------|`);
  for (const row of abSummary) {
    const dEce =
      row.v02.ece != null && row.v032.ece != null ? row.v032.ece - row.v02.ece : null;
    gateParts.push(
      `| ${row.sport} | ${row.family} | **${row.v02.verdict}** ECE=${fmtNum(row.v02.ece)} | **${row.v032.verdict}** ECE=${fmtNum(row.v032.ece)} | ${fmtNum(dEce)} | ${fmtNum(row.mad02, 3)} | ${fmtNum(row.mad032, 3)} |`,
    );
  }
  gateParts.push("");
  const pass = allGates.filter((g) => g.verdict === "PASS").length;
  const fail = allGates.filter((g) => g.verdict === "FAIL").length;
  const insuff = allGates.filter((g) => g.verdict === "INSUFFICIENT_DATA").length;
  gateParts.push("## Totals");
  gateParts.push("");
  gateParts.push(`- PASS=${pass} FAIL=${fail} INSUFFICIENT_DATA=${insuff}`);
  gateParts.push("- Proxy / missing-identity players graded: **0** (hard reject).");
  gateParts.push("- Production allowlist unchanged; serve remains off.");
  gateParts.push("");

  holdoutParts.push("## Blockers / notes");
  holdoutParts.push("");
  holdoutParts.push(
    "- Closing-line rows remain INSUFFICIENT (unlicensed archive).",
  );
  holdoutParts.push(
    "- Identity gate: only `/^\\d{3,}$/` ESPN athlete ids; `home_qb`-style proxies never enter obs.",
  );
  holdoutParts.push(
    "- `any_td` graded only when boxscore TD columns parse for that named athlete.",
  );
  holdoutParts.push("");

  const oosPath = join(REPORT_DIR, "FOOTBALL_AB_HOLDOUT.md");
  const gatePath = join(REPORT_DIR, "FOOTBALL_AB_GATES.md");
  await writeFile(oosPath, holdoutParts.join("\n"), "utf8");
  await writeFile(gatePath, gateParts.join("\n"), "utf8");
  console.log(`wrote ${oosPath}`);
  console.log(`wrote ${gatePath}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
