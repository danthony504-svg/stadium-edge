/**
 * Phase C.2.2 — chronological OOS for NFL/NCAAF player props (shadow).
 *
 * Named-player grounding: ESPN summary boxscore athlete.id + displayName + team
 * at event; model that playerId; side/team must match; participationStatus
 * confirmed_starter (QB leaders) / active (skill). Leak-free form via walkForward.
 *
 * Gates reported on holdout only; val is diagnostic. Closing-line archive absent
 * → INSUFFICIENT_DATA (eval-grid −110 labeled clearly). No serve / allowlist.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SIM_V2_DEEP_DRAWS } from "../src/version.js";
import { buildJointFootballTensor } from "../src/models/football/jointFootball.js";
import {
  FOOTBALL_PROP_MODEL_VERSION,
  attachFootballPlayerProps,
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
  compareDistributions,
  evaluateFamilyGate,
  formatDistTable,
  formatGateTable,
  formatReliability,
  type CalibObs,
  type DistCompare,
  type FamilyGateRow,
} from "./familyCalibration.js";

const REPORT_DIR = join(import.meta.dirname, "report");
const CACHE_DIR = join(import.meta.dirname, "cache");
const ESPN_PATH: Record<FootballSport, string> = {
  nfl: "football/nfl",
  ncaaf: "football/college-football",
};

type LeaderStat = "pass_yds" | "rush_yds" | "rec_yds";
type ChronoFold = "train" | "val" | "holdout";

type NamedLeader = {
  athleteId: string;
  displayName: string;
  teamId: string;
  teamSide: "home" | "away";
  value: number;
  group: "passing" | "rushing" | "receiving";
  stat: LeaderStat;
};

type LeaderCacheFile = {
  fetchedAt: string;
  sport: FootballSport;
  byEvent: Record<string, NamedLeader[]>;
};

const MAIN_LINE: Record<FootballSport, Record<LeaderStat, number>> = {
  nfl: { pass_yds: 249.5, rush_yds: 64.5, rec_yds: 54.5 },
  ncaaf: { pass_yds: 239.5, rush_yds: 74.5, rec_yds: 59.5 },
};

/** Extreme alts for overconfidence band audit (eval-grid −110, not CL). */
const ALT_LINES: Record<LeaderStat, number[]> = {
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

function usageFor(role: FootballPropRole, stat: LeaderStat): number {
  if (role === "qb" && stat === "pass_yds") return 0.95;
  if (role === "qb" && stat === "rush_yds") return 0.95;
  if (role === "rb") return 0.62;
  return 0.32;
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
  const r = await fetch(url, { headers: { "User-Agent": "stadium-edge-sim-v2-prop-oos" } });
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

  // Best yardage per (side, stat) — named athlete identity.
  const best = new Map<string, NamedLeader>();

  const consider = (
    group: NamedLeader["group"],
    stat: LeaderStat,
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
        for (const a of st.athletes ?? []) {
          const athleteId = String(a.athlete?.id ?? "").trim();
          if (!athleteId) continue;
          const raw = a.stats?.[yi];
          const v = Number(String(raw ?? "").replace(/,/g, ""));
          if (!Number.isFinite(v)) continue;
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
          });
        }
      }
    }
  };

  consider("passing", "pass_yds", ["passingyards", "yds"]);
  consider("rushing", "rush_yds", ["rushingyards", "yds"]);
  consider("receiving", "rec_yds", ["receivingyards", "yds"]);
  return [...best.values()];
}

function buildRoster(leaders: NamedLeader[]): FootballPropPlayerInput[] {
  const byId = new Map<
    string,
    { leader: NamedLeader; groups: Set<NamedLeader["group"]>; stats: Set<LeaderStat> }
  >();
  for (const L of leaders) {
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
      // Prefer passing-group identity for dual-threat.
      if (L.group === "passing") cur.leader = L;
    }
  }
  const roster: FootballPropPlayerInput[] = [];
  for (const { leader, groups } of byId.values()) {
    const hasPass = groups.has("passing");
    const role = roleForLeader(
      hasPass ? "passing" : leader.group,
      hasPass,
    );
    const primaryStat: LeaderStat = hasPass
      ? "pass_yds"
      : leader.stat;
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

function percentile(xs: Float64Array, p: number): number {
  const arr = Array.from(xs).sort((a, b) => a - b);
  if (!arr.length) return 0;
  const i = Math.min(arr.length - 1, Math.max(0, Math.floor(p * (arr.length - 1))));
  return arr[i]!;
}

type FoldRun = {
  sport: FootballSport;
  fold: ChronoFold;
  label: string;
  gamesAttempted: number;
  gamesWithLeaders: number;
  namedPlayers: number;
  obs: CalibObs[];
  distPairs: Array<{ label: string; actual: number; simMean: number; simVar: number; simP90: number }>;
  ms: number;
};

async function runFold(
  sport: FootballSport,
  fold: ChronoFold,
  label: string,
  games: EligibleGame[],
  leaderCache: LeaderCacheFile,
  opts: { draws: number; maxGames?: number },
): Promise<FoldRun> {
  const slice = opts.maxGames != null ? games.slice(0, opts.maxGames) : games;
  const obs: CalibObs[] = [];
  const distPairs: FoldRun["distPairs"] = [];
  const namedIds = new Set<string>();
  let gamesWithLeaders = 0;
  const t0 = performance.now();
  let fetched = 0;

  for (const eg of slice) {
    const g = eg.game;
    let leaders = leaderCache.byEvent[g.eventId];
    if (!leaders) {
      leaders = await fetchNamedLeaders(sport, g.eventId, g.homeTeamId, g.awayTeamId);
      leaderCache.byEvent[g.eventId] = leaders;
      fetched += 1;
      if (fetched % 25 === 0) await saveLeaderCache(leaderCache);
      await sleep(100);
    }
    if (!leaders.length) continue;
    gamesWithLeaders += 1;

    const roster = buildRoster(leaders);
    for (const p of roster) namedIds.add(p.playerId);

    const tensor = attachFootballPlayerProps({
      tensor: buildJointFootballTensor({
        sport,
        eventId: g.eventId,
        seed: `prop-oos:${sport}:${g.eventId}`,
        nDraws: opts.draws,
        home: { ...eg.homeForm, teamId: g.homeTeamId },
        away: { ...eg.awayForm, teamId: g.awayTeamId },
      }),
      players: roster,
      propSeedSuffix: "c2.2-oos",
    });

    for (const L of leaders) {
      // Require team/side match against game record.
      const expectedTeam = L.teamSide === "home" ? g.homeTeamId : g.awayTeamId;
      if (String(L.teamId) !== String(expectedTeam)) continue;
      if (L.teamSide === "home" && String(expectedTeam) !== String(g.homeTeamId)) continue;
      if (L.teamSide === "away" && String(expectedTeam) !== String(g.awayTeamId)) continue;

      const stats = tensor.players[L.athleteId]?.stats?.[L.stat];
      if (!stats) continue;
      const simMean = mean(stats);
      distPairs.push({
        label: `${sport}:${L.stat}`,
        actual: L.value,
        simMean,
        simVar: variance(stats),
        simP90: percentile(stats, 0.9),
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
          fold,
          isAlt,
          playerId: L.athleteId,
          line,
          namedPlayer: true,
          participationKnown: true,
          realBookLine: false,
        });
      }
    }
  }

  if (fetched > 0) await saveLeaderCache(leaderCache);

  return {
    sport,
    fold,
    label,
    gamesAttempted: slice.length,
    gamesWithLeaders,
    namedPlayers: namedIds.size,
    obs,
    distPairs,
    ms: performance.now() - t0,
  };
}

function distCompareFromPairs(
  pairs: FoldRun["distPairs"],
): DistCompare[] {
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

function gateRowsForHoldout(sport: FootballSport, holdout: CalibObs[]): FamilyGateRow[] {
  const rows: FamilyGateRow[] = [];
  const hold = holdout.filter((o) => o.fold === "holdout");

  rows.push(
    evaluateFamilyGate(`${sport}:player_prop`, hold, { requireNamedPlayer: true }),
  );
  for (const stat of ["pass_yds", "rush_yds", "rec_yds"] as LeaderStat[]) {
    rows.push(
      evaluateFamilyGate(
        `${sport}:player_prop:${stat}`,
        hold.filter((o) => o.slice.startsWith(stat)),
        { requireNamedPlayer: true },
      ),
    );
    rows.push(
      evaluateFamilyGate(
        `${sport}:player_prop:${stat}:main`,
        hold.filter((o) => o.slice === `${stat}:main`),
        { requireNamedPlayer: true },
      ),
    );
    rows.push(
      evaluateFamilyGate(
        `${sport}:player_prop:${stat}:alt`,
        hold.filter((o) => o.slice === `${stat}:alt`),
        { requireNamedPlayer: true },
      ),
    );
  }
  // Closing-line benchmark: no licensed archive → INSUFFICIENT_DATA.
  rows.push(
    evaluateFamilyGate(`${sport}:closing_line_benchmark`, [], {
      requireRealBook: true,
    }),
  );
  // Explicit empty-require path with flag for documentation.
  const clPlaceholder = hold.slice(0, 0);
  rows.push(
    evaluateFamilyGate(`${sport}:closing_line_vs_eval_grid`, clPlaceholder, {
      requireRealBook: true,
    }),
  );
  return rows;
}

function fmtDiag(run: FoldRun): string[] {
  const mains = run.obs.filter((o) => !o.isAlt);
  const alts = run.obs.filter((o) => o.isAlt);
  return [
    `### ${run.sport} / ${run.fold} (${run.label}) — diagnostic`,
    "",
    `- Games attempted: ${run.gamesAttempted}`,
    `- Games with named leaders: ${run.gamesWithLeaders}`,
    `- Distinct named athletes: ${run.namedPlayers}`,
    `- Observations: ${run.obs.length} (main=${mains.length}, alt=${alts.length})`,
    `- Runtime: ${(run.ms / 1000).toFixed(1)}s (mean ${(run.ms / Math.max(1, run.gamesAttempted)).toFixed(0)} ms/game)`,
    "",
  ];
}

async function main() {
  await mkdir(REPORT_DIR, { recursive: true });
  await mkdir(CACHE_DIR, { recursive: true });

  const draws = Number(process.env.PROP_OOS_DRAWS ?? 2000);
  // Aim ≥500 obs/sport; holdout NFL≈285 / NCAAF≈404 games × ~6 leaders × lines.
  const maxHoldout = process.env.PROP_OOS_MAX_HOLDOUT
    ? Number(process.env.PROP_OOS_MAX_HOLDOUT)
    : undefined;
  const maxVal = Number(process.env.PROP_OOS_MAX_VAL ?? 40);

  const oosParts: string[] = [
    "# Phase C.2.2 — Football player prop chronological OOS (named-player)",
    "",
    "Shadow-only. No `SIM_V2_SERVE`, no allowlists, no Coach/P0 wiring.",
    "",
    `- Prop model: \`football.props\` @ **${FOOTBALL_PROP_MODEL_VERSION}** (yard-budget shock σ=0.12; val-fold mean scales).`,
    `- Draws/game: ${draws} (CI deep contract ${SIM_V2_DEEP_DRAWS}).`,
    "- Odds: **eval-grid −110** (explicitly **not** closing lines; archive unlicensed → INSUFFICIENT).",
    "- Identity: ESPN boxscore `athlete.id` + `displayName` + team id; side must match game record.",
    "- Participation: QB leaders `confirmed_starter`; skill leaders `active`.",
    "- Form: walk-forward prior games only (`selectEligibleGames` / `formBeforeKickoff`).",
    "- Gates: **holdout only**; train unused for props; val diagnostic only.",
    "",
  ];

  const gateParts: string[] = [
    "# Football family gates — player props (holdout)",
    "",
    `Thresholds: minOos=${500}, maxEce=${0.04} (from \`SIM_V2_ACCEPTANCE_THRESHOLDS\`).`,
    "",
    "Verdicts: **PASS** | **FAIL** | **INSUFFICIENT_DATA**.",
    "",
    "Closing-line rows are INSUFFICIENT until a licensed archive exists (`CLOSING_LINE_ARCHIVE.md`).",
    "",
  ];

  const allGates: FamilyGateRow[] = [];

  for (const sport of ["nfl", "ncaaf"] as FootballSport[]) {
    console.log(`prop-oos ${sport}: load games...`);
    const plan = DEFAULT_FETCH_PLANS.find((p) => p.sport === sport);
    if (!plan) throw new Error(`no_fetch_plan:${sport}`);
    const { games } = await loadOrFetchGames(plan);
    const { eligible } = selectEligibleGames(games);
    const split = splitChronological(sport, eligible);
    const leaderCache = await loadLeaderCache(sport);

    console.log(
      `prop-oos ${sport}: holdout=${split.holdout.length} val=${split.val.length} (maxHoldout=${maxHoldout ?? "all"})`,
    );

    const holdoutRun = await runFold(
      sport,
      "holdout",
      split.labels.holdout,
      split.holdout,
      leaderCache,
      { draws, maxGames: maxHoldout },
    );
    const valRun = await runFold(sport, "val", split.labels.val, split.val, leaderCache, {
      draws,
      maxGames: maxVal,
    });

    const holdObs = holdoutRun.obs;
    const gates = gateRowsForHoldout(sport, holdObs);
    allGates.push(...gates);

    const dists = distCompareFromPairs(holdoutRun.distPairs);
    const mainHold = holdObs.filter((o) => !o.isAlt);
    const altHold = holdObs.filter((o) => o.isAlt);

    oosParts.push(`# ${sport.toUpperCase()}`);
    oosParts.push("");
    oosParts.push(`- Holdout label: ${split.labels.holdout}`);
    oosParts.push(`- Holdout games attempted: ${holdoutRun.gamesAttempted}`);
    oosParts.push(`- Games with named ESPN leaders: ${holdoutRun.gamesWithLeaders}`);
    oosParts.push(`- Distinct named athletes (holdout): ${holdoutRun.namedPlayers}`);
    oosParts.push(
      `- Settled prop observations (holdout): ${holdObs.length} (main=${mainHold.length}, alt=${altHold.length})`,
    );
    oosParts.push(
      `- Gate minOosSample=500: **${holdObs.length >= 500 ? "met" : "NOT MET / INSUFFICIENT_DATA"}** (n=${holdObs.length})`,
    );
    oosParts.push(`- Mean runtime/game: ${(holdoutRun.ms / Math.max(1, holdoutRun.gamesAttempted)).toFixed(1)} ms`);
    oosParts.push(`- Serve/allowlist: **off** / empty`);
    oosParts.push("");
    oosParts.push("## Holdout family gates");
    oosParts.push("");
    oosParts.push(...formatGateTable(gates));
    oosParts.push("");
    oosParts.push("## Distribution compare (sim mean vs actual leader yards)");
    oosParts.push("");
    if (dists.length) oosParts.push(...formatDistTable(dists));
    else oosParts.push("_insufficient pairs_");
    oosParts.push("");
    oosParts.push("## Reliability (holdout overall)");
    oosParts.push("");
    oosParts.push(...formatReliability(holdObs));
    oosParts.push("");
    oosParts.push("## Extreme alt overconfidence bands (holdout alts)");
    oosParts.push("");
    {
      const altGate = evaluateFamilyGate(`${sport}:alts_extreme`, altHold, {
        requireNamedPlayer: true,
      });
      oosParts.push(
        `- n=${altGate.n}; ECE=${altGate.ece?.toFixed(4) ?? "n/a"}; overconf80 hit=${altGate.overconf80.hitRate?.toFixed(3) ?? "n/a"} (n=${altGate.overconf80.n}); overconf90=${altGate.overconf90.hitRate?.toFixed(3) ?? "n/a"} (n=${altGate.overconf90.n}); overconf95=${altGate.overconf95.hitRate?.toFixed(3) ?? "n/a"} (n=${altGate.overconf95.n})`,
      );
      oosParts.push(`- Reasons: ${altGate.reasons.join("; ") || "—"}`);
    }
    oosParts.push("");
    oosParts.push("## Val fold (diagnostic only — not used for gates)");
    oosParts.push("");
    oosParts.push(...fmtDiag(valRun));
    oosParts.push("## Notes / root causes addressed");
    oosParts.push("");
    oosParts.push(
      "1. **Proxy identity mismatch** — prior OOS modeled synthetic `home_qb`/`home_rb` while grading game leaders; now models ESPN `athlete.id`.",
    );
    oosParts.push(
      "2. **Pass yard budget overconfidence** — teamYardBudget pass coefficient trimmed; multiplicative lognormal shock σ=0.12 on pass/rush/rec budgets per draw.",
    );
    oosParts.push(
      "3. **Closing lines** — INSUFFICIENT (no licensed archive); eval-grid −110 only.",
    );
    oosParts.push("");
  }

  gateParts.push(...formatGateTable(allGates));
  gateParts.push("");
  gateParts.push("## Summary");
  gateParts.push("");
  const pass = allGates.filter((g) => g.verdict === "PASS").length;
  const fail = allGates.filter((g) => g.verdict === "FAIL").length;
  const insuff = allGates.filter((g) => g.verdict === "INSUFFICIENT_DATA").length;
  gateParts.push(`- PASS=${pass} FAIL=${fail} INSUFFICIENT_DATA=${insuff}`);
  gateParts.push(`- Prop model version: ${FOOTBALL_PROP_MODEL_VERSION}`);
  gateParts.push("- Production allowlist unchanged; serve remains off.");
  gateParts.push("");

  const oosPath = join(REPORT_DIR, "FOOTBALL_PROP_OOS.md");
  const gatePath = join(REPORT_DIR, "FOOTBALL_FAMILY_GATES.md");
  await writeFile(oosPath, oosParts.join("\n"), "utf8");
  await writeFile(gatePath, gateParts.join("\n"), "utf8");
  console.log(`wrote ${oosPath}`);
  console.log(`wrote ${gatePath}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
