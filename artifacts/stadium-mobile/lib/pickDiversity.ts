// Pick diversity for AI Coach parlays — quality first, variety on close scores.

import type { ParsedPick } from "../components/PickCard.tsx";
import { gameLineLegBucket, isGameLinePick } from "./gameSimScoring.ts";
import { comparePickStrength } from "./parlayQualifiedGate.ts";
import {
  coachFinalScoresNear,
  compareCoachPicksByFinalScore,
  computeCoachFinalScore,
} from "./coachPickRanking.ts";
import { parlayLegKey } from "./parlayVarietyMemory.ts";
import { pickLegFingerprint } from "./parlayReachCore.ts";

const norm = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Within this near-score band, prefer the pick that adds more variety. */
export const DIVERSITY_SCORE_TIE_BAND = 0.35;

/** Deprioritize a recently used leg unless quality clearly beats this gap. */
const RECENT_LEG_PENALTY = DIVERSITY_SCORE_TIE_BAND * 1000 * 0.7;
/** Deprioritize a recently used player prop unless quality clearly beats this gap. */
const RECENT_PLAYER_PENALTY = DIVERSITY_SCORE_TIE_BAND * 1000 * 0.4;

export type PickDiversityCaps = {
  maxPerGame: number;
  maxPerPlayer: number;
  maxPerTeam: number;
  maxPerMarketFamily: number;
  maxGameLegs: number;
  /** Hard cap on standard spread legs — prevents spread-dominated tickets. */
  maxSpreadLegs: number;
};

/** Coarse market buckets for ticket mix quotas. */
export type MarketBucket = "player_prop" | "game_line" | "alt_line" | "longshot";

export type MarketQuotaRange = { min: number; max: number };
export type MarketQuotas = Record<MarketBucket, MarketQuotaRange>;

export type PickDiversityOpts = {
  target: number;
  varietySeed?: string;
  avoidLegKeys?: Set<string>;
  recentPlayerKeys?: Set<string>;
  playerAppearanceCounts?: Map<string, number>;
  quotas?: MarketQuotas;
  longshotAsk?: boolean;
  caps: PickDiversityCaps;
};

export type PickDiversityState = {
  legSeen: Set<string>;
  bucketSeen: Set<string>;
  perGame: Map<string, number>;
  perPlayer: Set<string>;
  perTeam: Map<string, number>;
  perMarketFamily: Map<string, number>;
  perMarketBucket: Map<MarketBucket, number>;
  gameLegs: number;
};

export function defaultDiversityCaps(target: number): PickDiversityCaps {
  const spreadCap = Math.max(1, Math.floor(target * 0.30));
  return {
    maxPerGame: target >= 12 ? 2 : target >= 8 ? 2 : target >= 5 ? 3 : 4,
    maxPerPlayer: 1,
    maxPerTeam: target >= 12 ? 2 : target >= 6 ? 2 : 3,
    maxPerMarketFamily: Math.max(2, Math.min(target, Math.ceil(target * 0.45))),
    maxGameLegs: Math.max(2, Math.min(Math.ceil(target * 0.45), target - 2)),
    maxSpreadLegs: spreadCap,
  };
}

function quotaRange(target: number, minPct: number, maxPct: number): MarketQuotaRange {
  return {
    min: Math.max(0, Math.ceil(target * minPct - 1e-6)),
    max: Math.max(1, Math.floor(target * maxPct + 1e-6)),
  };
}

/** Target ticket mix — props, game lines, alt lines, and high-value longshots. */
export function defaultMarketQuotas(target: number, longshotAsk = false): MarketQuotas {
  if (target <= 3) {
    return {
      player_prop: { min: 1, max: target },
      game_line: { min: 0, max: 2 },
      alt_line: { min: 0, max: 1 },
      longshot: { min: 0, max: 1 },
    };
  }

  const singleCap = Math.max(2, Math.ceil(target * 0.45));
  const quotas: MarketQuotas = {
    player_prop: quotaRange(target, 0.3, 0.4),
    game_line: quotaRange(target, 0.2, 0.3),
    alt_line: quotaRange(target, 0.15, 0.25),
    longshot: quotaRange(target, longshotAsk ? 0.1 : 0.08, 0.2),
  };

  for (const bucket of Object.keys(quotas) as MarketBucket[]) {
    quotas[bucket].max = Math.min(quotas[bucket].max, singleCap);
    if (quotas[bucket].max < quotas[bucket].min) {
      quotas[bucket].min = quotas[bucket].max;
    }
  }

  let sumMin = Object.values(quotas).reduce((s, q) => s + q.min, 0);
  if (sumMin > target) {
    const trimOrder: MarketBucket[] = ["longshot", "alt_line", "game_line", "player_prop"];
    for (const bucket of trimOrder) {
      while (sumMin > target && quotas[bucket].min > 0) {
        quotas[bucket].min -= 1;
        sumMin -= 1;
      }
    }
  }

  return quotas;
}

export function relaxMarketQuotas(quotas: MarketQuotas, target: number): MarketQuotas {
  const out = { ...quotas };
  for (const bucket of Object.keys(out) as MarketBucket[]) {
    out[bucket] = {
      min: Math.max(0, out[bucket].min - 1),
      max: Math.min(target, out[bucket].max + 1),
    };
  }
  return out;
}

export function openMarketQuotas(target: number): MarketQuotas {
  const cap = Math.max(2, Math.ceil(target * 0.5));
  return {
    player_prop: { min: 0, max: cap },
    game_line: { min: 0, max: cap },
    alt_line: { min: 0, max: cap },
    longshot: { min: 0, max: cap },
  };
}

export function createPickDiversityState(): PickDiversityState {
  return {
    legSeen: new Set(),
    bucketSeen: new Set(),
    perGame: new Map(),
    perPlayer: new Set(),
    perTeam: new Map(),
    perMarketFamily: new Map(),
    perMarketBucket: new Map(),
    gameLegs: 0,
  };
}

function teamNick(team: string): string {
  const parts = norm(team).split(" ").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

/** Team backed by a leg — props use teamAbbr; game lines parse the pick label. */
export function pickTeamKey(pick: ParsedPick): string | null {
  if (pick.teamAbbr?.trim()) return norm(pick.teamAbbr);
  if (!pick.isProp && isGameLinePick(pick)) {
    const label = String(pick.pick ?? "");
    if (/\b(over|under)\b/i.test(label)) return null;
    const m = label.match(/^(.+?)\s*[+-]\d/);
    const team = (m?.[1] ?? label.replace(/\s*ml$/i, "")).trim();
    return team ? norm(team) : null;
  }
  return null;
}

/** Market family for rotation — props, spreads, totals, alt lines, team totals. */
export function pickMarketFamily(pick: ParsedPick): string {
  const m = norm(pick.market);
  if (pick.isProp) {
    if (/stolen base/.test(m)) return "prop:stolen_bases";
    if (/home run/.test(m)) return "prop:home_runs";
    if (/hit/.test(m)) return "prop:hits";
    if (/strikeout|pitcher/.test(m)) return "prop:strikeouts";
    if (/point/.test(m)) return "prop:points";
    if (/rebound/.test(m)) return "prop:rebounds";
    if (/assist/.test(m)) return "prop:assists";
    if (/3.?point|three/.test(m)) return "prop:threes";
    if (/pass|rush|rec|yard|td|touchdown/.test(m)) return "prop:football";
    if (/goal/.test(m)) return "prop:goals";
    return `prop:${m.split(" ")[0] ?? "other"}`;
  }
  if (/team total/.test(m)) return "game:team_total";
  if (/alt/.test(m) && /spread|run line|puck/.test(m)) return "game:alt_spread";
  if (/alt/.test(m) && /total|over|under/.test(m)) return "game:alt_total";
  if (/spread|run line|puck/.test(m)) return "game:spread";
  if (/total|over\/under|o\/u/.test(m)) return "game:total";
  if (/money|ml|h2h/.test(m)) return "game:moneyline";
  return `game:${m}`;
}

/** High-value plus-money legs (+250 or better, or flagged high-risk value). */
export function isQuotaLongshot(pick: ParsedPick): boolean {
  if (pick.finalAiScore?.highRiskValuePlay) return true;
  const odds = pick.odds ?? -999;
  return odds >= 250;
}

/** Coarse bucket for ticket mix quotas. */
export function pickMarketBucket(pick: ParsedPick): MarketBucket {
  if (isQuotaLongshot(pick)) return "longshot";
  if (pick.isProp) return "player_prop";
  const family = pickMarketFamily(pick);
  if (family === "game:alt_spread" || family === "game:alt_total" || family === "game:team_total") {
    return "alt_line";
  }
  return "game_line";
}

export function pickPlayerKey(pick: ParsedPick): string | null {
  if (!pick.isProp || !pick.player?.trim()) return null;
  return norm(pick.player);
}

/** Penalty for repeating recent legs/players — quality can still override. */
export function diversityPenalty(pick: ParsedPick, opts: PickDiversityOpts): number {
  let penalty = 0;
  const legKey = parlayLegKey(pick);
  if (opts.avoidLegKeys?.has(legKey)) penalty += RECENT_LEG_PENALTY;
  const playerKey = pickPlayerKey(pick);
  if (playerKey) {
    if (opts.recentPlayerKeys?.has(playerKey)) penalty += RECENT_PLAYER_PENALTY;
    const appearances = opts.playerAppearanceCounts?.get(playerKey) ?? 0;
    if (appearances > 0) penalty += appearances * RECENT_PLAYER_PENALTY * 0.55;
  }
  return penalty;
}

/** Higher score = bucket needs more legs to hit quota minimum. */
export function quotaNeedScore(
  pick: ParsedPick,
  state: PickDiversityState,
  quotas?: MarketQuotas,
): number {
  if (!quotas) return 0;
  const bucket = pickMarketBucket(pick);
  const count = state.perMarketBucket.get(bucket) ?? 0;
  const { min, max } = quotas[bucket];
  if (count >= max) return -1000;
  if (count < min) return (min - count) * 80;
  return 0;
}

/** Strength score for diversity-aware ranking — composite weighted so clear value wins. */
export function diversityAdjustedScore(pick: ParsedPick, opts: PickDiversityOpts): number {
  const coach = computeCoachFinalScore(pick) ?? 0;
  return coach * 1000 - diversityPenalty(pick, opts);
}

/** Load on game / team / market family — lower is better for tie-breaks. */
export function diversityLoadScore(pick: ParsedPick, state: PickDiversityState): number {
  const gameKey = norm(pick.game);
  const gameLoad = state.perGame.get(gameKey) ?? 0;
  const teamKey = pickTeamKey(pick);
  const teamLoad = teamKey ? (state.perTeam.get(teamKey) ?? 0) : 0;
  const family = pickMarketFamily(pick);
  const marketLoad = state.perMarketFamily.get(family) ?? 0;
  const bucket = pickMarketBucket(pick);
  const bucketLoad = state.perMarketBucket.get(bucket) ?? 0;
  return gameLoad * 100 + teamLoad * 40 + marketLoad * 15 + bucketLoad * 25;
}

export function canAddPickDiversity(
  pick: ParsedPick,
  state: PickDiversityState,
  caps: PickDiversityCaps,
  opts?: Pick<PickDiversityOpts, "quotas">,
): boolean {
  const fp = pickLegFingerprint(pick);
  if (state.legSeen.has(fp)) return false;

  const gameKey = norm(pick.game);
  if ((state.perGame.get(gameKey) ?? 0) >= caps.maxPerGame) return false;

  if (pick.isProp) {
    const playerKey = pickPlayerKey(pick);
    if (playerKey && state.perPlayer.has(playerKey)) return false;
    const teamKey = pickTeamKey(pick);
    if (teamKey && (state.perTeam.get(teamKey) ?? 0) >= caps.maxPerTeam) return false;
  }

  const family = pickMarketFamily(pick);
  if ((state.perMarketFamily.get(family) ?? 0) >= caps.maxPerMarketFamily) return false;
  if (family === "game:spread" && (state.perMarketFamily.get("game:spread") ?? 0) >= caps.maxSpreadLegs) {
    return false;
  }

  const marketBucket = pickMarketBucket(pick);
  const bucketCount = state.perMarketBucket.get(marketBucket) ?? 0;
  const quota = opts?.quotas?.[marketBucket];
  if (quota && bucketCount >= quota.max) return false;

  if (!pick.isProp && isGameLinePick(pick)) {
    if (state.gameLegs >= caps.maxGameLegs) return false;
    const legBucket = gameLineLegBucket(pick.game, pick.market, pick.pick);
    if (state.bucketSeen.has(legBucket)) return false;
  }

  return true;
}

export function addPickDiversityState(pick: ParsedPick, state: PickDiversityState): void {
  const fp = pickLegFingerprint(pick);
  state.legSeen.add(fp);
  const gameKey = norm(pick.game);
  state.perGame.set(gameKey, (state.perGame.get(gameKey) ?? 0) + 1);
  const playerKey = pickPlayerKey(pick);
  if (playerKey) state.perPlayer.add(playerKey);
  const teamKey = pickTeamKey(pick);
  if (teamKey) state.perTeam.set(teamKey, (state.perTeam.get(teamKey) ?? 0) + 1);
  const family = pickMarketFamily(pick);
  state.perMarketFamily.set(family, (state.perMarketFamily.get(family) ?? 0) + 1);
  const marketBucket = pickMarketBucket(pick);
  state.perMarketBucket.set(marketBucket, (state.perMarketBucket.get(marketBucket) ?? 0) + 1);
  if (!pick.isProp && isGameLinePick(pick)) {
    state.gameLegs += 1;
    state.bucketSeen.add(gameLineLegBucket(pick.game, pick.market, pick.pick));
  }
}

/** Compare picks for ticket fill — strength first, variety on close scores. */
export function comparePicksWithDiversity(
  a: ParsedPick,
  b: ParsedPick,
  opts: PickDiversityOpts,
  state: PickDiversityState,
): number {
  const scoreA = diversityAdjustedScore(a, opts);
  const scoreB = diversityAdjustedScore(b, opts);
  const rawA = computeCoachFinalScore(a) ?? 0;
  const rawB = computeCoachFinalScore(b) ?? 0;
  if (!coachFinalScoresNear(rawA, rawB) && Math.abs(scoreA - scoreB) > DIVERSITY_SCORE_TIE_BAND * 1000) {
    return scoreB - scoreA;
  }

  const penalizedA = diversityPenalty(a, opts);
  const penalizedB = diversityPenalty(b, opts);
  if (penalizedA !== penalizedB) return penalizedA - penalizedB;
  const needA = quotaNeedScore(a, state, opts.quotas);
  const needB = quotaNeedScore(b, state, opts.quotas);
  if (needA !== needB) return needB - needA;

  return compareCoachPicksByFinalScore(a, b, {
    diversityLoad: (p) => diversityLoadScore(p, state),
  });
}

/** Pick the best addable candidate — quality first, variety when scores are close. */
export function pickBestDiverseCandidate(
  candidates: ParsedPick[],
  state: PickDiversityState,
  opts: PickDiversityOpts,
): ParsedPick | null {
  const addable = candidates.filter((p) => canAddPickDiversity(p, state, opts.caps, opts));
  if (!addable.length) return null;
  addable.sort((a, b) => comparePicksWithDiversity(a, b, opts, state));
  return addable[0] ?? null;
}

/**
 * Fill a parlay to target from qualified candidates — diversity caps, recent-leg
 * deprioritization, and variety tie-breaks when scores are close.
 */
export function selectDiverseQualifiedParlay(
  candidates: ParsedPick[],
  target: number,
  opts: PickDiversityOpts,
): ParsedPick[] {
  if (target <= 0 || !candidates.length) return [];
  const state = createPickDiversityState();
  const out: ParsedPick[] = [];
  const pool = [...candidates];

  while (out.length < target) {
    const next = pickBestDiverseCandidate(pool, state, opts);
    if (!next) break;
    addPickDiversityState(next, state);
    out.push(next);
  }

  return out;
}

/** Relax caps in passes — never add unqualified legs. */
export function reachSelectDiverseQualified(
  candidates: ParsedPick[],
  target: number,
  opts: Omit<PickDiversityOpts, "caps" | "quotas"> & {
    caps?: Partial<PickDiversityCaps>;
    quotas?: MarketQuotas;
  },
): ParsedPick[] {
  if (target <= 0) return [];
  const base = defaultDiversityCaps(target);
  const spreadHardMax = Math.min(target, Math.ceil(target * 0.35));
  const baseQuotas = opts.quotas ?? defaultMarketQuotas(target, opts.longshotAsk);
  const capsPasses: PickDiversityCaps[] = [
    { ...base, ...opts.caps },
    {
      ...base,
      ...opts.caps,
      maxPerGame: Math.max(base.maxPerGame + 1, opts.caps?.maxPerGame ?? base.maxPerGame),
      maxPerTeam: Math.max(base.maxPerTeam + 1, opts.caps?.maxPerTeam ?? base.maxPerTeam),
      maxPerMarketFamily: Math.max(
        base.maxPerMarketFamily + 2,
        opts.caps?.maxPerMarketFamily ?? base.maxPerMarketFamily,
      ),
      maxSpreadLegs: Math.min(
        spreadHardMax,
        Math.max(base.maxSpreadLegs + 1, opts.caps?.maxSpreadLegs ?? base.maxSpreadLegs),
      ),
    },
    {
      maxPerGame: Math.min(target, 6),
      maxPerPlayer: 1,
      maxPerTeam: Math.min(target, 4),
      maxPerMarketFamily: target,
      maxGameLegs: Math.min(target, base.maxGameLegs + 2),
      maxSpreadLegs: spreadHardMax,
    },
    {
      maxPerGame: target,
      maxPerPlayer: target >= 12 ? 2 : 1,
      maxPerTeam: target,
      maxPerMarketFamily: target,
      maxGameLegs: target,
      maxSpreadLegs: spreadHardMax,
    },
  ];
  const quotaPasses: MarketQuotas[] = [
    baseQuotas,
    relaxMarketQuotas(baseQuotas, target),
    openMarketQuotas(target),
  ];

  let best: ParsedPick[] = [];
  for (const caps of capsPasses) {
    for (const quotas of quotaPasses) {
      const attempt = selectDiverseQualifiedParlay(candidates, target, {
        ...opts,
        target,
        caps,
        quotas,
      });
      if (attempt.length > best.length) best = attempt;
      if (attempt.length >= target) return attempt.slice(0, target);
    }
  }
  return best;
}

export { teamNick };
