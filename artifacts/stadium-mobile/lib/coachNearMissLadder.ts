// When a Coach leg fails the quality bar, walk every posted alternate ladder
// (props: other lines; game lines: ML/spread/alt spread/total/alt total) and swap
// in the qualifying rung with the best overall value — not the safest line.

import type { ParsedPick } from "../components/PickCard.tsx";
import { sameGame } from "../components/PickCard.tsx";
import type { GameMeta, PropPoolEntry, RealOddsEntry } from "./api.ts";
import { classifySimAlignment } from "./finalAiScore.ts";
import {
  COACH_SIM_MIN_CONFIDENCE,
  COACH_SIM_MIN_GRADE,
  passesCoachSimQualityGate,
} from "./gameSimQualityGates.ts";
import { evalLinesForGame, gameLabelsMatch } from "./gameLineOptimizer.ts";
import {
  gameSimHitForPick,
  GAME_SIM_MIN_HIT,
  isGameLinePick,
  type CoachGameSimEntry,
} from "./gameSimScoring.ts";
import { attachPickScores } from "./pickScoreContext.ts";
import { propSimKey } from "./propSelection.ts";
import { pickLegFingerprint, type ParlayLegReject } from "./parlayReachCore.ts";
import {
  alternateOverallValueScore,
  formatAlternateValueNote,
  metricsForAlternate,
} from "./coachAltValueScore.ts";
import {
  averageTicketEdge,
  pickEdgePct,
  shouldReoptimizeTicketEdge,
  weakestEdgeLegIndex,
} from "./coachTicketEdge.ts";

/** How close a leg must be to the bar before we search alternates. */
export const NEAR_MISS_MARGIN_PCT = 3;

const GRADE_RANK: Record<string, number> = {
  F: 0,
  D: 1,
  "C-": 2,
  C: 3,
  "C+": 4,
  "B-": 5,
  B: 6,
  "B+": 7,
  "A-": 8,
  A: 9,
  "A+": 10,
};

function gradeRank(g: string | null | undefined): number {
  if (!g) return -1;
  return GRADE_RANK[g] ?? -1;
}

const norm = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function numLine(pick: string): number | null {
  const m = String(pick).match(/([+-]?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function pickTeamName(pick: string): string | null {
  const p = String(pick ?? "");
  if (/\b(over|under)\b/i.test(p)) return null;
  return (
    p
      .replace(/\s*(ml|moneyline)\s*$/i, "")
      .replace(/\s*[+-]?\d+(?:\.\d+)?\s*$/, "")
      .trim() || null
  );
}

function teamsMatch(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  const nick = (s: string) => {
    const parts = norm(s).split(" ").filter(Boolean);
    return parts[parts.length - 1] ?? "";
  };
  const na = nick(a);
  const nb = nick(b);
  if (na.length > 2 && na === nb) return true;
  const ta = new Set(x.split(" ").filter((w) => w.length > 2));
  return y
    .split(" ")
    .filter((w) => w.length > 2)
    .some((w) => ta.has(w));
}

function metricsFromPick(
  pick: ParsedPick,
  sim: CoachGameSimEntry | null | undefined,
  propHit: number | null | undefined,
) {
  const conf = pick.finalAiScore?.confidencePct ?? pick.scores?.confidencePct ?? null;
  const edge = pick.finalAiScore?.edgePct ?? pick.scores?.edgePct ?? null;
  const grade = pick.finalAiScore?.grade ?? null;
  const hit =
    pick.isProp && propHit != null
      ? propHit
      : (pick.finalAiScore?.simHit ?? gameSimHitForPick(pick, sim ?? null));
  return { conf, edge, grade, hit };
}

export function passesCoachPropQualityGate(
  pick: ParsedPick,
  propHit: number | null | undefined,
): boolean {
  if (!pick.isProp) return true;
  const m = metricsFromPick(pick, null, propHit);
  if (m.edge == null || m.edge <= 0) return false;
  if (gradeRank(m.grade) < gradeRank(COACH_SIM_MIN_GRADE)) return false;
  if (m.conf == null || m.conf < COACH_SIM_MIN_CONFIDENCE) return false;
  const { simAligned, highRiskValuePlay } = classifySimAlignment(m.hit, m.edge);
  return simAligned || highRiskValuePlay;
}

/** Leg failed the bar but is within NEAR_MISS_MARGIN_PCT on confidence, edge, or sim hit. */
export function isNearMissQualityFailure(
  pick: ParsedPick,
  sim: CoachGameSimEntry | null | undefined,
  propHit?: number | null,
): boolean {
  if (pick.isProp) {
    if (passesCoachPropQualityGate(pick, propHit)) return false;
  } else if (passesCoachSimQualityGate(pick, sim, { finalAi: pick.finalAiScore, odds: pick.odds })) {
    return false;
  }

  const m = metricsFromPick(pick, sim, propHit);
  const confNear =
    m.conf != null &&
    m.conf >= COACH_SIM_MIN_CONFIDENCE - NEAR_MISS_MARGIN_PCT &&
    m.conf < COACH_SIM_MIN_CONFIDENCE;
  const hitNear =
    m.hit != null &&
    m.hit >= GAME_SIM_MIN_HIT - NEAR_MISS_MARGIN_PCT / 100 &&
    m.hit < GAME_SIM_MIN_HIT;
  const edgeNear = m.edge != null && m.edge > -NEAR_MISS_MARGIN_PCT && m.edge <= 0;
  const gradeNear =
    gradeRank(m.grade) === gradeRank("C") && gradeRank(COACH_SIM_MIN_GRADE) === gradeRank("C+");
  return confNear || hitNear || edgeNear || gradeNear;
}

function propHitForPick(
  pick: ParsedPick,
  propSims?: Map<string, { hitProbability: number | null }>,
): number | null | undefined {
  if (!pick.isProp || !pick.player || pick.propLine == null || !pick.propSide) return null;
  const key = propSimKey(
    pick.player,
    pick.propMarketKey ?? pick.market,
    pick.propLine,
    pick.propSide,
  );
  return propSims?.get(key)?.hitProbability;
}

function parsedPickFromPoolEntry(e: PropPoolEntry): ParsedPick {
  const pick =
    e.line != null
      ? `${e.player} ${e.side} ${e.line} ${e.marketLabel}`
      : `${e.player} ${e.marketLabel}`;
  return {
    game: e.game,
    market: e.marketLabel,
    pick,
    odds: e.odds,
    sport: e.sport,
    isProp: true,
    startsAt: e.startsAt,
    headshot: e.headshot,
    teamAbbr: e.teamAbbr,
    player: e.player,
    athleteId: e.athleteId,
    propMarketKey: e.marketKey,
    propLine: e.line,
    propSide: e.side,
  };
}

function ladderPropCandidates(pick: ParsedPick, propPool: PropPoolEntry[]): PropPoolEntry[] {
  if (!pick.isProp || !pick.player) return [];
  const marketKey = pick.propMarketKey ?? pick.market;
  const side = pick.propSide;
  const rows = propPool.filter(
    (e) =>
      e.player === pick.player &&
      (e.marketKey === marketKey || norm(e.marketLabel) === norm(pick.market)) &&
      (!side || e.side === side) &&
      gameLabelsMatch(e.game, pick.game) &&
      e.line != null &&
      e.line !== pick.propLine,
  );
  return rows;
}

function isGameTotalEntry(e: RealOddsEntry): boolean {
  return /\b(over|under)\b/i.test(e.pick) && !/team total/i.test(e.market);
}

function isTeamSidedEntry(e: RealOddsEntry): boolean {
  const m = e.market.toLowerCase();
  if (/total|over|under|o\/u/.test(m)) return false;
  return /moneyline|spread|run line|puck line|alt spread/i.test(m);
}

function marketRank(market: string): number {
  const m = market.toLowerCase();
  if (/moneyline|\bml\b/.test(m)) return 2;
  if (/spread|run line|puck line/.test(m)) return 0;
  if (/alt spread/.test(m)) return 1;
  if (/total|alt total|team total/.test(m)) return 3;
  return 4;
}

function ladderAllGameAlternates(
  pick: ParsedPick,
  lines: RealOddsEntry[],
): RealOddsEntry[] {
  const pool = lines.filter(
    (e) =>
      gameLabelsMatch(e.game, pick.game) && (isTeamSidedEntry(e) || isGameTotalEntry(e)),
  );
  const seen = new Set<string>();
  const out: RealOddsEntry[] = [];
  const origKey = `${pick.market}|${pick.pick}`.toLowerCase();
  for (const e of pool) {
    const k = `${e.market}|${e.pick}`.toLowerCase();
    if (k === origKey || seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

function ladderGameLineCandidates(
  pick: ParsedPick,
  lines: RealOddsEntry[],
  opts?: { allGameMarkets?: boolean },
): RealOddsEntry[] {
  if (opts?.allGameMarkets) {
    return ladderAllGameAlternates(pick, lines);
  }
  const pool = lines.filter(
    (e) =>
      gameLabelsMatch(e.game, pick.game) && (isTeamSidedEntry(e) || isGameTotalEntry(e)),
  );
  const pickTeam = pickTeamName(pick.pick);
  const isTotal = /\b(over|under)\b/i.test(pick.pick) && !/team total/i.test(pick.market);
  const over = /\bover\b/i.test(pick.pick);
  const under = /\bunder\b/i.test(pick.pick);

  let candidates: RealOddsEntry[];
  if (isTotal) {
    candidates = pool.filter((e) => {
      if (!isGameTotalEntry(e)) return false;
      if (over) return /\bover\b/i.test(e.pick);
      if (under) return /\bunder\b/i.test(e.pick);
      return true;
    });
    candidates.sort((a, b) => {
      const la = numLine(a.pick) ?? 0;
      const lb = numLine(b.pick) ?? 0;
      if (over) return la - lb;
      if (under) return lb - la;
      return 0;
    });
  } else if (pickTeam) {
    candidates = pool.filter((e) => {
      const t = pickTeamName(e.pick);
      return t != null && teamsMatch(t, pickTeam);
    });
    candidates.sort((a, b) => {
      const ra = marketRank(a.market);
      const rb = marketRank(b.market);
      if (ra !== rb) return ra - rb;
      const la = numLine(a.pick);
      const lb = numLine(b.pick);
      if (la == null || lb == null) return 0;
      const neg = la < 0 || lb < 0;
      if (neg) return lb - la;
      return la - lb;
    });
  } else {
    candidates = pool;
  }

  const seen = new Set<string>();
  const out: RealOddsEntry[] = [];
  const origKey = `${pick.market}|${pick.pick}`.toLowerCase();
  for (const e of candidates) {
    const k = `${e.market}|${e.pick}`.toLowerCase();
    if (k === origKey || seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

export type NearMissLadderOpts = {
  evalLinesByGame?: Map<string, RealOddsEntry[]>;
  realOdds?: RealOddsEntry[];
  propPool?: PropPoolEntry[];
  propSimulations?: Map<string, { hitProbability: number | null }>;
  gameSimulations?: Map<string, CoachGameSimEntry>;
  matchupHistory?: Record<string, import("./api.ts").MatchupHistoryEntry>;
  matchupInjuries?: Record<string, import("./injuries.ts").GameInjuryReport>;
  gameMeta?: GameMeta[];
  /** Cap legs from one matchup on deep parlays (e.g. 4 for 12+ leg tickets). */
  maxPerGame?: number;
};

export type NearMissSwapResult = {
  pick: ParsedPick | null;
  note: string;
};

function scoreOpts(opts: NearMissLadderOpts) {
  return {
    realOdds: opts.realOdds ?? [],
    propPool: opts.propPool ?? [],
    propSimulations: opts.propSimulations,
    gameSimulations: opts.gameSimulations,
    matchupHistory: opts.matchupHistory,
    matchupInjuries: opts.matchupInjuries,
  };
}

/** Search posted alternates and return the best-value qualifying replacement, if any. */
export function swapNearMissPick(
  failed: ParsedPick,
  opts: NearMissLadderOpts,
): NearMissSwapResult {
  const sim = lookupSim(failed.game, opts.gameSimulations);
  const alts = collectScoredAlternates(failed, opts);
  if (!alts.length) return { pick: null, note: "" };

  const best = alts[0]!;
  const altHit = propHitForPick(best, opts.propSimulations);
  const altSim = best.isProp ? null : sim;
  const valueNote = formatAlternateValueNote(best, altSim, altHit);
  return {
    pick: best,
    note: `_Swapped **${failed.pick}** for **${best.pick}** — tested every posted alternate and chose the best overall value (${valueNote}), not just the safest line._`,
  };
}

function lookupSim(
  game: string,
  sims?: Map<string, CoachGameSimEntry>,
): CoachGameSimEntry | undefined {
  if (!sims) return undefined;
  const direct = sims.get(game);
  if (direct) return direct;
  for (const [label, sim] of sims) {
    if (gameLabelsMatch(label, game)) return sim;
  }
  return undefined;
}

/**
 * After picks are scored, walk alternate ladders for every leg that fails the
 * quality bar; drop legs only when no posted alternate clears the same gates.
 */
export function applyNearMissLadderToPicks(
  picks: ParsedPick[],
  opts: NearMissLadderOpts,
): { picks: ParsedPick[]; note: string } {
  const notes: string[] = [];
  const out: ParsedPick[] = [];

  for (const p of picks) {
    const sim = lookupSim(p.game, opts.gameSimulations);
    const hit = propHitForPick(p, opts.propSimulations);
    const passesQuality = p.isProp
      ? passesCoachPropQualityGate(p, hit ?? null)
      : isGameLinePick(p) &&
        passesCoachSimQualityGate(p, sim, {
          finalAi: p.finalAiScore,
          odds: p.odds,
        });
    const hasPositiveValue = metricsForAlternate(p, sim, hit ?? null) != null;

    if (passesQuality && hasPositiveValue) {
      out.push(p);
      continue;
    }

    const swapped = swapNearMissPick(p, opts);
    if (swapped.pick) {
      notes.push(swapped.note);
      out.push(swapped.pick);
    }
  }

  return { picks: out, note: notes.filter(Boolean).join("\n\n") };
}

function countPerGame(picks: ParsedPick[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of picks) {
    let key = p.game;
    for (const existing of counts.keys()) {
      if (sameGame(existing, p.game)) {
        key = existing;
        break;
      }
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function canAddToTicket(
  ticket: ParsedPick[],
  candidate: ParsedPick,
  maxPerGame?: number,
): boolean {
  if (!maxPerGame || maxPerGame <= 0) return true;
  const counts = countPerGame(ticket);
  for (const [game, n] of counts) {
    if (sameGame(game, candidate.game) && n >= maxPerGame) return false;
  }
  return true;
}


/**
 * Promote near-miss rejects and qualifying prop-board alternates onto the main
 * ticket (not backup cards) until the requested leg count or candidates run out.
 */
export function fillTicketFromNearMissLadder(
  picks: ParsedPick[],
  rejects: ParlayLegReject[],
  target: number,
  opts: NearMissLadderOpts,
): {
  picks: ParsedPick[];
  note: string;
  filled: number;
  remainingRejects: ParlayLegReject[];
} {
  if (picks.length >= target) {
    return { picks, note: "", filled: 0, remainingRejects: rejects };
  }

  const onTicket = new Set(picks.map(pickLegFingerprint));
  const notes: string[] = [];
  let out = [...picks];
  let remaining = [...rejects].sort((a, b) => b.nearScore - a.nearScore);

  for (let pass = 0; pass < 4 && out.length < target && remaining.length > 0; pass++) {
    const nextRemaining: ParlayLegReject[] = [];
    let progress = false;

    for (const reject of remaining) {
      if (out.length >= target) {
        nextRemaining.push(reject);
        continue;
      }
      const rejectFp = pickLegFingerprint(reject.pick);
      if (onTicket.has(rejectFp)) {
        nextRemaining.push(reject);
        continue;
      }

      const promoted = promoteRejectToTicket(reject, opts);
      if (promoted.pick) {
        const pfp = pickLegFingerprint(promoted.pick);
        if (!onTicket.has(pfp) && canAddToTicket(out, promoted.pick, opts.maxPerGame)) {
          out.push(promoted.pick);
          onTicket.add(pfp);
          progress = true;
          if (promoted.note) notes.push(promoted.note);
          continue;
        }
      }
      nextRemaining.push(reject);
    }

    remaining = nextRemaining;
    if (!progress) break;
  }

  if (out.length < target) {
    const fromPool = promotableFromPoolWithLadder(out, target - out.length, opts);
    for (const p of fromPool.picks) {
      const fp = pickLegFingerprint(p);
      if (!onTicket.has(fp) && canAddToTicket(out, p, opts.maxPerGame)) {
        out.push(p);
        onTicket.add(fp);
      }
    }
    notes.push(...fromPool.notes);
  }

  return {
    picks: out,
    note: notes.filter(Boolean).join("\n\n"),
    filled: out.length - picks.length,
    remainingRejects: remaining,
  };
}

/**
 * Last-chance sweep: walk every remaining reject through the ladder and add
 * qualifying alternates to the main ticket (never as backup cards).
 */
export function sweepRejectsOntoTicket(
  picks: ParsedPick[],
  rejects: ParlayLegReject[],
  target: number,
  opts: NearMissLadderOpts,
): {
  picks: ParsedPick[];
  remainingRejects: ParlayLegReject[];
  notes: string[];
  added: number;
} {
  if (picks.length >= target || !rejects.length) {
    return { picks, remainingRejects: rejects, notes: [], added: 0 };
  }

  const onTicket = new Set(picks.map(pickLegFingerprint));
  const out = [...picks];
  const notes: string[] = [];
  const remaining: ParlayLegReject[] = [];
  const sorted = [...rejects].sort((a, b) => b.nearScore - a.nearScore);

  for (const reject of sorted) {
    if (out.length >= target) {
      remaining.push(reject);
      continue;
    }
    const promoted = promoteRejectToTicket(reject, opts);
    if (promoted.pick) {
      const fp = pickLegFingerprint(promoted.pick);
      if (!onTicket.has(fp) && canAddToTicket(out, promoted.pick, opts.maxPerGame)) {
        out.push(promoted.pick);
        onTicket.add(fp);
        if (promoted.note) notes.push(promoted.note);
        continue;
      }
    }
    remaining.push(reject);
  }

  return {
    picks: out,
    remainingRejects: remaining,
    notes,
    added: out.length - picks.length,
  };
}

function qualifiesPositiveValueAlternate(
  original: ParsedPick,
  alt: ParsedPick,
  sim: CoachGameSimEntry | null | undefined,
  propHit: number | null | undefined,
): boolean {
  if (!metricsForAlternate(alt, sim, propHit ?? null)) return false;
  if (original.isProp) return passesCoachPropQualityGate(alt, propHit ?? null);
  if (!isGameLinePick(original)) return false;
  return passesCoachSimQualityGate(alt, sim, {
    finalAi: alt.finalAiScore,
    odds: alt.odds,
  });
}

/** All posted ladder rungs for a leg, scored and sorted by overall value (best first). */
function collectScoredAlternates(
  pick: ParsedPick,
  opts: NearMissLadderOpts,
  ladderOpts: { allGameMarkets?: boolean } = { allGameMarkets: true },
): ParsedPick[] {
  const sim = lookupSim(pick.game, opts.gameSimulations);
  const seen = new Set<string>();
  const out: ParsedPick[] = [];

  const tryAdd = (candidate: ParsedPick, propHit: number | null | undefined) => {
    const fp = pickLegFingerprint(candidate);
    if (seen.has(fp) || fp === pickLegFingerprint(pick)) return;
    if (!qualifiesPositiveValueAlternate(pick, candidate, sim, propHit ?? null)) return;
    seen.add(fp);
    out.push(candidate);
  };

  if (pick.isProp) {
    const pool = opts.propPool ?? [];
    for (const row of ladderPropCandidates(pick, pool)) {
      let candidate = parsedPickFromPoolEntry(row);
      const hit = propHitForPick(candidate, opts.propSimulations);
      candidate = attachPickScores([candidate], scoreOpts(opts))[0] ?? candidate;
      tryAdd(candidate, hit ?? null);
    }
  } else if (isGameLinePick(pick)) {
    const evalMap = opts.evalLinesByGame;
    const lines = evalMap
      ? evalLinesForGame(pick.game, evalMap)
      : (opts.realOdds ?? []).filter((e) => gameLabelsMatch(e.game, pick.game));
    if (!lines.length || !sim) return out;
    for (const entry of ladderGameLineCandidates(pick, lines, ladderOpts)) {
      const stub: ParsedPick = {
        game: entry.game,
        market: entry.market,
        pick: entry.pick,
        odds: entry.odds,
        sport: entry.sport ?? pick.sport,
        isProp: false,
        startsAt: entry.startsAt ?? pick.startsAt ?? null,
      };
      const scored = attachPickScores([stub], scoreOpts(opts))[0] ?? stub;
      tryAdd(scored, null);
    }
  }

  return out.sort((a, b) => {
    const ra =
      alternateOverallValueScore(a, sim, propHitForPick(a, opts.propSimulations) ?? null) ??
      -999;
    const rb =
      alternateOverallValueScore(b, sim, propHitForPick(b, opts.propSimulations) ?? null) ??
      -999;
    return rb - ra;
  });
}

export type TicketEdgeOptimizeResult = {
  picks: ParsedPick[];
  note: string;
  swaps: number;
  dropped: number;
};

export type TicketEdgeOptimizeOpts = NearMissLadderOpts & {
  /** Do not drop legs while the ticket is still short of this target. */
  minLegCount?: number;
  /** When false, only ladder swaps run — no leg trims (use while filling a short ticket). */
  allowLegDrops?: boolean;
};

function passesFillQualityGate(
  pick: ParsedPick,
  sim: CoachGameSimEntry | null | undefined,
  propHit: number | null | undefined,
): boolean {
  if (pick.isProp) return passesCoachPropQualityGate(pick, propHit ?? null);
  if (!isGameLinePick(pick)) return false;
  return passesCoachSimQualityGate(pick, sim, {
    finalAi: pick.finalAiScore,
    odds: pick.odds,
  });
}

function passesPositiveValueGate(
  pick: ParsedPick,
  sim: CoachGameSimEntry | null | undefined,
  propHit: number | null | undefined,
): boolean {
  if (!passesFillQualityGate(pick, sim, propHit ?? null)) return false;
  return metricsForAlternate(pick, sim, propHit ?? null) != null;
}

/** Reach-fill: strict gate plus positive EV / payout value (no buried chalk). */
function passesReachFillGate(
  pick: ParsedPick,
  sim: CoachGameSimEntry | null | undefined,
  propHit: number | null | undefined,
): boolean {
  return passesPositiveValueGate(pick, sim, propHit ?? null);
}

/** Try direct qualify, ladder swap, then any scored alternate — for ticket fill. */
function promoteRejectToTicket(
  reject: ParlayLegReject,
  opts: NearMissLadderOpts,
): { pick: ParsedPick | null; note: string } {
  const sim = lookupSim(reject.pick.game, opts.gameSimulations);
  const hit = propHitForPick(reject.pick, opts.propSimulations);
  const scored = attachPickScores([reject.pick], scoreOpts(opts))[0] ?? reject.pick;

  if (passesReachFillGate(scored, sim, hit ?? null)) {
    return { pick: scored, note: "" };
  }

  const swapped = swapNearMissPick(scored, opts);
  if (
    swapped.pick &&
    passesReachFillGate(
      swapped.pick,
      sim,
      propHitForPick(swapped.pick, opts.propSimulations) ?? null,
    )
  ) {
    return { pick: swapped.pick, note: swapped.note };
  }

  for (const alt of collectScoredAlternates(scored, opts)) {
    const altHit = propHitForPick(alt, opts.propSimulations);
    const altSim = alt.isProp ? null : sim;
    if (passesReachFillGate(alt, altSim, altHit ?? null)) {
      return {
        pick: alt,
        note: `_Promoted **${alt.pick}** from **${scored.pick}** — best overall value among posted alternates (${formatAlternateValueNote(alt, altSim, altHit)})._`,
      };
    }
  }

  return { pick: null, note: "" };
}

/** Prop-pool legs that barely missed — feed the ticket fill ladder. */
export function collectNearMissPropRejects(
  ticket: ParsedPick[],
  opts: NearMissLadderOpts,
  cap = 200,
): ParlayLegReject[] {
  const pool = opts.propPool ?? [];
  if (!pool.length) return [];
  const onTicket = new Set(ticket.map(pickLegFingerprint));
  const onPlayers = new Set(
    ticket.filter((p) => p.isProp && p.player).map((p) => norm(p.player!)),
  );
  const rejects: ParlayLegReject[] = [];
  const seen = new Set<string>();

  for (const e of pool) {
    if (rejects.length >= cap) break;
    if (onPlayers.has(norm(e.player))) continue;
    const stub = parsedPickFromPoolEntry(e);
    const fp = pickLegFingerprint(stub);
    if (onTicket.has(fp) || seen.has(fp)) continue;
    seen.add(fp);

    const scored = attachPickScores([stub], scoreOpts(opts))[0] ?? stub;
    const hit = propHitForPick(scored, opts.propSimulations);
    if (passesFillQualityGate(scored, null, hit ?? null)) continue;
    if (!isNearMissQualityFailure(scored, null, hit ?? null)) continue;

    const edge = pickEdgePct(scored) ?? 0;
    rejects.push({
      pick: scored,
      reason: `Prop near-miss — ${hit != null ? `${Math.round(hit * 100)}% sim` : "sim pending"}`,
      nearScore: (hit ?? 0) * 50 + Math.max(0, edge) * 3,
    });
  }

  return rejects;
}

const PROMOTABLE_POOL_SCAN_CAP = 150;

function promotableFromPoolWithLadder(
  ticket: ParsedPick[],
  limit: number,
  opts: NearMissLadderOpts,
): { picks: ParsedPick[]; notes: string[] } {
  const pool = opts.propPool ?? [];
  if (!pool.length || limit <= 0) return { picks: [], notes: [] };
  const onTicket = new Set(ticket.map(pickLegFingerprint));
  const seenPlayers = new Set(
    ticket.filter((p) => p.isProp && p.player).map((p) => norm(p.player!)),
  );
  const out: ParsedPick[] = [];
  const notes: string[] = [];
  const stubs: ParsedPick[] = [];

  for (const e of pool) {
    if (stubs.length >= PROMOTABLE_POOL_SCAN_CAP) break;
    if (seenPlayers.has(norm(e.player))) continue;
    const stub = parsedPickFromPoolEntry(e);
    const fp = pickLegFingerprint(stub);
    if (onTicket.has(fp)) continue;
    stubs.push(stub);
  }

  const scored = attachPickScores(stubs, scoreOpts(opts));
  const ranked = scored
    .map((pick) => ({
      pick,
      hit: propHitForPick(pick, opts.propSimulations),
      edge: pickEdgePct(pick) ?? 0,
    }))
    .sort((a, b) => b.edge - a.edge);

  for (const row of ranked) {
    if (out.length >= limit) break;
    let candidate = row.pick;
    let hit = row.hit;

    if (!passesCoachPropQualityGate(candidate, hit ?? null)) {
      const swapped = swapNearMissPick(candidate, opts);
      if (swapped.pick) {
        candidate = swapped.pick;
        hit = propHitForPick(candidate, opts.propSimulations);
        if (swapped.note) notes.push(swapped.note);
      }
    }

    if (!passesReachFillGate(candidate, null, hit ?? null)) continue;
    const fp = pickLegFingerprint(candidate);
    if (onTicket.has(fp) || !canAddToTicket(out, candidate, opts.maxPerGame)) continue;
    onTicket.add(fp);
    seenPlayers.add(norm(candidate.player ?? ""));
    out.push(candidate);
    notes.push(
      `_Added **${candidate.pick}** from the live prop board — a posted line cleared the 10k sim and Final AI gates._`,
    );
  }

  return { picks: out, notes };
}

/**
 * When ticket avg edge is negative but within 1% of zero, walk every leg's
 * alternate ladder and greedily swap for the best ticket-level edge gain.
 * Repeat until avg edge is positive or no improving alternate exists, then drop
 * the weakest-edge legs rather than keeping filler that drags the ticket under.
 */
export function optimizeTicketAverageEdge(
  picks: ParsedPick[],
  opts: NearMissLadderOpts,
  runOpts?: { minLegCount?: number },
): TicketEdgeOptimizeResult {
  if (picks.length === 0) {
    return { picks, note: "", swaps: 0, dropped: 0 };
  }

  let current = [...picks];
  let avg = averageTicketEdge(current);
  if (!shouldReoptimizeTicketEdge(avg) && (avg == null || avg >= 0)) {
    return { picks: current, note: "", swaps: 0, dropped: 0 };
  }

  const notes: string[] = [];
  let swaps = 0;
  let dropped = 0;
  const maxRounds = Math.max(8, current.length * 4);

  for (let round = 0; round < maxRounds; round++) {
    avg = averageTicketEdge(current);
    if (avg != null && avg > 0) break;
    if (avg == null || avg <= -1) break;
    if (!shouldReoptimizeTicketEdge(avg) && avg < 0) break;

    let best: { idx: number; pick: ParsedPick; newAvg: number } | null = null;
    for (let i = 0; i < current.length; i++) {
      const leg = current[i]!;
      for (const alt of collectScoredAlternates(leg, opts)) {
        const trial = current.map((p, j) => (j === i ? alt : p));
        const trialAvg = averageTicketEdge(trial);
        if (trialAvg == null) continue;
        const curAvg = avg ?? -999;
        if (trialAvg > curAvg && (!best || trialAvg > best.newAvg)) {
          best = { idx: i, pick: alt, newAvg: trialAvg };
        }
      }
    }

    if (!best) break;
    const old = current[best.idx]!;
    current[best.idx] = best.pick;
    swaps += 1;
    notes.push(
      `_Swapped **${old.pick}** for **${best.pick.pick}** — alternate line lifts ticket avg edge (${avg}% → ${best.newAvg}%)._`,
    );
    if (best.newAvg > 0) break;
  }

  avg = averageTicketEdge(current);
  const floor = runOpts?.minLegCount ?? 0;
  const allowDrops = runOpts?.allowLegDrops !== false;
  while (allowDrops && current.length > 1 && avg != null && avg < 0) {
    if (floor > 0 && current.length <= floor) break;
    const dropIdx = weakestEdgeLegIndex(current);
    if (dropIdx == null) break;
    const removed = current[dropIdx]!;
    current = current.filter((_, j) => j !== dropIdx);
    dropped += 1;
    const nextAvg = averageTicketEdge(current);
    notes.push(
      `_Dropped **${removed.pick}** — trimmed a weak-edge leg so the ticket average isn't negative (${avg}% → ${nextAvg ?? "—"}%)._`,
    );
    avg = nextAvg;
    if (avg != null && avg > 0) break;
  }

  return {
    picks: current,
    note: notes.filter(Boolean).join("\n\n"),
    swaps,
    dropped,
  };
}
