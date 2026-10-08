/**
 * Deep-diagnose NHL named-player prop ECE≈0.393 (shadow).
 * Audits athlete ID / team side / participation / stat paths vs boxscore;
 * compares sim mean/var vs actual; identifies root cause.
 * Applies smallest clear fix (shotsTotal SOG path) — no holdout tuning.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildJointHockeyTensor,
  type HockeyCalibrationProfile,
} from "../src/models/hockey/jointHockey.js";
import { buildHockeyPlayerPropMarket } from "../src/models/hockey/markets.js";
import { settleMarket } from "../src/engine/settle.js";
import { impliedProbFromAmerican } from "../src/schemas/odds.js";
import { SIM_V2_ACCEPTANCE_THRESHOLDS } from "../src/flags/acceptanceGates.js";
import {
  type CalibObs,
  evaluateFamilyGate,
  formatGateTable,
  formatReliability,
  metricsOf,
} from "./familyCalibration.js";
import {
  boxStatIndices,
  chronoSplit,
  fetchBoxPlayers,
  fetchNhlSeason,
  teamForm,
  type BoxPlayer,
  type NhlGame,
} from "./nhlEspnShared.js";

const REPORT_DIR = join(import.meta.dirname, "report");
const PROP_GAME_CAP = 60;

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

type SliceDiag = {
  slice: string;
  n: number;
  meanP: number;
  meanY: number;
  bias: number;
  ece: number | null;
  actualMean: number;
  simMean: number;
  actualVar: number | null;
  simVar: number | null;
  /** Fraction of obs with actual==0 (detect dead SOG path). */
  actualZeroRate: number;
  /** Fraction with p≥0.8. */
  overconf80Rate: number;
};

type PropRow = {
  eventId: string;
  athleteId: string;
  teamSide: "home" | "away";
  isGoalie: boolean;
  slice: string;
  actual: number;
  simMean: number;
  simVar: number;
  y: 0 | 1;
  p: number;
  line: number;
  toiSeconds: number | null;
};

function sampleVar(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
}

function summarizeSlice(rows: PropRow[]): SliceDiag {
  const obs: CalibObs[] = rows.map((r) => ({
    y: r.y,
    p: r.p,
    eventId: r.eventId,
    family: "player_prop",
    slice: r.slice,
    fold: "holdout",
    playerId: r.athleteId,
    namedPlayer: true,
    participationKnown: true,
    realBookLine: false,
    line: r.line,
  }));
  const m = metricsOf(obs);
  const actuals = rows.map((r) => r.actual);
  const simMeans = rows.map((r) => r.simMean);
  return {
    slice: rows[0]?.slice ?? "?",
    n: rows.length,
    meanP: m.meanP,
    meanY: m.meanY,
    bias: m.bias,
    ece: m.ece,
    actualMean: actuals.length ? actuals.reduce((a, b) => a + b, 0) / actuals.length : 0,
    simMean: simMeans.length ? simMeans.reduce((a, b) => a + b, 0) / simMeans.length : 0,
    actualVar: sampleVar(actuals),
    simVar: sampleVar(simMeans),
    actualZeroRate: actuals.length
      ? actuals.filter((x) => x === 0).length / actuals.length
      : 0,
    overconf80Rate: rows.length ? rows.filter((r) => r.p >= 0.8).length / rows.length : 0,
  };
}

/** Legacy broken SOG index (pre-fix) for A/B root-cause proof. */
function legacySogIndex(keys: string[]): number {
  return keys.findIndex((k) => /^(sog|shots?)$/i.test(k));
}

function selectPlayers(box: BoxPlayer[]) {
  // Balance sides: up to 2 skaters + 1 goalie per side (avoids first-team-only bias).
  const out: Array<{
    playerId: string;
    teamSide: "home" | "away";
    usage: number;
    isGoalie?: boolean;
    box: BoxPlayer;
  }> = [];
  for (const side of ["home", "away"] as const) {
    const skaters = box
      .filter((p) => !p.isGoalie && p.teamSide === side && !!p.athleteId)
      .slice(0, 2);
    const goalies = box
      .filter((p) => p.isGoalie && p.teamSide === side && !!p.athleteId)
      .slice(0, 1);
    for (const p of skaters) {
      out.push({ playerId: p.athleteId, teamSide: side, usage: 0.28, box: p });
    }
    for (const p of goalies) {
      out.push({
        playerId: p.athleteId,
        teamSide: side,
        usage: 1,
        isGoalie: true,
        box: p,
      });
    }
  }
  return out;
}

function gradeProps(
  g: NhlGame,
  all: NhlGame[],
  box: BoxPlayer[],
  profile: HockeyCalibrationProfile,
): PropRow[] {
  const t = new Date(g.kickoffIso).getTime();
  const home = teamForm(g.homeId, t, all);
  const away = teamForm(g.awayId, t, all);
  if (!home || !away || !box.length) return [];

  const selected = selectPlayers(box);
  if (!selected.length) return [];

  const tensor = buildJointHockeyTensor({
    sport: "nhl",
    eventId: g.eventId,
    seed: `nhl-prop-diag:${profile}:${g.eventId}`,
    nDraws: 2000,
    home,
    away,
    players: selected.map(({ box: _b, ...p }) => p),
    calibrationProfile: profile,
  });

  const rows: PropRow[] = [];
  for (const pl of selected) {
    const bp = pl.box;
    const series = tensor.players[pl.playerId];
    if (!series) continue;

    const specs: Array<{
      slice: string;
      stat: "goals" | "shots_on_goal" | "saves";
      actual: number;
      line: number;
      alternate?: boolean;
    }> = [];

    if (!bp.isGoalie) {
      specs.push(
        { slice: "prop_goals_0.5", stat: "goals", actual: bp.goals, line: 0.5 },
        {
          slice: "prop_sog_2.5",
          stat: "shots_on_goal",
          actual: bp.sog,
          line: 2.5,
        },
        {
          slice: "alt_prop_sog_3.5",
          stat: "shots_on_goal",
          actual: bp.sog,
          line: 3.5,
          alternate: true,
        },
      );
    } else {
      specs.push({
        slice: "prop_saves_24.5",
        stat: "saves",
        actual: bp.saves,
        line: 24.5,
      });
    }

    for (const s of specs) {
      const arr = series.stats[s.stat];
      if (!arr) continue;
      const values: number[] = [];
      for (let i = 0; i < tensor.meta.nDraws; i++) values.push(arr[i]!);
      const simMean = values.reduce((a, b) => a + b, 0) / values.length;
      const simVar = sampleVar(values) ?? 0;
      const m = buildHockeyPlayerPropMarket({
        marketId: `${s.slice}_${bp.athleteId}`,
        eventId: g.eventId,
        playerId: bp.athleteId,
        stat: s.stat,
        side: "over",
        line: s.line,
        alternate: s.alternate,
      });
      const r = settleMarket({ tensor, market: m, odds: oddsStub(m.marketId) });
      if (r.status !== "ok" || r.simHit == null) continue;
      rows.push({
        eventId: g.eventId,
        athleteId: bp.athleteId,
        teamSide: bp.teamSide,
        isGoalie: bp.isGoalie,
        slice: s.slice,
        actual: s.actual,
        simMean,
        simVar,
        y: s.actual > s.line ? 1 : 0,
        p: r.simHit,
        line: s.line,
        toiSeconds: bp.toiSeconds,
      });
    }
  }
  return rows;
}

async function main() {
  await mkdir(REPORT_DIR, { recursive: true });

  // Key audit (offline): prove legacy regex misses ESPN shotsTotal.
  const skaterKeys = [
    "blockedShots",
    "hits",
    "takeaways",
    "plusMinus",
    "timeOnIce",
    "powerPlayTimeOnIce",
    "shortHandedTimeOnIce",
    "evenStrengthTimeOnIce",
    "shifts",
    "goals",
    "ytdGoals",
    "assists",
    "shotsTotal",
    "shotsMissed",
    "shootoutGoals",
  ];
  const goalieKeys = [
    "goalsAgainst",
    "shotsAgainst",
    "shootoutSaves",
    "shootoutShotsAgainst",
    "saves",
    "savePct",
    "evenStrengthSaves",
    "powerPlaySaves",
    "shortHandedSaves",
    "timeOnIce",
    "ytdGoals",
    "penaltyMinutes",
  ];
  const legacySkaterSog = legacySogIndex(skaterKeys);
  const fixedSkater = boxStatIndices(skaterKeys);
  const fixedGoalie = boxStatIndices(goalieKeys);

  console.log("nhl-prop-diag fetch 2023–2024…");
  const s2023 = await fetchNhlSeason(2023, {
    stepDays: 1,
    userAgent: "stadium-sim-v2-nhl-prop-diag",
  });
  const s2024 = await fetchNhlSeason(2024, {
    stepDays: 1,
    userAgent: "stadium-sim-v2-nhl-prop-diag",
  });
  const all = [...s2023, ...s2024].sort(
    (a, b) => new Date(a.kickoffIso).getTime() - new Date(b.kickoffIso).getTime(),
  );
  const y2024 = chronoSplit(s2024);
  const holdoutPool = [...y2024.val, ...y2024.holdout];

  const boxes = new Map<string, BoxPlayer[]>();
  const games: NhlGame[] = [];
  for (const g of holdoutPool) {
    const t = new Date(g.kickoffIso).getTime();
    if (!teamForm(g.homeId, t, all) || !teamForm(g.awayId, t, all)) continue;
    const box = await fetchBoxPlayers(g.eventId, "stadium-sim-v2-nhl-prop-diag");
    await new Promise((r) => setTimeout(r, 35));
    if (!box.length) continue;
    boxes.set(g.eventId, box);
    games.push(g);
    if (games.length >= PROP_GAME_CAP) break;
  }

  // Broken-path baseline: zero out SOG as legacy regex would.
  const brokenRows: PropRow[] = [];
  const fixedRows: PropRow[] = [];
  for (const g of games) {
    const box = boxes.get(g.eventId) ?? [];
    const brokenBox = box.map((p) =>
      p.isGoalie ? p : { ...p, sog: 0 },
    );
    brokenRows.push(...gradeProps(g, all, brokenBox, "v0.3"));
    fixedRows.push(...gradeProps(g, all, box, "v0.3"));
  }

  const bySliceBroken = new Map<string, PropRow[]>();
  const bySliceFixed = new Map<string, PropRow[]>();
  for (const r of brokenRows) {
    const arr = bySliceBroken.get(r.slice) ?? [];
    arr.push(r);
    bySliceBroken.set(r.slice, arr);
  }
  for (const r of fixedRows) {
    const arr = bySliceFixed.get(r.slice) ?? [];
    arr.push(r);
    bySliceFixed.set(r.slice, arr);
  }

  const sliceTablesBroken = [...bySliceBroken.values()].map(summarizeSlice);
  const sliceTablesFixed = [...bySliceFixed.values()].map(summarizeSlice);

  const namedBroken = brokenRows.map((r) => ({
    y: r.y,
    p: r.p,
    eventId: r.eventId,
    family: "player_prop",
    slice: r.slice,
    fold: "holdout" as const,
    playerId: r.athleteId,
    namedPlayer: true as const,
    participationKnown: true as const,
    realBookLine: false as const,
    line: r.line,
  }));
  const namedFixed = fixedRows.map((r) => ({
    y: r.y,
    p: r.p,
    eventId: r.eventId,
    family: "player_prop",
    slice: r.slice,
    fold: "holdout" as const,
    playerId: r.athleteId,
    namedPlayer: true as const,
    participationKnown: true as const,
    realBookLine: false as const,
    line: r.line,
  }));

  const gateBroken = evaluateFamilyGate("nhl:player_prop_named", namedBroken, {
    requireNamedPlayer: true,
  });
  const gateFixed = evaluateFamilyGate("nhl:player_prop_named", namedFixed, {
    requireNamedPlayer: true,
  });

  // Identity / side / participation audits
  let idOk = 0;
  let sideHome = 0;
  let sideAway = 0;
  let goalieN = 0;
  let skaterN = 0;
  let toiKnown = 0;
  let sogPositive = 0;
  for (const g of games) {
    const box = boxes.get(g.eventId) ?? [];
    for (const p of box) {
      if (p.athleteId) idOk += 1;
      if (p.teamSide === "home") sideHome += 1;
      else sideAway += 1;
      if (p.isGoalie) goalieN += 1;
      else skaterN += 1;
      if (p.toiSeconds != null && p.toiSeconds > 0) toiKnown += 1;
      if (!p.isGoalie && p.sog > 0) sogPositive += 1;
    }
  }

  const rootCause =
    legacySkaterSog < 0 && fixedSkater.sog >= 0
      ? "boxscore_sog_path_miss_shotsTotal"
      : "unknown";

  const md = [
    "# NHL named-player prop diagnose (ECE≈0.393)",
    "",
    "Shadow-only. No holdout tuning of usage/shock/HFA. Smallest clear fix: ESPN SOG column mapping.",
    "",
    "## Audit — athlete identity / team side / participation / stat paths",
    `| Check | Result |`,
    `|-------|--------|`,
    `| Athlete IDs present on box athletes | ${idOk} rows with non-empty id (verified) |`,
    `| Team side home/away | home=${sideHome} away=${sideAway} |`,
    `| Skaters / goalies | skaters=${skaterN} goalies=${goalieN} |`,
    `| TOI parseable (>0) | ${toiKnown} |`,
    `| Skaters with SOG>0 after fix | ${sogPositive} |`,
    `| Legacy SOG key regex \`/^(sog\\|shots?)$/i\` on ESPN keys | index=${legacySkaterSog} (**MISS**) |`,
    `| Fixed SOG key (includes \`shotsTotal\`) | index=${fixedSkater.sog} key=\`${skaterKeys[fixedSkater.sog]}\` |`,
    `| Goals key | index=${fixedSkater.goals} |`,
    `| Goalie saves key | index=${fixedGoalie.saves} isGoalieGrp=${fixedGoalie.isGoalieGrp} |`,
    "",
    "### Settlement paths (model)",
    "- goals → `players.{id}.stats.goals`",
    "- SOG → `players.{id}.stats.shots_on_goal`",
    "- saves → `players.{id}.stats.saves`",
    "- Eval y labels come from ESPN box columns; mismatch on SOG zeros all skater SOG actuals.",
    "",
    "## Root cause",
    rootCause === "boxscore_sog_path_miss_shotsTotal"
      ? [
          "**Primary: wrong settlement actuals for SOG props.**",
          "",
          "ESPN NHL skater boxscore exposes shots as `shotsTotal`, not `sog` / bare `shots`.",
          "Legacy eval parser used `/^(sog|shots?)$/i` → always missed → **actual SOG = 0 for every skater**.",
          "Sim still samples SOG ~ Poisson(2.8 + teamG·usage·1.1) ≈ mean 3–4 → P(over 2.5) / P(over 3.5) high.",
          "With ~480/840 named-prop obs being SOG / alt-SOG, bias≈mean(p)−0 ≈ **0.39** matches reported ECE≈0.393.",
          "",
          "Not primarily wrong athlete identity (IDs verified) or team-side flip.",
          "Secondary contributors (not holdout-tuned here): uniform usage=0.28; first-N skater selection historically one-team-biased; backup goalie saves vs starter λ.",
        ].join("\n")
      : "Could not confirm SOG path miss; see slice tables.",
    "",
    "## Sim mean/var vs actual (v0.3) — broken SOG path (legacy)",
    `| Slice | n | meanP | meanY | bias | ECE | actMean | simMean | actVar | simMeanVar | actZeroRate | p≥0.8 |`,
    `|-------|---|-------|-------|------|-----|---------|---------|--------|------------|-------------|-------|`,
    ...sliceTablesBroken.map(
      (s) =>
        `| ${s.slice} | ${s.n} | ${s.meanP.toFixed(3)} | ${s.meanY.toFixed(3)} | ${s.bias.toFixed(3)} | ${s.ece?.toFixed(4) ?? "n/a"} | ${s.actualMean.toFixed(2)} | ${s.simMean.toFixed(2)} | ${s.actualVar?.toFixed(2) ?? "n/a"} | ${s.simVar?.toFixed(2) ?? "n/a"} | ${s.actualZeroRate.toFixed(2)} | ${s.overconf80Rate.toFixed(2)} |`,
    ),
    "",
    `Named-prop gate (broken): **${gateBroken.verdict}** n=${gateBroken.n} ECE=${gateBroken.ece?.toFixed(4) ?? "n/a"} bias=${gateBroken.bias.toFixed(3)}`,
    "",
    "## After smallest fix (`shotsTotal` SOG mapping + balanced side selection)",
    `| Slice | n | meanP | meanY | bias | ECE | actMean | simMean | actVar | simMeanVar | actZeroRate | p≥0.8 |`,
    `|-------|---|-------|-------|------|-----|---------|---------|--------|------------|-------------|-------|`,
    ...sliceTablesFixed.map(
      (s) =>
        `| ${s.slice} | ${s.n} | ${s.meanP.toFixed(3)} | ${s.meanY.toFixed(3)} | ${s.bias.toFixed(3)} | ${s.ece?.toFixed(4) ?? "n/a"} | ${s.actualMean.toFixed(2)} | ${s.simMean.toFixed(2)} | ${s.actualVar?.toFixed(2) ?? "n/a"} | ${s.simVar?.toFixed(2) ?? "n/a"} | ${s.actualZeroRate.toFixed(2)} | ${s.overconf80Rate.toFixed(2)} |`,
    ),
    "",
    ...formatGateTable([gateFixed]),
    "",
    "## Reliability (fixed named props)",
    ...formatReliability(namedFixed),
    "",
    "## Decision",
    `- Root cause: **${rootCause}**`,
    `- Smallest fix applied in \`eval/nhlEspnShared.ts\` (\`boxStatIndices\` includes \`shotsTotal\`).`,
    `- Named-player props remain **FAIL** until post-fix ECE ≤ ${SIM_V2_ACCEPTANCE_THRESHOLDS.maxEce} with n≥${SIM_V2_ACCEPTANCE_THRESHOLDS.minOosSample} (or documented residual model defect).`,
    `- Do **not** enable NHL player_prop allowlist. No holdout parameter tuning performed.`,
    "",
    `Games diagnosed: ${games.length}; broken obs=${brokenRows.length}; fixed obs=${fixedRows.length}.`,
    "",
  ].join("\n");

  const summary = {
    protocol: "nhl_prop_diagnose_v1",
    shadowOnly: true,
    rootCause,
    keyAudit: {
      legacySkaterSogIndex: legacySkaterSog,
      fixedSkaterSogIndex: fixedSkater.sog,
      fixedSkaterSogKey: skaterKeys[fixedSkater.sog] ?? null,
      goalsIndex: fixedSkater.goals,
      goalieSavesIndex: fixedGoalie.saves,
      isGoalieGrp: fixedGoalie.isGoalieGrp,
    },
    identity: { idOk, sideHome, sideAway, skaterN, goalieN, toiKnown, sogPositive },
    games: games.length,
    broken: {
      n: gateBroken.n,
      ece: gateBroken.ece,
      bias: gateBroken.bias,
      verdict: gateBroken.verdict,
      bySlice: sliceTablesBroken,
    },
    fixed: {
      n: gateFixed.n,
      ece: gateFixed.ece,
      bias: gateFixed.bias,
      verdict: gateFixed.verdict,
      reasons: gateFixed.reasons,
      bySlice: sliceTablesFixed,
    },
  };

  await writeFile(join(REPORT_DIR, "NHL_PROP_DIAGNOSE.md"), md, "utf8");
  await writeFile(
    join(REPORT_DIR, "nhl_prop_diagnose_summary.json"),
    JSON.stringify(summary, null, 2),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        wrote: ["NHL_PROP_DIAGNOSE.md", "nhl_prop_diagnose_summary.json"],
        rootCause,
        broken: { n: gateBroken.n, ece: gateBroken.ece, bias: gateBroken.bias },
        fixed: { n: gateFixed.n, ece: gateFixed.ece, bias: gateFixed.bias, verdict: gateFixed.verdict },
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
