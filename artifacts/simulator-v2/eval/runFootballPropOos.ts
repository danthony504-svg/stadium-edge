/**
 * Phase C.2 — chronological OOS for NFL/NCAAF player props (shadow).
 * Uses ESPN summary leaders for pass/rush/rec yards on holdout games.
 * Leak-free: form/features from prior games only (game form from walkForward).
 *
 * Does not flip acceptance gates or enable serve.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SIM_V2_DEEP_DRAWS } from "../src/version.js";
import { buildJointFootballTensor } from "../src/models/football/jointFootball.js";
import { attachFootballPlayerProps } from "../src/models/football/playerProps.js";
import { buildFootballPlayerPropMarket } from "../src/models/football/markets.js";
import { settleMarket } from "../src/engine/settle.js";
import { impliedProbFromAmerican } from "../src/schemas/odds.js";
import { brierScore, expectedCalibrationError, logLoss } from "../src/metrics/calibration.js";
import { DEFAULT_FETCH_PLANS, loadOrFetchGames } from "./fetchHistoricalGames.js";
import { selectEligibleGames } from "./walkForward.js";
import { splitChronological } from "./chronoSplits.js";
import type { FootballSport } from "./types.js";

const REPORT_DIR = join(import.meta.dirname, "report");
const ESPN_PATH: Record<FootballSport, string> = {
  nfl: "football/nfl",
  ncaaf: "football/college-football",
};

type LeaderStat = "pass_yds" | "rush_yds" | "rec_yds";

type BoxLeader = { name: string; value: number; teamSide: "home" | "away" };

async function fetchLeaders(sport: FootballSport, eventId: string): Promise<Partial<Record<LeaderStat, BoxLeader>>> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${ESPN_PATH[sport]}/summary?event=${eventId}`;
  const r = await fetch(url, { headers: { "User-Agent": "stadium-edge-sim-v2-prop-oos" } });
  if (!r.ok) return {};
  const j = (await r.json()) as {
    boxscore?: {
      players?: Array<{
        team?: { id?: string };
        statistics?: Array<{
          name?: string;
          athletes?: Array<{ athlete?: { displayName?: string }; stats?: string[] }>;
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
  const homeId = comps.find((c) => c.homeAway === "home")?.team?.id;
  const awayId = comps.find((c) => c.homeAway === "away")?.team?.id;
  const out: Partial<Record<LeaderStat, BoxLeader>> = {};

  const pickYard = (
    groupName: string,
    key: string,
    stat: LeaderStat,
  ): void => {
    for (const teamBlock of j.boxscore?.players ?? []) {
      const side: "home" | "away" | null =
        teamBlock.team?.id && teamBlock.team.id === homeId
          ? "home"
          : teamBlock.team?.id && teamBlock.team.id === awayId
            ? "away"
            : null;
      if (!side) continue;
      for (const st of teamBlock.statistics ?? []) {
        if ((st.name ?? "").toLowerCase() !== groupName) continue;
        const keys = st.keys ?? st.labels ?? [];
        const yi = keys.findIndex((k) => k.toLowerCase() === key || k.toLowerCase() === "yds");
        if (yi < 0) continue;
        for (const a of st.athletes ?? []) {
          const raw = a.stats?.[yi];
          const v = Number(raw);
          if (!Number.isFinite(v)) continue;
          const name = a.athlete?.displayName ?? "unknown";
          const prev = out[stat];
          if (!prev || v > prev.value) out[stat] = { name, value: v, teamSide: side };
        }
      }
    }
  };

  pickYard("passing", "yds", "pass_yds");
  pickYard("rushing", "yds", "rush_yds");
  pickYard("receiving", "yds", "rec_yds");
  return out;
}

type Obs = { y: 0 | 1; p: number; eventId: string; stat: LeaderStat; line: number };

function summarize(obs: Obs[]) {
  if (!obs.length) {
    return { n: 0, brier: null as number | null, logLoss: null as number | null, ece: null as number | null };
  }
  const pairs = obs.map((o) => ({ y: o.y, p: o.p }));
  return {
    n: obs.length,
    brier: brierScore(pairs),
    logLoss: logLoss(pairs),
    ece: expectedCalibrationError(pairs, 10),
  };
}

async function runSport(sport: FootballSport, maxHoldout = 40, draws = 2000): Promise<string> {
  const plan = DEFAULT_FETCH_PLANS.find((p) => p.sport === sport);
  if (!plan) throw new Error(`no_fetch_plan:${sport}`);
  const { games } = await loadOrFetchGames(plan);
  const { eligible } = selectEligibleGames(games);
  const split = splitChronological(sport, eligible);
  const holdout = split.holdout.slice(0, maxHoldout);
  const obs: Obs[] = [];
  const t0 = performance.now();
  let leadersFetched = 0;

  for (const eg of holdout) {
    const g = eg.game;
    const leaders = await fetchLeaders(sport, g.eventId);
    if (Object.keys(leaders).length) leadersFetched += 1;
    await new Promise((r) => setTimeout(r, 120));

    const tensor = attachFootballPlayerProps({
      tensor: buildJointFootballTensor({
        sport,
        eventId: g.eventId,
        seed: `prop-oos:${sport}:${g.eventId}`,
        nDraws: draws,
        home: eg.homeForm,
        away: eg.awayForm,
      }),
      players: [
        { playerId: "home_qb", teamSide: "home", role: "qb", usage: 0.95, participationStatus: "confirmed_starter" },
        { playerId: "home_rb", teamSide: "home", role: "rb", usage: 0.6 },
        { playerId: "home_wr", teamSide: "home", role: "wr", usage: 0.3 },
        { playerId: "away_qb", teamSide: "away", role: "qb", usage: 0.95, participationStatus: "confirmed_starter" },
        { playerId: "away_rb", teamSide: "away", role: "rb", usage: 0.6 },
        { playerId: "away_wr", teamSide: "away", role: "wr", usage: 0.3 },
      ],
    });

    const specs: Array<{ stat: LeaderStat; playerId: string; line: number }> = [
      { stat: "pass_yds", playerId: "home_qb", line: 249.5 },
      { stat: "pass_yds", playerId: "away_qb", line: 224.5 },
      { stat: "rush_yds", playerId: "home_rb", line: 64.5 },
      { stat: "rec_yds", playerId: "home_wr", line: 54.5 },
    ];

    for (const spec of specs) {
      const leader = leaders[spec.stat];
      // Only grade when leader side matches the modeled player side.
      const side = spec.playerId.startsWith("home") ? "home" : "away";
      if (!leader || leader.teamSide !== side) continue;
      const market = buildFootballPlayerPropMarket({
        marketId: `${g.eventId}:${spec.stat}:${spec.line}`,
        eventId: g.eventId,
        sport,
        playerId: spec.playerId,
        stat: spec.stat,
        side: "over",
        line: spec.line,
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
          provenance: { provider: "eval-grid", fetchedAt: new Date().toISOString() },
        },
      });
      if (settled.status !== "ok" || settled.simHit == null) continue;
      const y: 0 | 1 = leader.value > spec.line ? 1 : 0;
      obs.push({ y, p: settled.simHit, eventId: g.eventId, stat: spec.stat, line: spec.line });
    }
  }

  const ms = performance.now() - t0;
  const p95Proxy = ms / Math.max(1, holdout.length);
  const byStat: Record<string, ReturnType<typeof summarize>> = {};
  for (const stat of ["pass_yds", "rush_yds", "rec_yds"] as LeaderStat[]) {
    byStat[stat] = summarize(obs.filter((o) => o.stat === stat));
  }
  const overall = summarize(obs);

  const lines: string[] = [];
  lines.push(`# Football prop chronological OOS (${sport})`);
  lines.push("");
  lines.push(`- Holdout label: ${split.labels.holdout}`);
  lines.push(`- Holdout games attempted: ${holdout.length}`);
  lines.push(`- Games with ESPN leaders: ${leadersFetched}`);
  lines.push(`- Settled prop observations: ${overall.n}`);
  lines.push(`- Draws/game: ${draws} (CI contract uses ${SIM_V2_DEEP_DRAWS})`);
  lines.push(`- Mean runtime/game: ${p95Proxy.toFixed(1)} ms (proxy; not full p95 bench)`);
  lines.push(`- Serve/allowlist: **off** / empty`);
  lines.push("");
  lines.push("| Slice | n | Brier | LogLoss | ECE |");
  lines.push("|-------|---|-------|---------|-----|");
  const row = (name: string, s: ReturnType<typeof summarize>) =>
    `| ${name} | ${s.n} | ${s.brier?.toFixed(4) ?? "n/a"} | ${s.logLoss?.toFixed(4) ?? "n/a"} | ${s.ece?.toFixed(4) ?? "n/a"} |`;
  lines.push(row("overall", overall));
  for (const [k, v] of Object.entries(byStat)) lines.push(row(k, v));
  lines.push("");
  lines.push("## Notes / defects");
  lines.push("- Leader-vs-line is a **proxy** identity (game leader, not named book player). Full name matching remains a blocker.");
  lines.push("- Grid lines (−110) are not closing lines (archive not ingested).");
  lines.push(`- Gate minOosSample=500: **${overall.n >= 500 ? "met" : "NOT MET"}** (n=${overall.n}).`);
  lines.push("- Production allowlist unchanged.");
  return lines.join("\n");
}

async function main() {
  await mkdir(REPORT_DIR, { recursive: true });
  const sports: FootballSport[] = ["nfl", "ncaaf"];
  const parts: string[] = [
    "# Phase C.2 — Football player prop chronological OOS",
    "",
    "Shadow-only. No serve / allowlist changes.",
    "",
  ];
  for (const sport of sports) {
    console.log(`prop-oos ${sport}...`);
    parts.push(await runSport(sport));
    parts.push("");
  }
  const path = join(REPORT_DIR, "FOOTBALL_PROP_OOS.md");
  await writeFile(path, parts.join("\n"), "utf8");
  console.log(`wrote ${path}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
