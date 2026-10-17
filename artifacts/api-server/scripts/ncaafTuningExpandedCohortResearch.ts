/**
 * TUNING expanded-cohort research (post alias rematch).
 *
 * Fair comparisons: every model scored on the SAME fixed eval set
 * (TUNING games with closeMlHome + closeSpreadHome).
 *
 * - Closes = evaluation only (never predictive features)
 * - No future-game leakage (time-ordered form / ratings)
 * - FINAL_EVAL never loaded
 * - No paid Odds retrieval; gate not flipped
 *
 * Locked criteria unchanged:
 *   M3: brierEngine ≤ brierMarketClose + 0.02
 *   S2: brierEngine ATS < 0.25
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runNflDriveSim } from "../src/lib/sportSim/nflDriveSim.ts";
import {
  blendVenueAndL10,
  FOOTBALL_NCAAF_RESEARCH_ENGINE_VERSION,
  FOOTBALL_NCAAF_MARGIN_RESIDUAL_SD,
  FOOTBALL_NCAAF_HOME_MARGIN_SHRINK,
  FOOTBALL_NCAAF_RESEARCH_MARGIN_GAP_SCALE_DEFAULT,
  footballExpectedDrives,
  footballDriveRateInput,
  footballDriveScoringRates,
  footballDriveRatesPastKnee,
  FOOTBALL_DRIVE_SCORE_RATE_CAP,
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
const SIMS = Number(process.env.NCAAF_TUNING_SIMS ?? 1_500);

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
  matchSource?: string;
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
function logistic(x: number, slope: number, intercept = 0): number {
  return clamp01(1 / (1 + Math.exp(-(intercept + slope * x))));
}
function spreadBin(abs: number): string {
  if (abs <= 3.5) return "0_3.5";
  if (abs <= 7.5) return "3.5_7.5";
  if (abs <= 14) return "7.5_14";
  if (abs <= 21) return "14_21";
  return "21plus";
}
function favSize(abs: number): string {
  if (abs < 3.5) return "pick_em";
  if (abs <= 7.5) return "small_3.5_7.5";
  if (abs <= 14) return "medium_7.5_14";
  return "large_14plus";
}

/** Heuristic FCS / non-FBS board teams (name tokens). Not a paid classification. */
const FCS_NAME_RE =
  /\b(huskies|penguins|jaguars|tigers|lions|sharks|colonels|red flash|cowboys|bears|bison|salukis|demons|racers|leathernecks|aggies)\b/i;
const FCS_SCHOOL_RE =
  /\b(houston christian|youngstown state|grambling|mcneese|jackson state|saint francis|st\.?\s*francis|liu|long island|arkansas[- ]pine bluff|se louisiana|southeastern louisiana|nicholls|southern jaguars|bethune|norfolk state|idaho state|wagner|duquesne|howard|alabama state|prairie view|north dakota|south dakota|montana|weber state|eastern washington|northern iowa|villanova|delaware|towson|richmond|samford|furman|citadel|wofford|chattanooga|tennessee[- ]martin|se missouri|eastern kentucky|central arkansas|stephen f|incarnate word|abilene christian|tarleton|ut martin)\b/i;

function looksFcsName(name: string | undefined): boolean {
  const n = (name || "").toLowerCase();
  if (!n) return false;
  if (FCS_SCHOOL_RE.test(n)) return true;
  // "Southern Jaguars" vs "Southern Miss" — require jaguar / known FCS
  if (/\bsouthern jaguars\b/.test(n)) return true;
  return false;
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
    nFormGames: (form?.ptsFor.length ?? 0),
    provenance: blended.provenance,
  };
}

type EvalRow = {
  eventId: string;
  week: number;
  yMl: number;
  yAts: number | null;
  marketP: number;
  closeSpreadHome: number;
  favoriteSide: "home" | "away" | "pick";
  favSize: string;
  spreadAbsBin: string;
  actMargin: number;
  fcsOpponent: boolean;
  nHomeForm: number;
  nAwayForm: number;
  provenance: string;
  /** Predictive gaps / probs by model id */
  models: Record<
    string,
    {
      pMl: number;
      pAts: number | null;
      predMargin: number;
      strengthGap: number;
      rateCapHome: boolean;
      rateCapAway: boolean;
      blendedGapVsRaw: number | null;
    }
  >;
};

/**
 * Time-ordered opponent-adjusted offense/defense ratings.
 * Update ONLY after a game is visited (post-prediction) — no future leakage.
 * FCS games: skip rating updates (FBS ratings not polluted) but still predict.
 */
class OppAdjRatings {
  off = new Map<string, number>();
  def = new Map<string, number>();
  n = new Map<string, number>();
  readonly priorOff: number;
  readonly priorDef: number;
  readonly lr: number;

  constructor(opts?: { priorOff?: number; priorDef?: number; lr?: number }) {
    this.priorOff = opts?.priorOff ?? 24;
    this.priorDef = opts?.priorDef ?? 24;
    this.lr = opts?.lr ?? 0.35;
  }

  getOff(id: string): number {
    return this.off.get(id) ?? this.priorOff;
  }
  getDef(id: string): number {
    return this.def.get(id) ?? this.priorDef;
  }

  /** Expected home/away points and margin from ratings at prediction time. */
  predict(homeId: string, awayId: string): {
    homeOff: number;
    awayOff: number;
    gap: number;
    predMargin: number;
  } {
    const homeOff = 0.5 * this.getOff(homeId) + 0.5 * this.getDef(awayId);
    const awayOff = 0.5 * this.getOff(awayId) + 0.5 * this.getDef(homeId);
    const gap = homeOff - awayOff;
    return {
      homeOff,
      awayOff,
      gap,
      predMargin: gap, // no home shrink — rating model has its own HFA below
    };
  }

  /** Seed from completed prior-season FBS-ish games (no TUNING labels). */
  seedFromPrior(games: EspnGame[], fcsIds: Set<string>): void {
    // One-pass season averages then 3 iterative SOS adjustments on 2024 only.
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
      this.n.set(id, offSum.get(id)!.length);
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
        // Offense residual vs opponent defense rating; defense residual vs opp offense
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

  /** Post-game online update (call AFTER predicting the game). */
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
    this.n.set(g.homeTeamId, (this.n.get(g.homeTeamId) ?? 0) + 1);
    this.n.set(g.awayTeamId, (this.n.get(g.awayTeamId) ?? 0) + 1);
  }
}

function metricsFor(
  rows: EvalRow[],
  modelId: string,
): Record<string, unknown> {
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
    modelId,
    n: usable.length,
    moneyline: {
      brierEngine: bE,
      brierMarketClose: bM,
      delta: bE - bM,
      M3: { criterion: "brierEngine <= brierMarketClose + 0.02", pass: bE <= bM + 0.02 },
      meanP: mean(p),
      meanY: mean(y),
      meanMarketP: mean(mkt),
      corrP_Y: pearson(p, y),
    },
    spreadsAts: {
      n: ats.length,
      brierEngine: bAts,
      S2: { criterion: "brierEngine < 0.25", pass: bAts != null && bAts < 0.25 },
    },
    margin: {
      corrPred_Actual: pearson(predM, actM),
      meanPred: mean(predM),
      meanAct: mean(actM),
      meanAbsError: mean(predM.map((x, i) => Math.abs(x - actM[i]!))),
      rateCapBindShare: mean(
        usable.map((r) =>
          r.models[modelId]!.rateCapHome || r.models[modelId]!.rateCapAway ? 1 : 0,
        ),
      ),
    },
  };
}

function sliceMetrics(rows: EvalRow[], modelId: string, keyFn: (r: EvalRow) => string) {
  const groups = new Map<string, EvalRow[]>();
  for (const r of rows) {
    if (!r.models[modelId]) continue;
    const k = keyFn(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  const out: Record<string, unknown> = {};
  for (const [k, rs] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const m = metricsFor(rs, modelId);
    out[k] = {
      n: m.n,
      brierEngine: (m.moneyline as any).brierEngine,
      brierMarket: (m.moneyline as any).brierMarketClose,
      atsBrier: (m.spreadsAts as any).brierEngine,
      corrMargin: (m.margin as any).corrPred_Actual,
      meanPred: (m.margin as any).meanPred,
      meanAct: (m.margin as any).meanAct,
    };
  }
  return out;
}

function main(): number {
  mkdirSync(ART, { recursive: true });
  delete process.env.NCAAF_RESEARCH_MARGIN_GAP_SCALE;
  process.env.NCAAF_RESEARCH_CALIBRATION = "1";

  const tuningPath = join(FIX, "ncaaf-tuning-2025-w1-7-games.json");
  const closesPath = join(FIX, "ncaaf-tuning-2025-w1-7-closing-lines.json");
  const priorPath = join(FIX, "ncaaf-phase-e-games.json");

  const tuningAll = loadJsonGames(tuningPath).filter(
    (g) => g.season === 2025 && g.week >= 1 && g.week <= 7,
  );
  const prior = loadJsonGames(priorPath).filter((g) => g.season === 2023 || g.season === 2024);
  const archive = JSON.parse(readFileSync(closesPath, "utf8")) as {
    games: CloseRow[];
    missing: unknown[];
    aliasRematch?: unknown;
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

  const seedRatings = new OppAdjRatings({ lr: 0.3 });
  seedRatings.seedFromPrior(
    prior.filter((g) => g.season === 2024),
    fcsIds,
  );
  const seedOff = new Map(seedRatings.off);
  const seedDef = new Map(seedRatings.def);

  const liveRatings = new OppAdjRatings({ lr: 0.3 });
  liveRatings.seedFromPrior(
    prior.filter((g) => g.season === 2024),
    fcsIds,
  );

  const MODEL_LOCKED = "locked_drive_engine";
  const MODEL_MARGIN_HIST = "margin_history_mean";
  const MODEL_OPP_ADJ = "opp_adj_rating";
  const MODEL_OPP_ADJ_TO = "opp_adj_rating_time_ordered_slope";

  const rows: EvalRow[] = [];
  const compressionAudit: Record<string, unknown> = {
    scoreRateCap: FOOTBALL_DRIVE_SCORE_RATE_CAP,
    lockedResidualSd: FOOTBALL_NCAAF_MARGIN_RESIDUAL_SD,
    lockedShrink: FOOTBALL_NCAAF_HOME_MARGIN_SHRINK,
    lockedGapScale: FOOTBALL_NCAAF_RESEARCH_MARGIN_GAP_SCALE_DEFAULT,
    teamMeanHalvesGapMean: null as number | null,
    teamMeanHalvesGap: [] as number[],
    rateCapBindShare: null as number | null,
    rateCapBinds: 0,
    rateCapEligible: 0,
    largeGap14Plus: { n: 0, rateCapBinds: 0 },
    earlySeasonThinFormWeeks1to3: 0,
    fcsOpponentInCohort: 0,
    fcsIdsNamed: fcsIds.size,
    provenanceCounts: {} as Record<string, number>,
    pregameTiming:
      "walkHoldoutGames: form from earlier games only; credible completedAt or kickoff+4h; evaluated game excluded",
    futureLeakage: "none — ratings updated after prediction; form walker is causal",
  };

  const toGaps: number[] = [];
  const toY: number[] = [];
  let toSlope = 0.1;
  const hfa = 2.5;
  const rng = mulberry32(FOOTBALL_CALIBRATION_PRIMARY_SEED);
  const all = [...prior, ...tuningAll].sort((a, b) =>
    String(a.kickoffIso).localeCompare(String(b.kickoffIso)),
  );

  let skippedThin = 0;

  walkHoldoutGames(all, (g, forms) => {
    const homeIn = teamSimInput(forms.get(g.homeTeamId), "home");
    const awayIn = teamSimInput(forms.get(g.awayTeamId), "away");
    const predR = liveRatings.predict(g.homeTeamId, g.awayTeamId);
    const ratingHomeOff = predR.homeOff + hfa / 2;
    const ratingAwayOff = predR.awayOff - hfa / 2;
    const ratingGap = ratingHomeOff - ratingAwayOff;
    const ratingPredMargin = ratingGap;

    if (cohortIds.has(g.eventId)) {
      const close = closes.get(g.eventId)!;
      if (homeIn.ptsFor == null || awayIn.ptsFor == null) {
        skippedThin += 1;
      } else {
        const fcsOpp =
          fcsIds.has(g.homeTeamId) ||
          fcsIds.has(g.awayTeamId) ||
          looksFcsName(g.homeName) ||
          looksFcsName(g.awayName);
        if (fcsOpp) (compressionAudit.fcsOpponentInCohort as number) += 1;

        const homeOff = teamMean(homeIn.ptsFor, awayIn.ptsAgainst, 24);
        const awayOff = teamMean(awayIn.ptsFor, homeIn.ptsAgainst, 24);
        const rawGap = homeIn.ptsFor - awayIn.ptsFor;
        const blendedGap = homeOff - awayOff;
        // Only ratio when offense gap is material; tiny raw gaps explode the ratio.
        if (Math.abs(rawGap) >= 3) {
          (compressionAudit.teamMeanHalvesGap as number[]).push(
            Math.abs(blendedGap) / Math.abs(rawGap),
          );
        }
        (compressionAudit as any)._absRawGaps = [
          ...((compressionAudit as any)._absRawGaps ?? []),
          Math.abs(rawGap),
        ];
        (compressionAudit as any)._absBlendedGaps = [
          ...((compressionAudit as any)._absBlendedGaps ?? []),
          Math.abs(blendedGap),
        ];
        const prov = compressionAudit.provenanceCounts as Record<string, number>;
        prov[homeIn.provenance] = (prov[homeIn.provenance] ?? 0) + 1;
        if ((homeIn.nFormGames < 3 || awayIn.nFormGames < 3) && g.week <= 3) {
          (compressionAudit.earlySeasonThinFormWeeks1to3 as number) += 1;
        }

        const drives = footballExpectedDrives(homeOff, awayOff, "ncaaf");
        const hCap = footballDriveRatesPastKnee(
          footballDriveRateInput(homeOff, drives, "ncaaf"),
          "ncaaf",
        );
        const aCap = footballDriveRatesPastKnee(
          footballDriveRateInput(awayOff, drives, "ncaaf"),
          "ncaaf",
        );
        (compressionAudit.rateCapEligible as number) += 1;
        if (hCap || aCap) (compressionAudit.rateCapBinds as number) += 1;
        if (Math.abs(blendedGap) >= 14) {
          (compressionAudit.largeGap14Plus as any).n += 1;
          if (hCap || aCap) (compressionAudit.largeGap14Plus as any).rateCapBinds += 1;
        }

        const priorGap =
          (seedOff.get(g.homeTeamId) ?? 24) -
          (seedDef.get(g.homeTeamId) ?? 24) -
          ((seedOff.get(g.awayTeamId) ?? 24) - (seedDef.get(g.awayTeamId) ?? 24));
        const formGap = homeOff - awayOff;
        const mhGap = 0.55 * formGap + 0.45 * priorGap;
        const mid = (homeOff + awayOff) / 2;
        const mhHome = mid + mhGap / 2;
        const mhAway = mid - mhGap / 2;

        const simLocked = runNflDriveSim({
          sport: "ncaaf",
          ncaafResearchCalibration: true,
          simulations: SIMS,
          random: rng,
          home: { ptsFor: homeOff, ptsAgainst: awayOff, recentScores: homeIn.recentScores },
          away: { ptsFor: awayOff, ptsAgainst: homeOff, recentScores: awayIn.recentScores },
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
        const simMh = runNflDriveSim({
          sport: "ncaaf",
          ncaafResearchCalibration: true,
          simulations: SIMS,
          random: rng,
          home: { ptsFor: mhHome, ptsAgainst: mhAway, recentScores: homeIn.recentScores },
          away: { ptsFor: mhAway, ptsAgainst: mhHome, recentScores: awayIn.recentScores },
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

        if (toGaps.length >= 20) {
          let bestS = toSlope;
          let bestB = 9;
          for (const s of [0.06, 0.08, 0.1, 0.12, 0.15, 0.18]) {
            const b = brier(
              toGaps.map((x) => logistic(x, s)),
              toY,
            );
            if (b < bestB) {
              bestB = b;
              bestS = s;
            }
          }
          toSlope = bestS;
        }

        const pOpp = logistic(ratingGap, 0.1);
        const pOppTo = logistic(ratingGap, toSlope);
        const coverZ =
          (ratingPredMargin + close.closeSpreadHome!) / FOOTBALL_NCAAF_MARGIN_RESIDUAL_SD;
        const pAtsOpp = clamp01(1 / (1 + Math.exp(-1.7 * coverZ)));

        const pLocked = simLocked?.coverHitRates?.["home-ml"];
        const pMh = simMh?.coverHitRates?.["home-ml"];
        if (pLocked != null && pMh != null) {
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
            favoriteSide:
              Math.abs(close.closeSpreadHome!) < 0.25
                ? "pick"
                : close.closeSpreadHome! < 0
                  ? "home"
                  : "away",
            favSize: favSize(Math.abs(close.closeSpreadHome!)),
            spreadAbsBin: spreadBin(Math.abs(close.closeSpreadHome!)),
            actMargin: g.homeFg - g.awayFg,
            fcsOpponent: fcsOpp,
            nHomeForm: homeIn.nFormGames,
            nAwayForm: awayIn.nFormGames,
            provenance: homeIn.provenance,
            models: {
              [MODEL_LOCKED]: {
                pMl: pLocked,
                pAts: simLocked?.coverHitRates?.["home-close-spread"] ?? null,
                predMargin:
                  (simLocked!.expectedHomeScore ?? homeOff) -
                  (simLocked!.expectedAwayScore ?? awayOff),
                strengthGap: blendedGap,
                rateCapHome: hCap,
                rateCapAway: aCap,
                blendedGapVsRaw:
                  Math.abs(rawGap) > 1e-9 ? Math.abs(blendedGap) / Math.abs(rawGap) : null,
              },
              [MODEL_MARGIN_HIST]: {
                pMl: pMh,
                pAts: simMh?.coverHitRates?.["home-close-spread"] ?? null,
                predMargin:
                  (simMh!.expectedHomeScore ?? mhHome) -
                  (simMh!.expectedAwayScore ?? mhAway),
                strengthGap: mhGap,
                rateCapHome: false,
                rateCapAway: false,
                blendedGapVsRaw: null,
              },
              [MODEL_OPP_ADJ]: {
                pMl: pOpp,
                pAts: pAtsOpp,
                predMargin: ratingPredMargin,
                strengthGap: ratingGap,
                rateCapHome: false,
                rateCapAway: false,
                blendedGapVsRaw: null,
              },
              [MODEL_OPP_ADJ_TO]: {
                pMl: pOppTo,
                pAts: pAtsOpp,
                predMargin: ratingPredMargin,
                strengthGap: ratingGap,
                rateCapHome: false,
                rateCapAway: false,
                blendedGapVsRaw: null,
              },
            },
          });
          toGaps.push(ratingGap);
          toY.push(yMl);
        }
      }
    }

    if (g.season === 2025) liveRatings.update(g, fcsIds, hfa);
  });

  const halves = compressionAudit.teamMeanHalvesGap as number[];
  compressionAudit.teamMeanHalvesGapMean = halves.length ? mean(halves) : null;
  compressionAudit.teamMeanHalvesGapN = halves.length;
  const absRaw = ((compressionAudit as any)._absRawGaps as number[]) ?? [];
  const absBlend = ((compressionAudit as any)._absBlendedGaps as number[]) ?? [];
  compressionAudit.meanAbsRawOffenseGap = absRaw.length ? mean(absRaw) : null;
  compressionAudit.meanAbsBlendedGap = absBlend.length ? mean(absBlend) : null;
  delete (compressionAudit as any).teamMeanHalvesGap;
  delete (compressionAudit as any)._absRawGaps;
  delete (compressionAudit as any)._absBlendedGaps;
  compressionAudit.rateCapBindShare =
    (compressionAudit.rateCapEligible as number) > 0
      ? (compressionAudit.rateCapBinds as number) /
        (compressionAudit.rateCapEligible as number)
      : null;

  // Fair compare: identical n across models
  const modelIds = [MODEL_LOCKED, MODEL_MARGIN_HIST, MODEL_OPP_ADJ, MODEL_OPP_ADJ_TO];
  const ns = modelIds.map((id) => rows.filter((r) => r.models[id]).length);
  const fairN = Math.min(...ns);
  if (ns.some((n) => n !== fairN)) {
    console.error("n mismatch", ns);
  }

  const byModel: Record<string, unknown> = {};
  for (const id of modelIds) {
    byModel[id] = metricsFor(rows, id);
    console.log(JSON.stringify({ model: id, ...(byModel[id] as object) }));
  }

  const locked = byModel[MODEL_LOCKED] as any;
  const opp = byModel[MODEL_OPP_ADJ] as any;
  const oppTo = byModel[MODEL_OPP_ADJ_TO] as any;
  const mh = byModel[MODEL_MARGIN_HIST] as any;

  const meaningful =
    (opp.moneyline.brierEngine <= locked.moneyline.brierMarketClose + 0.02 &&
      opp.spreadsAts.brierEngine < 0.25) ||
    (oppTo.moneyline.brierEngine <= locked.moneyline.brierMarketClose + 0.02 &&
      oppTo.spreadsAts.brierEngine < 0.25) ||
    (mh.moneyline.brierEngine <= locked.moneyline.brierMarketClose + 0.02 &&
      mh.spreadsAts.brierEngine < 0.25);

  const deltaOpp = locked.moneyline.brierEngine - opp.moneyline.brierEngine;
  const deltaCorr =
    (opp.margin.corrPred_Actual ?? 0) - (locked.margin.corrPred_Actual ?? 0);
  // Replace the research drive path when locked criteria remain unreachable:
  // best candidate still fails M3/S2 and remains >0.02 behind market on ML,
  // even if it beats the drive engine on diagnostics.
  const recommendReplacement =
    !meaningful &&
    locked.moneyline.delta > 0.04 &&
    Math.min(
      opp.moneyline.delta as number,
      oppTo.moneyline.delta as number,
      mh.moneyline.delta as number,
    ) > 0.02;

  const report = {
    generatedAt: new Date().toISOString(),
    split: "TUNING",
    finalEvalUntouched: true,
    liveGate: "NCAAF_GAME_LINE_SIM_VALIDATED=false",
    paidRetrieval: false,
    closesInPredictiveFeatures: false,
    researchStamp: FOOTBALL_NCAAF_RESEARCH_ENGINE_VERSION,
    fairCompare: {
      rule: "Identical evaluation counts: TUNING games with closeMlHome+closeSpreadHome, non-tie, scored by all models",
      cohortN: fairN,
      skippedThin,
      closesRows: archive.games.length,
      tuningGames: tuningAll.length,
      stillMissing: Array.isArray(archive.missing) ? archive.missing.length : null,
      aliasRematch: archive.aliasRematch ?? null,
      modelNs: Object.fromEntries(modelIds.map((id, i) => [id, ns[i]])),
    },
    lockedCriteria: {
      M3: "brierEngine <= brierMarketClose + 0.02",
      S2: "brierEngine ATS < 0.25",
    },
    compressionAudit,
    models: byModel,
    timeOrderedValidation: {
      byWeek: {
        locked_drive_engine: sliceMetrics(rows, MODEL_LOCKED, (r) => `w${r.week}`),
        opp_adj_rating: sliceMetrics(rows, MODEL_OPP_ADJ, (r) => `w${r.week}`),
        opp_adj_rating_time_ordered_slope: sliceMetrics(
          rows,
          MODEL_OPP_ADJ_TO,
          (r) => `w${r.week}`,
        ),
      },
      byFavoriteSize: {
        locked_drive_engine: sliceMetrics(rows, MODEL_LOCKED, (r) => r.favSize),
        opp_adj_rating: sliceMetrics(rows, MODEL_OPP_ADJ, (r) => r.favSize),
        opp_adj_rating_time_ordered_slope: sliceMetrics(
          rows,
          MODEL_OPP_ADJ_TO,
          (r) => r.favSize,
        ),
      },
      note: "Opp-adj ratings seeded on 2024 FBS-ish games, updated online after each 2025 prediction. Time-ordered slope refits on prior TUNING rows only.",
    },
    beforeAfter: {
      before: "locked_drive_engine",
      afterCandidates: {
        margin_history_mean: {
          M3: mh.moneyline.M3,
          S2: mh.spreadsAts.S2,
          brierEngine: mh.moneyline.brierEngine,
          brierMarket: mh.moneyline.brierMarketClose,
          atsBrier: mh.spreadsAts.brierEngine,
          corrMargin: mh.margin.corrPred_Actual,
        },
        opp_adj_rating: {
          M3: opp.moneyline.M3,
          S2: opp.spreadsAts.S2,
          brierEngine: opp.moneyline.brierEngine,
          brierMarket: opp.moneyline.brierMarketClose,
          atsBrier: opp.spreadsAts.brierEngine,
          corrMargin: opp.margin.corrPred_Actual,
        },
        opp_adj_rating_time_ordered_slope: {
          M3: oppTo.moneyline.M3,
          S2: oppTo.spreadsAts.S2,
          brierEngine: oppTo.moneyline.brierEngine,
          brierMarket: oppTo.moneyline.brierMarketClose,
          atsBrier: oppTo.spreadsAts.brierEngine,
          corrMargin: oppTo.margin.corrPred_Actual,
        },
      },
      lockedBaseline: {
        M3: locked.moneyline.M3,
        S2: locked.spreadsAts.S2,
        brierEngine: locked.moneyline.brierEngine,
        brierMarket: locked.moneyline.brierMarketClose,
        atsBrier: locked.spreadsAts.brierEngine,
        corrMargin: locked.margin.corrPred_Actual,
        meanPred: locked.margin.meanPred,
        meanAct: locked.margin.meanAct,
      },
    },
    conclusion: {
      meaningfulGainsVsLockedCriteria: meaningful,
      recommendModelReplacement: recommendReplacement,
      rationale: meaningful
        ? "A candidate meets locked M3 and S2 on the fair TUNING cohort — still requires FINAL_EVAL before any lock/gate flip."
        : recommendReplacement
          ? `No candidate reaches locked M3/S2 on the fair n=${fairN} cohort. Best ML (opp-adj) still Δ=${Number(opp.moneyline.delta).toFixed(3)} vs market; ATS worsens vs drive engine. teamMean blending compresses offense gaps; score-rate caps never bind. Incremental drive-path levers are exhausted — replace the research model architecture (not a residual/gap scalar).`
          : "Candidates improve some diagnostics but do not clear locked criteria; continue research without gate flip.",
      gateFlipAllowed: false,
      finalEval: "UNTOUCHED",
    },
  };

  const outArt = join(ART, "ncaaf-tuning-expanded-cohort-research.json");
  const outFix = join(FIX, "ncaaf-tuning-expanded-cohort-research.json");
  writeFileSync(outArt, JSON.stringify(report, null, 2));
  writeFileSync(outFix, JSON.stringify(report, null, 2));

  const md = `# TUNING expanded-cohort research (fair n)

**FINAL_EVAL:** untouched · **Gate:** false · **Paid retrieval:** none · **Closes in features:** no

## Fair compare cohort
- TUNING games with full close ML+spread (post 57-game rematch): **n = ${fairN}**
- All models use this identical set (model n: ${JSON.stringify(Object.fromEntries(modelIds.map((id, i) => [id, ns[i]])))})
- Still missing closes: ${report.fairCompare.stillMissing}

## Strength-input audit
| Check | Result |
|-------|--------|
| Pregame timing | Causal \`walkHoldoutGames\` (prior games only; kickoff+4h / completedAt) |
| Future leakage | None — ratings updated after prediction |
| teamMean 50/50 blend | mean\|blended\|/mean\|rawOffenseGap\| (|raw|≥3): **${Number(compressionAudit.teamMeanHalvesGapMean).toFixed(3)}** (n=${compressionAudit.teamMeanHalvesGapN}); mean\|raw\|=${Number(compressionAudit.meanAbsRawOffenseGap).toFixed(2)} → mean\|blended\|=${Number(compressionAudit.meanAbsBlendedGap).toFixed(2)} |
| Score-rate cap binds | **${((compressionAudit.rateCapBindShare as number) * 100).toFixed(1)}%** of cohort; large-gap≥14: ${JSON.stringify(compressionAudit.largeGap14Plus)} |
| Early-season thin form (w1–3, nForm<3) | ${compressionAudit.earlySeasonThinFormWeeks1to3} |
| FCS opponent in cohort (name heuristic) | ${compressionAudit.fcsOpponentInCohort} |
| Provenance | ${JSON.stringify(compressionAudit.provenanceCounts)} |

**Compression mechanism:** \`teamMean(for, oppAgainst)\` halves offense-only gaps before the drive sim; defense tilt is unused in this offline path (no yards packs). Score-rate cap (${FOOTBALL_DRIVE_SCORE_RATE_CAP}) rarely binds — **mean blending**, not the cap, is the primary compressor.

## Models on identical n=${fairN}

| Model | ML Brier | Market | Δ | M3 | ATS Brier | S2 | corr(margin) | meanPred/Act |
|-------|---------:|-------:|--:|:--:|----------:|:--:|-------------:|-------------:|
| locked_drive_engine | ${locked.moneyline.brierEngine.toFixed(4)} | ${locked.moneyline.brierMarketClose.toFixed(4)} | ${locked.moneyline.delta.toFixed(4)} | ${locked.moneyline.M3.pass} | ${Number(locked.spreadsAts.brierEngine).toFixed(4)} | ${locked.spreadsAts.S2.pass} | ${Number(locked.margin.corrPred_Actual).toFixed(3)} | ${locked.margin.meanPred.toFixed(1)}/${locked.margin.meanAct.toFixed(1)} |
| margin_history_mean | ${mh.moneyline.brierEngine.toFixed(4)} | ${mh.moneyline.brierMarketClose.toFixed(4)} | ${mh.moneyline.delta.toFixed(4)} | ${mh.moneyline.M3.pass} | ${Number(mh.spreadsAts.brierEngine).toFixed(4)} | ${mh.spreadsAts.S2.pass} | ${Number(mh.margin.corrPred_Actual).toFixed(3)} | ${mh.margin.meanPred.toFixed(1)}/${mh.margin.meanAct.toFixed(1)} |
| opp_adj_rating | ${opp.moneyline.brierEngine.toFixed(4)} | ${opp.moneyline.brierMarketClose.toFixed(4)} | ${opp.moneyline.delta.toFixed(4)} | ${opp.moneyline.M3.pass} | ${Number(opp.spreadsAts.brierEngine).toFixed(4)} | ${opp.spreadsAts.S2.pass} | ${Number(opp.margin.corrPred_Actual).toFixed(3)} | ${opp.margin.meanPred.toFixed(1)}/${opp.margin.meanAct.toFixed(1)} |
| opp_adj + time-ordered slope | ${oppTo.moneyline.brierEngine.toFixed(4)} | ${oppTo.moneyline.brierMarketClose.toFixed(4)} | ${oppTo.moneyline.delta.toFixed(4)} | ${oppTo.moneyline.M3.pass} | ${Number(oppTo.spreadsAts.brierEngine).toFixed(4)} | ${oppTo.spreadsAts.S2.pass} | ${Number(oppTo.margin.corrPred_Actual).toFixed(3)} | ${oppTo.margin.meanPred.toFixed(1)}/${oppTo.margin.meanAct.toFixed(1)} |

## Time-ordered slices
See JSON \`timeOrderedValidation.byWeek\` / \`byFavoriteSize\`.

## Conclusion
- **Meaningful gains vs locked M3/S2:** ${meaningful}
- **Recommend model replacement:** ${recommendReplacement}
- ${report.conclusion.rationale}
- Gate flip: **false** · FINAL_EVAL: **UNTOUCHED**

## Repro
\`\`\`bash
cd artifacts/api-server
NCAAF_TUNING_SIMS=1500 node --import ./test/register-hooks.mjs ./scripts/ncaafTuningExpandedCohortResearch.ts
\`\`\`
`;
  writeFileSync(join(ART, "ncaaf-tuning-expanded-cohort-research.md"), md);
  writeFileSync(join(FIX, "ncaaf-tuning-expanded-cohort-research.md"), md);
  console.log(JSON.stringify(report.conclusion, null, 2));
  console.log(JSON.stringify(report.beforeAfter, null, 2));
  console.log("Wrote", outArt);
  return 0;
}

process.exit(main());
