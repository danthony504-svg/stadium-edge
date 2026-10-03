// NFL / NCAAF — drive-by-drive simulation calibrated to real team scoring form.
//
// The previous version derived per-drive scoring rates by capping a ratio:
// tdRate = min(0.42, ppd / 28) and fgRate = min(0.28, ppd / 40). Both caps bind
// at roughly 11 points per game, which every real football team clears, so
// expected points per drive collapsed to a constant 3.78 and every matchup
// projected about 42-42 (an ~84-point total) no matter how strong or weak the
// teams were. Drive counts were also computed from one shared expression, so the
// two teams always ran the identical number of possessions, and the trailing-
// team bonus only ever fired for the away team because the home loop ran first
// and compared against an away score that was still zero.
//
// This version solves the drive rates FROM the points per game the real inputs
// imply instead of capping them, so the simulated mean reproduces the input:
// 7 * tdRate + 3 * fgRate === pointsPerDrive by construction. Team offence and
// opponent defence therefore both move the projection across the whole range.

import type { GameSimResult } from "../gameMonteCarlo.js";
import type { SportSimContext } from "./types.js";
import { finalizeFromScores, simCount } from "./shared.js";

type LeagueProfile = {
  /** Long-run points per team per game — used only to scale opponent strength. */
  avgPoints: number;
  /** Possessions per team per game. */
  drives: number;
  /** Share of offensive points arriving as touchdowns rather than field goals. */
  tdPointShare: number;
  /**
   * The NFL plays a single sudden-death overtime period that can still end
   * level; college football alternates possessions until someone leads.
   */
  overtimeTieRate: number;
};

const LEAGUES: Record<string, LeagueProfile> = {
  nfl: { avgPoints: 22.5, drives: 11, tdPointShare: 0.74, overtimeTieRate: 0.07 },
  ncaaf: { avgPoints: 27.5, drives: 12.4, tdPointShare: 0.76, overtimeTieRate: 0 },
};

/** Drives past this fraction of the game are played with a lead/deficit script. */
const LATE_DRIVE_FRACTION = 0.7;
const TRAILING_AGGRESSION = 1.12;
const LEADING_CLOCK_BLEED = 0.9;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function gauss(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function leagueProfileForSport(sport: string): LeagueProfile {
  return LEAGUES[sport.toLowerCase()] ?? LEAGUES["nfl"]!;
}

/**
 * Points this offence is expected to score against this defence, from the real
 * scoring form the app already loads. The offence is scaled by how far the
 * opponent's defence sits from league average — a 30-point offence facing a
 * 14-point defence in a 22.5-point league projects 30 * 14 / 22.5 ≈ 18.7 — then
 * shrunk toward the plain average of the two when the sample is thin, so a
 * single early-season blowout cannot dominate the projection.
 */
export function expectedPoints(
  offense: number | null | undefined,
  opponentDefense: number | null | undefined,
  sampleGames: number,
  league: LeagueProfile,
): number {
  const off = offense != null && Number.isFinite(offense) ? offense : null;
  const def =
    opponentDefense != null && Number.isFinite(opponentDefense) ? opponentDefense : null;
  const lo = league.avgPoints * 0.25;
  const hi = league.avgPoints * 2.2;

  if (off == null && def == null) return league.avgPoints;
  if (off == null) return clamp(def!, lo, hi);
  if (def == null) return clamp(off, lo, hi);

  const scaled = off * (def / league.avgPoints);
  const plain = (off + def) / 2;
  const trust = Math.max(0, sampleGames) / (Math.max(0, sampleGames) + 3);
  return clamp(trust * scaled + (1 - trust) * plain, lo, hi);
}

/**
 * Touchdown/field-goal split that reproduces `pointsPerDrive` exactly. A drive
 * scores at most once, so both rates scale back together — preserving the
 * TD/FG mix — if an extreme input pushes their sum toward certainty.
 */
function driveOutcome(pointsPerDrive: number, tdPointShare: number): number {
  const tdRate = (pointsPerDrive * tdPointShare) / 7;
  const fgRate = (pointsPerDrive * (1 - tdPointShare)) / 3;
  const combined = tdRate + fgRate;
  const scale = combined > 0.92 ? 0.92 / combined : 1;
  const td = tdRate * scale;
  const fg = fgRate * scale;
  const r = Math.random();
  if (r < td) return 7;
  if (r < td + fg) return 3;
  return 0;
}

/** Possessions alternate, so both teams stay within a drive or two — but are drawn independently. */
function drivesForDraw(mean: number): number {
  return clamp(Math.round(mean + gauss() * 0.9), 8, 15);
}

function scriptedPointsPerDrive(base: number, own: number, opponent: number, late: boolean): number {
  if (!late || own === opponent) return base;
  return own < opponent ? base * TRAILING_AGGRESSION : base * LEADING_CLOCK_BLEED;
}

export function runNflDriveSim(ctx: SportSimContext): GameSimResult | null {
  const n = simCount(ctx);
  const league = leagueProfileForSport(ctx.sport);
  // Each projection blends one team's offence with the other's defence, so it is
  // only as trustworthy as the thinner of the two samples.
  const sampleGames = Math.min(
    ctx.home.recentScores?.length ?? 0,
    ctx.away.recentScores?.length ?? 0,
  );

  const homePoints = expectedPoints(ctx.home.ptsFor, ctx.away.ptsAgainst, sampleGames, league);
  const awayPoints = expectedPoints(ctx.away.ptsFor, ctx.home.ptsAgainst, sampleGames, league);
  if (!Number.isFinite(homePoints) || !Number.isFinite(awayPoints)) return null;

  const homePpd = homePoints / league.drives;
  const awayPpd = awayPoints / league.drives;
  const homeEdge = homePpd + awayPpd > 0 ? homePpd / (homePpd + awayPpd) : 0.5;

  const homeScores: number[] = new Array(n);
  const awayScores: number[] = new Array(n);

  for (let i = 0; i < n; i++) {
    const homeDrives = drivesForDraw(league.drives);
    const awayDrives = drivesForDraw(league.drives);
    const rounds = Math.max(homeDrives, awayDrives);
    // The opening coin flip decides who owns the final possession.
    const homeFirst = Math.random() < 0.5;
    let h = 0;
    let a = 0;

    for (let d = 0; d < rounds; d++) {
      const late = d >= rounds * LATE_DRIVE_FRACTION;
      for (let slot = 0; slot < 2; slot++) {
        const isHome = homeFirst ? slot === 0 : slot === 1;
        if (isHome) {
          if (d >= homeDrives) continue;
          h += driveOutcome(scriptedPointsPerDrive(homePpd, h, a, late), league.tdPointShare);
        } else {
          if (d >= awayDrives) continue;
          a += driveOutcome(scriptedPointsPerDrive(awayPpd, a, h, late), league.tdPointShare);
        }
      }
    }

    if (h === a) {
      const unresolved = league.overtimeTieRate > 0 && Math.random() < league.overtimeTieRate;
      if (!unresolved) {
        const points = Math.random() < 0.55 ? 3 : 7;
        if (Math.random() < homeEdge) h += points;
        else a += points;
      }
    }

    homeScores[i] = h;
    awayScores[i] = a;
  }

  return finalizeFromScores(
    ctx,
    homeScores,
    awayScores,
    {
      simModel: "nfl-drive",
      simModelLabel: "NFL drive-by-drive",
    },
    48,
  );
}
