/**
 * TUNING eval: college team-strength v0 (research) vs locked drive baseline.
 *
 * Components compared on identical causal, time-ordered fair cohort:
 *   - locked_drive_teamMean (baseline)
 *   - ts_opp_adj_only
 *   - ts_opp_adj_early_blend
 *   - ts_opp_adj_uncertainty
 *   - ts_full (blend + uncertainty + mismatch)
 *
 * Closes = evaluation only. FINAL_EVAL never loaded. No paid Odds.
 * Does not flip NCAAF_GAME_LINE_SIM_VALIDATED.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runNflDriveSim } from "../src/lib/sportSim/nflDriveSim.ts";
import {
  blendVenueAndL10,
  FOOTBALL_NCAAF_MARGIN_RESIDUAL_SD,
  FOOTBALL_NCAAF_HOME_MARGIN_SHRINK,
  FOOTBALL_DRIVE_ENGINE_VERSION,
} from "../src/lib/sportSim/footballDriveMatchup.ts";
import {
  FOOTBALL_CALIBRATION_PRIMARY_SEED,
  mulberry32,
  walkHoldoutGames,
  type HoldoutWalkForm,
} from "../src/lib/sportSim/footballCalibration.ts";
import { teamMean } from "../src/lib/sportSim/shared.ts";
import {
  FOOTBALL_NCAAF_TEAM_STRENGTH_RESEARCH_VERSION,
  NcaafOppAdjRatings,
  predictTeamStrength,
  type PredictComponents,
} from "../src/lib/sportSim/ncaafTeamStrength.ts";

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, "../test/fixtures");
const ART = "/opt/cursor/artifacts";
const SIMS = Number(process.env.NCAAF_TUNING_SIMS ?? 1_000);

type EspnGame = {
  eventId: string;
  season: number;
  week: number;
  kickoffIso?: string;
  homeTeamId: string;
  awayTeamId: string;
  homeName?: string;
  awayName?: string;
  homeFg: number;
  awayFg: number;
};
type CloseRow = {
  gameId: string;
  closeMlHome: number | null;
  closeSpreadHome: number | null;
};

function mean(xs: number[], fb = 0): number {
  if (!xs.length) return fb;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function brier(ps: number[], ys: number[]): number {
  let s = 0;
  for (let i = 0; i < ps.length; i++) s += (ps[i]! - ys[i]!) ** 2;
  return s / Math.max(1, ps.length);
}
function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i]! - mx;
    const b = ys[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx < 1e-12 || dy < 1e-12) return null;
  return num / Math.sqrt(dx * dy);
}
function americanToImplied(american: number): number {
  if (!Number.isFinite(american) || american === 0) return 0.5;
  if (american < 0) return (-american) / (-american + 100);
  return 100 / (american + 100);
}
function favSize(abs: number): string {
  if (abs < 3.5) return "pick_em";
  if (abs <= 7.5) return "small_3.5_7.5";
  if (abs <= 14) return "medium_7.5_14";
  return "large_14plus";
}

function loadJsonGames(path: string): EspnGame[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as { games: EspnGame[] };
  return (raw.games ?? []).filter(
    (g) =>
      g?.homeTeamId &&
      g?.awayTeamId &&
      Number.isFinite(g.homeFg) &&
      Number.isFinite(g.awayFg) &&
      g.kickoffIso,
  );
}

function teamSimInput(form: HoldoutWalkForm | undefined, venue: "home" | "away") {
  const l10For = form?.ptsFor.slice(-10) ?? [];
  const l10Against = form?.ptsAgainst.slice(-10) ?? [];
  const venueFor =
    venue === "home" ? form?.homeFor.slice(-10) ?? [] : form?.awayFor.slice(-10) ?? [];
  const venueAgainst =
    venue === "home"
      ? form?.homeAgainst.slice(-10) ?? []
      : form?.awayAgainst.slice(-10) ?? [];
  const l10 = {
    games: l10For.length,
    ptsFor: l10For.length >= 2 ? mean(l10For, 24) : null,
    ptsAgainst: l10Against.length >= 2 ? mean(l10Against, 24) : null,
  };
  const vs = {
    games: venueFor.length,
    ptsFor: venueFor.length ? mean(venueFor, 24) : null,
    ptsAgainst: venueAgainst.length ? mean(venueAgainst, 24) : null,
  };
  const blended = blendVenueAndL10(vs, l10);
  return {
    ptsFor: blended.ptsFor,
    ptsAgainst: blended.ptsAgainst,
    recentScores: l10For.slice(),
    nFormGames: form?.ptsFor.length ?? 0,
  };
}

type ModelOut = {
  pMl: number;
  pAts: number | null;
  predMargin: number;
  sigma: number | null;
  priorWeight: number | null;
};
type Row = {
  eventId: string;
  week: number;
  yMl: number;
  yAts: number | null;
  marketP: number;
  closeSpreadHome: number;
  favSize: string;
  actMargin: number;
  models: Record<string, ModelOut>;
};

const MODEL_IDS = [
  "locked_drive_teamMean",
  "ts_opp_adj_only",
  "ts_opp_adj_early_blend",
  "ts_opp_adj_uncertainty",
  "ts_full",
] as const;

const TS_COMPONENTS: Record<string, PredictComponents> = {
  ts_opp_adj_only: {
    useEarlyBlend: false,
    useUncertainty: false,
    useMismatchHandling: false,
  },
  ts_opp_adj_early_blend: {
    useEarlyBlend: true,
    useUncertainty: false,
    useMismatchHandling: false,
  },
  ts_opp_adj_uncertainty: {
    useEarlyBlend: true,
    useUncertainty: true,
    useMismatchHandling: false,
  },
  ts_full: {
    useEarlyBlend: true,
    useUncertainty: true,
    useMismatchHandling: true,
  },
};

function metrics(rows: Row[], modelId: string) {
  const usable = rows.filter((r) => r.models[modelId]);
  const p = usable.map((r) => r.models[modelId]!.pMl);
  const y = usable.map((r) => r.yMl);
  const mkt = usable.map((r) => r.marketP);
  const ats = usable.filter((r) => r.models[modelId]!.pAts != null && r.yAts != null);
  const predM = usable.map((r) => r.models[modelId]!.predMargin);
  const actM = usable.map((r) => r.actMargin);
  const sigmas = usable
    .map((r) => r.models[modelId]!.sigma)
    .filter((s): s is number => s != null && Number.isFinite(s));
  const bE = brier(p, y);
  const bM = brier(mkt, y);
  const bAts = ats.length
    ? brier(
        ats.map((r) => r.models[modelId]!.pAts!),
        ats.map((r) => r.yAts!),
      )
    : null;
  return {
    n: usable.length,
    mlBrier: bE,
    mktBrier: bM,
    delta: bE - bM,
    M3: bE <= bM + 0.02,
    atsN: ats.length,
    atsBrier: bAts,
    S2: bAts != null && bAts < 0.25,
    corrMargin: pearson(predM, actM),
    meanPred: mean(predM),
    meanAct: mean(actM),
    marginBias: mean(predM) - mean(actM),
    meanSigma: sigmas.length ? mean(sigmas) : null,
    sigmaP50: sigmas.length
      ? [...sigmas].sort((a, b) => a - b)[Math.floor(sigmas.length * 0.5)]!
      : null,
    sigmaP90: sigmas.length
      ? [...sigmas].sort((a, b) => a - b)[Math.floor(sigmas.length * 0.9)]!
      : null,
  };
}

function slice(rows: Row[], modelId: string, keyFn: (r: Row) => string) {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    if (!r.models[modelId]) continue;
    const k = keyFn(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  const out: Record<string, ReturnType<typeof metrics>> = {};
  for (const [k, rs] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    out[k] = metrics(rs, modelId);
  }
  return out;
}

function main(): number {
  mkdirSync(ART, { recursive: true });
  delete process.env.NCAAF_RESEARCH_MARGIN_GAP_SCALE;
  process.env.NCAAF_RESEARCH_CALIBRATION = "1";
  process.env.NCAAF_TEAM_STRENGTH_RESEARCH = "1";

  const tuningAll = loadJsonGames(join(FIX, "ncaaf-tuning-2025-w1-7-games.json")).filter(
    (g) => g.season === 2025 && g.week >= 1 && g.week <= 7,
  );
  const prior = loadJsonGames(join(FIX, "ncaaf-phase-e-games.json")).filter(
    (g) => g.season === 2023 || g.season === 2024,
  );
  const archive = JSON.parse(
    readFileSync(join(FIX, "ncaaf-tuning-2025-w1-7-closing-lines.json"), "utf8"),
  ) as { games: CloseRow[]; missing: unknown[] };
  const closes = new Map(archive.games.map((g) => [String(g.gameId), g]));
  const cohortIds = new Set(
    tuningAll
      .filter((g) => {
        const c = closes.get(g.eventId);
        return (
          !!c &&
          c.closeMlHome != null &&
          Number.isFinite(c.closeMlHome) &&
          c.closeSpreadHome != null &&
          Number.isFinite(c.closeSpreadHome) &&
          g.homeFg !== g.awayFg
        );
      })
      .map((g) => g.eventId),
  );

  const dataLimitations = {
    fcsDivisionIds:
      "VERIFIED — season-specific ESPN standings groups 80/81 in ncaaf-subdivision-espn-ids.json",
    injuryPreKick: "MISSING — injuryKnown left null; E4 blocked",
    neutralSiteConference: "MISSING — not on TUNING game rows",
    closingTotalsAlts: "MISSING — not in archive; out of scope",
    finalEval: "UNTOUCHED — not loaded",
    closesInFeatures: false,
    unratedPolicy: "predictTeamStrength returns null — no invented default-24 μ",
  };

  const seed = new NcaafOppAdjRatings();
  seed.seedFromPrior(prior.filter((g) => g.season === 2024));
  const live = seed.clone();
  const rng = mulberry32(FOOTBALL_CALIBRATION_PRIMARY_SEED);
  const all = [...prior, ...tuningAll].sort((a, b) =>
    String(a.kickoffIso).localeCompare(String(b.kickoffIso)),
  );

  const rows: Row[] = [];
  let skippedThin = 0;

  walkHoldoutGames(all, (g, forms) => {
    const homeIn = teamSimInput(forms.get(g.homeTeamId), "home");
    const awayIn = teamSimInput(forms.get(g.awayTeamId), "away");

    if (cohortIds.has(g.eventId)) {
      const close = closes.get(g.eventId)!;
      if (homeIn.ptsFor == null || awayIn.ptsFor == null) {
        skippedThin += 1;
      } else {
        const homeBlend = teamMean(homeIn.ptsFor, awayIn.ptsAgainst, 24);
        const awayBlend = teamMean(awayIn.ptsFor, homeIn.ptsAgainst, 24);
        const simLocked = runNflDriveSim({
          sport: "ncaaf",
          ncaafResearchCalibration: true,
          simulations: SIMS,
          random: rng,
          home: {
            ptsFor: homeBlend,
            ptsAgainst: awayBlend,
            recentScores: homeIn.recentScores,
          },
          away: {
            ptsFor: awayBlend,
            ptsAgainst: homeBlend,
            recentScores: awayIn.recentScores,
          },
          coverQueries: [
            { id: "home-ml", kind: "ml", teamSide: "home" },
            {
              id: "home-close-spread",
              kind: "spread",
              teamSide: "home",
              line: close.closeSpreadHome!,
            },
          ],
          retainOutcomes: false,
        });
        const pLocked = simLocked.coverHitRates?.["home-ml"];
        if (pLocked != null) {
          const yMl = g.homeFg > g.awayFg ? 1 : 0;
          const adj = g.homeFg - g.awayFg + close.closeSpreadHome!;
          const yAts = Math.abs(adj) < 1e-9 ? null : adj > 0 ? 1 : 0;
          const models: Record<string, ModelOut> = {
            locked_drive_teamMean: {
              pMl: pLocked,
              pAts: simLocked.coverHitRates?.["home-close-spread"] ?? null,
              predMargin:
                (simLocked.expectedHomeScore ?? homeBlend) -
                (simLocked.expectedAwayScore ?? awayBlend),
              sigma: null,
              priorWeight: null,
            },
          };
          for (const [id, comps] of Object.entries(TS_COMPONENTS)) {
            const pred = predictTeamStrength({
              seed,
              live,
              homeId: g.homeTeamId,
              awayId: g.awayTeamId,
              week: g.week,
              components: comps,
            });
            if (!pred) continue; // unrated side — exclude from this model row
            models[id] = {
              pMl: pred.pHomeMl,
              pAts: pred.pHomeCover(close.closeSpreadHome!),
              predMargin: pred.mu,
              sigma: pred.sigma,
              priorWeight: pred.priorWeight,
            };
          }
          rows.push({
            eventId: g.eventId,
            week: g.week,
            yMl,
            yAts,
            marketP: americanToImplied(close.closeMlHome!),
            closeSpreadHome: close.closeSpreadHome!,
            favSize: favSize(Math.abs(close.closeSpreadHome!)),
            actMargin: g.homeFg - g.awayFg,
            models,
          });
        }
      }
    }

    // Causal: update live ratings only AFTER prediction (FBS–FBS only; 2025 walk)
    if (g.season === 2025) live.update(g);
  });

  const modelsOut: Record<string, unknown> = {};
  const byWeek: Record<string, unknown> = {};
  const byFav: Record<string, unknown> = {};
  for (const id of MODEL_IDS) {
    modelsOut[id] = metrics(rows, id);
    byWeek[id] = slice(rows, id, (r) => `w${r.week}`);
    byFav[id] = slice(rows, id, (r) => r.favSize);
  }

  const w1 = rows.filter((r) => r.week === 1);
  const large = rows.filter((r) => r.favSize === "large_14plus");
  const baseline = "locked_drive_teamMean";
  const vsBaseline: Record<string, unknown> = {};
  for (const id of MODEL_IDS) {
    if (id === baseline) continue;
    const a = metrics(rows, id);
    const b = metrics(rows, baseline);
    const aW1 = metrics(w1, id);
    const bW1 = metrics(w1, baseline);
    const aL = metrics(large, id);
    const bL = metrics(large, baseline);
    const sliceRegress =
      aW1.mlBrier > bW1.mlBrier + 0.005 ||
      aW1.delta > bW1.delta + 0.005 ||
      aW1.marginBias < bW1.marginBias - 0.5 ||
      (aL.atsBrier ?? 0) > (bL.atsBrier ?? 0) + 0.01 ||
      aL.marginBias < bL.marginBias - 1.0;
    const aggBetter =
      a.mlBrier < b.mlBrier - 1e-4 || (a.atsBrier ?? 9) < (b.atsBrier ?? 9) - 1e-4;
    vsBaseline[id] = {
      M3: a.M3,
      S2: a.S2,
      aggMlDeltaVsBaseline: a.mlBrier - b.mlBrier,
      aggAtsDeltaVsBaseline: (a.atsBrier ?? 0) - (b.atsBrier ?? 0),
      sliceRegress,
      acceptVsBaseline: aggBetter && !sliceRegress && a.M3 && a.S2,
      note:
        aggBetter && sliceRegress
          ? "REJECT — aggregate gain with W1/14+ regression"
          : !a.M3 || !a.S2
            ? "FAIL locked M3/S2"
            : aggBetter
              ? "improves aggregate without slice regress (still need M3/S2)"
              : "no aggregate improvement",
    };
  }

  const report = {
    generatedAt: new Date().toISOString(),
    split: "TUNING",
    finalEvalUntouched: true,
    liveGate: "NCAAF_GAME_LINE_SIM_VALIDATED=false",
    paidRetrieval: false,
    closesInPredictiveFeatures: false,
    researchFlag: "NCAAF_TEAM_STRENGTH_RESEARCH=1",
    stamps: {
      liveDrive: FOOTBALL_DRIVE_ENGINE_VERSION,
      lockedResearchDrive: "ppg-per-drive-v1.1-research",
      teamStrength: FOOTBALL_NCAAF_TEAM_STRENGTH_RESEARCH_VERSION,
    },
    lockedParamsPreserved: {
      residualSd: FOOTBALL_NCAAF_MARGIN_RESIDUAL_SD,
      homeShrink: FOOTBALL_NCAAF_HOME_MARGIN_SHRINK,
    },
    simsPerGame: SIMS,
    dataLimitations,
    fairCompare: {
      cohortN: rows.length,
      skippedThin,
      closesRows: archive.games.length,
      stillMissing: (archive.missing ?? []).length,
      modelNs: Object.fromEntries(MODEL_IDS.map((id) => [id, metrics(rows, id).n])),
    },
    models: modelsOut,
    slices: {
      week1: Object.fromEntries(MODEL_IDS.map((id) => [id, metrics(w1, id)])),
      large_14plus: Object.fromEntries(MODEL_IDS.map((id) => [id, metrics(large, id)])),
      byWeek,
      byFavoriteSize: byFav,
    },
    vsBaseline,
    conclusion: {
      anyPassM3S2: MODEL_IDS.some((id) => {
        const m = metrics(rows, id);
        return m.M3 && m.S2;
      }),
      anyAcceptVsBaseline: Object.values(vsBaseline).some((v: any) => v.acceptVsBaseline),
      gateFlipAllowed: false,
      finalEval: "UNTOUCHED",
    },
  };

  writeFileSync(join(FIX, "ncaaf-tuning-team-strength-v0.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(ART, "ncaaf-tuning-team-strength-v0.json"), JSON.stringify(report, null, 2));

  const md: string[] = [];
  md.push("# TUNING: team-strength v0 vs locked drive (cache-only)");
  md.push("");
  md.push(
    `**Stamp:** \`${FOOTBALL_NCAAF_TEAM_STRENGTH_RESEARCH_VERSION}\` · **Flag:** \`NCAAF_TEAM_STRENGTH_RESEARCH=1\` · **FINAL_EVAL:** untouched · **Gate:** false · **Paid:** none · **Closes in features:** no`,
  );
  md.push("");
  md.push("## Data limitations");
  md.push("");
  for (const [k, v] of Object.entries(dataLimitations)) {
    md.push(`- **${k}:** ${v}`);
  }
  md.push("");
  md.push(`## Fair cohort n=${rows.length}`);
  md.push("");
  md.push(
    "| Model | n | ML Brier | Δ vs mkt | M3 | ATS | S2 | corr(m) | bias | meanσ |",
  );
  md.push(
    "|-------|--:|---------:|---------:|:--:|----:|:--:|--------:|-----:|------:|",
  );
  for (const id of MODEL_IDS) {
    const m = metrics(rows, id);
    md.push(
      `| \`${id}\` | ${m.n} | ${m.mlBrier.toFixed(4)} | ${m.delta.toFixed(4)} | ${m.M3} | ${(m.atsBrier ?? NaN).toFixed(4)} | ${m.S2} | ${(m.corrMargin ?? NaN).toFixed(3)} | ${m.marginBias.toFixed(1)} | ${m.meanSigma == null ? "—" : m.meanSigma.toFixed(1)} |`,
    );
  }
  md.push("");
  md.push("## Week 1");
  md.push("");
  md.push("| Model | n | ML | Δ | ATS | bias | meanσ |");
  md.push("|-------|--:|---:|--:|----:|-----:|------:|");
  for (const id of MODEL_IDS) {
    const m = metrics(w1, id);
    md.push(
      `| \`${id}\` | ${m.n} | ${m.mlBrier.toFixed(3)} | ${m.delta.toFixed(3)} | ${(m.atsBrier ?? NaN).toFixed(3)} | ${m.marginBias.toFixed(1)} | ${m.meanSigma == null ? "—" : m.meanSigma.toFixed(1)} |`,
    );
  }
  md.push("");
  md.push("## Large favorites (14+)");
  md.push("");
  md.push("| Model | n | ML | Δ | ATS | bias | meanσ |");
  md.push("|-------|--:|---:|--:|----:|-----:|------:|");
  for (const id of MODEL_IDS) {
    const m = metrics(large, id);
    md.push(
      `| \`${id}\` | ${m.n} | ${m.mlBrier.toFixed(3)} | ${m.delta.toFixed(3)} | ${(m.atsBrier ?? NaN).toFixed(3)} | ${m.marginBias.toFixed(1)} | ${m.meanSigma == null ? "—" : m.meanSigma.toFixed(1)} |`,
    );
  }
  md.push("");
  md.push("## Vs locked drive baseline");
  md.push("");
  for (const id of MODEL_IDS) {
    if (id === baseline) continue;
    const v = vsBaseline[id] as any;
    md.push(`### \`${id}\``);
    md.push(`- ${v.note}`);
    md.push(
      `- ΔML vs baseline: ${Number(v.aggMlDeltaVsBaseline).toFixed(4)} · ΔATS: ${Number(v.aggAtsDeltaVsBaseline).toFixed(4)} · sliceRegress: ${v.sliceRegress}`,
    );
    md.push("");
  }
  md.push("## Conclusion");
  md.push("");
  md.push(`- Any M3∧S2 PASS: **${report.conclusion.anyPassM3S2}**`);
  md.push(`- Any accept vs baseline (incl. M3∧S2): **${report.conclusion.anyAcceptVsBaseline}**`);
  md.push("- Gate flip: **false** · FINAL_EVAL: **UNTOUCHED** · voice paused · no deploy/OTA");
  md.push("");
  md.push("## Repro");
  md.push("```bash");
  md.push("cd artifacts/api-server");
  md.push(
    "NCAAF_TUNING_SIMS=1000 NCAAF_TEAM_STRENGTH_RESEARCH=1 node --import ./test/register-hooks.mjs ./scripts/ncaafTuningTeamStrengthV0.ts",
  );
  md.push("```");

  const mdText = md.join("\n");
  writeFileSync(join(FIX, "ncaaf-tuning-team-strength-v0.md"), mdText);
  writeFileSync(join(ART, "ncaaf-tuning-team-strength-v0.md"), mdText);
  writeFileSync(join(here, "../../../docs/coach/ncaaf-tuning-team-strength-v0.md"), mdText);

  console.log(
    JSON.stringify(
      {
        cohortN: rows.length,
        anyPassM3S2: report.conclusion.anyPassM3S2,
        models: Object.fromEntries(
          MODEL_IDS.map((id) => {
            const m = metrics(rows, id);
            return [id, { ml: m.mlBrier, delta: m.delta, M3: m.M3, ats: m.atsBrier, S2: m.S2 }];
          }),
        ),
      },
      null,
      2,
    ),
  );
  return 0;
}

process.exit(main());
