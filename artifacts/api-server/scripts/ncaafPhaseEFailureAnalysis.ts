/**
 * Reproducible NCAAF Phase E failure analysis on the USED 2024 holdout.
 *
 * Compares engine measurements (from vendored Phase E fixtures at tip e6c26f85
 * research path) against simple and market baselines. Separates MODEL_WEAKNESS
 * from MISSING_DATA. Does not tune. Does not flip the live gate.
 *
 * Holdout policy: 2024 window (pre-cutoff + untouched) is USED. Further model
 * tuning requires a reserved untouched window (see docs).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { americanToImplied } from "../src/lib/sportSim/footballCalibration.ts";

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, "../test/fixtures");
const ART = "/opt/cursor/artifacts";

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function brier(ps: number[], ys: number[]): number {
  let s = 0;
  for (let i = 0; i < ps.length; i++) s += (ps[i]! - ys[i]!) ** 2;
  return s / ps.length;
}

function loadJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIX, name), "utf8")) as T;
}

function main(): number {
  const games = loadJson<{ games: Array<{
    eventId: string;
    season: number;
    kickoffIso?: string;
    homeFg: number;
    awayFg: number;
  }> }>("ncaaf-phase-e-games.json");
  const closes = loadJson<{ games: Array<{
    gameId: string;
    kickoffIso: string;
    closeMlHome: number | null;
    closeSpreadHome: number | null;
    homeScore: number;
    awayScore: number;
    injuryKnown: boolean | null;
    qbOut: boolean | null;
  }> }>("ncaaf-phase-e-closing-lines.json");
  const mf = loadJson<Record<string, unknown>>("ncaaf-phase-e-market-families-report.json");
  const audit = loadJson<Record<string, unknown>>("ncaaf-phase-e-spread-settlement-audit.json");
  const clv = loadJson<Record<string, unknown>>("ncaaf-phase-e-coach-pick-clv-report.json");
  const cal = loadJson<Record<string, unknown>>("ncaaf-phase-e-calibration-report.json");
  const diag = existsSync(join(FIX, "ncaaf-phase-e-spread-margin-diag.json"))
    ? loadJson<Record<string, unknown>>("ncaaf-phase-e-spread-margin-diag.json")
    : null;

  const USED_CUTOFF = "2024-10-15T00:00:00Z";
  const RESERVED_UNTOUCHED = {
    label: "2025_FBS_regular_season_forward",
    rule: "All 2025+ FBS games with kickoff after collection start; never reuse 2024 for tuning",
    status: "RESERVED_EMPTY — fixtures not yet vendored for evaluation",
    priorUsedWindows: [
      {
        label: "2024_pre_cutoff",
        kickoff: `< ${USED_CUTOFF}`,
        usedFor: "v1.1-research residual/shrink lock + Coach CLV selection",
      },
      {
        label: "2024_untouched_post_cutoff",
        kickoff: `≥ ${USED_CUTOFF}`,
        usedFor: "holdout evaluation at tip e6c26f85 (ATS/ML/totals/CLV reports)",
      },
    ],
  };

  // Market + simple baselines from archive (no engine)
  const joined = closes.games.filter(
    (g) =>
      g.closeMlHome != null &&
      Number.isFinite(g.closeMlHome) &&
      Number.isFinite(g.homeScore) &&
      Number.isFinite(g.awayScore) &&
      g.homeScore !== g.awayScore,
  );
  const mlPsMarket: number[] = [];
  const mlYs: number[] = [];
  const mlPsCoin: number[] = [];
  const mlPsHome: number[] = [];
  for (const g of joined) {
    const p = americanToImplied(Number(g.closeMlHome));
    if (p == null) continue;
    mlPsMarket.push(p);
    mlYs.push(g.homeScore > g.awayScore ? 1 : 0);
    mlPsCoin.push(0.5);
    mlPsHome.push(1);
  }

  const spreadJoined = closes.games.filter(
    (g) =>
      g.closeSpreadHome != null &&
      Number.isFinite(g.closeSpreadHome) &&
      Number.isFinite(g.homeScore) &&
      Number.isFinite(g.awayScore),
  );
  const atsYs: number[] = [];
  const atsCoin: number[] = [];
  let atsPushes = 0;
  for (const g of spreadJoined) {
    const adj = g.homeScore - g.awayScore + Number(g.closeSpreadHome);
    if (Math.abs(adj) < 1e-9) {
      atsPushes += 1;
      continue;
    }
    atsYs.push(adj > 0 ? 1 : 0);
    atsCoin.push(0.5);
  }

  const mlUntouched = (mf.moneyline as { untouchedHoldout: Record<string, unknown> })
    .untouchedHoldout;
  const spUntouched = (mf.closingSpread as { untouchedHoldout: Record<string, unknown> })
    .untouchedHoldout;
  const totUntouched = (
    mf.totals as { untouchedHoldout: { overAtProjectedMean: Record<string, unknown> } }
  ).untouchedHoldout.overAtProjectedMean;

  const injuryNonNull = closes.games.filter((g) => g.injuryKnown != null).length;
  const hasCloseTotal = closes.games.some((g) =>
    Object.prototype.hasOwnProperty.call(g, "closeTotal"),
  );

  const report = {
    generatedAt: new Date().toISOString(),
    researchTip: "e6c26f85",
    liveEngine: "ppg-per-drive-v1 (Render e607f131) — unchanged",
    researchEngine: "ppg-per-drive-v1.1-research (opt-in only; not live)",
    gate: "NCAAF_GAME_LINE_SIM_VALIDATED=false",
    holdoutPolicy: {
      evaluatedHoldoutStatus: "USED",
      usedCutoff: USED_CUTOFF,
      reservedUntouched: RESERVED_UNTOUCHED,
      note: "Do not tune residual/shrink/selection thresholds on USED 2024 windows.",
    },
    baselines: {
      moneyline: {
        nJoinedDecided: mlYs.length,
        brierCoin: brier(mlPsCoin, mlYs),
        brierAlwaysHome: brier(mlPsHome, mlYs),
        brierMarketClose: brier(mlPsMarket, mlYs),
        meanMarketP: mean(mlPsMarket),
        meanY: mean(mlYs),
        engineUntouchedFromFixture: {
          n: mlUntouched.n,
          brierEngine: mlUntouched.brierEngine,
          brierCoin: mlUntouched.brierCoin,
          brierMarket: mlUntouched.brierMarket,
          beatsCoin: mlUntouched.beatsCoin,
          beatsMarket: mlUntouched.beatsMarket,
        },
      },
      spreadsAts: {
        nJoinedDecided: atsYs.length,
        nPushes: atsPushes,
        brierCoin: brier(atsCoin, atsYs),
        brierMarketAts: null,
        marketAtsNote:
          "MISSING_DATA — archive has closeSpreadHome points but no closing ATS juice; cannot form market-implied cover probs",
        meanY: mean(atsYs),
        engineUntouchedFromFixture: {
          n: spUntouched.n,
          brierEngine: spUntouched.brierEngine,
          brierCoin: spUntouched.brierCoin,
          beatsCoin: spUntouched.beatsCoin,
          meanP: spUntouched.meanP,
          meanY: spUntouched.meanY,
        },
        settlementAudit: {
          sign: "CLEARED",
          extraction: "CLEARED",
          pushes: "CLEARED",
          openModel: (audit.defects as Array<{ id: string; status: string }>)?.find(
            (d) => d.id === "spread_calibration_vs_coin",
          )?.status,
        },
      },
      totals: {
        closingTotalsInArchive: hasCloseTotal,
        engineOverAtProjected: {
          brierEngine: totUntouched.brierEngine,
          beatsCoin: totUntouched.beatsCoin,
        },
        marketBaseline: null,
        note: "MISSING_DATA — no closeTotal in E2b archive",
      },
    },
    modelWeaknesses: [
      {
        id: "ats_discrimination",
        severity: "blocking_spreads",
        evidence:
          "Untouched ATS Brier 0.264 > coin 0.25 after residual/bias fix; corr(p,y)≈0.05",
        class: "MODEL_WEAKNESS",
      },
      {
        id: "ml_loses_to_close",
        severity: "blocking_ml_restore",
        evidence: `Untouched ML Brier ${mlUntouched.brierEngine} > market ${mlUntouched.brierMarket}`,
        class: "MODEL_WEAKNESS",
      },
      {
        id: "coach_clv_negative",
        severity: "blocking_e2b_clv",
        evidence: clv.clvAcceptanceCriteria,
        class: "MODEL_WEAKNESS_AND_MISSING_DATA",
        note: "Selection quality negative vs close; also blocked by empty early two-sided price cache (C1 under R1–R4)",
      },
      {
        id: "pre_cutoff_underdispersion_addressed_research_only",
        severity: "research",
        evidence: diag,
        class: "MODEL_WEAKNESS",
        note: "Residual+shrink locked as research path only; live engine untouched",
      },
    ],
    missingData: [
      {
        id: "closing_totals",
        class: "MISSING_DATA",
        coverage: "0/842",
        blocks: ["totals_market_baseline", "totals_CLV"],
      },
      {
        id: "posted_alt_prices",
        class: "MISSING_DATA",
        coverage: "0",
        blocks: ["alt_CLV", "alt_restore"],
      },
      {
        id: "closing_spread_juice",
        class: "MISSING_DATA",
        coverage: "points only; no American ATS prices in archive",
        blocks: ["spread_market_baseline"],
      },
      {
        id: "early_two_sided_t24h_prices",
        class: "MISSING_DATA",
        coverage: "early-snapshot cache empty; fixture home-only",
        blocks: ["coach_CLV_C1_under_R1_R2"],
      },
      {
        id: "pre_kickoff_injury_2024",
        class: "MISSING_DATA",
        coverage: `${injuryNonNull}/842 non-null injuryKnown`,
        blocks: ["E4_injury_conservatism"],
        rule: "Never backfill with current ESPN injuries",
      },
    ],
    e2aSoftGates: {
      outcomeVsCoin: (cal.verdicts as Record<string, string>)?.E2_outcomeVsCoin,
      softGates: (cal.verdicts as Record<string, string>)?.E2_closeArchiveSoftGates,
    },
    perMarketVerdict: {
      moneyline: "NOT_READY — beats coin, loses market, CLV fail, E4/E6 open",
      spreads: "NOT_READY — fails coin (model discrimination); settlement cleared",
      totals: "NOT_READY — missing closing totals",
      alts: "NOT_READY — missing posted ALT prices",
    },
    keepP0Armed: true,
    flagFlipAllowed: false,
    e6Requested: false,
  };

  mkdirSync(FIX, { recursive: true });
  mkdirSync(ART, { recursive: true });
  const outName = "ncaaf-phase-e-failure-analysis.json";
  writeFileSync(join(FIX, outName), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(ART, outName), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  return 0;
}

process.exit(main());
