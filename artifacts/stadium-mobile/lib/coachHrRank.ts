/**
 * Dedicated batter_home_runs ranking for Coach board scans.
 *
 * Real provider data only. Missing inputs are excluded and reduce coverage
 * (never invented). Weights favor simulated HR probability + matchup quality
 * first; price/EV is secondary so longshots are not preferred by default.
 */

import type { ParsedPick } from "../components/PickCard.tsx";
import { impliedProb } from "./format.ts";
import { simEvPct } from "./gameSimQualityGates.ts";
import { computeHrScore, type HrScore, type HrScoreInput } from "./hrScore.ts";
import { gameValueForMarket } from "./propStats.ts";
import type {
  MlbGameEnvSlice,
  MlbPlatoonSlice,
  PitcherTendencySlice,
} from "./propHolisticRecommendation.ts";
import { resolveMlbPitcherTendency } from "./propHolisticRecommendation.ts";
import type { PlayerHistorySlice } from "./pickScoreContext.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";
import { boardLegPoolRole } from "./ticketStaging.ts";
import { pickLegFingerprint } from "./parlayReachCore.ts";

/** Coach HR rank weights — sum to 1. Sim + matchup lead; EV is tertiary. */
export const COACH_HR_RANK_WEIGHTS = {
  hrProbability: 0.4,
  matchupQuality: 0.35,
  marketEv: 0.15,
  batterPower: 0.1,
} as const;

export type CoachHrRankFactorKey = keyof typeof COACH_HR_RANK_WEIGHTS;

export type CoachHrRankComponents = {
  hrScore: number | null;
  hrScorePresentCount: number;
  hrScoreExcluded: string[];
  hrFactors: Array<{ key: string; label: string; display: string | null; present: boolean }>;
  batterPower01: number | null;
  batterPowerPresent: string[];
  batterPowerMissing: string[];
  environmentPresent: string[];
  environmentMissing: string[];
  simHrProb: number | null;
  impliedProb: number | null;
  evPct: number | null;
  odds: number | null;
  line: number | null;
  factorScores: Record<CoachHrRankFactorKey, number | null>;
  coverage: number;
  rankScore: number;
};

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lin01 = (x: number, lo: number, hi: number) => clamp01((x - lo) / (hi - lo));

export function isBatterHomeRunMarket(marketKey: string | null | undefined): boolean {
  const k = String(marketKey ?? "")
    .toLowerCase()
    .replace(/_alternate$/, "");
  if (k === "batter_home_runs") return true;
  return /home\s*runs?/.test(k) || /\bhr\b/.test(k);
}

export function isBatterHomeRunPick(pick: ParsedPick): boolean {
  if (!pick.isProp) return false;
  return isBatterHomeRunMarket(pick.propMarketKey ?? pick.market);
}

export function isHrOnlyScoredPool(scored: BoardScoredLeg[]): boolean {
  const props = scored.filter((l) => l.pick.isProp);
  if (!props.length) return false;
  return props.every((l) => isBatterHomeRunPick(l.pick));
}

function recentHrRate(ph: PlayerHistorySlice | null | undefined): number | null {
  const recent = ph?.recent;
  if (!recent?.length) return null;
  let sum = 0;
  let n = 0;
  const ambiguous = new Set<string>();
  for (const g of recent) {
    const stats = (g.stats ?? {}) as Record<string, string>;
    const hr = gameValueForMarket("batter_home_runs", stats, ambiguous);
    if (hr == null || !Number.isFinite(hr)) continue;
    sum += hr;
    n += 1;
  }
  if (n === 0) return null;
  return sum / n;
}

/** Batter power from REAL logs / platoon splits only — never invents Statcast. */
export function batterPowerFromRealData(
  ph: PlayerHistorySlice | null | undefined,
  platoon: MlbPlatoonSlice | null | undefined,
): { score01: number | null; present: string[]; missing: string[] } {
  const present: string[] = [];
  const missing: string[] = [
    "barrel_rate",
    "hard_hit_rate",
    "exit_velocity",
    "iso",
    "recent_batted_ball_quality",
  ];
  const parts: number[] = [];

  const hrRate = recentHrRate(ph);
  if (hrRate != null) {
    parts.push(lin01(hrRate, 0, 0.45));
    present.push(`recent_hr_rate=${hrRate.toFixed(2)}`);
  }

  const vs = platoon?.vsThatHand;
  if (vs?.ops != null && Number.isFinite(vs.ops)) {
    parts.push(lin01(vs.ops, 0.65, 1.05));
    present.push(`vs_hand_ops=${vs.ops.toFixed(3)}`);
  }
  if (vs?.slg != null && Number.isFinite(vs.slg)) {
    parts.push(lin01(vs.slg, 0.35, 0.65));
    present.push(`vs_hand_slg=${vs.slg.toFixed(3)}`);
  }
  if (vs?.hr != null && Number.isFinite(vs.hr)) {
    parts.push(lin01(vs.hr, 0, 25));
    present.push(`vs_hand_hr=${vs.hr}`);
  }
  if (platoon?.platoon === "advantage" || platoon?.platoon === "switch") {
    parts.push(0.7);
    present.push(`platoon=${platoon.platoon}`);
  } else if (platoon?.platoon === "disadvantage") {
    parts.push(0.35);
    present.push("platoon=disadvantage");
  } else {
    missing.push("handedness_split");
  }

  if (!parts.length) return { score01: null, present, missing };
  return {
    score01: parts.reduce((a, b) => a + b, 0) / parts.length,
    present,
    missing,
  };
}

export function hrScoreInputFromMlbContext(opts: {
  tendency?: PitcherTendencySlice | null;
  platoon?: MlbPlatoonSlice | null;
  gameEnv?: MlbGameEnvSlice | null;
}): HrScoreInput {
  const tend = opts.tendency ?? opts.platoon?.opposingPitcherTendency ?? null;
  const env = opts.gameEnv;
  const dome = env?.climateControlled === true || env?.park?.dome === true;
  const platoonOps = opts.platoon?.vsThatHand?.ops ?? null;
  return {
    hrPer9: tend?.hrPer9 ?? null,
    barrelPctAllowed: tend?.barrelPctAllowed ?? null,
    hardHitPctAllowed: tend?.hardHitPctAllowed ?? null,
    battedBallEvents: tend?.battedBallEvents ?? null,
    flyBallPct: tend?.flyBallPct ?? null,
    hrIndex: env?.park?.hrIndex ?? null,
    tempF: dome ? null : (env?.weather?.tempF ?? null),
    dome: dome ? true : env?.park?.dome === false ? false : null,
    platoonOps,
  };
}

function environmentCoverage(env: MlbGameEnvSlice | null | undefined): {
  present: string[];
  missing: string[];
} {
  const present: string[] = [];
  const missing: string[] = [];
  if (env?.park?.hrIndex != null) present.push(`park_hr_index=${env.park.hrIndex}`);
  else missing.push("park_hr_factor");
  if (env?.park?.dome === true || env?.climateControlled === true) {
    present.push("dome");
  } else {
    if (env?.weather?.tempF != null) present.push(`tempF=${env.weather.tempF}`);
    else missing.push("temperature");
    if (env?.weather?.windMph != null) present.push(`windMph=${env.weather.windMph}`);
    else missing.push("wind_speed");
    // mlb-probables weather has no wind direction — do not invent it.
    missing.push("wind_direction");
  }
  missing.push("lineup_plate_appearances");
  missing.push("opposing_bullpen_hr_vulnerability");
  missing.push("pitch_mix");
  missing.push("hitter_vs_pitch_types");
  return { present, missing };
}

function score01ToTen(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.round(clamp01(v) * 100) / 10;
}

/** Build diagnostics + rank score for one HR candidate. */
export function buildCoachHrRankComponents(opts: {
  pick: ParsedPick;
  simHit?: number | null;
  evPct?: number | null;
  platoon?: MlbPlatoonSlice | null;
  gameEnv?: MlbGameEnvSlice | null;
  playerHistory?: PlayerHistorySlice | null;
  playerTeamIsHome?: boolean | null;
}): CoachHrRankComponents {
  const pick = opts.pick;
  const tendency = resolveMlbPitcherTendency(
    opts.gameEnv,
    opts.platoon,
    opts.playerTeamIsHome ?? null,
  );
  const hrInput = hrScoreInputFromMlbContext({
    tendency,
    platoon: opts.platoon,
    gameEnv: opts.gameEnv,
  });
  const hr: HrScore = computeHrScore(hrInput);
  const batter = batterPowerFromRealData(opts.playerHistory, opts.platoon);
  const envCov = environmentCoverage(opts.gameEnv);

  const simHrProb =
    opts.simHit != null && Number.isFinite(opts.simHit)
      ? opts.simHit
      : (pick.finalAiScore?.simHit ?? null);
  const odds = typeof pick.odds === "number" && Number.isFinite(pick.odds) ? pick.odds : null;
  const implied = odds != null ? impliedProb(odds) : null;
  const evPct =
    opts.evPct != null && Number.isFinite(opts.evPct)
      ? opts.evPct
      : simHrProb != null && odds != null
        ? simEvPct(simHrProb, odds)
        : null;

  const matchup01 =
    hr.score != null ? clamp01(hr.score / 100) : batter.score01 != null ? batter.score01 : null;

  const factorScores: Record<CoachHrRankFactorKey, number | null> = {
    hrProbability: score01ToTen(simHrProb),
    matchupQuality: score01ToTen(matchup01),
    marketEv:
      evPct != null && Number.isFinite(evPct) ? Math.max(0, Math.min(10, evPct / 2)) : null,
    batterPower: score01ToTen(batter.score01),
  };

  let acc = 0;
  let wSum = 0;
  for (const key of Object.keys(COACH_HR_RANK_WEIGHTS) as CoachHrRankFactorKey[]) {
    const s = factorScores[key];
    if (s == null || !Number.isFinite(s)) continue;
    const w = COACH_HR_RANK_WEIGHTS[key];
    wSum += w;
    acc += w * s;
  }
  const coverage = wSum;
  const rankScore = wSum <= 0 ? 0 : Math.round(acc * wSum * 100) / 10;

  return {
    hrScore: hr.score,
    hrScorePresentCount: hr.presentCount,
    hrScoreExcluded: [...hr.excluded],
    hrFactors: hr.factors.map((f) => ({
      key: f.key,
      label: f.label,
      display: f.display,
      present: f.sub != null,
    })),
    batterPower01: batter.score01,
    batterPowerPresent: batter.present,
    batterPowerMissing: batter.missing,
    environmentPresent: envCov.present,
    environmentMissing: envCov.missing,
    simHrProb,
    impliedProb: implied,
    evPct,
    odds,
    line: pick.propLine ?? null,
    factorScores,
    coverage,
    rankScore,
  };
}

/** Sort key for board staging — HR markets only. */
export function coachHrRankScore(
  leg: BoardScoredLeg,
  components?: CoachHrRankComponents | null,
): number {
  if (components) return components.rankScore;
  return buildCoachHrRankComponents({
    pick: leg.pick,
    simHit: leg.simHit,
    evPct: leg.evPct,
  }).rankScore;
}

/**
 * Pure top-N by HR rank among qualified distinct hitters.
 * Same-game stacks are allowed only when those hitters independently rank in
 * the top N — correlation soft-preference does not demote or promote them.
 */
export function selectTopHrQualifiedLegs(
  ranked: BoardScoredLeg[],
  target: number,
): ParsedPick[] {
  const qualified = ranked
    .filter((leg) => isBatterHomeRunPick(leg.pick))
    .filter((leg) => boardLegPoolRole(leg.pick, leg.pick.finalAiScore) != null)
    .sort((a, b) => b.rankScore - a.rankScore || (b.simHit ?? 0) - (a.simHit ?? 0));

  const out: ParsedPick[] = [];
  const seenFp = new Set<string>();
  const seenHitters = new Set<string>();

  for (const leg of qualified) {
    if (out.length >= target) break;
    const fp = pickLegFingerprint(leg.pick);
    if (seenFp.has(fp)) continue;
    const hitterKey = String(leg.pick.athleteId ?? leg.pick.player ?? "")
      .toLowerCase()
      .trim();
    if (!hitterKey || seenHitters.has(hitterKey)) continue;
    seenFp.add(fp);
    seenHitters.add(hitterKey);
    const role = boardLegPoolRole(leg.pick, leg.pick.finalAiScore)!;
    out.push({ ...leg.pick, ticketRole: role, highRiskValuePlay: false });
  }
  return out;
}

/** Compare selected HR hitters vs next-best for diagnostics. */
export function hrSelectionDiagnostics(
  scored: BoardScoredLeg[],
  selected: ParsedPick[],
  componentsByFp: Map<string, CoachHrRankComponents>,
): {
  selected: Array<{
    player: string;
    game: string;
    rankScore: number;
    components: CoachHrRankComponents | null;
  }>;
  nextBest: Array<{
    player: string;
    game: string;
    rankScore: number;
    components: CoachHrRankComponents | null;
    whyBehind: string;
  }>;
} {
  const selectedFps = new Set(selected.map(pickLegFingerprint));
  const ordered = [...scored]
    .filter((l) => isBatterHomeRunPick(l.pick))
    .filter((l) => boardLegPoolRole(l.pick, l.pick.finalAiScore) != null)
    .sort((a, b) => b.rankScore - a.rankScore);

  const selectedRows = selected.map((p) => {
    const fp = pickLegFingerprint(p);
    const leg = ordered.find((l) => pickLegFingerprint(l.pick) === fp);
    return {
      player: String(p.player ?? p.pick ?? ""),
      game: p.game,
      rankScore: leg?.rankScore ?? 0,
      components: componentsByFp.get(fp) ?? null,
    };
  });

  const nextBest = ordered
    .filter((l) => !selectedFps.has(pickLegFingerprint(l.pick)))
    .slice(0, 5)
    .map((l) => {
      const fp = pickLegFingerprint(l.pick);
      const c = componentsByFp.get(fp) ?? null;
      const bestSel = selectedRows[0];
      const whyBehind = bestSel
        ? [
            `rank ${l.rankScore.toFixed(1)} vs lead ${bestSel.rankScore.toFixed(1)}`,
            c?.simHrProb != null ? `simHR=${(c.simHrProb * 100).toFixed(1)}%` : "simHR=missing",
            c?.hrScore != null ? `hrScore=${c.hrScore}` : "hrScore=missing",
            c?.evPct != null ? `ev=${c.evPct.toFixed(1)}%` : "ev=missing",
            `coverage=${((c?.coverage ?? 0) * 100).toFixed(0)}%`,
          ].join("; ")
        : "not selected";
      return {
        player: String(l.pick.player ?? l.pick.pick ?? ""),
        game: l.pick.game,
        rankScore: l.rankScore,
        components: c,
        whyBehind,
      };
    });

  return { selected: selectedRows, nextBest };
}
