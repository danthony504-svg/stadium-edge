/**
 * Cache-only isolated lever tests on the TUNING closes archive.
 *
 * Levers (tested separately; pre-kickoff info only):
 *   1. prior_season_w1 — carry 2024 seed ratings into Week 1 (thin-form fix)
 *   2. opp_adj_online vs opp_adj_seed_frozen — opponent-adjusted updates
 *   3. teamMean_on vs teamMean_off — blend vs raw form into drive sim
 *
 * Identical cohort + time-ordered week folds. Reject if aggregate improves
 * but early-week or large-favorite slices worsen.
 *
 * FINAL_EVAL never loaded. No paid Odds. Gate not flipped.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runNflDriveSim } from "../src/lib/sportSim/nflDriveSim.ts";
import {
  blendVenueAndL10,
  FOOTBALL_NCAAF_MARGIN_RESIDUAL_SD,
  FOOTBALL_NCAAF_HOME_MARGIN_SHRINK,
  FOOTBALL_NCAAF_RESEARCH_MARGIN_GAP_SCALE_DEFAULT,
} from "../src/lib/sportSim/footballDriveMatchup.ts";
import {
  FOOTBALL_CALIBRATION_PRIMARY_SEED,
  mulberry32,
  walkHoldoutGames,
  type HoldoutWalkForm,
} from "../src/lib/sportSim/footballCalibration.ts";
import { teamMean } from "../src/lib/sportSim/shared.ts";

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
  return s / ps.length;
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
function clamp01(x: number): number {
  return Math.max(0.02, Math.min(0.98, x));
}
function logistic(x: number, slope: number): number {
  return clamp01(1 / (1 + Math.exp(-(slope * x))));
}
function favSize(abs: number): string {
  if (abs < 3.5) return "pick_em";
  if (abs <= 7.5) return "small_3.5_7.5";
  if (abs <= 14) return "medium_7.5_14";
  return "large_14plus";
}

const FCS_SCHOOL_RE =
  /\b(houston christian|youngstown state|grambling|mcneese|jackson state|saint francis|st\.?\s*francis|liu|long island|se louisiana|southeastern louisiana|nicholls|bethune|norfolk state|idaho state|wagner|duquesne|howard|alabama state|prairie view|north dakota|south dakota|montana|weber state|eastern washington|northern iowa|villanova|delaware|towson|richmond|samford|furman|citadel|wofford|chattanooga|tennessee[- ]martin|se missouri|eastern kentucky|central arkansas|stephen f|incarnate word|abilene christian|tarleton|ut martin|southern jaguars)\b/i;

function looksFcsName(name: string | undefined): boolean {
  return FCS_SCHOOL_RE.test((name || "").toLowerCase());
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

class OppAdjRatings {
  off = new Map<string, number>();
  def = new Map<string, number>();
  readonly priorOff: number;
  readonly priorDef: number;
  readonly lr: number;
  constructor(opts?: { lr?: number }) {
    this.priorOff = 24;
    this.priorDef = 24;
    this.lr = opts?.lr ?? 0.3;
  }
  getOff(id: string): number {
    return this.off.get(id) ?? this.priorOff;
  }
  getDef(id: string): number {
    return this.def.get(id) ?? this.priorDef;
  }
  predict(homeId: string, awayId: string) {
    const homeOff = 0.5 * this.getOff(homeId) + 0.5 * this.getDef(awayId);
    const awayOff = 0.5 * this.getOff(awayId) + 0.5 * this.getDef(homeId);
    return { homeOff, awayOff, gap: homeOff - awayOff, predMargin: homeOff - awayOff };
  }
  seedFromPrior(games: EspnGame[], fcsIds: Set<string>): void {
    const teams = new Set<string>();
    for (const g of games) {
      if (fcsIds.has(g.homeTeamId) || fcsIds.has(g.awayTeamId)) continue;
      teams.add(g.homeTeamId);
      teams.add(g.awayTeamId);
    }
    const offSum = new Map<string, number[]>();
    const defSum = new Map<string, number[]>();
    for (const id of teams) {
      offSum.set(id, []);
      defSum.set(id, []);
    }
    for (const g of games) {
      if (fcsIds.has(g.homeTeamId) || fcsIds.has(g.awayTeamId)) continue;
      offSum.get(g.homeTeamId)!.push(g.homeFg);
      defSum.get(g.homeTeamId)!.push(g.awayFg);
      offSum.get(g.awayTeamId)!.push(g.awayFg);
      defSum.get(g.awayTeamId)!.push(g.homeFg);
    }
    for (const id of teams) {
      this.off.set(id, mean(offSum.get(id)!, this.priorOff));
      this.def.set(id, mean(defSum.get(id)!, this.priorDef));
    }
    for (let iter = 0; iter < 4; iter++) {
      const newOff = new Map<string, number[]>();
      const newDef = new Map<string, number[]>();
      for (const id of teams) {
        newOff.set(id, []);
        newDef.set(id, []);
      }
      for (const g of games) {
        if (fcsIds.has(g.homeTeamId) || fcsIds.has(g.awayTeamId)) continue;
        newOff.get(g.homeTeamId)!.push(g.homeFg - (this.getDef(g.awayTeamId) - this.priorDef));
        newOff.get(g.awayTeamId)!.push(g.awayFg - (this.getDef(g.homeTeamId) - this.priorDef));
        newDef.get(g.homeTeamId)!.push(g.awayFg - (this.getOff(g.awayTeamId) - this.priorOff));
        newDef.get(g.awayTeamId)!.push(g.homeFg - (this.getOff(g.homeTeamId) - this.priorOff));
      }
      for (const id of teams) {
        this.off.set(id, mean(newOff.get(id)!, this.priorOff));
        this.def.set(id, mean(newDef.get(id)!, this.priorDef));
      }
    }
  }
  update(g: EspnGame, fcsIds: Set<string>, hfa = 2.5): void {
    if (fcsIds.has(g.homeTeamId) || fcsIds.has(g.awayTeamId)) return;
    const lr = this.lr;
    const predH = 0.5 * this.getOff(g.homeTeamId) + 0.5 * this.getDef(g.awayTeamId) + hfa / 2;
    const predA = 0.5 * this.getOff(g.awayTeamId) + 0.5 * this.getDef(g.homeTeamId) - hfa / 2;
    const errH = g.homeFg - predH;
    const errA = g.awayFg - predA;
    this.off.set(g.homeTeamId, this.getOff(g.homeTeamId) + lr * errH);
    this.def.set(g.awayTeamId, this.getDef(g.awayTeamId) + lr * errH);
    this.off.set(g.awayTeamId, this.getOff(g.awayTeamId) + lr * errA);
    this.def.set(g.homeTeamId, this.getDef(g.homeTeamId) + lr * errA);
  }
  clone(): OppAdjRatings {
    const c = new OppAdjRatings({ lr: this.lr });
    c.off = new Map(this.off);
    c.def = new Map(this.def);
    return c;
  }
}

type ModelOut = { pMl: number; pAts: number | null; predMargin: number };
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
  "locked_teamMean",
  "raw_offense_no_teamMean",
  "prior_season_into_w1",
  "opp_adj_seed_frozen",
  "opp_adj_online_updates",
] as const;

function metrics(rows: Row[], modelId: string) {
  const usable = rows.filter((r) => r.models[modelId]);
  const p = usable.map((r) => r.models[modelId]!.pMl);
  const y = usable.map((r) => r.yMl);
  const mkt = usable.map((r) => r.marketP);
  const ats = usable.filter((r) => r.models[modelId]!.pAts != null && r.yAts != null);
  const predM = usable.map((r) => r.models[modelId]!.predMargin);
  const actM = usable.map((r) => r.actMargin);
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

/** Reject if aggregate ML improves but early-week or large-fav slices worsen. */
function verdictVsBaseline(
  cand: string,
  baseline: string,
  rows: Row[],
): { accept: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const bAll = metrics(rows, baseline);
  const cAll = metrics(rows, cand);
  const bW1 = metrics(
    rows.filter((r) => r.week === 1),
    baseline,
  );
  const cW1 = metrics(
    rows.filter((r) => r.week === 1),
    cand,
  );
  const bEarly = metrics(
    rows.filter((r) => r.week <= 3),
    baseline,
  );
  const cEarly = metrics(
    rows.filter((r) => r.week <= 3),
    cand,
  );
  const bLarge = metrics(
    rows.filter((r) => r.favSize === "large_14plus"),
    baseline,
  );
  const cLarge = metrics(
    rows.filter((r) => r.favSize === "large_14plus"),
    cand,
  );

  const aggMlBetter = cAll.mlBrier < bAll.mlBrier - 1e-4;
  const aggAtsBetter = (cAll.atsBrier ?? 9) < (bAll.atsBrier ?? 9) - 1e-4;

  // Slice worsen checks (higher Brier / worse |bias| for under-prediction of blowouts)
  if (cW1.mlBrier > bW1.mlBrier + 0.005) {
    reasons.push(`w1 ML Brier worsened ${bW1.mlBrier.toFixed(3)}→${cW1.mlBrier.toFixed(3)}`);
  }
  if (cW1.delta > bW1.delta + 0.005) {
    reasons.push(`w1 Δ vs market worsened ${bW1.delta.toFixed(3)}→${cW1.delta.toFixed(3)}`);
  }
  // Margin bias: locked under-predicts blowouts (negative bias). Worsen = more negative.
  if (cW1.marginBias < bW1.marginBias - 0.5) {
    reasons.push(
      `w1 marginBias more under-predictive ${bW1.marginBias.toFixed(2)}→${cW1.marginBias.toFixed(2)}`,
    );
  }
  if (cEarly.mlBrier > bEarly.mlBrier + 0.005) {
    reasons.push(
      `w1–3 ML Brier worsened ${bEarly.mlBrier.toFixed(3)}→${cEarly.mlBrier.toFixed(3)}`,
    );
  }
  if ((cLarge.atsBrier ?? 0) > (bLarge.atsBrier ?? 0) + 0.01) {
    reasons.push(
      `large_14plus ATS worsened ${(bLarge.atsBrier ?? 0).toFixed(3)}→${(cLarge.atsBrier ?? 0).toFixed(3)}`,
    );
  }
  if (cLarge.marginBias < bLarge.marginBias - 1.0) {
    reasons.push(
      `large_14plus marginBias more under-predictive ${bLarge.marginBias.toFixed(2)}→${cLarge.marginBias.toFixed(2)}`,
    );
  }

  const sliceOk = reasons.length === 0;
  let accept = false;
  if (!aggMlBetter && !aggAtsBetter) {
    reasons.push("no aggregate ML/ATS improvement vs locked_teamMean");
    accept = false;
  } else if (!sliceOk) {
    reasons.unshift("REJECT: aggregate gain with early-week/large-fav slice regression");
    accept = false;
  } else {
    accept = true;
    reasons.push("ACCEPT: aggregate improves without early-week/large-fav regression");
  }
  return { accept, reasons };
}

function main(): number {
  mkdirSync(ART, { recursive: true });
  delete process.env.NCAAF_RESEARCH_MARGIN_GAP_SCALE;
  process.env.NCAAF_RESEARCH_CALIBRATION = "1";

  const tuningAll = loadJsonGames(join(FIX, "ncaaf-tuning-2025-w1-7-games.json")).filter(
    (g) => g.season === 2025 && g.week >= 1 && g.week <= 7,
  );
  const prior = loadJsonGames(join(FIX, "ncaaf-phase-e-games.json")).filter(
    (g) => g.season === 2023 || g.season === 2024,
  );
  const archive = JSON.parse(
    readFileSync(join(FIX, "ncaaf-tuning-2025-w1-7-closing-lines.json"), "utf8"),
  ) as {
    games: CloseRow[];
    missing: unknown[];
    creditsSpent?: number;
    creditCap?: number;
    generatedAt?: string;
  };
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

  const nameById = new Map<string, string>();
  for (const g of [...prior, ...tuningAll]) {
    if (g.homeName) nameById.set(g.homeTeamId, g.homeName);
    if (g.awayName) nameById.set(g.awayTeamId, g.awayName);
  }
  const fcsIds = new Set<string>();
  for (const [id, name] of nameById) {
    if (looksFcsName(name)) fcsIds.add(id);
  }

  const seed = new OppAdjRatings({ lr: 0.3 });
  seed.seedFromPrior(
    prior.filter((g) => g.season === 2024),
    fcsIds,
  );
  const online = seed.clone();
  const frozen = seed.clone(); // never updated during TUNING
  const hfa = 2.5;
  const rng = mulberry32(FOOTBALL_CALIBRATION_PRIMARY_SEED);
  const all = [...prior, ...tuningAll].sort((a, b) =>
    String(a.kickoffIso).localeCompare(String(b.kickoffIso)),
  );

  const rows: Row[] = [];
  let skippedThin = 0;

  walkHoldoutGames(all, (g, forms) => {
    const homeIn = teamSimInput(forms.get(g.homeTeamId), "home");
    const awayIn = teamSimInput(forms.get(g.awayTeamId), "away");
    const predOnline = online.predict(g.homeTeamId, g.awayTeamId);
    const predFrozen = frozen.predict(g.homeTeamId, g.awayTeamId);

    if (cohortIds.has(g.eventId)) {
      const close = closes.get(g.eventId)!;
      if (homeIn.ptsFor == null || awayIn.ptsFor == null) {
        skippedThin += 1;
      } else {
        const homeBlend = teamMean(homeIn.ptsFor, awayIn.ptsAgainst, 24);
        const awayBlend = teamMean(awayIn.ptsFor, homeIn.ptsAgainst, 24);

        // Prior-season into W1: replace thin early form with seed rating PPG
        const priorPred = seed.predict(g.homeTeamId, g.awayTeamId);
        const usePriorW1 = g.week === 1;
        const homePrior = priorPred.homeOff + hfa / 2;
        const awayPrior = priorPred.awayOff - hfa / 2;

        const runDrive = (homeOff: number, awayOff: number) =>
          runNflDriveSim({
            sport: "ncaaf",
            ncaafResearchCalibration: true,
            simulations: SIMS,
            random: rng,
            home: {
              ptsFor: homeOff,
              ptsAgainst: awayOff,
              recentScores: homeIn.recentScores,
            },
            away: {
              ptsFor: awayOff,
              ptsAgainst: homeOff,
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

        const simLocked = runDrive(homeBlend, awayBlend);
        const simRaw = runDrive(homeIn.ptsFor, awayIn.ptsFor);
        const simPriorW1 = usePriorW1
          ? runDrive(homePrior, awayPrior)
          : simLocked;

        const coverZOnline =
          (predOnline.predMargin + hfa + close.closeSpreadHome!) /
          FOOTBALL_NCAAF_MARGIN_RESIDUAL_SD;
        const coverZFrozen =
          (predFrozen.predMargin + hfa + close.closeSpreadHome!) /
          FOOTBALL_NCAAF_MARGIN_RESIDUAL_SD;

        const pLocked = simLocked.coverHitRates?.["home-ml"];
        const pRaw = simRaw.coverHitRates?.["home-ml"];
        const pPrior = simPriorW1.coverHitRates?.["home-ml"];
        if (pLocked != null && pRaw != null && pPrior != null) {
          const yMl = g.homeFg > g.awayFg ? 1 : 0;
          const adj = g.homeFg - g.awayFg + close.closeSpreadHome!;
          const yAts = Math.abs(adj) < 1e-9 ? null : adj > 0 ? 1 : 0;
          rows.push({
            eventId: g.eventId,
            week: g.week,
            yMl,
            yAts,
            marketP: americanToImplied(close.closeMlHome!),
            closeSpreadHome: close.closeSpreadHome!,
            favSize: favSize(Math.abs(close.closeSpreadHome!)),
            actMargin: g.homeFg - g.awayFg,
            models: {
              locked_teamMean: {
                pMl: pLocked,
                pAts: simLocked.coverHitRates?.["home-close-spread"] ?? null,
                predMargin:
                  (simLocked.expectedHomeScore ?? homeBlend) -
                  (simLocked.expectedAwayScore ?? awayBlend),
              },
              raw_offense_no_teamMean: {
                pMl: pRaw,
                pAts: simRaw.coverHitRates?.["home-close-spread"] ?? null,
                predMargin:
                  (simRaw.expectedHomeScore ?? homeIn.ptsFor!) -
                  (simRaw.expectedAwayScore ?? awayIn.ptsFor!),
              },
              prior_season_into_w1: {
                pMl: pPrior,
                pAts: simPriorW1.coverHitRates?.["home-close-spread"] ?? null,
                predMargin:
                  (simPriorW1.expectedHomeScore ?? (usePriorW1 ? homePrior : homeBlend)) -
                  (simPriorW1.expectedAwayScore ?? (usePriorW1 ? awayPrior : awayBlend)),
              },
              opp_adj_seed_frozen: {
                pMl: logistic(predFrozen.gap + hfa, 0.1),
                pAts: clamp01(1 / (1 + Math.exp(-1.7 * coverZFrozen))),
                predMargin: predFrozen.predMargin + hfa,
              },
              opp_adj_online_updates: {
                pMl: logistic(predOnline.gap + hfa, 0.1),
                pAts: clamp01(1 / (1 + Math.exp(-1.7 * coverZOnline))),
                predMargin: predOnline.predMargin + hfa,
              },
            },
          });
        }
      }
    }

    if (g.season === 2025) online.update(g, fcsIds, hfa);
    // frozen: no TUNING updates
  });

  const baseline = "locked_teamMean";
  const models: Record<string, unknown> = {};
  const byWeek: Record<string, unknown> = {};
  const byFav: Record<string, unknown> = {};
  const verdicts: Record<string, unknown> = {};

  for (const id of MODEL_IDS) {
    models[id] = metrics(rows, id);
    byWeek[id] = slice(rows, id, (r) => `w${r.week}`);
    byFav[id] = slice(rows, id, (r) => r.favSize);
    if (id !== baseline) {
      verdicts[id] = verdictVsBaseline(id, baseline, rows);
    }
  }

  // Time-ordered expanding folds: evaluate week k using same causal preds (already
  // time-ordered); report cumulative weeks 1..k metrics for locked vs each lever.
  const expandingFolds: Record<string, unknown> = {};
  for (let k = 1; k <= 7; k++) {
    const foldRows = rows.filter((r) => r.week <= k);
    const fold: Record<string, unknown> = { throughWeek: k, n: foldRows.length };
    for (const id of MODEL_IDS) {
      fold[id] = metrics(foldRows, id);
    }
    expandingFolds[`through_w${k}`] = fold;
  }

  const creditProvenance = {
    recoveryBranch: "cursor/ncaaf-tuning-closes-3645",
    retrievalAgentBcId: "bc-01a1471c-a008-7787-a77d-4ba59e943645",
    thisAnalysisBranch: "cursor/ncaaf-tuning-cache-analysis-8b51",
    thisAnalysisAgentBcId: "bc-01a140e2-c331-7d27-9d8f-4d9938928b51",
    archiveGeneratedAt: archive.generatedAt,
    scriptLedgerCreditsSpent: archive.creditsSpent ?? 3280,
    scriptHttpCalls: 163,
    scriptAlreadySpentProbe: 20,
    scriptLedgerFormula: "20 + 163×20 = 3280",
    sessionRemainingDelta: 3560,
    sessionRemainingFormula: "first free /v4/sports remaining 3808289 − post-batch 3804729 = 3560",
    gap: 280,
    gapExplanation:
      "Same authorized TUNING retrieval (one session). First E2b process was interrupted after charging ~280 credits of snapshots; second process reused those caches (free to ledger) so creditsSpent=3280 under-counts. Authoritative spend = remaining-Δ 3560. Not a second retrieval.",
    distinctRetrievals: false,
    paidHttpThisTurn: 0,
  };

  const report = {
    generatedAt: new Date().toISOString(),
    split: "TUNING",
    finalEvalUntouched: true,
    liveGate: "NCAAF_GAME_LINE_SIM_VALIDATED=false",
    paidRetrieval: false,
    closesInPredictiveFeatures: false,
    lockedParams: {
      residualSd: FOOTBALL_NCAAF_MARGIN_RESIDUAL_SD,
      homeShrink: FOOTBALL_NCAAF_HOME_MARGIN_SHRINK,
      gapScale: FOOTBALL_NCAAF_RESEARCH_MARGIN_GAP_SCALE_DEFAULT,
    },
    simsPerGame: SIMS,
    fairCompare: {
      cohortN: rows.length,
      skippedThin,
      closesRows: archive.games.length,
      tuningGames: tuningAll.length,
      stillMissing: (archive.missing ?? []).length,
      modelNs: Object.fromEntries(MODEL_IDS.map((id) => [id, metrics(rows, id).n])),
    },
    creditProvenance,
    models,
    timeOrderedFolds: {
      byWeek,
      byFavoriteSize: byFav,
      expandingThroughWeek: expandingFolds,
      note: "All strength inputs use walkHoldoutGames (prior games only). Opp-adj online updates only after prediction. Seed frozen never sees TUNING outcomes.",
    },
    sliceAwareVerdicts: verdicts,
    conclusion: {
      anyAccepted: Object.values(verdicts).some((v: any) => v.accept),
      recommendModelReplacement: true,
      note: "Isolated levers that only lift aggregate ML while regressing Week-1 or large-favorite slices are REJECTED. Gate stays false.",
    },
  };

  const jsonPath = join(FIX, "ncaaf-tuning-isolated-levers.json");
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  writeFileSync(join(ART, "ncaaf-tuning-isolated-levers.json"), JSON.stringify(report, null, 2));

  const mdLines: string[] = [];
  mdLines.push("# TUNING isolated levers (cache-only)");
  mdLines.push("");
  mdLines.push(
    "**FINAL_EVAL:** untouched · **Gate:** false · **Paid:** none · **Closes in features:** no",
  );
  mdLines.push("");
  mdLines.push("## Credit provenance (3560 vs 3280)");
  mdLines.push("");
  mdLines.push("| Figure | Value | Meaning |");
  mdLines.push("|-------|------:|---------|");
  mdLines.push("| Session remaining-Δ | **3560** | Authoritative Odds spend this retrieval session |");
  mdLines.push("| Script `creditsSpent` | **3280** | `already_spent=20` + `163×20` HTTP in completed process |");
  mdLines.push("| Gap | **280** | Interrupted first process charged cache; second process reused (ledger miss) |");
  mdLines.push("| Retrieval agent | `bc-01a1471c-a008-7787-a77d-4ba59e943645` | branch `cursor/ncaaf-tuning-closes-3645` |");
  mdLines.push("| Distinct retrievals? | **No** | One authorized TUNING pull; two processes |");
  mdLines.push("");
  mdLines.push(`## Fair cohort n=${rows.length}`);
  mdLines.push("");
  mdLines.push("| Model | ML Brier | Δ vs mkt | M3 | ATS | S2 | corr(m) | bias |");
  mdLines.push("|-------|---------:|---------:|:--:|----:|:--:|--------:|-----:|");
  for (const id of MODEL_IDS) {
    const m = metrics(rows, id);
    mdLines.push(
      `| \`${id}\` | ${m.mlBrier.toFixed(4)} | ${m.delta.toFixed(4)} | ${m.M3} | ${(m.atsBrier ?? NaN).toFixed(4)} | ${m.S2} | ${(m.corrMargin ?? NaN).toFixed(3)} | ${m.marginBias.toFixed(1)} |`,
    );
  }
  mdLines.push("");
  mdLines.push("## Week 1 slice");
  mdLines.push("");
  mdLines.push("| Model | n | ML | Δ | ATS | bias |");
  mdLines.push("|-------|--:|---:|--:|----:|-----:|");
  for (const id of MODEL_IDS) {
    const m = metrics(
      rows.filter((r) => r.week === 1),
      id,
    );
    mdLines.push(
      `| \`${id}\` | ${m.n} | ${m.mlBrier.toFixed(3)} | ${m.delta.toFixed(3)} | ${(m.atsBrier ?? NaN).toFixed(3)} | ${m.marginBias.toFixed(1)} |`,
    );
  }
  mdLines.push("");
  mdLines.push("## Large favorites (14+)");
  mdLines.push("");
  mdLines.push("| Model | n | ML | Δ | ATS | bias |");
  mdLines.push("|-------|--:|---:|--:|----:|-----:|");
  for (const id of MODEL_IDS) {
    const m = metrics(
      rows.filter((r) => r.favSize === "large_14plus"),
      id,
    );
    mdLines.push(
      `| \`${id}\` | ${m.n} | ${m.mlBrier.toFixed(3)} | ${m.delta.toFixed(3)} | ${(m.atsBrier ?? NaN).toFixed(3)} | ${m.marginBias.toFixed(1)} |`,
    );
  }
  mdLines.push("");
  mdLines.push("## Slice-aware verdicts vs `locked_teamMean`");
  mdLines.push("");
  for (const id of MODEL_IDS) {
    if (id === baseline) continue;
    const v = verdicts[id] as { accept: boolean; reasons: string[] };
    mdLines.push(`### \`${id}\` → **${v.accept ? "ACCEPT" : "REJECT"}**`);
    for (const r of v.reasons) mdLines.push(`- ${r}`);
    mdLines.push("");
  }
  mdLines.push("## Expanding time-ordered folds (ML Brier)");
  mdLines.push("");
  mdLines.push(
    "| Through week | locked | raw | priorW1 | opp frozen | opp online |",
  );
  mdLines.push("|-------------:|-------:|----:|--------:|-----------:|-----------:|");
  for (let k = 1; k <= 7; k++) {
    const fold = expandingFolds[`through_w${k}`] as Record<string, any>;
    mdLines.push(
      `| ${k} | ${fold.locked_teamMean.mlBrier.toFixed(3)} | ${fold.raw_offense_no_teamMean.mlBrier.toFixed(3)} | ${fold.prior_season_into_w1.mlBrier.toFixed(3)} | ${fold.opp_adj_seed_frozen.mlBrier.toFixed(3)} | ${fold.opp_adj_online_updates.mlBrier.toFixed(3)} |`,
    );
  }
  mdLines.push("");
  mdLines.push("## Conclusion");
  mdLines.push("");
  mdLines.push(
    `- Any lever accepted: **${report.conclusion.anyAccepted}**`,
  );
  mdLines.push("- Recommend model replacement: **true** (architecture), not residual/gap scalar");
  mdLines.push("- Gate flip: **false** · FINAL_EVAL: **UNTOUCHED** · paid this turn: **0**");
  mdLines.push("");
  mdLines.push("## Repro");
  mdLines.push("```bash");
  mdLines.push("cd artifacts/api-server");
  mdLines.push(
    "NCAAF_TUNING_SIMS=1000 node --import ./test/register-hooks.mjs ./scripts/ncaafTuningIsolatedLevers.ts",
  );
  mdLines.push("```");

  const md = mdLines.join("\n");
  writeFileSync(join(FIX, "ncaaf-tuning-isolated-levers.md"), md);
  writeFileSync(join(ART, "ncaaf-tuning-isolated-levers.md"), md);
  writeFileSync(join(here, "../../../../docs/coach/ncaaf-tuning-isolated-levers.md"), md);

  console.log(
    JSON.stringify(
      {
        cohortN: rows.length,
        anyAccepted: report.conclusion.anyAccepted,
        creditAuthoritative: 3560,
        creditLedger: 3280,
        verdicts: Object.fromEntries(
          Object.entries(verdicts).map(([k, v]: any) => [k, v.accept]),
        ),
      },
      null,
      2,
    ),
  );
  return 0;
}

process.exit(main());
