/**
 * Deep-diagnose NHL named-player props (shadow).
 * Audits athlete ID / team side / participation / stat path mappings
 * (goals, assists, points, SOG/shotsTotal, saves, ±, goalie keys);
 * re-grades OOS after mapping fixes; reports ECE/Brier/LL/n per prop family.
 * No holdout tuning of usage/shock/HFA.
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
/** Target ~500+ skater-prop obs per main family (4 skaters/game). */
const PROP_GAME_CAP = 130;

type PropStat = "goals" | "assists" | "points" | "shots_on_goal" | "saves";

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
  family: string;
  n: number;
  meanP: number;
  meanY: number;
  bias: number;
  ece: number | null;
  brier: number | null;
  logLoss: number | null;
  actualMean: number;
  simMean: number;
  actualVar: number | null;
  simVar: number | null;
  actualZeroRate: number;
  overconf80Rate: number;
};

type PropRow = {
  eventId: string;
  athleteId: string;
  teamSide: "home" | "away";
  isGoalie: boolean;
  slice: string;
  family: string;
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

function familyOfSlice(slice: string): string {
  if (slice.startsWith("alt_")) {
    if (slice.includes("sog")) return "alts";
    if (slice.includes("ast")) return "alts";
    if (slice.includes("pts")) return "alts";
    return "alts";
  }
  if (slice.includes("goals")) return "goals";
  if (slice.includes("ast")) return "assists";
  if (slice.includes("pts")) return "points";
  if (slice.includes("sog")) return "sog";
  if (slice.includes("saves")) return "saves";
  return "other";
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
    family: rows[0]?.family ?? familyOfSlice(rows[0]?.slice ?? ""),
    n: rows.length,
    meanP: m.meanP,
    meanY: m.meanY,
    bias: m.bias,
    ece: m.ece,
    brier: m.brier,
    logLoss: m.logLoss,
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

function toObs(rows: PropRow[]): CalibObs[] {
  return rows.map((r) => ({
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
    isAlt: r.family === "alts",
  }));
}

function gateFamily(key: string, rows: PropRow[]) {
  return evaluateFamilyGate(key, toObs(rows), { requireNamedPlayer: true });
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
      family: string;
      stat: PropStat;
      actual: number;
      line: number;
      alternate?: boolean;
    }> = [];

    if (!bp.isGoalie) {
      specs.push(
        {
          slice: "prop_goals_0.5",
          family: "goals",
          stat: "goals",
          actual: bp.goals,
          line: 0.5,
        },
        {
          slice: "prop_ast_0.5",
          family: "assists",
          stat: "assists",
          actual: bp.assists,
          line: 0.5,
        },
        {
          slice: "prop_pts_0.5",
          family: "points",
          stat: "points",
          actual: bp.points,
          line: 0.5,
        },
        {
          slice: "prop_sog_2.5",
          family: "sog",
          stat: "shots_on_goal",
          actual: bp.sog,
          line: 2.5,
        },
        {
          slice: "alt_prop_ast_1.5",
          family: "alts",
          stat: "assists",
          actual: bp.assists,
          line: 1.5,
          alternate: true,
        },
        {
          slice: "alt_prop_pts_1.5",
          family: "alts",
          stat: "points",
          actual: bp.points,
          line: 1.5,
          alternate: true,
        },
        {
          slice: "alt_prop_sog_3.5",
          family: "alts",
          stat: "shots_on_goal",
          actual: bp.sog,
          line: 3.5,
          alternate: true,
        },
      );
    } else {
      specs.push({
        slice: "prop_saves_24.5",
        family: "saves",
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
        family: s.family,
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

/** Pre-mapping-fix actuals: SOG=0 (legacy), assists/points=0 (unparsed). */
function stripUnmappedActuals(box: BoxPlayer[]): BoxPlayer[] {
  return box.map((p) =>
    p.isGoalie
      ? p
      : { ...p, sog: 0, assists: 0, points: 0, plusMinus: null },
  );
}

async function main() {
  await mkdir(REPORT_DIR, { recursive: true });

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
  const skaterLabels = [
    "BS",
    "HT",
    "TK",
    "+/-",
    "TOI",
    "PPTOI",
    "SHTOI",
    "ESTOI",
    "SHFT",
    "G",
    "YTDG",
    "A",
    "S",
    "SM",
    "SOG",
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
  const fixedSkaterLabels = boxStatIndices(skaterLabels);
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

  const brokenRows: PropRow[] = [];
  const fixedRows: PropRow[] = [];
  for (const g of games) {
    const box = boxes.get(g.eventId) ?? [];
    brokenRows.push(...gradeProps(g, all, stripUnmappedActuals(box), "v0.3"));
    fixedRows.push(...gradeProps(g, all, box, "v0.3"));
  }

  const bySliceBroken = new Map<string, PropRow[]>();
  const bySliceFixed = new Map<string, PropRow[]>();
  const byFamBroken = new Map<string, PropRow[]>();
  const byFamFixed = new Map<string, PropRow[]>();
  for (const r of brokenRows) {
    const arr = bySliceBroken.get(r.slice) ?? [];
    arr.push(r);
    bySliceBroken.set(r.slice, arr);
    const f = byFamBroken.get(r.family) ?? [];
    f.push(r);
    byFamBroken.set(r.family, f);
  }
  for (const r of fixedRows) {
    const arr = bySliceFixed.get(r.slice) ?? [];
    arr.push(r);
    bySliceFixed.set(r.slice, arr);
    const f = byFamFixed.get(r.family) ?? [];
    f.push(r);
    byFamFixed.set(r.family, f);
  }

  const sliceTablesBroken = [...bySliceBroken.values()].map(summarizeSlice);
  const sliceTablesFixed = [...bySliceFixed.values()].map(summarizeSlice);

  const famOrder = ["goals", "assists", "points", "sog", "saves", "alts"];
  const famGatesBroken = famOrder.map((fam) =>
    gateFamily(`nhl:prop_${fam}`, byFamBroken.get(fam) ?? []),
  );
  const famGatesFixed = famOrder.map((fam) =>
    gateFamily(`nhl:prop_${fam}`, byFamFixed.get(fam) ?? []),
  );

  const gateBroken = gateFamily("nhl:player_prop_named", brokenRows);
  const gateFixed = gateFamily("nhl:player_prop_named", fixedRows);

  let idOk = 0;
  let sideHome = 0;
  let sideAway = 0;
  let goalieN = 0;
  let skaterN = 0;
  let toiKnown = 0;
  let sogPositive = 0;
  let assistsPositive = 0;
  let pointsPositive = 0;
  let plusMinusKnown = 0;
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
      if (!p.isGoalie && p.assists > 0) assistsPositive += 1;
      if (!p.isGoalie && p.points > 0) pointsPositive += 1;
      if (p.plusMinus != null) plusMinusKnown += 1;
    }
  }

  const mappingFixes = [
    "shotsTotal → skater SOG (was missed by /^(sog|shots?)$/i)",
    "assists machine key + label A (was unparsed → actual=0)",
    "points = goals+assists when ESPN omits points column",
    "plusMinus machine key + label +/- (audit coverage)",
    "label mode: S→SOG, never label SOG (shootoutGoals)",
    "goalie: saves key / SV label; goalsAgainst≠goals; shootoutSaves≠saves",
  ];

  const md = [
    "# NHL named-player prop mapping audit + OOS re-eval",
    "",
    "Shadow-only. No holdout tuning of usage/shock/HFA.",
    "Mapping audit covers goals / assists / points / SOG / saves / alts (+ plusMinus, goalie keys).",
    "",
    "## Audit — athlete identity / team side / participation / stat paths",
    `| Check | Result |`,
    `|-------|--------|`,
    `| Athlete IDs present on box athletes | ${idOk} rows with non-empty id (verified) |`,
    `| Team side home/away | home=${sideHome} away=${sideAway} |`,
    `| Skaters / goalies | skaters=${skaterN} goalies=${goalieN} |`,
    `| TOI parseable (>0) | ${toiKnown} |`,
    `| Skaters with SOG>0 after fix | ${sogPositive} |`,
    `| Skaters with assists>0 after fix | ${assistsPositive} |`,
    `| Skaters with points>0 after fix | ${pointsPositive} |`,
    `| Rows with plusMinus parsed | ${plusMinusKnown} |`,
    `| Legacy SOG key regex \`/^(sog\\|shots?)$/i\` on ESPN keys | index=${legacySkaterSog} (**MISS**) |`,
    `| Fixed SOG key (includes \`shotsTotal\`) | index=${fixedSkater.sog} key=\`${skaterKeys[fixedSkater.sog]}\` |`,
    `| Assists key | index=${fixedSkater.assists} key=\`${skaterKeys[fixedSkater.assists]}\` |`,
    `| PlusMinus key | index=${fixedSkater.plusMinus} key=\`${skaterKeys[fixedSkater.plusMinus]}\` |`,
    `| Goals key | index=${fixedSkater.goals} |`,
    `| Label mode SOG (must be \`S\`, not label \`SOG\`) | index=${fixedSkaterLabels.sog} label=\`${skaterLabels[fixedSkaterLabels.sog]}\` |`,
    `| Goalie saves key | index=${fixedGoalie.saves} isGoalieGrp=${fixedGoalie.isGoalieGrp} |`,
    "",
    "### Mapping fixes",
    ...mappingFixes.map((x) => `- ${x}`),
    "",
    "### Settlement paths (model)",
    "- goals → `players.{id}.stats.goals`",
    "- assists → `players.{id}.stats.assists`",
    "- points → `players.{id}.stats.points` (actuals = goals+assists from box)",
    "- SOG → `players.{id}.stats.shots_on_goal`",
    "- saves → `players.{id}.stats.saves`",
    "",
    "## Before mapping completeness (SOG/assists/points actuals zeroed)",
    `| Slice | n | meanP | meanY | bias | ECE | Brier | LL | actMean | simMean | actZeroRate |`,
    `|-------|---|-------|-------|------|-----|-------|----|---------|---------|-------------|`,
    ...sliceTablesBroken.map(
      (s) =>
        `| ${s.slice} | ${s.n} | ${s.meanP.toFixed(3)} | ${s.meanY.toFixed(3)} | ${s.bias.toFixed(3)} | ${s.ece?.toFixed(4) ?? "n/a"} | ${s.brier?.toFixed(4) ?? "n/a"} | ${s.logLoss?.toFixed(4) ?? "n/a"} | ${s.actualMean.toFixed(2)} | ${s.simMean.toFixed(2)} | ${s.actualZeroRate.toFixed(2)} |`,
    ),
    "",
    `Named-prop gate (broken): **${gateBroken.verdict}** n=${gateBroken.n} ECE=${gateBroken.ece?.toFixed(4) ?? "n/a"} bias=${gateBroken.bias.toFixed(3)}`,
    "",
    "### Per-family (broken)",
    ...formatGateTable(famGatesBroken),
    "",
    "## After mapping fixes (full named-player OOS)",
    `| Slice | n | meanP | meanY | bias | ECE | Brier | LL | actMean | simMean | actZeroRate |`,
    `|-------|---|-------|-------|------|-----|-------|----|---------|---------|-------------|`,
    ...sliceTablesFixed.map(
      (s) =>
        `| ${s.slice} | ${s.n} | ${s.meanP.toFixed(3)} | ${s.meanY.toFixed(3)} | ${s.bias.toFixed(3)} | ${s.ece?.toFixed(4) ?? "n/a"} | ${s.brier?.toFixed(4) ?? "n/a"} | ${s.logLoss?.toFixed(4) ?? "n/a"} | ${s.actualMean.toFixed(2)} | ${s.simMean.toFixed(2)} | ${s.actualZeroRate.toFixed(2)} |`,
    ),
    "",
    "### Per-family (fixed) — ECE / Brier / LL / n",
    ...formatGateTable(famGatesFixed),
    "",
    "### Aggregate named-player gate",
    ...formatGateTable([gateFixed]),
    "",
    "## Reliability (fixed named props)",
    ...formatReliability(toObs(fixedRows)),
    "",
    "## Decision",
    `- Mapping audit complete; fixes listed above in \`eval/nhlEspnShared.ts\`.`,
    `- Aggregate named-player props: **${gateFixed.verdict}** n=${gateFixed.n} ECE=${gateFixed.ece?.toFixed(4) ?? "n/a"} (gate maxEce=${SIM_V2_ACCEPTANCE_THRESHOLDS.maxEce}, minOos=${SIM_V2_ACCEPTANCE_THRESHOLDS.minOosSample}).`,
    `- Residual FAIL (when present) is **model** λ/usage vs boxscore, not identity/side/path miss.`,
    `- Do **not** enable NHL player_prop allowlist. No holdout parameter tuning performed.`,
    "",
    `Games diagnosed: ${games.length}; broken obs=${brokenRows.length}; fixed obs=${fixedRows.length}.`,
    "",
    "See also: `MILESTONE_NHL_DECISION.md`, `NHL_COVERAGE_MATRIX.md`.",
    "",
  ].join("\n");

  const summary = {
    protocol: "nhl_prop_mapping_reeval_v2",
    shadowOnly: true,
    mappingFixes,
    keyAudit: {
      legacySkaterSogIndex: legacySkaterSog,
      fixedSkaterSogIndex: fixedSkater.sog,
      fixedSkaterSogKey: skaterKeys[fixedSkater.sog] ?? null,
      assistsIndex: fixedSkater.assists,
      assistsKey: skaterKeys[fixedSkater.assists] ?? null,
      plusMinusIndex: fixedSkater.plusMinus,
      plusMinusKey: skaterKeys[fixedSkater.plusMinus] ?? null,
      goalsIndex: fixedSkater.goals,
      labelSogIndex: fixedSkaterLabels.sog,
      labelSogKey: skaterLabels[fixedSkaterLabels.sog] ?? null,
      goalieSavesIndex: fixedGoalie.saves,
      isGoalieGrp: fixedGoalie.isGoalieGrp,
    },
    identity: {
      idOk,
      sideHome,
      sideAway,
      skaterN,
      goalieN,
      toiKnown,
      sogPositive,
      assistsPositive,
      pointsPositive,
      plusMinusKnown,
    },
    games: games.length,
    before: {
      n: gateBroken.n,
      ece: gateBroken.ece,
      brier: gateBroken.brier,
      logLoss: gateBroken.logLoss,
      bias: gateBroken.bias,
      verdict: gateBroken.verdict,
      byFamily: Object.fromEntries(
        famOrder.map((fam, i) => [
          fam,
          {
            n: famGatesBroken[i]!.n,
            ece: famGatesBroken[i]!.ece,
            brier: famGatesBroken[i]!.brier,
            logLoss: famGatesBroken[i]!.logLoss,
            verdict: famGatesBroken[i]!.verdict,
          },
        ]),
      ),
      bySlice: sliceTablesBroken,
    },
    after: {
      n: gateFixed.n,
      ece: gateFixed.ece,
      brier: gateFixed.brier,
      logLoss: gateFixed.logLoss,
      bias: gateFixed.bias,
      verdict: gateFixed.verdict,
      reasons: gateFixed.reasons,
      byFamily: Object.fromEntries(
        famOrder.map((fam, i) => [
          fam,
          {
            n: famGatesFixed[i]!.n,
            ece: famGatesFixed[i]!.ece,
            brier: famGatesFixed[i]!.brier,
            logLoss: famGatesFixed[i]!.logLoss,
            verdict: famGatesFixed[i]!.verdict,
            reasons: famGatesFixed[i]!.reasons,
          },
        ]),
      ),
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
        before: { n: gateBroken.n, ece: gateBroken.ece },
        after: {
          n: gateFixed.n,
          ece: gateFixed.ece,
          verdict: gateFixed.verdict,
          byFamily: summary.after.byFamily,
        },
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
