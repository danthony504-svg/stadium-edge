// Pick diversity for AI Coach parlays — quality first, variety on close scores.

import type { ParsedPick } from "../components/PickCard.tsx";
import { gameLineLegBucket, isGameLinePick } from "./gameSimScoring.ts";
import { comparePickStrength, nearScoreFromPick } from "./parlayQualifiedGate.ts";
import { parlayLegKey } from "./parlayVarietyMemory.ts";
import { pickLegFingerprint } from "./parlayReachCore.ts";
import { varietyRankKey } from "./varietySeed.ts";

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
};

export type PickDiversityOpts = {
  target: number;
  varietySeed?: string;
  avoidLegKeys?: Set<string>;
  recentPlayerKeys?: Set<string>;
  caps: PickDiversityCaps;
};

export type PickDiversityState = {
  legSeen: Set<string>;
  bucketSeen: Set<string>;
  perGame: Map<string, number>;
  perPlayer: Set<string>;
  perTeam: Map<string, number>;
  perMarketFamily: Map<string, number>;
  gameLegs: number;
};

export function defaultDiversityCaps(target: number): PickDiversityCaps {
  return {
    maxPerGame: target >= 12 ? 2 : target >= 8 ? 2 : target >= 5 ? 3 : 4,
    maxPerPlayer: 1,
    maxPerTeam: target >= 12 ? 2 : target >= 6 ? 2 : 3,
    maxPerMarketFamily: target >= 12 ? 3 : target >= 8 ? 4 : 6,
    maxGameLegs: Math.max(2, Math.min(Math.ceil(target * 0.35), target - 3)),
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
  if (playerKey && opts.recentPlayerKeys?.has(playerKey)) penalty += RECENT_PLAYER_PENALTY;
  return penalty;
}

/** Strength score for diversity-aware ranking — composite weighted so clear value wins. */
export function diversityAdjustedScore(pick: ParsedPick, opts: PickDiversityOpts): number {
  const composite = pick.finalAiScore?.composite ?? 0;
  return nearScoreFromPick(pick) + composite * 150 - diversityPenalty(pick, opts);
}

/** Load on game / team / market family — lower is better for tie-breaks. */
export function diversityLoadScore(pick: ParsedPick, state: PickDiversityState): number {
  const gameKey = norm(pick.game);
  const gameLoad = state.perGame.get(gameKey) ?? 0;
  const teamKey = pickTeamKey(pick);
  const teamLoad = teamKey ? (state.perTeam.get(teamKey) ?? 0) : 0;
  const family = pickMarketFamily(pick);
  const marketLoad = state.perMarketFamily.get(family) ?? 0;
  return gameLoad * 100 + teamLoad * 40 + marketLoad * 15;
}

export function canAddPickDiversity(
  pick: ParsedPick,
  state: PickDiversityState,
  caps: PickDiversityCaps,
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

  if (!pick.isProp && isGameLinePick(pick)) {
    if (state.gameLegs >= caps.maxGameLegs) return false;
    const bucket = gameLineLegBucket(pick.game, pick.market, pick.pick);
    if (state.bucketSeen.has(bucket)) return false;
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
  const rawA = nearScoreFromPick(a) + (a.finalAiScore?.composite ?? 0) * 150;
  const rawB = nearScoreFromPick(b) + (b.finalAiScore?.composite ?? 0) * 150;
  if (Math.abs(rawA - rawB) >= DIVERSITY_SCORE_TIE_BAND * 1000) {
    return rawB - rawA;
  }

  const scoreA = diversityAdjustedScore(a, opts);
  const scoreB = diversityAdjustedScore(b, opts);
  if (Math.abs(scoreA - scoreB) > DIVERSITY_SCORE_TIE_BAND * 1000) {
    return scoreB - scoreA;
  }
  const penalizedA = diversityPenalty(a, opts);
  const penalizedB = diversityPenalty(b, opts);
  if (penalizedA !== penalizedB) return penalizedA - penalizedB;
  const loadA = diversityLoadScore(a, state);
  const loadB = diversityLoadScore(b, state);
  if (loadA !== loadB) return loadA - loadB;
  const seed = opts.varietySeed ?? "variety";
  const keyA = varietyRankKey(seed, pickLegFingerprint(a));
  const keyB = varietyRankKey(seed, pickLegFingerprint(b));
  if (keyA !== keyB) return keyA - keyB;
  return comparePickStrength(b, a);
}

/** Pick the best addable candidate — quality first, variety when scores are close. */
export function pickBestDiverseCandidate(
  candidates: ParsedPick[],
  state: PickDiversityState,
  opts: PickDiversityOpts,
): ParsedPick | null {
  const addable = candidates.filter((p) => canAddPickDiversity(p, state, opts.caps));
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
  opts: Omit<PickDiversityOpts, "caps"> & { caps?: Partial<PickDiversityCaps> },
): ParsedPick[] {
  if (target <= 0) return [];
  const base = defaultDiversityCaps(target);
  const passes: PickDiversityCaps[] = [
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
    },
    {
      maxPerGame: Math.min(target, 6),
      maxPerPlayer: 1,
      maxPerTeam: Math.min(target, 4),
      maxPerMarketFamily: target,
      maxGameLegs: Math.min(target, base.maxGameLegs + 2),
    },
    {
      maxPerGame: target,
      maxPerPlayer: target >= 12 ? 2 : 1,
      maxPerTeam: target,
      maxPerMarketFamily: target,
      maxGameLegs: target,
    },
  ];

  let best: ParsedPick[] = [];
  for (const caps of passes) {
    const attempt = selectDiverseQualifiedParlay(candidates, target, {
      ...opts,
      target,
      caps,
    });
    if (attempt.length > best.length) best = attempt;
    if (attempt.length >= target) return attempt.slice(0, target);
  }
  return best;
}

export { teamNick };
