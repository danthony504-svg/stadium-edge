/** Offline regulation candidate; NOT registered for Coach or full-game grades. */
export const NCAAF_CANDIDATE_VERSION = "ncaaf-regulation-mean-v1";
export type CandidateTeam = {
  ptsFor: number;
  ptsAgainst: number;
  games: number;
};
export type CandidateInput = {
  home: CandidateTeam;
  away: CandidateTeam;
  simulations?: number;
  seed: number;
  drives?: number;
  expectedScoreMeans?: { home: number; away: number };
};
/** Exponential tilt of 0/3/7 outcomes. Input is points per drive, not per game. */
export function candidateDriveRates(
  ppd: number,
): { td: number; fg: number; expectedPoints: number } | null {
  if (!Number.isFinite(ppd) || ppd < 0 || ppd > 7) return null;
  if (!ppd) return { td: 0, fg: 0, expectedPoints: 0 };
  if (ppd === 7) return { td: 1, fg: 0, expectedPoints: 7 };
  const rates = (lambda: number) => {
    const max = Math.max(0, 3 * lambda, 7 * lambda),
      empty = Math.exp(-max),
      fg = 0.3 * Math.exp(3 * lambda - max),
      td = 0.7 * Math.exp(7 * lambda - max),
      sum = empty + fg + td;
    return {
      td: td / sum,
      fg: fg / sum,
      expectedPoints: (7 * td + 3 * fg) / sum,
    };
  };
  let lo = -20,
    hi = 20;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (rates(mid).expectedPoints < ppd) lo = mid;
    else hi = mid;
  }
  return rates((lo + hi) / 2);
}
export function chooseSampleMean(input: {
  venue?: { games: number; ptsFor: number | null; ptsAgainst: number | null };
  overall?: { games: number; ptsFor: number | null; ptsAgainst: number | null };
}): CandidateTeam | null {
  const s = input.venue && input.venue.games >= 3 ? input.venue : input.overall;
  if (
    !s ||
    !Number.isSafeInteger(s.games) ||
    s.games < 3 ||
    s.ptsFor == null ||
    s.ptsAgainst == null ||
    ![s.ptsFor, s.ptsAgainst].every(
      (v) => Number.isFinite(v) && v >= 0 && v <= 84,
    )
  )
    return null;
  return { games: s.games, ptsFor: s.ptsFor, ptsAgainst: s.ptsAgainst };
}
/** Local seeded RNG never mutates Math.random or other requests. */
export function runNcaafCandidate(
  input: CandidateInput,
): {
  version: string;
  settlement: "regulation_only";
  homeScores: number[];
  awayScores: number[];
  homeMean: number;
  awayMean: number;
  draws: number;
} | null {
  const n = input.simulations ?? 10000,
    drives = input.drives ?? 12;
  if (
    !Number.isInteger(n) ||
    n < 10000 ||
    n > 100000 ||
    !Number.isInteger(drives) ||
    drives < 8 ||
    drives > 20 ||
    !Number.isInteger(input.seed) ||
    ![input.home, input.away].every(
      (t) =>
        Number.isSafeInteger(t.games) &&
        t.games >= 3 &&
        [t.ptsFor, t.ptsAgainst].every(
          (v) => Number.isFinite(v) && v >= 0 && v <= 84,
        ),
    )
  )
    return null;
  if (
    input.expectedScoreMeans &&
    ![input.expectedScoreMeans.home, input.expectedScoreMeans.away].every(
      (v) => Number.isFinite(v) && v >= 0 && v <= 84,
    )
  )
    return null;
  const homeMean =
      input.expectedScoreMeans?.home ??
      (input.home.ptsFor + input.away.ptsAgainst) / 2,
    awayMean =
      input.expectedScoreMeans?.away ??
      (input.away.ptsFor + input.home.ptsAgainst) / 2;
  const h = candidateDriveRates(homeMean / drives),
    a = candidateDriveRates(awayMean / drives);
  if (!h || !a) return null;
  let state = input.seed >>> 0;
  const random = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const points = (r: number, rates: { td: number; fg: number }) =>
    r < rates.td ? 7 : r < rates.td + rates.fg ? 3 : 0;
  const homeScores: number[] = [],
    awayScores: number[] = [];
  for (let i = 0; i < n; i++) {
    let hs = 0,
      as = 0;
    for (let d = 0; d < drives; d++) {
      hs += points(random(), h);
      as += points(random(), a);
    }
    homeScores.push(hs);
    awayScores.push(as);
  }
  return {
    version: NCAAF_CANDIDATE_VERSION,
    settlement: "regulation_only",
    homeScores,
    awayScores,
    homeMean,
    awayMean,
    draws: n,
  };
}
