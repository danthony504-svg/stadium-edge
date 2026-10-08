/**
 * Diagnose nhl:ml_regulation ECE≈0.044 on n=650 expand (shadow).
 * Tries smallest val-only levers on early-2024 chrono train slice.
 * Never tunes on holdout; never loosens gates; does not change default v0.3.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildJointHockeyTensor,
  nhlFinalAwaySeries,
  nhlFinalHomeSeries,
  resolveHockeyCalibration,
  type HockeyCalibParams,
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
/** Cap val games for lever screen (early-2024 train slice). */
const VAL_GRADE_CAP = 650;

type Lever = {
  id: string;
  note: string;
  overrides?: Partial<
    Pick<HockeyCalibParams, "formShrinkToLeague" | "meanShockSigma" | "hfaGoals">
  >;
};

const LEVERS: Lever[] = [
  { id: "v0.3_default", note: "baseline (shrink0.4 shock0.15 hfa0.08)" },
  {
    id: "shrink_0.45",
    note: "slightly more form shrink",
    overrides: { formShrinkToLeague: 0.45 },
  },
  {
    id: "shrink_0.50",
    note: "more form shrink",
    overrides: { formShrinkToLeague: 0.5 },
  },
  {
    id: "hfa_0.06",
    note: "milder HFA",
    overrides: { hfaGoals: 0.06 },
  },
  {
    id: "hfa_0.10",
    note: "stronger HFA",
    overrides: { hfaGoals: 0.1 },
  },
  {
    id: "shock_0.18",
    note: "more mean shock",
    overrides: { meanShockSigma: 0.18 },
  },
  {
    id: "shock_0.12",
    note: "less mean shock",
    overrides: { meanShockSigma: 0.12 },
  },
];

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

function gradeMl(
  g: NhlGame,
  all: NhlGame[],
  lever: Lever,
  obsReg: CalibObs[],
  obsFin: CalibObs[],
): boolean {
  const t = new Date(g.kickoffIso).getTime();
  const home = teamForm(g.homeId, t, all);
  const away = teamForm(g.awayId, t, all);
  if (!home || !away) return false;

  const tensor = buildJointHockeyTensor({
    sport: "nhl",
    eventId: g.eventId,
    seed: `nhl-ml-reg-diag:${lever.id}:${g.eventId}`,
    nDraws: 2000,
    home,
    away,
    calibrationProfile: "v0.3",
    calibrationOverrides: lever.overrides,
  });
  void nhlFinalHomeSeries(tensor);
  void nhlFinalAwaySeries(tensor);

  const specs: Array<{
    slice: string;
    m: ReturnType<typeof buildHockeyMlMarket>;
    y: 0 | 1;
    into: CalibObs[];
  }> = [
    {
      slice: "ml_home_final",
      m: buildHockeyMlMarket({ marketId: "ml", eventId: g.eventId, side: "home" }),
      y: g.homeFinal > g.awayFinal ? 1 : 0,
      into: obsFin,
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
      into: obsReg,
    },
  ];

  for (const s of specs) {
    const r = settleMarket({ tensor, market: s.m, odds: oddsStub(s.m.marketId) });
    if (r.status === "ok" && r.simHit != null) {
      s.into.push({
        y: s.y,
        p: r.simHit,
        eventId: g.eventId,
        family: "ml",
        slice: s.slice,
        fold: "val",
        realBookLine: false,
      });
    }
  }
  return true;
}

async function main() {
  await mkdir(REPORT_DIR, { recursive: true });
  const base = resolveHockeyCalibration("v0.3");

  console.log("nhl-ml-reg-diag fetch seasons…");
  const s2022 = await fetchNhlSeason(2022, {
    stepDays: 1,
    userAgent: "stadium-sim-v2-nhl-ml-reg-diag",
  });
  const s2023 = await fetchNhlSeason(2023, {
    stepDays: 1,
    userAgent: "stadium-sim-v2-nhl-ml-reg-diag",
  });
  const s2024 = await fetchNhlSeason(2024, {
    stepDays: 1,
    userAgent: "stadium-sim-v2-nhl-ml-reg-diag",
  });
  const all = [...s2022, ...s2023, ...s2024].sort(
    (a, b) => new Date(a.kickoffIso).getTime() - new Date(b.kickoffIso).getTime(),
  );
  const y2024 = chronoSplit(s2024);
  // Early-2024 = train slice in chronoSplit; used as val for lever screen (never holdout).
  const valPool = y2024.train.slice(0, VAL_GRADE_CAP);

  type Row = {
    id: string;
    note: string;
    nReg: number;
    eceReg: number | null;
    brierReg: number | null;
    llReg: number | null;
    madReg: number | null;
    nFin: number;
    eceFin: number | null;
    verdictReg: string;
    verdictFin: string;
  };
  const rows: Row[] = [];
  let baselineObsReg: CalibObs[] = [];
  let baselineObsFin: CalibObs[] = [];

  for (const lever of LEVERS) {
    const obsReg: CalibObs[] = [];
    const obsFin: CalibObs[] = [];
    let used = 0;
    console.log(`nhl-ml-reg-diag lever=${lever.id} val n=${valPool.length}`);
    for (const g of valPool) {
      if (gradeMl(g, all, lever, obsReg, obsFin)) used += 1;
    }
    if (lever.id === "v0.3_default") {
      baselineObsReg = obsReg;
      baselineObsFin = obsFin;
    }
    const gReg = evaluateFamilyGate(`nhl:ml_regulation:${lever.id}`, obsReg);
    const gFin = evaluateFamilyGate(`nhl:ml_final:${lever.id}`, obsFin);
    rows.push({
      id: lever.id,
      note: lever.note,
      nReg: gReg.n,
      eceReg: gReg.ece,
      brierReg: gReg.brier,
      llReg: gReg.logLoss,
      madReg: meanAbsDevFromHalf(obsReg),
      nFin: gFin.n,
      eceFin: gFin.ece,
      verdictReg: gReg.verdict,
      verdictFin: gFin.verdict,
    });
    void used;
  }

  const baseline = rows.find((r) => r.id === "v0.3_default")!;
  const maxEce = SIM_V2_ACCEPTANCE_THRESHOLDS.maxEce;
  // Clear lever = val ECE ≤ gate AND does not push ml_final above gate, and beats baseline by ≥0.005.
  const clear = rows.filter(
    (r) =>
      r.id !== "v0.3_default" &&
      r.eceReg != null &&
      baseline.eceReg != null &&
      r.eceReg <= maxEce &&
      (r.eceFin ?? 1) <= maxEce &&
      baseline.eceReg - r.eceReg >= 0.005,
  );

  const holdoutKnown = {
    n: 650,
    eceReg: 0.0439,
    eceFin: 0.0313,
    note: "from NHL_ML_N_EXPAND.md — not re-tuned here",
  };

  const decision =
    clear.length > 0
      ? {
          status: "CLEAR_VAL_LEVER" as const,
          lever: clear[0]!.id,
          action:
            "Smallest clear val lever applied to NHL_FORM_SHRINK_TO_LEAGUE when shrink_*; then holdout re-grade via eval:nhl-ml-expand.",
        }
      : {
          status: "FAIL" as const,
          lever: null,
          action:
            "No clear val-only lever (ΔECE≥0.005 to ≤0.04 without harming ml_final). Keep v0.3 defaults; next = regulation-specific OT-tie sharpness / period share work on train/val.",
        };

  const md = [
    "# NHL ml_regulation diagnose (ECE≈0.044 @ n=650)",
    "",
    "Shadow-only. Gates unchanged (`maxEce=0.04`, `minOos=500`). Default hockey.joint remains **v0.3**.",
    "Val lever screen uses early-2024 chrono train slice only — **holdout not used for tuning**.",
    "",
    "## Holdout evidence (frozen expand)",
    `| Family | n | ECE | Verdict |`,
    `|--------|---|-----|---------|`,
    `| ml_regulation | ${holdoutKnown.n} | ${holdoutKnown.eceReg} | **FAIL** |`,
    `| ml_final | ${holdoutKnown.n} | ${holdoutKnown.eceFin} | **PASS** (preserve) |`,
    "",
    `Baseline calib: shrink=${base.formShrinkToLeague} shockσ=${base.meanShockSigma} hfa=${base.hfaGoals}.`,
    "",
    "## Reliability pattern (holdout v0.3)",
    "From expand report: mean bias≈−0.018 (mild underconfidence); mass in 0.3–0.5 bins nearly calibrated;",
    "ECE driven by thin tail bins + residual sharpness — not a single obvious HFA flip.",
    "",
    "## Val-only lever screen",
    `| Lever | n_reg | ECE_reg | Brier | LL | mad½ | n_fin | ECE_fin | reg | fin |`,
    `|-------|-------|---------|-------|----|------|-------|---------|-----|-----|`,
    ...rows.map(
      (r) =>
        `| ${r.id} | ${r.nReg} | ${r.eceReg?.toFixed(4) ?? "n/a"} | ${r.brierReg?.toFixed(4) ?? "n/a"} | ${r.llReg?.toFixed(4) ?? "n/a"} | ${r.madReg?.toFixed(4) ?? "n/a"} | ${r.nFin} | ${r.eceFin?.toFixed(4) ?? "n/a"} | ${r.verdictReg} | ${r.verdictFin} |`,
    ),
    "",
    "## Decision",
    `- Status: **${decision.status}**`,
    clear.length
      ? `- Clear lever(s): ${clear.map((c) => c.id).join(", ")} — ${decision.action}`
      : `- ${decision.action}`,
    `- Do **not** loosen gates. Do **not** enable spreads/totals without n≥500.`,
    `- Preserve ml_final PASS (holdout ECE=${holdoutKnown.eceFin}).`,
    "",
    "## Next step",
    "1. Keep v0.3 as shadow default (ml_final PASS).",
    "2. Regulation-specific work on train/val: period-share / OT-eligible sharpness separate from final ML path.",
    "3. Re-holdout only after val ECE clearly ≤0.04 with ml_final still ≤0.04.",
    "",
  ].join("\n");

  const mdFull = [
    md,
    "## Val reliability (v0.3 default)",
    ...formatReliability(baselineObsReg),
    "",
    ...formatGateTable([
      evaluateFamilyGate("nhl:ml_regulation:val", baselineObsReg),
      evaluateFamilyGate("nhl:ml_final:val", baselineObsFin),
    ]),
    "",
  ].join("\n");

  const summary = {
    protocol: "nhl_ml_reg_diagnose_v1",
    shadowOnly: true,
    holdoutKnown,
    valN: valPool.length,
    levers: rows,
    decision,
    gatesUnchanged: {
      maxEce: SIM_V2_ACCEPTANCE_THRESHOLDS.maxEce,
      minOos: SIM_V2_ACCEPTANCE_THRESHOLDS.minOosSample,
    },
  };

  await writeFile(join(REPORT_DIR, "NHL_ML_REG_DIAGNOSE.md"), mdFull, "utf8");
  await writeFile(
    join(REPORT_DIR, "nhl_ml_reg_diagnose_summary.json"),
    JSON.stringify(summary, null, 2),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        wrote: ["NHL_ML_REG_DIAGNOSE.md", "nhl_ml_reg_diagnose_summary.json"],
        decision,
        baselineVal: {
          eceReg: baseline.eceReg,
          eceFin: baseline.eceFin,
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
