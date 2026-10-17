/**
 * NCAAF dedicated college team-strength model — RESEARCH ONLY.
 *
 * Stamp: `ncaaf-team-strength-v0-research`
 * Activation: `ncaafTeamStrengthResearch === true` or env `NCAAF_TEAM_STRENGTH_RESEARCH=1`
 *
 * - Causal opponent-adjusted offense/defense ratings (update AFTER prediction)
 * - Gradual early-season blend of prior-season seed ↔ season-to-date
 * - Inflated σ + heavy-tail mixture CDF for uncertainty / mismatch tails
 *
 * Does NOT flip NCAAF_GAME_LINE_SIM_VALIDATED. Does NOT accept live client stamp.
 * Closing prices must never enter features or rating updates.
 */

export const FOOTBALL_NCAAF_TEAM_STRENGTH_RESEARCH_VERSION =
  "ncaaf-team-strength-v0-research" as const;

/** Base margin σ (points) before early-season inflation — research default. */
export const NCAAF_TS_BASE_MARGIN_SD = 16.5;

/** Home-field advantage in rating-space points. */
export const NCAAF_TS_HFA = 2.5;

/** Online learning rate for post-game rating updates. */
export const NCAAF_TS_LR = 0.3;

/** |μ| above which mismatch inflation applies (points). */
export const NCAAF_TS_MISMATCH_MU_THRESHOLD = 14;

/**
 * Heavy-tail mixture weight / wide-component scale (in z-space).
 * Approx Student-t-like tails without depending on Math.lgamma.
 */
export const NCAAF_TS_TAIL_MIX_W = 0.18;
export const NCAAF_TS_TAIL_MIX_SCALE = 2.4;

export function ncaafTeamStrengthResearchEnabled(
  flag?: boolean | null,
): boolean {
  if (flag === true) return true;
  if (flag === false) return false;
  const env = String(process.env.NCAAF_TEAM_STRENGTH_RESEARCH ?? "")
    .trim()
    .toLowerCase();
  return env === "1" || env === "true" || env === "yes";
}

function mean(xs: number[], fb = 0): number {
  if (!xs.length) return fb;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function clamp01(x: number): number {
  return Math.max(0.02, Math.min(0.98, x));
}

/** Standard normal CDF (Abramowitz–Stegun approximation). */
export function normalCdf(z: number): number {
  if (!Number.isFinite(z)) return 0.5;
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

/** Heavy-tailed CDF: (1-w)·Φ(z) + w·Φ(z/s). */
export function heavyTailCdf(
  z: number,
  w = NCAAF_TS_TAIL_MIX_W,
  scale = NCAAF_TS_TAIL_MIX_SCALE,
): number {
  if (!Number.isFinite(z)) return 0.5;
  const ww = Math.max(0, Math.min(1, w));
  return (1 - ww) * normalCdf(z) + ww * normalCdf(z / scale);
}

/**
 * Gradual early-season prior weight in [0,1].
 * High when both teams have few 2025 games; decays as min(nHome,nAway) grows.
 * Week also softens: weeks 1–3 keep more prior mass.
 */
export function earlySeasonPriorWeight(opts: {
  week: number;
  nHomeSeasonGames: number;
  nAwaySeasonGames: number;
}): number {
  const n = Math.min(
    Math.max(0, opts.nHomeSeasonGames),
    Math.max(0, opts.nAwaySeasonGames),
  );
  // Logistic decay in game count: ~0.85 at n=0, ~0.5 at n=2, ~0.15 at n=5
  const byGames = 1 / (1 + Math.exp(0.9 * (n - 2)));
  const weekBoost =
    opts.week <= 1 ? 1.15 : opts.week <= 3 ? 1.05 : opts.week <= 5 ? 0.95 : 0.85;
  return Math.max(0, Math.min(0.95, byGames * weekBoost));
}

/** Inflate base σ for thin samples / early weeks / large |μ|. */
export function marginSigma(opts: {
  baseSd?: number;
  week: number;
  nHomeSeasonGames: number;
  nAwaySeasonGames: number;
  absMu: number;
  mismatchHandling: boolean;
}): number {
  const base = opts.baseSd ?? NCAAF_TS_BASE_MARGIN_SD;
  const n = Math.min(opts.nHomeSeasonGames, opts.nAwaySeasonGames);
  const thin = 1 + 0.35 * Math.exp(-0.55 * n);
  const weekFactor =
    opts.week <= 1 ? 1.2 : opts.week <= 3 ? 1.1 : opts.week <= 5 ? 1.05 : 1.0;
  let mismatch = 1;
  if (opts.mismatchHandling && opts.absMu >= NCAAF_TS_MISMATCH_MU_THRESHOLD) {
    // Mild extra scale so tails cover blowouts without exploding pick'ems
    mismatch = 1 + 0.015 * (opts.absMu - NCAAF_TS_MISMATCH_MU_THRESHOLD);
  }
  return base * thin * weekFactor * mismatch;
}

export type TeamStrengthPredict = {
  mu: number;
  sigma: number;
  pHomeMl: number;
  /** P(home covers given home spread line) — line is home's point value (neg if favored). */
  pHomeCover: (homeSpreadLine: number) => number;
  priorWeight: number;
  components: {
    seedMu: number;
    liveMu: number;
    blendedMu: number;
  };
};

export type TeamStrengthGame = {
  homeTeamId: string;
  awayTeamId: string;
  homeFg: number;
  awayFg: number;
  week?: number;
  season?: number;
};

/**
 * Causal opponent-adjusted ratings.
 * Call `predict*` BEFORE `update` for each game.
 */
export class NcaafOppAdjRatings {
  off = new Map<string, number>();
  def = new Map<string, number>();
  /** Season-to-date FBS games counted toward early-blend n. */
  seasonN = new Map<string, number>();
  readonly priorOff: number;
  readonly priorDef: number;
  readonly lr: number;
  readonly hfa: number;

  constructor(opts?: { priorOff?: number; priorDef?: number; lr?: number; hfa?: number }) {
    this.priorOff = opts?.priorOff ?? 24;
    this.priorDef = opts?.priorDef ?? 24;
    this.lr = opts?.lr ?? NCAAF_TS_LR;
    this.hfa = opts?.hfa ?? NCAAF_TS_HFA;
  }

  getOff(id: string): number {
    return this.off.get(id) ?? this.priorOff;
  }
  getDef(id: string): number {
    return this.def.get(id) ?? this.priorDef;
  }
  getSeasonN(id: string): number {
    return this.seasonN.get(id) ?? 0;
  }

  /** Expected home/away points from ratings (includes HFA in margin). */
  expectedPoints(homeId: string, awayId: string): {
    homeOff: number;
    awayOff: number;
    mu: number;
  } {
    const homeOff = 0.5 * this.getOff(homeId) + 0.5 * this.getDef(awayId) + this.hfa / 2;
    const awayOff = 0.5 * this.getOff(awayId) + 0.5 * this.getDef(homeId) - this.hfa / 2;
    return { homeOff, awayOff, mu: homeOff - awayOff };
  }

  /** Seed from completed prior-season games (skip FCS ids). */
  seedFromPrior(games: TeamStrengthGame[], fcsIds: Set<string>): void {
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
        newOff
          .get(g.homeTeamId)!
          .push(g.homeFg - (this.getDef(g.awayTeamId) - this.priorDef));
        newOff
          .get(g.awayTeamId)!
          .push(g.awayFg - (this.getDef(g.homeTeamId) - this.priorDef));
        newDef
          .get(g.homeTeamId)!
          .push(g.awayFg - (this.getOff(g.awayTeamId) - this.priorOff));
        newDef
          .get(g.awayTeamId)!
          .push(g.homeFg - (this.getOff(g.homeTeamId) - this.priorOff));
      }
      for (const id of teams) {
        this.off.set(id, mean(newOff.get(id)!, this.priorOff));
        this.def.set(id, mean(newDef.get(id)!, this.priorDef));
      }
    }
  }

  /** Snapshot ratings (for frozen seed ↔ live blend). */
  clone(): NcaafOppAdjRatings {
    const c = new NcaafOppAdjRatings({
      priorOff: this.priorOff,
      priorDef: this.priorDef,
      lr: this.lr,
      hfa: this.hfa,
    });
    c.off = new Map(this.off);
    c.def = new Map(this.def);
    c.seasonN = new Map(this.seasonN);
    return c;
  }

  /**
   * Post-game update — call ONLY after predict for this game.
   * FCS games: skip rating pollution; still bump seasonN optionally false.
   */
  update(g: TeamStrengthGame, fcsIds: Set<string>): void {
    const fcs = fcsIds.has(g.homeTeamId) || fcsIds.has(g.awayTeamId);
    if (!fcs) {
      const predH =
        0.5 * this.getOff(g.homeTeamId) +
        0.5 * this.getDef(g.awayTeamId) +
        this.hfa / 2;
      const predA =
        0.5 * this.getOff(g.awayTeamId) +
        0.5 * this.getDef(g.homeTeamId) -
        this.hfa / 2;
      const errH = g.homeFg - predH;
      const errA = g.awayFg - predA;
      const lr = this.lr;
      this.off.set(g.homeTeamId, this.getOff(g.homeTeamId) + lr * errH);
      this.def.set(g.awayTeamId, this.getDef(g.awayTeamId) + lr * errH);
      this.off.set(g.awayTeamId, this.getOff(g.awayTeamId) + lr * errA);
      this.def.set(g.homeTeamId, this.getDef(g.homeTeamId) + lr * errA);
    }
    this.seasonN.set(g.homeTeamId, this.getSeasonN(g.homeTeamId) + 1);
    this.seasonN.set(g.awayTeamId, this.getSeasonN(g.awayTeamId) + 1);
  }
}

export type PredictComponents = {
  /** Live causal opp-adj only (no prior blend, gaussian σ=base). */
  useEarlyBlend: boolean;
  /** Inflate σ for thin/early; optional mismatch scale. */
  useUncertainty: boolean;
  /** Heavy-tail mixture CDF + mismatch σ inflation. */
  useMismatchHandling: boolean;
};

export const TEAM_STRENGTH_FULL: PredictComponents = {
  useEarlyBlend: true,
  useUncertainty: true,
  useMismatchHandling: true,
};

/**
 * Predict from seed (frozen prior) + live (updated) ratings.
 * `seed` should not be updated during the evaluation season.
 */
export function predictTeamStrength(opts: {
  seed: NcaafOppAdjRatings;
  live: NcaafOppAdjRatings;
  homeId: string;
  awayId: string;
  week: number;
  components: PredictComponents;
}): TeamStrengthPredict {
  const seedMu = opts.seed.expectedPoints(opts.homeId, opts.awayId).mu;
  const liveMu = opts.live.expectedPoints(opts.homeId, opts.awayId).mu;
  const nHome = opts.live.getSeasonN(opts.homeId);
  const nAway = opts.live.getSeasonN(opts.awayId);
  const priorWeight = opts.components.useEarlyBlend
    ? earlySeasonPriorWeight({
        week: opts.week,
        nHomeSeasonGames: nHome,
        nAwaySeasonGames: nAway,
      })
    : 0;
  const blendedMu = priorWeight * seedMu + (1 - priorWeight) * liveMu;
  const mu = blendedMu;

  const sigma = opts.components.useUncertainty
    ? marginSigma({
        week: opts.week,
        nHomeSeasonGames: nHome,
        nAwaySeasonGames: nAway,
        absMu: Math.abs(mu),
        mismatchHandling: opts.components.useMismatchHandling,
      })
    : NCAAF_TS_BASE_MARGIN_SD;

  const cdf = (z: number) =>
    opts.components.useMismatchHandling ? heavyTailCdf(z) : normalCdf(z);

  // P(home win) ≈ P(margin > 0)
  const pHomeMl = clamp01(1 - cdf(-mu / sigma));

  return {
    mu,
    sigma,
    pHomeMl,
    pHomeCover: (homeSpreadLine: number) => {
      // Home covers when homeFg - awayFg + homeSpreadLine > 0
      // ⇒ margin > -homeSpreadLine
      const z = (-homeSpreadLine - mu) / sigma;
      return clamp01(1 - cdf(z));
    },
    priorWeight,
    components: { seedMu, liveMu, blendedMu },
  };
}
