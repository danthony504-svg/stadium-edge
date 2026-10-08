/**
 * Expand chrono holdout for NHL ML families only (ml_regulation / ml_final).
 * Shadow-only. Raises graded cap + denser ESPN date sample toward n≥500.
 * Never tunes on holdout; reports INSUFFICIENT if still below gate.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildJointHockeyTensor,
  nhlFinalAwaySeries,
  nhlFinalHomeSeries,
  type HockeyCalibrationProfile,
} from "../src/models/hockey/jointHockey.js";
import { buildHockeyMlMarket } from "../src/models/hockey/markets.js";
import { settleMarket } from "../src/engine/settle.js";
import { impliedProbFromAmerican } from "../src/schemas/odds.js";
import { SIM_V2_ACCEPTANCE_THRESHOLDS } from "../src/flags/acceptanceGates.js";
import {
  type CalibObs,
  evaluateFamilyGate,
  formatGateTable,
  formatReliability,
  meanAbsDevFromHalf,
} from "./familyCalibration.js";
import {
  chronoSplit,
  fetchNhlSeason,
  teamForm,
  type NhlGame,
} from "./nhlEspnShared.js";

const REPORT_DIR = join(import.meta.dirname, "report");
/** Target graded ML games (one obs per game per ML slice). */
const HOLDOUT_GRADE_CAP = 650;

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

function gradeMlGame(
  g: NhlGame,
  all: NhlGame[],
  profile: HockeyCalibrationProfile,
  obs: CalibObs[],
): boolean {
  const t = new Date(g.kickoffIso).getTime();
  const home = teamForm(g.homeId, t, all);
  const away = teamForm(g.awayId, t, all);
  if (!home || !away) return false;

  const tensor = buildJointHockeyTensor({
    sport: "nhl",
    eventId: g.eventId,
    seed: `nhl-ml-expand:${profile}:${g.eventId}`,
    nDraws: 2000,
    home,
    away,
    calibrationProfile: profile,
  });

  // Touch finals so settlement paths match A/B (regulation vs OT/SO).
  void nhlFinalHomeSeries(tensor);
  void nhlFinalAwaySeries(tensor);

  const specs: Array<{ slice: string; m: ReturnType<typeof buildHockeyMlMarket>; y: 0 | 1 }> = [
    {
      slice: "ml_home_final",
      m: buildHockeyMlMarket({ marketId: "ml", eventId: g.eventId, side: "home" }),
      y: g.homeFinal > g.awayFinal ? 1 : 0,
    },
    {
      slice: "ml_home_regulation",
      m: buildHockeyMlMarket({
        marketId: "ml_reg",
        eventId: g.eventId,
        side: "home",
        includeOtSo: false,
      }),
      y: g.homeReg > g.awayReg ? 1 : 0,
    },
  ];

  for (const s of specs) {
    const r = settleMarket({ tensor, market: s.m, odds: oddsStub(s.m.marketId) });
    if (r.status === "ok" && r.simHit != null) {
      obs.push({
        y: s.y,
        p: r.simHit,
        eventId: g.eventId,
        family: "ml",
        slice: s.slice,
        fold: "holdout",
        realBookLine: false,
      });
    }
  }
  return true;
}

async function main() {
  await mkdir(REPORT_DIR, { recursive: true });

  console.log("nhl-ml-expand fetch 2022 (form prior densify)…");
  const s2022 = await fetchNhlSeason(2022, {
    stepDays: 1,
    userAgent: "stadium-sim-v2-nhl-ml-expand",
  });
  console.log(`nhl-ml-expand fetch 2023… (2022 n=${s2022.length})`);
  const s2023 = await fetchNhlSeason(2023, {
    stepDays: 1,
    userAgent: "stadium-sim-v2-nhl-ml-expand",
  });
  console.log(`nhl-ml-expand fetch 2024… (2023 n=${s2023.length})`);
  const s2024 = await fetchNhlSeason(2024, {
    stepDays: 1,
    userAgent: "stadium-sim-v2-nhl-ml-expand",
  });

  const all = [...s2022, ...s2023, ...s2024].sort(
    (a, b) => new Date(a.kickoffIso).getTime() - new Date(b.kickoffIso).getTime(),
  );

  // Same chrono protocol: train=2023, val=early-2024 diagnostic, holdout=mid+late-2024.
  const y2024 = chronoSplit(s2024);
  const holdoutPool = [...y2024.val, ...y2024.holdout];
  const holdout = holdoutPool.slice(0, HOLDOUT_GRADE_CAP);

  const profiles: HockeyCalibrationProfile[] = ["v0.2", "v0.3"];
  const byProfile: Record<
    string,
    { used: number; obs: CalibObs[]; mlReg: CalibObs[]; mlFin: CalibObs[] }
  > = {};

  for (const profile of profiles) {
    const obs: CalibObs[] = [];
    let used = 0;
    console.log(`nhl-ml-expand grade ${profile} holdout n=${holdout.length}`);
    for (const g of holdout) {
      if (gradeMlGame(g, all, profile, obs)) used += 1;
    }
    byProfile[profile] = {
      used,
      obs,
      mlReg: obs.filter((o) => o.slice === "ml_home_regulation"),
      mlFin: obs.filter((o) => o.slice === "ml_home_final"),
    };
  }

  const gates = profiles.flatMap((profile) => {
    const b = byProfile[profile]!;
    return [
      evaluateFamilyGate(`nhl:ml_regulation:${profile}`, b.mlReg),
      evaluateFamilyGate(`nhl:ml_final:${profile}`, b.mlFin),
    ];
  });

  const v03Reg = byProfile["v0.3"]!.mlReg;
  const v03Fin = byProfile["v0.3"]!.mlFin;
  const g03Reg = evaluateFamilyGate("nhl:ml_regulation", v03Reg);
  const g03Fin = evaluateFamilyGate("nhl:ml_final", v03Fin);

  const minN = Math.min(g03Reg.n, g03Fin.n);
  const stillInsufficient = minN < SIM_V2_ACCEPTANCE_THRESHOLDS.minOosSample;

  const md = [
    "# NHL ML n-expand — chrono holdout (ML families only)",
    "",
    "Shadow-only. Denser ESPN date sample (daily) + seasons 2022–2024 for form priors.",
    "Holdout protocol unchanged: mid+late-2024 chrono slice; **no holdout tuning**.",
    "",
    "## Fetch / freeze",
    `- Seasons fetched: 2022 n=${s2022.length}, 2023 n=${s2023.length}, 2024 n=${s2024.length}`,
    `- Date stride: every day (stepDays=1) + week fallback 1–28`,
    `- Train reference: 2023 (n=${s2023.length}); val early-2024 (n=${y2024.train.length})`,
    `- Holdout pool mid+late-2024: ${holdoutPool.length}; graded cap ${holdout.length}`,
    `- Form-ready graded: v0.2=${byProfile["v0.2"]!.used}, v0.3=${byProfile["v0.3"]!.used}`,
    `- Gate thresholds unchanged: minOos=${SIM_V2_ACCEPTANCE_THRESHOLDS.minOosSample}, maxEce=${SIM_V2_ACCEPTANCE_THRESHOLDS.maxEce}`,
    "",
    "## ML family results (v0.3 primary)",
    ...formatGateTable([g03Reg, g03Fin]),
    "",
    "## A/B snapshot (identical holdout games)",
    `| Family | Profile | n | ECE | Brier | LogLoss | mad½ | verdict |`,
    `|--------|---------|---|-----|-------|---------|------|---------|`,
    ...profiles.flatMap((profile) => {
      const b = byProfile[profile]!;
      const reg = evaluateFamilyGate(`nhl:ml_regulation`, b.mlReg);
      const fin = evaluateFamilyGate(`nhl:ml_final`, b.mlFin);
      return [
        `| ml_regulation | ${profile} | ${reg.n} | ${reg.ece?.toFixed(4) ?? "n/a"} | ${reg.brier?.toFixed(4) ?? "n/a"} | ${reg.logLoss?.toFixed(4) ?? "n/a"} | ${meanAbsDevFromHalf(b.mlReg)?.toFixed(4) ?? "n/a"} | **${reg.verdict}** |`,
        `| ml_final | ${profile} | ${fin.n} | ${fin.ece?.toFixed(4) ?? "n/a"} | ${fin.brier?.toFixed(4) ?? "n/a"} | ${fin.logLoss?.toFixed(4) ?? "n/a"} | ${meanAbsDevFromHalf(b.mlFin)?.toFixed(4) ?? "n/a"} | **${fin.verdict}** |`,
      ];
    }),
    "",
    "## Reliability (v0.3 ml_regulation)",
    ...formatReliability(v03Reg),
    "",
    "## Verdict",
    stillInsufficient
      ? `- **INSUFFICIENT**: ML n=${minN} still < ${SIM_V2_ACCEPTANCE_THRESHOLDS.minOosSample} after expand (ESPN densify exhausted for this chrono window).`
      : `- ML n reached ≥${SIM_V2_ACCEPTANCE_THRESHOLDS.minOosSample} (ml_regulation n=${g03Reg.n}, ml_final n=${g03Fin.n}).`,
    `- v0.3 ml_regulation ECE=${g03Reg.ece?.toFixed(4) ?? "n/a"} (prior A/B n=316 ECE≈0.033).`,
    `- v0.3 ml_final ECE=${g03Fin.ece?.toFixed(4) ?? "n/a"}.`,
    `- Do **not** enable production NHL serve from this expand alone.`,
    "",
  ].join("\n");

  const summary = {
    protocol: "nhl_ml_n_expand_v1",
    shadowOnly: true,
    fetch: {
      stepDays: 1,
      seasons: { 2022: s2022.length, 2023: s2023.length, 2024: s2024.length },
      holdoutPool: holdoutPool.length,
      holdoutGradedCap: holdout.length,
      holdoutEventIds: holdout.map((g) => g.eventId),
    },
    graded: {
      v02: byProfile["v0.2"]!.used,
      v03: byProfile["v0.3"]!.used,
    },
    ml: {
      v03: {
        ml_regulation: {
          n: g03Reg.n,
          ece: g03Reg.ece,
          brier: g03Reg.brier,
          logLoss: g03Reg.logLoss,
          verdict: g03Reg.verdict,
          reasons: g03Reg.reasons,
          madHalf: meanAbsDevFromHalf(v03Reg),
        },
        ml_final: {
          n: g03Fin.n,
          ece: g03Fin.ece,
          brier: g03Fin.brier,
          logLoss: g03Fin.logLoss,
          verdict: g03Fin.verdict,
          reasons: g03Fin.reasons,
          madHalf: meanAbsDevFromHalf(v03Fin),
        },
      },
      v02: {
        ml_regulation: (() => {
          const g = evaluateFamilyGate("nhl:ml_regulation", byProfile["v0.2"]!.mlReg);
          return { n: g.n, ece: g.ece, verdict: g.verdict };
        })(),
        ml_final: (() => {
          const g = evaluateFamilyGate("nhl:ml_final", byProfile["v0.2"]!.mlFin);
          return { n: g.n, ece: g.ece, verdict: g.verdict };
        })(),
      },
    },
    insufficient: stillInsufficient,
    minOos: SIM_V2_ACCEPTANCE_THRESHOLDS.minOosSample,
    gates,
  };

  await writeFile(join(REPORT_DIR, "NHL_ML_N_EXPAND.md"), md, "utf8");
  await writeFile(
    join(REPORT_DIR, "nhl_ml_n_expand_summary.json"),
    JSON.stringify(summary, null, 2),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        wrote: ["NHL_ML_N_EXPAND.md", "nhl_ml_n_expand_summary.json"],
        n: { ml_regulation: g03Reg.n, ml_final: g03Fin.n },
        ece: { ml_regulation: g03Reg.ece, ml_final: g03Fin.ece },
        insufficient: stillInsufficient,
        verdicts: { ml_regulation: g03Reg.verdict, ml_final: g03Fin.verdict },
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
