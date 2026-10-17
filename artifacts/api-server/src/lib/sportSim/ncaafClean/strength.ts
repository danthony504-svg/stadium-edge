/**
 * Chronological opponent-adjusted offense/defense for clean engine Stage A.
 * Unrated teams stay null — no silent default μ on predict.
 * Updates only after predict, and only for verified FBS–FBS games.
 */

import { isFbsFbsGame } from "../ncaafSubdivision.ts";
import type { TeamId, TeamStrengthState } from "./types.ts";

/** Provisional M2 research defaults — not close-fitted; lock before M3. */
export const CLEAN_HFA_POINTS = 2.5;
export const CLEAN_BASE_MARGIN_SD = 16.5;
export const CLEAN_BASE_TOTAL_SD = 13.5;
export const CLEAN_LR = 0.3;
/** League-average PPG used only when initializing a team after its first FBS–FBS final. */
export const CLEAN_LEAGUE_AVG_PPG = 24;

export type CleanStrengthGame = {
  homeTeamId: string;
  awayTeamId: string;
  homeFg: number;
  awayFg: number;
  season: number;
  kickoffIso?: string;
};

function mean(xs: number[], fb: number): number {
  if (!xs.length) return fb;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Explicit early-season uncertainty in [0, 1+].
 * High when min(nHome, nAway) is small / early week.
 */
export function cleanUncertainty(opts: {
  week: number;
  nHomeFbsGames: number;
  nAwayFbsGames: number;
}): number {
  const n = Math.min(
    Math.max(0, opts.nHomeFbsGames),
    Math.max(0, opts.nAwayFbsGames),
  );
  const thin = Math.exp(-0.45 * n); // ~1 at n=0, ~0.4 at n=2, ~0.1 at n=5
  const weekBoost =
    opts.week <= 1 ? 1.25 : opts.week <= 3 ? 1.1 : opts.week <= 5 ? 1.0 : 0.9;
  return Math.max(0, thin * weekBoost);
}

/** Margin σ from base + uncertainty inflation. */
export function cleanMarginSd(uncertainty: number, base = CLEAN_BASE_MARGIN_SD): number {
  return base * (1 + 0.55 * uncertainty);
}

export function cleanTotalSd(uncertainty: number, base = CLEAN_BASE_TOTAL_SD): number {
  return base * (1 + 0.4 * uncertainty);
}

export class CleanOppAdjStrength {
  off = new Map<string, number>();
  def = new Map<string, number>();
  /** Running mean of opponent offense faced (SOS offense). */
  sosOffSum = new Map<string, number>();
  sosOffN = new Map<string, number>();
  /** Running mean of opponent defense faced (SOS defense). */
  sosDefSum = new Map<string, number>();
  sosDefN = new Map<string, number>();
  seasonN = new Map<string, number>();
  lastKick = new Map<string, string>();
  readonly season: number;
  readonly lr: number;
  readonly leagueAvg: number;

  constructor(opts: { season: number; lr?: number; leagueAvg?: number }) {
    this.season = opts.season;
    this.lr = opts.lr ?? CLEAN_LR;
    this.leagueAvg = opts.leagueAvg ?? CLEAN_LEAGUE_AVG_PPG;
  }

  hasRating(id: TeamId): boolean {
    return this.off.has(id) && this.def.has(id);
  }

  getOff(id: TeamId): number | null {
    return this.off.has(id) ? this.off.get(id)! : null;
  }

  getDef(id: TeamId): number | null {
    return this.def.has(id) ? this.def.get(id)! : null;
  }

  getSeasonN(id: TeamId): number {
    return this.seasonN.get(id) ?? 0;
  }

  sosOff(id: TeamId): number | null {
    const n = this.sosOffN.get(id) ?? 0;
    if (n <= 0) return null;
    return (this.sosOffSum.get(id) ?? 0) / n;
  }

  sosDef(id: TeamId): number | null {
    const n = this.sosDefN.get(id) ?? 0;
    if (n <= 0) return null;
    return (this.sosDefSum.get(id) ?? 0) / n;
  }

  stateFor(id: TeamId): TeamStrengthState {
    const n = this.getSeasonN(id);
    const offMu = this.getOff(id);
    const defMu = this.getDef(id);
    const uncertainty = cleanUncertainty({
      week: 99,
      nHomeFbsGames: n,
      nAwayFbsGames: n,
    });
    return {
      teamId: id,
      season: this.season,
      nFbsGames: n,
      offMu,
      defMu,
      sosOff: this.sosOff(id),
      sosDef: this.sosDef(id),
      uncertainty,
      lastUpdatedKickoffIso: this.lastKick.get(id) ?? null,
    };
  }

  /**
   * Seed from prior-season completed FBS–FBS games only.
   * Establishes ratings; seasonN stays 0 (in-season count) so early uncertainty stays high.
   */
  seedFromPriorSeason(games: CleanStrengthGame[]): void {
    const eligible = games.filter(
      (g) =>
        g.season !== this.season &&
        Number.isFinite(g.homeFg) &&
        Number.isFinite(g.awayFg) &&
        isFbsFbsGame(g.homeTeamId, g.awayTeamId, g.season),
    );
    const teams = new Set<string>();
    for (const g of eligible) {
      teams.add(g.homeTeamId);
      teams.add(g.awayTeamId);
    }
    const offSum = new Map<string, number[]>();
    const defSum = new Map<string, number[]>();
    for (const id of teams) {
      offSum.set(id, []);
      defSum.set(id, []);
    }
    for (const g of eligible) {
      offSum.get(g.homeTeamId)!.push(g.homeFg);
      defSum.get(g.homeTeamId)!.push(g.awayFg);
      offSum.get(g.awayTeamId)!.push(g.awayFg);
      defSum.get(g.awayTeamId)!.push(g.homeFg);
    }
    for (const id of teams) {
      this.off.set(id, mean(offSum.get(id)!, this.leagueAvg));
      this.def.set(id, mean(defSum.get(id)!, this.leagueAvg));
    }
    // Light opp-adj refinement (same spirit as archived v0, new package).
    for (let iter = 0; iter < 3; iter++) {
      const newOff = new Map<string, number[]>();
      const newDef = new Map<string, number[]>();
      for (const id of teams) {
        newOff.set(id, []);
        newDef.set(id, []);
      }
      for (const g of eligible) {
        const defA = this.off.has(g.awayTeamId)
          ? this.def.get(g.awayTeamId)!
          : this.leagueAvg;
        const defH = this.def.get(g.homeTeamId)!;
        const offA = this.off.get(g.awayTeamId)!;
        const offH = this.off.get(g.homeTeamId)!;
        newOff
          .get(g.homeTeamId)!
          .push(g.homeFg - (defA - this.leagueAvg));
        newOff
          .get(g.awayTeamId)!
          .push(g.awayFg - (defH - this.leagueAvg));
        newDef
          .get(g.homeTeamId)!
          .push(g.awayFg - (offA - this.leagueAvg));
        newDef
          .get(g.awayTeamId)!
          .push(g.homeFg - (offH - this.leagueAvg));
      }
      for (const id of teams) {
        this.off.set(id, mean(newOff.get(id)!, this.leagueAvg));
        this.def.set(id, mean(newDef.get(id)!, this.leagueAvg));
      }
    }
  }

  /**
   * Expected points. Requires both sides rated — caller must check hasRating.
   * hfaPoints: pass CLEAN_HFA_POINTS only when venue.kind === "home"; else 0.
   */
  expectedPoints(
    homeId: TeamId,
    awayId: TeamId,
    hfaPoints: number,
  ): { homeOff: number; awayOff: number; marginMean: number; totalMean: number } {
    const hOff = this.getOff(homeId);
    const hDef = this.getDef(homeId);
    const aOff = this.getOff(awayId);
    const aDef = this.getDef(awayId);
    if (hOff == null || hDef == null || aOff == null || aDef == null) {
      throw new Error("expectedPoints requires both sides rated");
    }
    const homeScore = 0.5 * hOff + 0.5 * aDef + hfaPoints / 2;
    const awayScore = 0.5 * aOff + 0.5 * hDef - hfaPoints / 2;
    return {
      homeOff: homeScore,
      awayOff: awayScore,
      marginMean: homeScore - awayScore,
      totalMean: homeScore + awayScore,
    };
  }

  /**
   * Post-game update — call ONLY after predict for this game.
   * FBS–FCS / unknown never write into ratings.
   */
  update(g: CleanStrengthGame): void {
    if (!isFbsFbsGame(g.homeTeamId, g.awayTeamId, g.season)) return;
    if (g.season !== this.season) return;
    if (!Number.isFinite(g.homeFg) || !Number.isFinite(g.awayFg)) return;
    // Tied finals: still update strength from observed scores (OT-inclusive
    // two-way markets exclude ties at settlement, not at rating updates).
    this.ensureInit(g.homeTeamId, g.homeFg, g.awayFg);
    this.ensureInit(g.awayTeamId, g.awayFg, g.homeFg);

    const hOff = this.getOff(g.homeTeamId)!;
    const hDef = this.getDef(g.homeTeamId)!;
    const aOff = this.getOff(g.awayTeamId)!;
    const aDef = this.getDef(g.awayTeamId)!;

    // Predict residual without HFA in update (venue may be unknown); keeps
    // updates causal to scores only.
    const predH = 0.5 * hOff + 0.5 * aDef;
    const predA = 0.5 * aOff + 0.5 * hDef;
    const errH = g.homeFg - predH;
    const errA = g.awayFg - predA;
    const lr = this.lr;
    this.off.set(g.homeTeamId, hOff + lr * errH);
    this.def.set(g.awayTeamId, aDef + lr * errH);
    this.off.set(g.awayTeamId, aOff + lr * errA);
    this.def.set(g.homeTeamId, hDef + lr * errA);

    this.bumpSos(g.homeTeamId, aOff, aDef);
    this.bumpSos(g.awayTeamId, hOff, hDef);

    this.seasonN.set(g.homeTeamId, this.getSeasonN(g.homeTeamId) + 1);
    this.seasonN.set(g.awayTeamId, this.getSeasonN(g.awayTeamId) + 1);
    if (g.kickoffIso) {
      this.lastKick.set(g.homeTeamId, g.kickoffIso);
      this.lastKick.set(g.awayTeamId, g.kickoffIso);
    }
  }

  /** First observation initializes rating from that game's scores (not used on predict). */
  private ensureInit(id: TeamId, scored: number, allowed: number): void {
    if (this.hasRating(id)) return;
    this.off.set(id, scored);
    this.def.set(id, allowed);
  }

  private bumpSos(id: TeamId, oppOff: number, oppDef: number): void {
    this.sosOffSum.set(id, (this.sosOffSum.get(id) ?? 0) + oppOff);
    this.sosOffN.set(id, (this.sosOffN.get(id) ?? 0) + 1);
    this.sosDefSum.set(id, (this.sosDefSum.get(id) ?? 0) + oppDef);
    this.sosDefN.set(id, (this.sosDefN.get(id) ?? 0) + 1);
  }
}
